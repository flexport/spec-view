# SpecView API docs
<!--
    Unfortunately, GitHub doesn't have automatic TOC generation, and SpecView doesn't lend itself well to automatic doc generation, so the TOC is generated with the MarkdownTOC Sublime plugin for now. If you update this file, you'll need to either have that plugin installed, or make sure you manually keep the TOC below in sync.
-->
<!-- MarkdownTOC autolink="true" levels="1,2,3,4" -->

- [SpecView](#specview)
  - [Class methods](#class-methods)
    - [`component(name, selector, **kwargs, &block)`](#componentname-selector-kwargs-block)
    - [`child(...)`](#child)
    - [`default_selector(selector: string)`](#default_selectorselector-string)
    - [`with_selector(selector: string)`](#with_selectorselector-string)
    - [`with_same_element`](#with_same_element)
    - [`make_react_selector(name, **props)`](#make_react_selectorname-props)
    - [`with_react_selector(name, **props)`](#with_react_selectorname-props)
    - [`with_props(**props)`](#with_propsprops)
  - [Instance methods](#instance-methods)
    - [`element(wait: boolean, seconds_to_wait: number?)`](#elementwait-boolean-seconds_to_wait-number)
    - [`interaction_element`](#interaction_element)
    - [`native_interaction_element`](#native_interaction_element)
    - [`at(index: number)`](#atindex-number)
    - [`first`, `last`](#first-last)
    - [`text`](#text)
    - [`exists?`](#exists)
    - [`gone?`](#gone)
    - [`count`](#count)
    - [`prop(key)`](#propkey)
    - [`find(selector, **kwargs)`](#findselector-kwargs)
    - [`highlight`](#highlight)
    - [`clear_highlights`](#clear_highlights)
    - [`flash(milliseconds = 500)`](#flashmilliseconds--500)
    - [`click_and_wait`](#click_and_wait)
    - [`base_load(url: string)`](#base_loadurl-string)
    - [`ready`](#ready)
    - [`browser_logs`](#browser_logs)
    - [`execute_script(script: string, *args)`](#execute_scriptscript-string-args)
    - [`call_script_function(fn_string: string, *args)`](#call_script_functionfn_string-string-args)
    - [`scroll_to`](#scroll_to)
    - [`scroll_by(x_pixels, y_pixels)`](#scroll_byx_pixels-y_pixels)
    - [`bounding_rectangle`](#bounding_rectangle)
  - [Waiting Methods](#waiting-methods)
    - [`settle`](#settle)
    - [`wait_until_exists`](#wait_until_exists)
    - [`wait_until_gone`](#wait_until_gone)
    - [`wait_for(expected_errors: Array?, seconds_to_wait: number?, &block)`](#wait_forexpected_errors-array-seconds_to_wait-number-block)
    - [`wait_for_network`](#wait_for_network)
    - [`default_ignored_network_patterns`](#default_ignored_network_patterns)
    - [`default_ignored_timer_patterns`](#default_ignored_timer_patterns)
    - [`wait_for_view_activity`](#wait_for_view_activity)
    - [`wait_until_still`](#wait_until_still)
    - [`wait_until_visible`](#wait_until_visible)
  - [Delegated methods](#delegated-methods)
- [SpecViewArray](#specviewarray)
  - [Instance methods](#instance-methods-1)
    - [`==(other)`, `eql?(other)`](#other-eqlother)
    - [`to_a`, `to_ary`](#to_a-to_ary)
    - [Delegated methods](#delegated-methods-1)
- [Fetcher Execution](#fetcher-execution)

<!-- /MarkdownTOC -->

The following documentation covers the public API for the SpecView framework, along with some deeper explanation of SpecView's execution model.

## SpecView

### Class methods

#### `component(name, selector, **kwargs, &block)`

Defines a component instance method for this SpecView class.

##### _`name: symbol`_

The method name.

##### _`selector: string | SpecView subclass | Array<string | subclass>`_

_string_

A SpecView-CSS selector which matches a particular HTML element or React component. See [SpecViewReadme.md](./SpecViewReadme.md) about selector syntax

_SpecView subclass_

A subclass to use for this component. This is particularly useful for basic components which often have the same selector and common behavior. The actual selector used to match the component is defined by `default_selector` (see below).

_Array_

Same behavior as string or subclass, but used as syntactic sugar to tell the SpecView that this is a _list_ of components. See the "Fetcher Execution" section below for more details.

Multi-components increase the dimensionality of the fetcher by 1. That is, if you chain three multi-components together like this:

```ruby
view.houses.kitchens.stoves
```

then you will have a three dimensional array – every stove of every kitchen, for every house.

When the term "mapping function" is used in this document, it means that we start with an n-dimensional array, and then do some operation on each of its elements, returning a new n-dimensional array with the same structure. For example, calling `text` on a multi-dimensional SpecView, like

```ruby
view.companies.employees.first_name.text
```

will return a two dimensional array containing the text for each employee for each company. For example, if your page looked like this:

```
Two Rivers Inc
  Description: Forestry services company

  Employees:
    Randal Thor
    555 0143

Eyes to Die For
  Description: Colored contact lens retailer

  Employees:
    Elaine Tracand
    555 2139

    Maurine D'Amodred
    555 3188
```


Then the above query would return:

```ruby
[ #Companies
  [ # Employees
    "Randal", # First name
  ],
  [ #Employees
    "Elaine", # First name
    "Maurine", # First name
  ],
]
```

##### _kwargs_

###### _view\_class_

A SpecView subclass to use for this component. By default, the component will produce instances of the parent SpecView class.

###### _multi: boolean_

Another way to specify a list component. Same effect as using an array selector.

###### _at: integer_

Can only be used with a multi selector. Allows you to specify a particular index into the list. May be negative to index from the end. For example

```ruby
component :last_jedi, ['@Jedi'], at: -1
```

will define a _non_-list component that gets the last `Jedi` react component on the page.

##### &block

If you provide a block, you can specify child components with the `child` method (see below).

#### `child(...)`

You can only use this inside the block given to a `component` call. It has the same behavior as `component`, but defines components within the context of a parent component. This is nestable; you may pass a block to `child` and call `child` within that block as well.

#### `default_selector(selector: string)`

Specifies the selector to use when this SpecView class is used in other SpecViews' `component` calls. For example:

```ruby
class ListView < SpecView::Base
    default_selector "div.list"
end

class OuterView < SpecView::Base
    component :inner, ListView
end
```

The `list` component method on an `OuterView` instance will return a SpecView of class `ListView` which searches for the selector `div.list`.

#### `with_selector(selector: string)`

Creates a one-off subclass that overrides the default selector of this SpecView class (that is, the old default selector will be completely ignored). The following two lines do essentially the same thing:

```ruby
component :ok_button, "button:contains(OK)", view_class: ButtonView
# and
component :ok_button, ButtonView.with_selector("button:contains(OK)")
```

#### `with_same_element`

In rare cases, you may have content which is well encapsulated by a SpecView subclass, but which doesn't have its own clearly defined container element. In these cases, you can use `with_same_element` to tell the SpecView to simply reuse the parent's element (or react component). For example:

```ruby
class TabView < Base
  default_selector "div.tab-view"
  component :cat_tab, "ul.tabs li:contains(cat)"
  component :dog_tab, "ul.tabs li:contains(dog)"
  component :cat_tab_content, CatView.with_same_element
  component :dog_tab_content, DogView.with_same_element
end

view = TabView.new
```

In the above example, but `view.cat_tab_content` and `view.dog_tab_content` will point at the same DOM element as `view`, but their respective subclasses will provide different behavior.


#### `make_react_selector(name, **props)`

Constructs a react selector based on a component name and properties. For example:

`make_react_selector('Label', text: "Foo")`

will return `@Label{text: "Foo"}` which is a selector that will match a Label component with the `text` property "Foo".

#### `with_react_selector(name, **props)`

Convenience method, composition of `with_selector` and `make_react_selector`

#### `with_props(**props)`

Given a class with a default react component selector, create a new selector adding `props` to the property matcher.

Example:

```ruby
component :save_button, ButtonView.with_props label: "Save"
```

This results in a selector like `@Button{label: "Save"}`, because it extends `ButtonView`'s default selector with the props given.

### Instance methods

#### `element(wait: boolean, seconds_to_wait: number?)`

Fetch the Capybara element (or `SpecViewArray` of elements) for this SpecView. **You almost never need to call this method directly**, and doing so may make your tests flakier, because Capybara elements can go stale. Whenever possible, use SpecViews to defer fetcher execution until the moment an element is needed.

If the SpecView instance points at a React component (or list of such), this method will error. If you need an element to interact with regardless of what kind of fetcher your SpecView represents, use `interaction_element` (see below). Again, neither should be needed under normal circumstances.

##### _`wait: boolean`_

Whether or not to wait for this element to exist. Default is `true`.

##### _`seconds_to_wait: number`_

How long to wait for the element to exist before erroring. Defaults to `Capybara.default_max_wait_time`

#### `interaction_element`

Find an element for the SpecView which is appropriate to interact with. If the fetcher produces an HTML element, this will just be that element. If it produces a React component, it will the first descendent of the component which has one of the following types (in descending priority order)

1. textarea
2. form input
3. button
4. Any other element

You should generally only need to call this if you want to implement some low-level functionality and you need it to work with React component SpecViews. That said, it's usually better to use `interaction_element` than `element`.

#### `native_interaction_element`

Low level implementation for `interaction_element`. Returns a Selenium element instead of Capybara element.

#### `at(index: number)`

Given a SpecView that has a multi-fetcher, select the item at `index` instead of producing the entire list. This _modifies_ the fetcher, but does not actually execute it.

You cannot use this on a component that is not a multi-fetcher (even if earlier terms in the chain are multi components).

Negative `index` will index in reverse.

#### `first`, `last`

Aliases for `at(0)` and `at(-1)` respectively

#### `text`

Mapping function which returns the text content of the SpecView. If the view points at a React component, `text` will return all its childrens' text content, concatenated into a single string.

#### `exists?`

Returns true if the element or component can be found. If this is a multi element, it returns true if and only if the resulting multi-dimensional array contains at least one non-nil item.

#### `gone?`

Inverse of `exists?`.

#### `count`

Returns the number of non-nil items in a multi SpecView. If called on a SpecView which points at a single element, `count` will return 1 if the element exists, and 0 if not.

#### `prop(key)`

Mapping function. Given a react component, return the property given by `key`. Behavior is undefined if the property cannot be converted to JSON. Will raise an error if you call this on a SpecView which points at an HTML element (or array of such). When called on a SpecView whose element cannot be found, returns `nil`.

#### `find(selector, **kwargs)`

This works very similarly to `self.component`, but returns the component rather than defining an instance method. In most cases, you should avoid including this in your tests, but it is useful for quickly testing out selectors in the debugger. Takes exactly the same arguments as `self.component`, except without `name`. It also cannot take a block, since defining child components would be meaningless in this context.

See ["Custom queries" in the readme](./SpecViewReadme.md#custom-queries) for details and examples.

The following snippets are nearly equivalent:

```ruby
component :foo, "@Foo"
```

and

```ruby
def foo
  find("@Foo")
end
```

**Note: The above example is given to demonstrate what `find` does, but you would always use `component` in this case. Only use `find` when debugging, or in the rare case that you need a component method which takes arguments. Using `find` in the above case is both slower and non-idiomatic.**

#### `highlight`

Draws an orange rectangle around each of the matched elements. This is useful in conjunction with `find` when debugging, to identify what a query matches.

#### `clear_highlights`

Removes all boxes created with `highlight`

#### `flash(milliseconds = 500)`

Similar to highlight, but it automatically clears after `milliseconds`.

#### `click_and_wait`

Clicks the component and then calls `settle`

#### `base_load(url: string)`

Loads `url` in the browser, then waits for the page to load by calling `ready`. This is generally used by subclasses to define custom `load` methods.

#### `ready`

Wait until the page has loaded.

The default implementation waits for network requests to finish, then wait for there to be no `.test-loader` elements on the page. Subclasses may override this to specify additional logic to tell if the page finished loading. If you override, you should generally call `super`.

#### `browser_logs`

Fetch all `console.warning` and `console.error` output from the browser.

#### `execute_script(script: string, *args)`

Eval `script` as a javascript function in the client. `script` acts like a function body, and any arguments will be forwarded along in the `arguments` array. You can also use `return` inside `script` to return a particular value.

(See also `call_script_function` below)

#### `call_script_function(fn_string: string, *args)`

A more convenient way to call scripts with arguments. Example usage:

```ruby
view.call_script_function('(a, b, c) => a + b + c', 'foo', 'bar', 'baz')
```

would return the string "foobarbaz".

The difference between this and `execute_script` is that `call_script_function` lets you use named arguments more easily. The `execute_script` equivalent of the above example would be:

```ruby
view.execute_script('return arguments[0] + arguments[1] + arguments[2]', 'foo', 'bar', 'baz')
```

In general, if you don't need to pass arguments, `execute_script` may be a bit more concise. Otherwise, prefer `call_script_function`.

#### `scroll_to`

Scroll the viewport so the specified element is on screen

```ruby
view.header.scroll_to
```

#### `scroll_by(x_pixels, y_pixels)`

Scroll the viewport by specified x and y coordinates.  Inputs may be negative.

```ruby
view.scroll_by(100, 0)
```

Consider using `scroll_to` instead of scroll_by for less brittle tests

#### `bounding_rectangle`

Get a hash with keys "bottom", "left", "top" and "write" corresponding to the rectangle bounding the element. This corresponds to the `getBoundingClientRect()` DOM element method.

### Waiting Methods

These methods help you wait for the browser or server to catch up with simulated user actions.  You should prefer to use `settle` for all waiting, but sometimes it is necessary to do more specific kinds of waits

#### `settle`

This is the prefered method for waiting.  This will waits for all view and network activity to settle.  Behind the scenes, we use special chrome apis to make sure all network requests have completed, and do tracking of timeouts and intervals registered on the page to make sure things have finished rendering.  If you find a way `settle` does not wait for a common case, please let the #integrationtest-infra slack channel know!

Called simply like:

```ruby
view.settle
```

#### `wait_until_exists`

Wait until `exists?` returns true. Called like so:

```ruby
view.button_component.wait_until_exists
```

#### `wait_until_gone`

Wait until `gone?` returns true. Called like so:

```ruby
view.button_component.wait_until_gone
```

#### `wait_for(expected_errors: Array<Exception class>?, seconds_to_wait: number?, &block)`

Generic wait method. Waits until `block` returns `true`. Any error raised which is in `expected_errors` (default `[]`) will be ignored. If `block` does not return `true` within `seconds_to_wait` seconds, `ConditionNotMet` is thrown.

#### `wait_for_network`

Wait until no network requests are in flight.  Unless necessary, you should prefer the `settle` method.

#### `default_ignored_network_patterns`

An array of regular expressions of the format `[pattern: string, flags?: string]`. If a network request's url matches any of these patterns, it will be ignored for the purposes of `wait_for_network` and `settle`.

By default, this returns `[]`, but you can override it with a list of patterns if your app makes network requests that should not be tracked. For example, you may wish to exclude requests used for analytics using this blacklist.

The regular expressions are interpreted by passing the arguments to `new RegExp` in the browser.

#### `default_ignored_timer_patterns`

An array of regular expressions of the format `[pattern: string, flags?: string]`.

In order to track animations for `settle` and `wait_for_view_activity`, SpecView tracks all timers less than six seconds, and waits until those timers have fired.

In some cases, libraries or your own code may create timers on a persistent basis. This will cause `settle` and `wait_for_view_activity` to time out. You can avoid this by filtering those timers by overriding `default_ignored_timer_patterns` with a list of patterns to ignore.

These patterns are matched against the _stack trace_ from when the timer was created. So for example, if you know that a persistently polling timer is created from a file called `pollForChanges.js`, you might override this method like:

```ruby
def default_ignored_timer_patterns
  [["/pollForChanges\\.js"]]
end
```

As with `default_ignored_network_patterns`, the elements of the array are passed as arguments to `new RegExp` in the browser.

Note: For performance reasons, this blacklist only applies to timers greater than 500 milliseconds. Shorter timers cannot be ignored with this mechanism.

#### `wait_for_view_activity`

Wait for javascript animations to finish, and for all short-term timers to resolve.  Unless necessary, you should prefer the `settle` method.

#### `wait_until_still`

Waits until the bounding rectangle of an element has not changed for `minimum_still_time`. This is useful when CSS animations makes interaction with an element unreliable.

#### `wait_until_visible`

Wait until the element both exists and is visible on screen.

### Delegated methods

For convenience, the following [Capybara Element](https://www.rubydoc.info/gems/capybara/3.6.0/Capybara/Node/Element) methods are delegated to the result of `interaction_element`: `click`, `send_keys`, `checked?`, `hover`

And the following [Selenium Element](https://www.rubydoc.info/gems/selenium-webdriver/0.0.28/Selenium/WebDriver/Element) methods are delegated to the result of `native_interaction_element`: `value`, `toggle`, `clear`

In addition, any method not explicitly defined or delegated will forward to the Capybara element result of fetching the SpecView. Such methods will error if the SpecView represents a React component (or list of React components).

## SpecViewArray

A SpecViewArray is a delegating multi-dimensional array which is used for fetcher results. Note that because SpecView is as lazy as possible, you do _not_ get a SpecViewArray simply by accessing multicomponents. The SpecViewArray is created when you ask for an actual result, e.g. by calling `text`.

### Instance methods

#### `==(other)`, `eql?(other)`

Converts `self` to an array with `to_a` and then compares to `other` with `==`. If `other` is a SpecViewArray, it is also deeply converted into an array before comparing.

All of this means that you can use SpecViewArrays directly with rspec, like

```ruby
expect(view.people.names).to eql ['Bob', "Mary", "Jane"]
```

#### `to_a`, `to_ary`

Deeply convert SpecViewArray into an N-dimensional array.

#### Delegated methods

The following methods are delegated to `array` (that is, they run at the top level of the SpecViewArray):

`empty?`, `each`, `length`, `count`, `reduce`

The following are also delegated to the top level array, but _if_ the result of the call is an array, it is converted back into a SpecViewArray:

`map`, `collect`, `select`, `reject`, `reverse`, `[]`, `slice`

All other methods are delegated as _mapping functions_. So if you do:

```ruby
some_array.foo_bar
```

then you will _deeply_ map over the SpecViewArray, calling `foo_bar` one each item, and returning a new SpecViewArray of the same dimension. If a method is delegated this way to `nil`, the result will simply be `nil` (rather than erroring)

## Fetcher Execution

When a component method is called, no actual queries are executed. Instead, a new SpecView instance is created (based on the view class of the component definition) which encapsulates the _fetcher_ needed to find the HTML element or react component (or list thereof). These fetchers are _composable_, so when you have a chain like

```ruby
view.foo.bar.baz
```

The resulting SpecView encapsulates the logic "find `baz` in the context of a SpecView for `view.foo.bar`". And of course that "context" SpecView encapsulates "find `bar` in the context of a SpecView for `view.foo`", and so forth.

We finally talk to the browser when you ask a SpecView for specific information, like its text content. In many cases (including the `text` method), this means that we only send _one_ message to the browser.

The motivation for this is two-fold. First, it's much faster to send fewer messages to the web browser. Second, and more importantly, this means you almost never hold on to a reference to a Capybara element, which makes it much easier to prevent errors due to stale element references.

In some cases, we internally create _snapshot_ SpecViews. These are SpecViews that represent the result of executing a fetcher. They have actual HTML elements attached to them, and they can potentially become stale if they hang around too long. It is also currently impossible to create a snapshot of a React component (although you can create snapshots of its HTML element children). In general, you should not need to worry about snapshot SpecViews. They mostly exist as the penultimate step in calling a Capybara method on a SpecView component.

Note that if do certain operations on SpecViewArrays, like `select`, `slice`, and `[]`, you will end up with snapshot SpecViews. This implies three things:

1. You cannot call those methods on list components containing react components
2. You should avoid these operations whenever possible
3. If you must use these operations, do not save off the results for long-term reuse; they are very likely to go stale and cause your tests to flake. Your best option is to define a method or lambda if you'll need the same elements more than once, so that they can be refetched each time.
