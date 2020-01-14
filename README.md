# NOTE: THIS GEM IS IN A PRELIMINARY STATE AND IS NOT READ FOR HUMAN CONSUMPTION

As such, it has not been published yet. Work that remains to be done to get this ready for prime time:

1. Tests that don't live in the Flexport codebase (the `spec_view_spec.rb` file is only provided for reference)
2. Documentation for setup
3. Linting
4. Detection and support for multiple react versions (mostly relates to tag enums, which change between react versions)

# SpecView

<!--
  If you're editing without the MarkdownTOC sublime plugin, please manually
  keep the TOC below in sync.
-->

<!-- MarkdownTOC autolink="true" -->

- [Purpose](#purpose)
- [Walkthrough](#walkthrough)
  - [The SpecView class](#the-specview-class)
  - [Components](#components)
  - [List components](#list-components)
    - [Indexing into list components](#indexing-into-list-components)
      - [Indexing with a nested list](#indexing-with-a-nested-list)
      - [Indexing in component definition](#indexing-in-component-definition)
      - [Indexing and portals](#indexing-and-portals)
  - [Subview components](#subview-components)
    - [Overriding a subview's selector](#overriding-a-subviews-selector)
- [Waiting](#waiting)
- [Debugging queries](#debugging-queries)
- [Child components](#child-components)
- [Querying react components](#querying-react-components)
  - [Anatomy of a react selector](#anatomy-of-a-react-selector)
  - [Limitations of react selectors](#limitations-of-react-selectors)
    - [Mixing react selectors with HTML DOM selectors](#mixing-react-selectors-with-html-dom-selectors)
    - [Views that reference react Components](#views-that-reference-react-components)
- [Questions?](#questions)

<!-- /MarkdownTOC -->

## Purpose

SpecViews offer a way to encapsulate UX interactions with the app when writing integration tests. This has several benefits:

* Makes tests more readable by factoring out DOM access logic. Instead, tests become a list of high level instructions and questions.
* DRYs view interaction logic, so that:
  * New tests often require minimal new DOM interaction logic
  * When a change is made to the DOM structure, tests don't usually have to be repaired individually.
* Helps with code organization, as your interaction objects reflect the structure of the app itself
* Defers fetching of elements until they are actually used, which reduces the risk of errors like stale element references

## Walkthrough

These are the main concepts needed to understand how to use SpecViews in your tests, and create your own custom SpecViews:

### The SpecView class

A SpecView definition corresponds to a single piece of the UI. For example, consider the following HTML for a sign-in form:

```html
<form class="sign-in-form">
  <div class="field-section name-section">
    <label>Name</label>
    <input type="text" name="name" class="name-field">
  </div>
  <div class="field-section pass-section">
    <label>Password</label>
    <input type="password" name="pass" class="pass-field">
  </div>
  <div class="buttons">
      <button class="sign-in">Sign in</button>
      <button class="forgot">Forgot password</button>
  </div>
  <div class="message"></div>
</form>
```

This might have the following SpecView

```ruby
module SpecView
  class SignInFormView < Base
    default_selector           '.signin-form'
    component :name_field,     '.name-field'
    component :pass_field,     '.pass-field'
    component :button_section, '.buttons'
    component :sign_in_button, '.sign-in'
    component :forgot_button,  '.forgot'
    component :message,        '.message'

    def login(name, password)
      name_field.send_keys(name)
      pass_field.send_keys(password)
      sign_in_button.click
    end
  end
end
```

### Components

The most important part of a SpecView definition is its `component` declarations. In their most basic form, these are formatted as:

```ruby
  component :name, '<jquery selector>'
```

The point of components is to offer an easy way to access an element of the view (or a set of elements; see below about list components).

* Note: if you're unfamiliar with jQuery, these selectors work much like CSS selectors, except there are some additional helper functions you can use like `:contains(text)`, and `:has(.some .selector)`. The SpecView-flavored selectors also support `@ComponentName` for querying react components. See the "Querying react components" section below.

Now in our test code, we can have

```ruby
let(:view) { SignInFormView.new }

it 'should show an error if no password' do
  view.name_field.click # 1
  view.name_field.send_keys('bob')
  view.button_section.sign_in_button.click # 2
  expect(view.message.text).to eq 'You must enter a password'

  view.login('bob', 'password1')
  expect(view.message.text).to eq 'Login successful!'
end
```

You can probably guess what this does in practice, but lets break down some details by line number:

1.  You can call any method that a Capybara element responds to, and a component will pass it along to its element. So since elements respond to `click`, this line clicks on the name field. See [the Capybara API docs](https://www.rubydoc.info/gems/capybara/3.6.0/Capybara/Node/Element) for available methods.
2.  Components are _also_ SpecViews, so they get all of the same components as the parent SpecView. So this line says "look up the sign in button, inside the button section". In this particular case, of course, `view.sign_in_button` would have the same result

### List components

Often, you won't have a fixed number of elements in a view, or you'll want to deal with multiple components as a list. For this you can use list components. For example, we could add the following to our SignInFormView:

```ruby
component :labels, ['label']
```

And our test could include:

```ruby
expect(view.labels[0].text).to eq 'Name'
expect(view.labels.text).to eql ['Name', 'Password']
```

Again, let's break down the details. In the first example, we can see that the result of the list component behaves like an ordinary array. You can index it, map over it, slice, find, etc.

However, we can also see that these objects also _delegate_ to their items. So when we call `text` on the list, we get the result of calling `text` on each item.

When you get the result of a method like `text`, you'll have a SpecViewArray, which continues to provide this delegation behavior. For example, you can do:

```ruby
expect(view.labels.text.upcase).to eql ['NAME', 'PASSWORD']
```

Of course, sometimes the SpecViewArray's own method names will collide with something you want to delegate. In those cases, you can always use map:

```ruby
expect(view.labels.text.map(&:length)) to eql [4, 8]
```

And if you ever need a real array, you can just call `to_a`, and the SpecViewArray will be deeply converted.

#### Indexing into list components

You can refine a list component to a specific item with the `at` method. As a simple example:

```ruby
view.addresses.at(1).text
```

will give the text of the second address on the page. Negative numbers will index from the end of the list. As a convenience, `first` and `last` are provided, which simply call `at(0)` and `at(-1)`.

##### Indexing with a nested list

In the case above, `view.addresses.text[1]` would provide the same result (although it would be less efficient). However, `at`/`first`/`last` have different semantics with nested lists. For example:

```ruby
addresses.first.phone_numbers.text
addresses.phone_numbers.first.text
```

These two lines do very different things.

The first means "Get the the text of every phone number of the first address". The second means "Get the text of the first phone number of every address". The indexing method is attached to the component directly preceding it. This also means that a line like:

```ruby
addresses.middle_name.first.text
```

will error, because while `addresses` is a list component, `middle_name` (presumably) isn't.

##### Indexing in component definition

You can also use `at` directly in your component definitions. For example:

```ruby
component :second_address, ['@Address'], at: 1
```

will produce a single react component, which is the second `Address` component instance on the page.

##### Indexing and portals

A gotcha: react components are actually fetched in order of their HTML elements in the DOM. In the vast majority of cases, this will be exactly what you expect from looking at your React tree in the dev tools. However, if your component contains a portal, it may appear out of order. This is because the component's elements are (generally) appended to the end of the document body.

### Subview components

It is useful to be able to refactor your SpecView definitions into reusable components. For example, we could define a "field section" view for our form above like so:

```ruby
module SpecView
  class FieldSectionView < Base
    default_selector '.field-section'
    component :label, 'label'
    component :field, 'input'
  end
end
```

Now, in our SignInFormView definition, we could have:

```ruby
component :field_sections, [SpecView::FieldSectionView]
```

This is where `default_selector` comes into play; our SignInFormView now knows that it must find `.field-section` and wrap the result as a FieldSectionView. Note that the resulting components do _not_ inherit SignInFormView's components and methods.

So now we could test:

```ruby
expect(view.field_sections.label.text).to eql ['Name', 'Password']
```

#### Overriding a subview's selector

Often, you will want to provide a more specific selector for a subview. You can override the selector by using the `with_selector` method. Adding to our example above, you could do

```ruby
component :address_field_section, SpecView::FieldSectionView.with_selector(
  '.field_section:contains(Address)'
)
```

## Waiting

Waiting in integration tests is often a very important piece of making your tests pass consistently.  The recommended way to wait for your views to get completely rendered, and for your network requests to resolve is to call `settle`, like so:

```ruby
> view.settle
```

If you need to process jobs, you should use the `wait_for_jobs` method.  It takes a block, and will do `settle` before and after the block runs

```ruby
> view.wait_for_jobs do
>   # Launch jobs here
> end
```

For more information see the waiting section of the [API Docs](SpecViewAPIDocs.md).  If you encounter situations where `setle` doesn't wait long enough, please report it to the integration-test-infra slack channel, and we can help.  Sometimes it is necessary to use `wait_until_exists`, but you should prefer `settle`.

## Debugging queries

When debugging, it is a very slow process to repeatedly update your component selectors, then rerun your tests. If you're trying to pin down the right selector for a component, it is easier to use the `find` method. For example, you might `byebug` at a certain point in your tests, and then try:

```ruby
> view.control_section.find(["@Widget"]).count
```

to check if you match the expected number of elements. If you matched too many, you might then try something like:

```ruby
> view.control_section.find(["@Widget{label: 'Disengage Plantary Rotor Manifold'}"]).count
```

This can all be done inside of a single test run. Then, if you've found the right selector (probably meaning in this case that `count` returned 1), you can finally add to your SpecView:

```ruby
component manifold_disengage_widget, "@Widget{label: 'Disengage Plantary Rotor Manifold'}"
```

**Note: `find` is slower than `component` and non-idiomatic. It's useful for debugging, but you should prefer `component` in your actual implementation, except in rare cases where you need to customize your selector according to input arguments.**

`find` takes all the same arguments as `component`, except for `name`, and produces the same output as the equivalent component method. So once you've tested out your arguments with `find`, you can simply paste them into your `component` definition.

## Child components

Consider this HTML:

```html
<h1>Document browser</h1>
<p>Click the previews below to display full detail</p>
<div class="document-preview">
  <h1>Summary of ICTX deferrals</h1>
  <p>Lorem ipsum dolor…</p>
  <p>"Cupcake icing dollop," said Ahmed…</p>
</div>
<div class="document-preview">
  <h1>First-class tangential overviews</h1>
  <p>In the first quarter of 2017…</p>
  <p>Standard rates apply in the following…</p>
</div>
<div class="main-document">
  <h1>Fiscal Year 2018 External Proxies
  <p>When that April with his showers sweet</p>
  <p>The drought of March has pierced in the feet</p>
</div>
```

Suppose you're making a SpecView, and you mainly care about the contents of `.main-document` above. You could write your components like this:

```ruby
component :main_document,   '.main-document'
component :main_headers,    ['.main-document h1']
component :main_paragraphs, ['.main-document p']
```

But this isn't very DRY, since you need to put `.main-document` before each selector. You can probably see that in more complicated real world cases, this can get really verbose. Worse, if the structure of the DOM changes, you have to track down and change all of those prefixes.

Instead, you can use **child components** to achieve the same result:

```ruby
component :main_document, '.main-document' do
  child :main_headers, ['h1']
  child :main_paragraphs, ['p']
end
```

This also gives your SpecView a clearer visual flow, since your components are grouped together with a similar structure to the page itself.

In either version, the way you access e.g. the text of the first header, would be the same:

```ruby
view.main_headers[0].text
# or
view.main_headers.first.text
```

## Querying react components

React codebases often don't have many semantic class annotations, which makes querying just based on CSS selectors cumbersome. There are some workarounds for this, like adding `.test-someUsefulTag` to elements, and using `:contains(Some text)` selectors. But that's often very clumsy, and can produce an undesirable and tight coupling between your test code and your markup.

On the other hand, React markup provides a _ton_ of semantic information, and SpecView selectors let you take advantage of that by querying about react components themselves. Here is an example selector which queries react components:

`@Label{value: "Address"} @TextInput input;`

And here is a snippet of markdown (as you might see in the react devtools extension) which the above selector would match:

```xml
<Label value="Address">
  <TextInput theme="Base" size="m">
    <input type="text" value=""></input>
  </TextInput>
</Label>
```

As you might expect, the above selector specifically matches the `input` tag on the third line.

### Anatomy of a react selector

React selectors begin with an `@` sign and then have two parts:

1.  The component name (required). This is exactly the display name you see in the react devtools. So if you see `<puritan(Foo …>`, your react selector should be `@puritan(Foo)`.
2.  A property matcher (optional). If given, this will be checked against the properties of each component. The main points to keep in mind are:
    * It looks for a superset of the properties given. So if the `Label` above were `<Label value="Address" weight="bold">`, the above selector would still match
    * It can match deeper properties either by using a nested object, or by using syntax like `{"foo.bar.baz": "qux"}`
    * It must be a valid JS object literal, but doesn't have to be valid JSON
    * You can also match regexes like this: `@Label{value:/^Addr.*$/}`

### Limitations of react selectors

#### Mixing react selectors with HTML DOM selectors

You can mix the two types of selectors freely in one query, but the only relationship allowed between them is "descendent of". For example, this selector is fine:

`div @SomeContainer div:eq(3) @Label{value:'Foo'} @TextInput label + input`

`label + input` is allowed because that entire snippet is only about DOM elements. However, no other form of mixing is allowed. The following examples are not supported:

```
div > @TextInput
@Label > div
.foo + @TextInput
.foo ~ @TextInput
@Container > @TextInput
@Container:not(div)
@Container:first-child
@Container:eq(1)
div:has(@Container)
```

#### Views that reference react Components

Consider the following SpecView components:

```ruby
  component :name_field, '@TextInput{label:"Name"}'
  component :input, 'input'
```

If you get the result of `view.name_field`, the SpecView you get back represents the TextInput react component itself and _not_ any element inside it. However, there is no way to fetch react components from the browser directly. Therefore, if you try to use `view.name_field.style`, you will get an error; `style` is a Capybara element method, and no element can be fetched this way. Similarly, you cannot use `[]` indexing on a list of react components (but you can use `at`, as described above)

However, there are several convenience methods that can directly interact with react fetchers. These are `click`, `send_keys`, `checked`?, `hover`, `value`, `toggle`, and `clear`. These will automatically search for an appropriate element inside the react component to interact with. You can also directly call `text` on a react component or list. This will fetch the concatenated text of all the component's child elements.

## Questions?

Ping @benbernard or @ada any time if you have more questions about SpecView
