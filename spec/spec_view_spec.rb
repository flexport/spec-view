# typed: ignore
# TEAM: backend_infra

# Note: for this test to succeed, you must be running webpack with ReactTestApp

require "rails_spec_helper"

module SpecViewSpec
  class DescriptionView < SpecView::Base
    component :paragraph, "p"
    component :bold, "b"
    component :manual_paragraph_child, "b", parent: :paragraph
    component :paragraph_with_children, "p" do
      child :child, "b"
      # this is to test that we handle kwargs on child component calls correctly
      child :multi_child, "b", multi: true
    end
  end

  class TestListView < SpecView::Base
    default_selector "ul.cats"
    component :items, ["li"]
  end

  class TestView < SpecView::Base
    component :animated, ".animated"
    component :description, ".description", view_class: DescriptionView
    component :employee_list, ".employee-list"
    component :people, [".person"]
    component :dogs, [".dog"]
    component :cats, [".cats li"]
    component :dog, ".fido"
    component :first_name, ".first-name"
    component :middle_name, ".middle-name"
    component :last_name, ".last-name"
    component :people_who_arent_alice, ".person:not(:contains(Alice))", multi: true # alternative syntax
    component :not_here, ".does-not-exist"
    component :not_heres, [".does-not-exist"]
    component :delayed_elem, ".delayed-elem"

    # Child components
    component :people_group, [".person"] do
      child :peoples_cats, [".cats li"]
    end

    # Grandchild components
    component :grandparents, [".person"] do
      child :gp_cat_list, ".cats" do
        child :grandchildren, ["li"]
      end
    end
  end

  describe SpecView::Base, js: true, js_errors: false, capybara: true, ignore_console_errors: /.*data-react-props*/ do
    describe "no-browser tests" do
      it "remains_true_for?" do
        view = SpecView::Base.new
        # Make time deterministic
        time = 1000
        time_step = 0.1
        allow(view).to receive(:now) { time += time_step }

        # Always false
        expect(view.send(:remains_true_for?, 1) { false }).to eq(false)

        # Always true
        expect(view.send(:remains_true_for?, 1) { true }).to eq(true)

        # Becomes false
        i = 0
        expect(view.send(:remains_true_for?, 1) { (i += 1) < 5 }).to eq(false)

        # Would become true
        i = 0
        expect(view.send(:remains_true_for?, 1) { (i += 1) > 5 }).to eq(false)

        # Would become false if we waited longer
        i = 0
        becomes_false_after_two_seconds = -> { (i += 1) < 20 }
        expect(view.send(:remains_true_for?, 1, &becomes_false_after_two_seconds)).to eq(true)

        # verification of previous test with longer time
        i = 0
        expect(view.send(:remains_true_for?, 3, &becomes_false_after_two_seconds)).to eq(false)
      end
    end

    describe "vanilla HTML" do
      let(:user) { create(:carrier_ops) }
      let(:view) { TestView.new }
      let(:url) { "/test" }

      before do
        ::TestController.enabled = true
        # Load in test html
        ::TestController.content = %(
        <style>
          .animated {
            width: 100px;
            height: 100px;
            transition: width 0.1s;
            transition-timing-function: linear;
          }

          .animated:hover {
            width: 300px;
          }
        </style>
        <div class="animated"></div>
        <div class="description">
          <b>Description:</b>
          <p>This is some employee information to test a <b>spec view</b></p>
        </div>
        <ul class="employee-list">
          <li class="person">
            <span class="first-name">Alice</span>
            <span class="middle-name">Alexandria</span>
            <span class="last-name">Alsace</span>
            <span class="fido">Fido</span>
            <ul class="cats">
              <li>Amy</li>
            </ul>
          </li>
          <li class="person">
            <span class="first-name">Bob</span>
            <span class="last-name">Bretford</span>
            <ul class="cats">
              <li>Bruiser</li>
              <li>Bocephus</li>
            </ul>
          </li>
          <li class="person">
            <span class="first-name">Frieda</span>
            <span class="last-name">Frampton</span>
            <ul class="cats"></ul>
          </li>
        </ul>
        )
        visit url
      end

      around(:example) do |example|
        using_flexport_subdomain("core") do
          sign_in(user, scope: :user)
          example.run
        end
      end

      context "normal load" do
        before do
          # This wait is just for futureproofing; make sure that we don't have any
          # requests to start with
          view.wait_for_network
          SpecViewTestJob.test_val = nil
        end

        it "does pass runtime check" do
          expect(view.execute_script("return _SpecView.runtimeTest()")).to eq("Runtime installed!")
        end

        it "waits for animating box" do
          expect(view.animated.bounding_rectangle).to eq({
            "bottom" => 100,
            "left" => 0,
            "right" => 100,
            "top" => 0,
          })
          view.animated.hover
          view.animated.wait_until_still
          expect(view.animated.bounding_rectangle).to eq({
            "bottom" => 100,
            "left" => 0,
            "right" => 300,
            "top" => 0,
          })
        end

        it "does handle wait_for_network correctly" do
          expect(view.execute_script("return window.outstandingRequestDetails")).to be_empty
          # Lock the test controller to prevent it from responding until we're ready
          ::TestController::XHR_LOCK.lock
          expect(view.execute_script("return window.outstandingRequestDetails")).to be_empty
          view.execute_script(%{fetch('/test/xhr?1').then(r => r.json()).then(r => window.foo = r)})
          request_list = view.execute_script("return window.outstandingRequestDetails")
          expect(request_list.length).to eq(1)
          expect(request_list[0]["url"]).to match(%r{test/xhr\?1$})
          expect { view.wait_for_network(seconds_to_wait: 1) }.to raise_error(SpecView::Base::ConditionNotMet)
          # sanity check that the request didn't finish
          expect(view.execute_script("return window.foo")).to be_nil
          # unlock and wait
          ::TestController::XHR_LOCK.unlock
          # should pass the wait now that the request can complete
          view.wait_for_network

          # should now be no outstanding requests
          expect(view.execute_script("return window.outstandingRequestDetails")).to be_empty
          # fetch should have done what we expected (sanity check)
          expect(view.execute_script("return window.foo")).to eql({"hello" => "world"})
        end

        it "does handle perform_enqueued_jobs_now correctly" do
          # assert old value
          expect(SpecViewTestJob.test_val).to be_nil
          assert_no_enqueued_jobs

          view.execute_script(%{fetch('/test/xhr?job=job1').then(r => r.json()).then(r => window.foo = r)})

          # get response from backend
          view.settle
          view.wait_for do
            view.execute_script("return window.foo") == {"hello" => "in queue"}
          end

          # verify job has not run
          assert_enqueued_jobs(1)
          expect(SpecViewTestJob.test_val).to be_nil

          # peform enqueued jobs now
          perform_enqueued_jobs_now

          assert_no_enqueued_jobs
          expect(SpecViewTestJob.test_val).to eql("job1")
        end

        it "waits_for_job to prevent race condition" do
          # Lock the test job to prevent it from finishing until we're ready
          ::TestController::XHR_LOCK.lock
          view.execute_script(%{fetch('/test/xhr?job=success_job').then(r => r.json()).then(r => window.foo = r)})
          expect(view.execute_script("return window.outstandingRequestDetails").length).to eq(1)
          expect do
            view.wait_for_jobs(seconds_to_wait: 1) do
              view.execute_script(%{fetch('/test/xhr?job=failed_job').then(r => r.json()).then(r => window.foo = r)})
            end
          end.to raise_error(SpecView::Base::ConditionNotMet)
          ::TestController::XHR_LOCK.unlock
          view.wait_for_network
          perform_enqueued_jobs_now
          expect(SpecViewTestJob.test_val).to eql("success_job")
          view.wait_for_jobs do
            view.execute_script(%{fetch('/test/xhr?job=new_job').then(r => r.json()).then(r => window.foo = r)})
          end
          expect(SpecViewTestJob.test_val).to eql("new_job")
        end

        it "waits_for_job and asserts to prevent race condition" do
          # Lock the test job to prevent it from finishing until we're ready
          assert_no_enqueued_jobs
          view.execute_script(%{fetch('/test/xhr?job=success_job').then(r => r.json()).then(r => window.foo = r)})

          # get response from backend
          view.wait_for_network
          view.wait_for do
            view.execute_script("return window.foo") == {"hello" => "in queue"}
          end
          assert_enqueued_jobs(1)
          expect do
            view.wait_for_jobs do
              view.execute_script(%{fetch('/test/xhr?job=failed_job').then(r => r.json()).then(r => window.foo = r)})
            end
          end.to raise_exception(Assert::AssertionError)
          perform_enqueued_jobs_now
          expect(SpecViewTestJob.test_val).to eql("success_job")
          view.wait_for_jobs do
            view.execute_script(%{fetch('/test/xhr?job=new_job').then(r => r.json()).then(r => window.foo = r)})
          end
          expect(SpecViewTestJob.test_val).to eql("new_job")
        end

        it "does parse SVCSS queries correctly" do
          # Parsing CSS extension
          def check_svcss(input, *output)
            result = view.call_script_function(
              "sel => _SpecView.parseSVCSS(sel)",
              input,
            ).map(&:deep_symbolize_keys)
            expect(result).to eql(output), input
          end
          expect check_svcss("*", {type: "jquery", selector: "*"})
          expect check_svcss(
            "div.foo > .bar:has(span b)",
            {
              type: "jquery",
              selector: "div.foo > .bar:has(span b)",
            },
          )

          expect check_svcss(
            "div.foo @Label .bar b.qux",
            {
              type: "jquery",
              selector: "div.foo",
            },
            {
              type: "react",
              componentName: "Label",
            },
            {
              type: "jquery",
              selector: ".bar b.qux",
            },
          )

          expect check_svcss(
            'div.foo @Label{patrick: "stewart"} .bar b.qux',
            {
              type: "jquery",
              selector: "div.foo",
            },
            {
              type: "react",
              componentName: "Label",
              propertyMatcher: {patrick: "stewart"},
            },
            {
              type: "jquery",
              selector: ".bar b.qux",
            },
          )

          expect check_svcss(
            '@Anvil{hammer: true} @Monkey{"wrench": {"open": false, "weight": 47 /*kilograms*/}}',
            {
              type: "react",
              componentName: "Anvil",
              propertyMatcher: {hammer: true},
            },
            {
              type: "react",
              componentName: "Monkey",
              propertyMatcher: {wrench: {open: false, weight: 47}},
            },
          )

          # Multi-hash form (these are used by the with_props method)
          expect check_svcss(
            "@Animal{type: 'dog'},{name: 'Toto'}",
            {
              type: "react",
              componentName: "Animal",
              propertyMatcher: {type: "dog", name: "Toto"},
            },
          )

          expect check_svcss(
            "@Animal{type: 'dog', name: 'Fido'},{name: 'Toto'}",
            {
              type: "react",
              componentName: "Animal",
              propertyMatcher: {type: "dog", name: "Toto"},
            },
          )

          expect check_svcss(
            "div.foo @Animal{type: 'dog', name: 'Fido'},{name: 'Toto'} div.bar @Collar{tag: false},{tag: true},{decoration: 'bones'}",
            {
              type: "jquery",
              selector: "div.foo",
            },
            {
              type: "react",
              componentName: "Animal",
              propertyMatcher: {type: "dog", name: "Toto"},
            },
            {
              type: "jquery",
              selector: "div.bar",
            },
            {
              type: "react",
              componentName: "Collar",
              propertyMatcher: {tag: true, decoration: "bones"},
            },
          )
        end

        it "element search should behave correctly" do
          # Basic existence
          expect(view.employee_list.element).to_not be_nil
          # Proxying to the element (visible is an element method)
          expect(view.description).to be_visible
          # Getting a child component
          expect(view.description.bold.text).to eq("Description:")
          # Found components are wrapped with original spec view, so they proxy the
          # original components
          expect(view.description.paragraph.bold.text).to eq("spec view")
          expect(view.description.manual_paragraph_child.text).to eq("spec view")
          # Parent works as a normal element
          expect(view.description.paragraph_with_children.text).to eq("This is some employee information to test a spec view")
          # Parent works with chaining
          expect(view.description.paragraph_with_children.bold.text).to eq("spec view")
          # Child is top level component with correct scope
          expect(view.description.child.text).to eq("spec view")
          expect(view.description.multi_child.text).to eq(["spec view"])
          # Grand child is top level component with correct scope
          expect(view.grandchildren.text).to eql([["Amy"], ["Bruiser", "Bocephus"], []])
          # Lists of elements
          expect(view.people.count).to eq(3)
          expect(view.employee_list.people.count).to eq(3)
          expect(view.cats[1].text).to eq("Bruiser")
          expect(view.employee_list.people[1].cats[1].text).to eq("Bocephus")
          expect(view.dogs).to be_empty

          # Custom find single element
          expect(view.description.find("b").text).to eq("Description:")
          # Custom find multiple elements
          expect(view.employee_list.find([".person"]).count).to eq(3)
          # Custom find multiple elements with multi param
          expect(view.employee_list.find(".person", multi: true).count).to eq(3)

          # Count
          expect(view.grandchildren.count).to be(3)
          expect(view.people.cats.count).to be(3)
          expect(view.people.count).to be(3)
          expect(view.people.at(1).cats.count).to be(2)
          expect(view.not_here.count).to be(0)
          expect(view.not_heres.count).to be(0)

          # Exists
          expect(view.description.exists?).to be(true)
          expect(view.not_here.exists?).to be(false)
          expect(view.not_heres.exists?).to be(false)
          expect(view.cats.exists?).to be(true)
          expect(view.dogs.exists?).to be(false)

          # Wait until exists
          view.description.wait_until_exists
          expect(view.description.exists?).to be(true)

          expect(view.delayed_elem.exists?).to be(false)
          view.execute_script('setTimeout(() => {
            const div = document.createElement("div");
            div.classList.add("delayed-elem");
            document.body.append(div);
          }, 500)')
          expect(view.delayed_elem.exists?).to be(false)
          view.delayed_elem.wait_until_exists
          expect(view.delayed_elem.exists?).to be(true)

          expect { view.not_here.wait_until_exists(seconds_to_wait: 0.1) }.to raise_error(SpecView::Base::ConditionNotMet)

          # Indexing
          expect(view.employee_list.people.at(1).cats.at(0).text).to eq("Bruiser")
          expect(view.employee_list.people.first.cats.last.text).to eq("Amy")
          expect(view.employee_list.people.at(1).cats.last.text).to eq("Bocephus")

          # Mapping components onto arrays
          expect(view.people.last_name.text).to eql(["Alsace", "Bretford", "Frampton"])

          # Method not defined
          expect { view.people.larst_norm }.to raise_error(NoMethodError)

          # Empty and friends
          expect(view.people.middle_name).to_not be_empty
          expect(view.people_who_arent_alice.middle_name).to_not be_empty # not compacted by default
          expect(view.people_who_arent_alice.middle_name.text).to eql([nil, nil])

          expect(view.people_who_arent_alice.middle_name.exists?).to eql(false) # views don't exist

          expect(view.people.cats.text).to eql([["Amy"], ["Bruiser", "Bocephus"], []])
          expect(view.peoples_cats.text).to eql([["Amy"], ["Bruiser", "Bocephus"], []])

          # Wait behavior
          expect { view.first_name.last_name.element(seconds_to_wait: 0.1) }.to raise_error(Capybara::ElementNotFound)

          # inspect output
          expect(view.employee_list.inspect).to eq("#<TestView:TestView.employee_list>")
          expect(view.employee_list.people.inspect).to eq("#<TestView:TestView.employee_list.people>")
          # Array indexes
          expect(view.employee_list.people[1].inspect).to eq("#<TestView:TestView.employee_list.people[1]>")
          expect(view.employee_list.people[0].first_name.inspect).to eq("#<TestView:TestView.employee_list.people[0].first_name>")
          expect(view.employee_list.people[1].cats[0].inspect).to eq("#<TestView:TestView.employee_list.people[1].cats[0]>")
          expect(view.employee_list.people.at(1).cats.last.inspect).to eq("#<TestView:TestView.employee_list.people.at(1).cats.at(-1)>")
          # TODO: Rewrap arrays when using delegated array methods so the following test expects:
          # #<TestView:TestView.employee_list.people.reverse[0]
          expect(view.employee_list.people.reverse[0].inspect).to eq("#<TestView:TestView.employee_list.people[2]>")

          expect(view.employee_list.people.select { true }.first_name.inspect).to eq("#<SpecViewArray:TestView.employee_list.people.select().first_name>")
          expect(view.description.paragraph.inspect).to eq("#<DescriptionView:TestView.description<DescriptionView>.paragraph>")

          # Caling a javascript function
          child_count = "el => el.childElementCount"
          expect(view.call_script_function(child_count, view.description.element.native)).to eq(2)

          # Component off of snapshotted SpecViewArray
          expect(view.employee_list.people.reverse.cats.text).to eql([
            [],
            ["Bruiser", "Bocephus"],
            ["Amy"],
          ])
          expect(view.employee_list.people[1..-1].cats.text).to eql([["Bruiser", "Bocephus"], []])
        end

        describe "test-level isolation" do
          describe "sessionStorage" do
            let(:key) { "session_storage_leakage_test" }
            let(:value) { "foobar" }

            # rubocop:disable RSpec/RepeatedDescription, RSpec/RepeatedExample
            it "doesn't leak" do
              expect(view.session_storage_get(key)).to be_nil

              view.session_storage_set(key, value)
              expect(view.session_storage_get(key)).to eq(value)
            end

            it "doesn't leak" do
              expect(view.session_storage_get(key)).to be_nil

              view.session_storage_set(key, value)
              expect(view.session_storage_get(key)).to eq(value)
            end
            # rubocop:enable RSpec/RepeatedDescription, RSpec/RepeatedExample
          end
        end
      end

      context "timer instrumentation" do
        it "handle timer waits correctly" do
          # Override defaults to allow very long timers (so that our test isn't
          # meaningfully timing dependent)
          view.execute_script("_SpecView.TIMEOUT_TRACKING_CONSTANTS.MAX_DELAY_MS = 600000") # ten minute max delay
          # Short delay
          view.execute_script("setTimeout(() => {}, 100)")
          expect { view.wait_for_view_activity }.to_not raise_error
          # Long delay
          timer_id = view.call_script_function("function testOuterScope () { return setTimeout(() => {}, 500000) }")
          expect { view.wait_for_view_activity(seconds_to_wait: 0.1) }.to raise_error(SpecView::Base::ConditionNotMet)
          expect(view.execute_script("return _SpecView.activeTimers.values().next().value.stack")).to match(/testOuterScope/)

          # Clearing the timeout should untrack it
          view.call_script_function("clearTimeout", timer_id)
          expect { view.wait_for_view_activity(seconds_to_wait: 1) }.to_not raise_error
        end
      end

      context "test hooks" do
        describe "#wait_until_counter_increments" do
          it "resolves once the counter has been incremented" do
            # increment by 1
            expect do
              view.wait_until_counter_increments(counter: "TEST", seconds_to_wait: 15) do
                view.call_script_function("() => window.testHook.incrementCounter('TEST')")
              end
            end.to_not raise_error

            # expect to be incremented by 2. increment, wait, then increment
            expect do
              view.wait_until_counter_increments(counter: "TEST", by: 2, seconds_to_wait: 15) do
                view.call_script_function("() => window.testHook.incrementCounter('TEST')")
                view.call_script_function("() => setTimeout(() => window.testHook.incrementCounter('TEST'), 1000)")
              end
            end.to_not raise_error
          end

          it "raises if the counter does not get incremented" do
            expect do
              view.wait_until_counter_increments(counter: "TEST", by: 1000, seconds_to_wait: 1) do
                view.call_script_function("() => window.testHook.incrementCounter('TEST')")
              end
            end.to raise_error(SpecView::Base::ConditionNotMet)
          end
        end
      end

      context "with a fake queued request" do
        let(:url) { "/test?test-fake-requests" }

        it "does handle queued network requests correctly" do
          view.wait_for_network([["^FAKE REQUEST URL$"]]) # wait for everything else
          request_list = view.execute_script("return window.outstandingRequestDetails")
          expect(request_list).to eql([{"requestId" => -50, "url" => "FAKE REQUEST URL"}])
        end
      end
    end

    class ReactTestView < SpecView::Base
      component :alpha, "@Alpha"
      component :alphas, ["@Alpha"] do
        child :charlies_children_of_alphas, ["@Charlie"]
      end

      component :by_key, ["@Charlie div:reactKey(third)"]
      component :by_numeric_key, ["@Charlie div:reactKey(2)"]
      component :fifth_alpha, ["@Alpha"], at: 4
      component :bravo, "@Bravo"
      component :not_here, "@NotHere"
      component :not_heres, ["@NotHere"]
      component :bravo_42, "@Bravo{num: 42}"
      component :charlies, ["@Charlie"]
      component :papa, "@puritan(Papa)"
      component :rubber_charlies, '@Charlie{duck: "rubber"}', multi: true
      component :oz, "@Alpha{frank: 'oz'}" do
        child :mallard, "@Charlie"
      end
      component :div_in_portal, ".div-in-portal"
      component :double_portal, ".double-portal"
      component :alpha_with_portal, "@Alpha{portal: true}"
      component :portal_traversal, '@Alpha{portal: true} @Bravo{info="bravo inside portal"} div.div-in-portal-bravo span.double-portal'
      component :alpha_with_input, "@Alpha{hasInput: true}"

      component :wrapper, ".wrapper"
      component :bravo_wrapper, ".bravo-wrapper"
      component :content, ".content"
      component :bravo_inner, ".bravo-inner"
      component :html_first_traversal, '.wrapper @Alpha{frank:"zappa"} .bravo-wrapper @Bravo div.bravo-inner'

      # Component using regex in matcher
      component :bravo_boo, "@Bravo{word: /^boo+$/}"

      # This will error if you request it because bare functional components are not supported
      component :functional_component, "@FunctionalComponent"
      component :bleps, [".blep"]
      component :ocean, '@Alpha{frank:"ocean"}'
      component :ocean_bleps, ['@Alpha{frank:"ocean"} .blep']
      component :functional_ocean, '@FunctionalComponent @Alpha{frank:"ocean"}' do
        child :functional_ocean_bleps, [".blep"]
      end
      component :functional_simple, '@FunctionalComponent{type: "simple"}'
      component :functional_simples, ['@FunctionalComponent{type: "simple"}']
      component :memo, "@MemoComponent"
      component :inside_memo, "@InsideMemo"
    end

    describe "react" do
      let(:user) { create(:carrier_ops) }
      let(:view) { ReactTestView.new }

      before do
        ::TestController.enabled = true
        visit "/test/react"
      end

      around(:example) do |example|
        using_flexport_subdomain("core") do
          sign_in(user, scope: :user)
          example.run
        end
      end

      it "does behave correctly" do
        # Basic react matching
        expect(view.alpha.el.text).to eq("First div")
        # Matching a component child with same direct descendent
        expect(view.alpha.bravo_42.el.text).to eq("Second div")
        # Matching an HTML element by react key
        expect(view.by_key.text).to eql(["Third div"])
        # Matching an HTML element by numeric react key
        expect(view.by_numeric_key.text).to eql(["Second div"])
        # Matching many react elements
        expect(view.charlies.el.text).to eql(["Second div", "Charlie inside sinatra", "Eighth div"])
        expect(view.alpha.charlies.text).to eql(["Second divThird div", "Charlie inside sinatra"])
        expect(view.alpha.charlies.el.text).to eql(["Second div", "Charlie inside sinatra"])
        # Searching inside a multi-element react component, but not its first element
        expect(view.alpha.rubber_charlies.el.text).to eql(["Charlie inside sinatra"])
        # Using a simple property matcher
        expect(view.oz.el.text).to eq("Fifth div")
        # Matching a child of a property matcher component
        expect(view.mallard.text).to eq("Eighth div")
        expect(view.mallard.el.text).to eq("Eighth div")

        # Matching text of a nested child component
        expect(view.charlies_children_of_alphas.text).to eql([
          ["Second divThird div", "Charlie inside sinatra"],
          ["Eighth div"],
          [],
          [],
          [],
          [],
        ])

        # Indexing
        # (you might expect this to be at(4), but the one with the portal comes
        # later because its element is later in the DOM)
        expect(view.alphas.at(3).text).to eq("Here is a text field")
        expect(view.alphas.at(4).bleps.last.text).to eq("Bonjour")
        expect(view.fifth_alpha.at(4).bleps.last.text).to eq("Bonjour")

        # Exists
        expect(view.alphas.exists?).to be(true)
        expect(view.alpha.exists?).to be(true)
        expect(view.not_here.exists?).to be(false)
        expect(view.not_heres.exists?).to be(false)

        # Count
        expect(view.alpha.count).to eql(1)
        expect(view.alphas.count).to eql(6)
        expect(view.not_heres.count).to eql(0)
        expect(view.not_here.count).to eql(0)

        # Props
        expect(view.charlies_children_of_alphas.prop("duck")).to eql([
          ["goose", "rubber"],
          ["mallard"],
          [],
          [],
          [],
          [],
        ])
        expect(view.charlies_children_of_alphas.prop("goose")).to eql([
          [nil, nil],
          [nil],
          [],
          [],
          [],
          [],
        ])

        # Custom find
        expect(view.oz.find("@Bravo{num: 1}").text).to eq("Sixth div")
        expect(view.alpha.find(["@Charlie"]).text).to eql([
          "Second divThird div",
          "Charlie inside sinatra",
        ])
        expect(view.alpha.find(["@Charlie"], at: 1).text).to eql("Charlie inside sinatra")

        # UI interactions
        view.execute_script("clickedFrankHerbert = false")
        view.bravo.click
        expect(view.call_script_function("() => clickedFrankHerbert")).to eq(false)
        view.papa.click
        expect(view.call_script_function("() => clickedFrankHerbert")).to eq(true)
        view.alpha_with_input.click
        view.alpha_with_input.send_keys("bloop")
        expect(view.call_script_function("() => changedInput")).to eq("bloop")

        old_wait_time = Capybara.default_max_wait_time
        Capybara.default_max_wait_time = 1
        expect { view.not_here.click }.to raise_error(Capybara::ElementNotFound)
        Capybara.default_max_wait_time = old_wait_time

        # Portals
        # Getting dom elements in portals without react traversal
        expect(view.div_in_portal.text).to eq("Now you're thinking with portals")
        expect(view.double_portal.text).to eq("…is a lie")
        # Fetchers which must hop across portals to find those elements
        expect(view.alpha_with_portal.div_in_portal.text).to eq("Now you're thinking with portals")

        # TODO: At some point we should support this case, but it will require
        # that we do something more sophisticated with jQuery to allow it to
        # jump across portals.
        # [Ada Cohen @ 2018-09-13 12:47:40]
        # expect(view.alpha_with_portal.double_portal.text).to eq "...is a lie"
        expect(view.alpha_with_portal.bravo.bravo.double_portal.text).to eq("…is a lie")

        # Traversing through both HTML and React
        expect(view.wrapper.alpha.content.text).to eq("Alpha zappa")
        expect(view.wrapper.alpha.bravo_wrapper.bravo.bravo_inner.text).to eq("Bravo inner")
        expect(view.wrapper.alpha.bravo.bravo_inner.text).to eq("Bravo inner")
        expect(view.wrapper.alpha.bravo.bravo_inner.text).to eq("Bravo inner")
        expect(view.wrapper.alpha.bravo_inner.text).to eq("Bravo inner")
        expect(view.html_first_traversal.text).to eq("Bravo inner")

        # Functional components should work
        expect(view.functional_component.exists?).to eq(true)
        expect(view.functional_simple.text).to eq("This is an SFC")
        expect(view.functional_simples.at(1).text).to eq("This is a second SFC")
        expect(view.functional_simples.at(2).text).to eq("This is a third SFC")
        expect(view.functional_simples.last.text).to eq("This is an SFC inside a portal")
        expect(view.functional_component.bleps.text).to eq_array(%w[Hi Hola Konichiwa Bonjour])
        expect(view.functional_ocean_bleps.text).to eq_array(%w[Hi Hola Konichiwa Bonjour])

        expect(view.inside_memo.exists?).to be(true)
        expect(view.inside_memo.text).to eq("I is memo")

        # Highlighting
        view.find("@Alpha").highlight
        expect(view.find([".specview-highlight"]).count).to eq(1)
        view.clear_highlights
        expect(view.find([".specview-highlight"]).count).to eq(0)
        view.find(["@Alpha"]).highlight
        expect(view.find([".specview-highlight"]).count).to eq(6)
        view.clear_highlights
        expect(view.find([".specview-highlight"]).count).to eq(0)
        view.find(["@Alpha span"]).highlight
        expect(view.find([".specview-highlight"]).count).to eq(3)
        view.clear_highlights
        expect(view.find([".specview-highlight"]).count).to eq(0)
      end

      # Memo components don't work yet
      it "does support memo components" do
        pending("memo component support")
        expect { view.memo.exists? }.to_not raise_error
      end

      it ":with_props" do
        expect(ReactTestView.with_selector("@Foo").with_props(foo: "bar")._get_default_selector).to eq('@Foo{"foo":"bar"}')
        expect(ReactTestView.with_selector("@Foo{baz: 12}").with_props(foo: "bar")._get_default_selector).to eq('@Foo{baz: 12},{"foo":"bar"}')
      end
    end
  end
end
