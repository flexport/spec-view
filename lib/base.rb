# typed: ignore
# TEAM: backend_infra
module SpecView
  WAIT_LOG_THRESHOLD_MS = 500
  # Base spec view, which defines the inherent mechanics behind spec views, as
  # well as the default components that all spec views have
  class Base
    # Convenience helpers are on both classes and instances
    extend SpecView::SpecViewHelpers
    include SpecView::SpecViewHelpers

    attr_reader :name, :is_snapshot

    delegate :click, :send_keys, :checked?, :disabled?, :hover, to: :interaction_element
    delegate :value, :toggle, :clear, to: :native_interaction_element

    def initialize(name: self.class.name.demodulize, info: nil, element: nil, context: nil, is_snapshot: false)
      @name = name
      @info = info
      @element = element
      @context = context
      @is_snapshot = is_snapshot

      # Because we use method_missing for delegation, internal bugs within the
      # Base class can result in stack overflows. This array keeps track of
      # method_missing delegations already in the call stack and errors early if
      # they recurse.
      @prohibited_delegation_methods = []
    end

    # Subclasses define this to allow themselves to be used instead of selectors
    def self.default_selector(selector)
      define_singleton_method(:_get_default_selector) { selector }
    end

    # Create a subclass that overrides the default selector.
    def self.with_selector(selector)
      Class.new(self) do
        default_selector selector
        # This is an anonymous class, so we have to give it a name
        def self.name
          "#{superclass.name}{#{_get_default_selector}}"
        end
      end
    end

    # Create a subclass that reuses the parent view's element. This is useful
    # when you conceptually have a unique subview, but that subview is not
    # cleanly reflected by the DOM.
    def self.with_same_element
      with_selector(:identity)
    end

    def self.with_contents(contents)
      with_selector("#{_get_default_selector}:contains(#{contents})")
    end

    def self.with_label(label)
      with_selector("label:contains(#{label}) #{_get_default_selector}")
    end

    # Helper to make a selector for a component with a given props hash
    def self.make_react_selector(name, **props)
      "@#{name}#{props.to_json}"
    end

    def self.with_react_selector(*args)
      with_selector(make_react_selector(*args))
    end

    # Extend existing react selector with another property hash Note: if the
    # last part of the original selector is not a react selector, the resulting
    # selector will be invalid
    def self.with_props(**props)
      original = _get_default_selector
      prop_string = props.to_json
      # Add comma to concatenate if needed
      prop_string = ",#{prop_string}" if original.end_with?("}")
      with_selector("#{original}#{prop_string}")
    end

    # Methods that do not wait for non-empty results when delegating. You can
    # override this to add your own symbols if needed, but be sure to call
    # super.
    def no_wait_method_names
      [:empty?, :exists?]
    end

    # Get the Capybara element associated with this spec view. Because SpecView
    # delegates method calls to its element, you usually don't need to call
    # this.
    #
    # By default, this waits for the element to exist, and will raise an
    # exception if the element is not found. This can be disabled by passing
    # wait: false.
    def element(
      wait: !is_snapshot_descendent?,
      seconds_to_wait: nil # Used in tests to test wait behavior in reasonable time
    )
      seconds_to_wait = seconds_to_wait.nil? ? Capybara.default_max_wait_time : seconds_to_wait
      snapshot = _snapshot(wait: wait, seconds_to_wait: seconds_to_wait)
      snapshot.snapshot_element
    end

    def snapshot_element
      raise "#{name} is not a snapshot" unless @is_snapshot
      @element
    end

    # Get the element used to do UI interactions
    def interaction_element
      _convert_selenium_to_capybara(native_interaction_element)
    end

    # The lower level selenium API has some interactions that aren't exposed by Capybara
    def native_interaction_element
      call_fetcher_function("interactionElement")
    end

    def first
      at(0)
    end

    def last
      at(-1)
    end

    def at(index)
      child_name = "#{@name}.at(#{index})"
      self.class.new(name: child_name, info: {**@info, at: index}, context: @context)
    end

    # Declare a component.
    # Usage examples:
    #
    #  A simple selector for a single button
    #    component :submit_button, 'button.submit'
    #  An array of table rows:
    #    component :carrier_rows, ['tr.carrier-row']
    #      or
    #    component :carrier_rows, 'tr.carrier-row', multi: true
    #  A subview with its own SpecView
    #    component :customs_info_form, CustomsInformationFormView
    #  A subview with a custom selector
    #    component :customs_info_form, CustomsInformationFormView.with_selector('@CustomsInformationForm{title: "Edit"}')
    #  A section component which narrows down the search for its children
    #    component :modal_header, '.modal-header' do
    #      component :modal_close, 'button'
    #      component :modal_title, 'h1'
    #    end
    #  (the title component could then be accessed as view.modal_title, which would find an
    #  h1 inside the .modal-header element)
    #
    # Note that while `selector` is executed relative to the parent element,
    # the `matcher` argument is executed with respect to the document itself. See
    # the SpecViewReadme.md for more info.
    # rubocop:disable Metrics/ParameterLists
    def self.component(
      name,
      selector = nil,
      view_class: self,
      multi: false,
      at: nil, # Combined with multi, lets you get a specific element out of a list
      parent: nil, # symbol of parent, used for subcomponents
      **kwargs,
      &block
    )
      # rubocop:enable Metrics/ParameterLists
      method_body = self._create_component_method_proc(
        name,
        selector,
        view_class: view_class,
        multi: multi,
        at: at,
        parent: parent,
        **kwargs,
      )

      define_method(name, method_body)

      if block
        # If a block is provided, run in a child component context
        child_context = ChildComponentContext.new(self, name)
        child_context.instance_exec(&block)
      end
    end

    def self._create_component_method_proc(
      name,
      selector = nil,
      view_class: self,
      multi: false,
      at: nil, # Combined with multi, lets you get a specific element out of a list
      parent: nil, # symbol of parent, used for subcomponents
      **kwargs
    )
      raise ArgumentError.new("Must have selector") if selector.nil?
      if selector.is_a?(Array)
        selector = selector.first
        multi = true
      end

      # Detect subcomponent syntax (view class as selector)
      if selector.is_a?(Base.class)
        view_class = selector
        selector = view_class._get_default_selector
      end

      info = {
        name: name,
        selector: selector,
        multi: multi,
        view_class: view_class,
        at: at,
      }

      return -> {
        child_name = "#{@name}.#{name}"
        child_name = "#{child_name}<#{view_class.name.demodulize}>" if view_class != self.class
        context = parent.nil? ? self : self.public_send(parent)
        view_class.new(name: child_name, info: info, context: context)
      }
    end

    # Custom find of an SVCSS selector; result is just like if you defined a
    # component. Prefer defining components, but this is particularly helpful in
    # debugging selectors.
    def find(*component_args)
      method_body = self.class._create_component_method_proc(:custom_find, *component_args)
      instance_exec(&method_body)
    end

    # Convenience components to get decorated children. These can be used with
    # react component spec views, since they cannot be snapshotted directly.
    component :el, "> *"
    component :els, ["> *"]

    # Is the final result of this going to be a SpecViewArray? (A non-multi
    # component will return true if it is the child of a multi component)
    def is_multi?
      return false if @context.nil?
      return false unless @info
      return true if @info[:multi]
      return @context.is_multi?
    end

    def is_snapshot_descendent?
      return true if @is_snapshot
      return false if @context.nil?
      return true if @context.is_snapshot_descendent?
      return false
    end

    # Call a fetcher function by name with some arguments. This will not wrap
    # elements in SpecView, but arrays will be wrapped in SpecViewArray
    #
    # This is used internally to provide a frontend for the functions defined in
    # fetcherFunctions.js
    #
    # TODO: It would be nice to have query functions that can return
    # elements/components, and turn into deferred execution. This will require
    # making SpecViews that wrap non-query fetchers
    def call_fetcher_function(fn_name, *args, wait: !is_snapshot_descendent?, seconds_to_wait: Capybara.default_max_wait_time)
      context = _fetcher
      fetcher = {
        context: context,
        fn: fn_name,
        args: args,
      }

      name = "#{@name}.#{fn_name}()"

      raw_result = execute_fetcher(
        fetcher,
        name: name,
        wait: wait,
        seconds_to_wait: seconds_to_wait,
      )

      wrap_function_result(raw_result, name)
    end

    def wrap_function_result(raw_result, base_name = name)
      if raw_result.is_a?(Array)
        wrapped_result = raw_result.each_with_index.map do |item, index|
          wrap_function_result(
            item,
            "#{base_name}[#{index}]",
          )
        end
        SpecViewArray.new(base_name, wrapped_result)
      else
        raw_result
      end
    end

    # fetcher-based functions
    # You can always pass wait: <boolean> and seconds_to_wait: number

    # Get text of the element/component
    def text(**kwargs)
      call_fetcher_function("text", **kwargs)
    end

    def exists?(**kwargs)
      call_fetcher_function("exists", **kwargs)
    end

    def gone?(**kwargs)
      !exists?(**kwargs)
    end

    def count(**kwargs)
      call_fetcher_function("count", **kwargs)
    end

    def prop(key)
      call_fetcher_function("prop", key, wait: false)
    end

    def flash(milliseconds = 500)
      call_fetcher_function("highlight", milliseconds)
    end

    def highlight
      call_fetcher_function("highlight")
    end

    def clear_highlights
      execute_script("_SpecView.$('.specview-highlight').remove()")
    end

    def wait_until_exists(seconds_to_wait: nil)
      wait_for(seconds_to_wait: seconds_to_wait) do
        exists?
      end
    end

    def wait_until_gone(seconds_to_wait: nil)
      wait_for(seconds_to_wait: seconds_to_wait) do
        gone?
      end
    end

    # Wait until exists? and Capybara::Node::Element#visible?
    def wait_until_visible(seconds_to_wait: nil)
      wait_for(seconds_to_wait: seconds_to_wait) do
        exists? && el.visible?
      end
    end

    def click_and_wait(*args)
      click
      settle(*args)
    end

    def hover_and_wait
      hover
      settle
    end

    def base_load(url, retry_count = 0)
      begin
        page.visit(url)
      rescue Net::ReadTimeout => e
        if retry_count < 3
          # With recent selenium upgrade, we are seeing many timeouts just on
          # the the inital visit, lets retry for this error
          ErrorLogger.warn("Retrying load due to timeout")
          base_load(url, retry_count + 1)
        else
          raise e
        end
      end

      ready
    end

    def ready
      settle
    end

    # Create the data which the browser runtime can execute to find a result set
    def _fetcher
      if @is_snapshot
        return nil unless @element
        return @element.native
      end

      context = @context
      return {isRoot: true} if context.nil?
      context = context._fetcher if context.respond_to?(:_fetcher)

      # See self.with_same_element
      return context if @info[:selector] == :identity

      return {
        context: context,
        query: {
          selector: @info[:selector],
          multi: @info[:multi],
          at: @info[:at],
        },
      }
    end

    def execute_fetcher(fetcher, name: @name, wait: true, seconds_to_wait: Capybara.default_max_wait_time)
      result = nil
      # fetch into result
      do_fetch = proc {
        result = call_script_function("fetcher => _SpecView.fetch(fetcher)", fetcher)
      }

      # Wait with intermittent logging to diagnose slow tests
      if wait
        # Use process clock so that libraries like Timecop don't interfere.
        start_time = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        synchronize(seconds_to_wait) do
          # Execute the fetcher and throw if empty
          do_fetch.call
          if result.nil? || result == []
            if Process.clock_gettime(Process::CLOCK_MONOTONIC) - start_time > WAIT_LOG_THRESHOLD_MS / 1000
              Rails.logger.info("#{inspect}: Fetcher took more than #{WAIT_LOG_THRESHOLD_MS} ms")
            end
            raise Capybara::ElementNotFound.new("Got no result for #{name}")
          end
        end
      else
        do_fetch.call
      end

      result
    end

    # Get either the SpecView, the SpecViewArray, or nil by executing the fetcher
    def _snapshot(
      wait: !is_snapshot_descendent?,
      seconds_to_wait: Capybara.default_max_wait_time # Used in tests to test wait behavior in reasonable time
    )
      # If already a snapshot view, just return it
      return self if @is_snapshot

      raw_result = execute_fetcher(_fetcher, wait: wait, seconds_to_wait: seconds_to_wait)

      _make_snapshot_result(raw_result)
    end

    def _convert_selenium_to_capybara(node)
      base_node = Capybara::Selenium::Node.new(driver, node)
      Capybara::Node::Element.new(page, base_node, nil, nil)
    end

    # Create either a SpecView or a multi-dimensional SpecView array
    def _make_snapshot_result(raw_result, base_name = name)
      # Recurse with arrays then turn into delegating array type
      if raw_result.is_a?(Array)
        wrapped_result = raw_result.each_with_index.map do |item, index|
          _make_snapshot_result(
            item,
            "#{base_name}[#{index}]",
          )
        end
        return SpecViewArray.new(base_name, wrapped_result)
      end
      if raw_result.nil? || raw_result.is_a?(Selenium::WebDriver::Element)
        # Convert to Capybara element
        if raw_result.nil?
          element = nil
        else
          element = _convert_selenium_to_capybara(raw_result)
        end
        return self.class.new(name: base_name, element: element, is_snapshot: true, info: @info)
      end
      raise ArgumentError.new("Unknown type for _make_snapshot_result: #{raw_result.class}")
    end

    def respond_to_missing?(name, include_private = false)
      if is_multi?
        return true if SpecView::SpecViewArray.method_defined?(name)
        if include_private
          return true if SpecView::SpecViewArray.private_method_defined?(name)
        end
      end

      return true if Capybara::Node::Element.method_defined?(name)
      if include_private
        return true if Capybara::Node::Element.private_method_defined?(name)
      end
      return false
    end

    def method_missing(name, *args, &block)
      # If an internal implementation tries to call a method that doesn't
      # exist and can't be delegated, it can cause an infinite recurse. This
      # catches that early.
      #
      # This should be the absolute first thing to happen in this method,
      # because any typo'd method that gets called before this check will likely
      # cause a SystemStackError
      if @prohibited_delegation_methods.include?(name)
        raise "Infinite delegation loop for method #{name} on #{self.name}"
      end

      # Only respond if respond_to_missing is true
      unless respond_to_missing?(name, true)
        return super
      end

      begin
        @prohibited_delegation_methods << name

        if @is_snapshot
          delegate = @element
        else
          wait = !no_wait_method_names.include?(name) && !is_snapshot_descendent?
          delegate = _snapshot(wait: wait)
        end

        return nil if delegate.nil?
        if delegate.respond_to?(name, false)
          delegate.public_send(name, *args, &block)
        else
          super
        end
      ensure
        @prohibited_delegation_methods.delete(name)
      end
    end

    # Retrieves the browser logs from selenium, only gets warnings and errors
    # under current configuration
    def browser_logs
      page.driver.browser.manage.logs.get(:browser)
    end

    def inspect
      "#<#{self.class.name.demodulize}:#{name}>"
    end

    def _js_runtime
      @_js_runtime ||= begin
        dir = File.expand_path("runtime", __dir__)
        manifest = YAML.safe_load(File.read("#{dir}/manifest.yml"))
        runtime_scripts = manifest.map do |line|
          path = "#{dir}/#{line}"
          code = File.read(path)
          # simple modulize
          %@
            (() => {
              try {
                #{code}
              } catch (e) {
                // Alert on runtime init error to stop tests early
                window.alert("Error setting up SpecView runtime in #{line}: " + e.message)
              }
            })();
          @
        end
        %(
          // Create SpecView namespace if needed
          window._SpecView = window._SpecView || {};
          _SpecView.loaded = true;
          #{runtime_scripts.join}
        )
      end
    end

    # Wrap a script with runtime check. This will return early if the runtime
    # isn't injected, so that we can inject and retry. Output of modified script
    # will be {needsRuntime: <bool>, result: <any>}
    def _wrap_script_for_runtime(script)
      return %@
        if (!window._SpecView.loaded) return {hasRuntime: false};
        let wrappedResult;
        let logs = [];
        // Add logger
        _SpecView.log = function (...args) {
          args = args.map(arg => (typeof arg === 'object') ? JSON.stringify(arg, null, 2) : arg);
          logs.push(args.join(''))
        };
        const oldConsoleLog = console.log;
        try {
          let result = (function() {
            #{script}
          }).apply(null, arguments);
          wrappedResult = {hasRuntime: true, result};
        } catch (err) {
          wrappedResult = {error: err.stack}
        } finally {
          wrappedResult.logs = logs;
        }
        return wrappedResult;
      @
    end

    def try_run_wrapped_script(wrapped_script, *args)
      result = browser.execute_script(wrapped_script, *args)

      # If the script used _SpecView.log, print out the log lines
      if result["logs"].present?
        puts("Begin execute_script logs...")
        result["logs"].each do |log_line|
          puts(log_line)
        end
        puts("...end execute_script logs:")
      end

      # Translate javascript error into ruby error, if one was thrown
      raise result["error"] if result["error"]

      return result
    end

    # Call javascript in the client, passing in some arguments. Example:
    #   view.execute_script('return arguments[0] + 5', 8)
    # would return 13.
    #
    # Note, native Selenium elements are supported, but they must currently be
    # unwrapped. A SpecView's element is a Capybara element, so you must call
    # its `native` method to run pass it into execute_script.
    #
    # Additionally, if your script returns an element, or array of elements,
    # those will be raw Selenium elements. Unfortunately, it is currently
    # difficult to turn those into Capybara elements, so it's usually easier to
    # process everything on the client and return something other than DOM
    # elements when possible.
    #
    # It's often cleaner to use call_script_function.
    #
    # TODO: Transform element arguments (including those inside arrays) into
    # native nodes
    def execute_script(script, *args)
      # TODO: transform native node and Array<native node> return values into capybara elements

      # Wrap the script with standard runtime boilerplate, which detects whether
      # we've injected the runtime. If the runtime has not been injected, the
      # inner code will not be run, but the wrapped result will note that the
      # runtime was not injected.
      wrapped_script = _wrap_script_for_runtime(script)

      # Try to run the script as is (in most cases, the runtime is already
      # installed)
      result = try_run_wrapped_script(wrapped_script, *args)

      # If the runtime hasn't been injected, inject it now and rerun the script
      unless result["hasRuntime"]
        browser.execute_script(_js_runtime)
        result = try_run_wrapped_script(wrapped_script, *args)
      end

      # We now know that the runtime has been injected, so if we see no runtime
      # the second time, something is broken.
      raise "Failed to inject runtime" unless result["hasRuntime"]

      return result["result"]
    end

    # Sugar to call a function with arguments.
    # Example:
    #   view.call_script_function("el => el.childElementCount > 0", some_element.native)
    # will return whether the some_element has any child elements.
    def call_script_function(fn_string, *args)
      execute_script("return (#{fn_string})(...arguments)", *args)
    end

    def session_storage_get(key)
      execute_script("return sessionStorage.getItem(arguments[0])", key)
    end

    def session_storage_set(key, value)
      execute_script("sessionStorage.setItem(arguments[0], arguments[1])", key, value)
    end

    class ConditionNotMet < StandardError
    end

    # Helper function to wait for some predicate to be true before continuing execution.
    # Defaults to waiting one minute
    # Example:
    #   view.wait_for { view.modal.exists? }
    # If the block is expected to throw exceptions, you can pass those in to wait for them to stop
    def wait_for(
      expected_errors = [],
      seconds_to_wait: nil # Used in tests to test wait behavior in reasonable time
    )
      seconds_to_wait = seconds_to_wait.nil? ? Capybara.default_max_wait_time : seconds_to_wait
      synchronize seconds_to_wait, errors: expected_errors + [ConditionNotMet] do
        raise ConditionNotMet unless yield
      end
    end

    # Wait until all network requests are settled. You can pass an array of
    # pairs which are params to `new RegExp(...)` as url patterns to exclude
    # from the wait. See default_ignored_network_patterns for examples. Remember
    # to be kind to different test environments, and don't assume a specific
    # host or protocol.
    def wait_for_network(ignore_patterns = [], seconds_to_wait: nil)
      all_ignored_patterns = default_ignored_network_patterns + ignore_patterns
      wait_for(seconds_to_wait: seconds_to_wait) do
        !call_script_function("_SpecView.hasOutstandingRequests", all_ignored_patterns)
      end
    end

    def wait_for_view_activity(ignored_timer_patterns = [], seconds_to_wait: Capybara.default_max_wait_time)
      all_ignored_patterns = default_ignored_timer_patterns + ignored_timer_patterns
      wait_for(seconds_to_wait: seconds_to_wait) do
        !call_script_function("_SpecView.hasViewActivity", all_ignored_patterns)
      end
    end

    def bounding_rectangle
      call_script_function("el => el.getBoundingClientRect()", native).slice(
        "bottom",
        "left",
        "right",
        "top",
      )
    end

    # Wait until the bounds of a specific component no longer change.
    # Specifically, this compares the bottom, left, right, top of the element between wait_for calls
    # and looks for them to be still for a minimum_still_time
    def wait_until_still(minimum_still_time: 1 / 30.0, seconds_to_wait: Capybara.default_max_wait_time)
      wait_for(seconds_to_wait: seconds_to_wait) do
        start_bounds = bounding_rectangle
        remains_true_for?(minimum_still_time) { bounding_rectangle == start_bounds }
      end
    end

    # scrolls current element into viewport
    def scroll_to
      call_script_function("el => el.scrollIntoView()", native_interaction_element)
    end

    # scrolls a DOM element a set number of pixels
    def scroll_by(x_pixels, y_pixels)
      call_script_function(
        "(el, x, y) => el.scrollBy(x, y)",
        native_interaction_element,
        x_pixels,
        y_pixels,
      )
    end

    # Regexes for urls that should be ignored when waiting for network requests.
    #
    # Each pattern should be an array of one or two strings, which are used as
    # the inputs to the javascript RegExp constructor
    def default_ignored_network_patterns
      []
    end

    # Substrings to match against stack traces for timers. If they match, the
    # timer will not be tracked for view activity detection.
    #
    # Each pattern should be an array of one or two strings, which are used as
    # the inputs to the javascript RegExp constructor
    def default_ignored_timer_patterns
      []
    end

    def settle(ignored_network_patterns = [], ignored_timer_patterns = [], seconds_to_wait: Capybara.default_max_wait_time, min_settle_seconds: 0.05)
      wait_for(seconds_to_wait: seconds_to_wait) do
        remains_true_for?(min_settle_seconds) { !unsettled?(ignored_network_patterns) }
      end
    end

    protected

    # Is there network or view activity?
    def unsettled?(ignored_network_patterns = [], ignored_timer_patterns = [])
      all_ignored_network_patterns = default_ignored_network_patterns + ignored_network_patterns
      all_ignored_timer_patterns = default_ignored_timer_patterns + ignored_timer_patterns
      call_script_function(
        "_SpecView.hasNetworkOrViewActivity",
        all_ignored_network_patterns,
        all_ignored_timer_patterns,
      )
    end

    # Check that the block provided remains true for at least some number of
    # seconds. This is a building block for wait_for* methods, not generally
    # intended to be used outside of this file.
    #
    # Note: this calls the passed block in a tight loop, and should therefore
    # only be used with blocks that are in some way IO bound (like selenium
    # calls that talk to the browser)
    def remains_true_for?(min_seconds)
      check_end = now + min_seconds
      loop do
        start_of_loop = now
        break false unless yield
        break true if start_of_loop > check_end
      end
    end

    # Monotonic time, immune to timecop's diabolical machinations
    def now
      Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end
  end

  class ChildComponentContext
    def initialize(view_class, parent_symbol)
      @view_class = view_class
      @parent_symbol = parent_symbol
      @prohibited_delegation_methods = []
    end

    def child(*args, **kwargs, &block)
      @view_class.component(*args, **kwargs, parent: @parent_symbol, &block)
    end

    def component(*args)
      raise 'Use "child" to define child components, not "component"'
    end

    def respond_to_missing?(name, include_private = false)
      # While ChildComponentContext is an instance, we are forwarding to a
      # class, so its singleton class is what we actually care about.
      singleton = @view_class.singleton_class
      return true if singleton.method_defined?(name)
      if include_private
        return true if singleton.private_method_defined?(name)
      end
      return false
    end

    def method_missing(name, *args, &block)
      if @prohibited_delegation_methods.include?(name)
        # If an internal implementation tries to call a method that doesn't
        # exist and can't be delegated, it can cause an infinite recurse. This
        # catches that early.
        raise "Infinite delegation loop for method #{name} in child context for #{@parent_symbol}"
      end

      begin
        @prohibited_delegation_methods << name
        if respond_to_missing?(name)
          @view_class.public_send(name, *args, &block)
        else
          super
        end
      ensure
        @prohibited_delegation_methods.delete(name)
      end
    end
  end
end
