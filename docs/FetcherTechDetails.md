# Fetcher architecture

<!-- MarkdownTOC autolink="true" levels="1,2,3,4" -->

- [Motivation](#motivation)
  - [The component DSL](#the-component-dsl)
  - [The fetcher architecture](#the-fetcher-architecture)
    - [Naive implementation](#naive-implementation)
    - [Fetchers](#fetchers)
- [A quick aside about arrays](#a-quick-aside-about-arrays)
- [Anatomy of a fetcher](#anatomy-of-a-fetcher)
  - [What is "context"?](#what-is-context)
  - [An individual fetcher node](#an-individual-fetcher-node)
    - [query](#query)
    - [selector](#selector)
    - [multi](#multi)
    - [at](#at)
  - [fn](#fn)
  - [fnArgs](#fnargs)
- [Query execution](#query-execution)

<!-- /MarkdownTOC -->

This document is an in-depth explanation of the fetcher architecture used by SpecView. The code discussed here mostly lives in ./base.rb, ./runtime/query.js, and ./runtime/fetcherFunctions.js . If you merely want to use SpecViews to write tests, you don't need to read this. However, if you intend to extend fetcher execution, understanding this document first is a good idea.

Fetchers are the backbone of the component DSL given by SpecView. For example, when you run an expression like

```ruby
view.address_book.addresses.phone_numbers.area_codes.text
```

you are executing a fetcher inside the browser to produce that result.

## Motivation

### The component DSL

The purpose of the component DSL is to make it easy to define composable APIs for interacting with your views. In practice, well designed GUIs tend to have significant amounts of repetition and standardization, while at the same time being full of special cases, especially with respect to the context in which they appear. For example, a table might have fifty identically styled row, then a separator, and a final row containing aggregates. The individual rows and cells are extremely standardized, but the final row is an example of a special case. The component DSL allows you to define your components without being overly redundant. For example, with the right definitions, you might have both:

```ruby
view.table.body_rows.at(5).price_cell.text
# and
view.table.aggregate_row.price_cell.text
```

where `price_cell` is a single component within your SpecView definition.

### The fetcher architecture

The next question is how to implement the component DSL efficiently.

#### Naive implementation

We could simply fetch each component in turn. For example, in fetching:

```ruby
view.modal.footer.button.text
```

we could follow the steps:

1. Tell Selenium to search page for "modal"
2. Tell Selenium to search "modal" for "footer"
3. Tell Selenium to search "footer" for "button"
4. Tell Selenium to get text from button

This is a poor strategy for three main reasons. First, every time you say "tell Selenium", you're implying a round trip of communication to the browser, which also involves synchronization with the JS engine, and processing of the results. These calls are _very_ expensive, and even a short sequence like described above can easily take many tens of milliseconds.

Second, and related, is that all of that time passing leaves us open for stale element references. During the time that we're tossing elements back and forth between rspec and the browser, the page might change out from under us. Even worse, the slow performance of this strategy encourages test authors to cache their results, making stale element errors even more likely.

Finally, the above strategy works fine for HTML elements (which Capybara provides an API for handling), but offers no good way to handle React components.

#### Fetchers

Fetchers address all three of the problems mentioned above. Instead of executing gobs of requests with many round trips to the web browser, a fetcher encapsulates a _query_ which the browser can execute all at once. This document will explain how these queries are structured, and how the browser runtime executes them.

## A quick aside about arrays

The component DSL is a simple [array programming language](https://en.wikipedia.org/wiki/Array_programming). Nearly all operations deeply map over array inputs by default, while aggregation methods (like `count`) are the exception. That is, unless otherwise specified, you should assume that

`[a0, ..., an].someOperation` = `[a0.someOperation, ..., an.someOperation]`

and that this relation is recursive.

## Anatomy of a fetcher

The basic structure of a fetcher is a linked list. The head of this list is the _last_ term in the query. The second node provides _context_, by describing the second-to-last term and _its_ context, and so on. Forexample, consider the query:

```ruby
view.div.p.span
```

The (very simplified) structure of the fetcher would look like:

```js
{
  selector: 'span',
  context: {
    selector: 'p',
    context: {
      selector: 'div'
      context: 'root'
    }
  }
}
```

Notice that each "context" (except for 'root') is itself a fetcher. This is key to understanding both how component methods produce their fetchers, and how the runtime executes them.

### What is "context"?

The context for a fetcher is simply the scope in which we search for matching elements/react components. There are four basic things a context can be:

1. A fetcher
2. An element / react component
3. A (possibly deep) array of elements / react components
4. `{isRoot: true}`

The root context is used when you have a noncomponent SpecView instance, like `SomeSpecView.new` instead of `view.some_component`. This means "search the whole document".

Fetcher contexts are the most common case to send from the SpecView framework, although in elements will be sent.

The runtime always normalizes the context to be one of 2 or 3 above. (Null is also possible; null contexts always just fetch a null result.)

When context is an array, the runtime will deeply map over the context, executing the current query node within each scope, and producing an array result of the same dimension as the original context (or +1 if the query node has multi: true).

The rest of this section will focus on the queries themselves, and will set aside the question of what context they're executing in. This means we can focus entirely on specific nodes.

### An individual fetcher node

Aside from context, the fetcher node contains several fields

#### query

Most fetcher nodes are query nodes, and they provide this field. This specifies how to find the elements / components which we're interested in.

#### selector

This string is an SVCSS selector. These are a superset of jquery selectors, extended to support `@ComponentName{key: "value"}` terms, which match react components.

#### multi

If false, this node will output at most one item per context element. If there is more than one matching element, we simply take the first one. If there are none, we return `null`.

If true, this node will output _all_ matching items per context element. If there are no matches, an empty array is returned.

In general, `multi: true` increases the dimension of the result array by one. `at` terms notwithstanding, you can read the dimension of a component query by simply counting the number of multi component terms. So you would assume that the following:

```ruby
view.houses.basement.shelves.books.pages.text
```

returns a 4-dimensional array. That is "each page (1) of each book (2) of each shelf (3) of the basement of each house (4)", where each innermost term is the text of a particular page. In this sense, we would call a single element a "zero-dimensional array", which is a concept sometimes referenced in the implementation.

This behavior is modified by the `at` property, if it is set.

#### at

May only be used with `multi: true` nodes, and specifies an index into results produced by the previous term. This is _innermost_ indexing, and it cancels out the dimension increase of the term it attaches to. Thus

```
view.houses.at(-1).basement.shelves.books.at(0).pages.text
```

would be phrased as "the text of each page of the first book of each shelf of the basement of the last house". The `at` is not a term in its own right, but rather _modifies_ the `books` and `houses` terms. It "cancels" the dimensional increase caused by a multi term, so the above query's dimension can be read as "text of each page (1) of first book of shelves (2) of basement of first house", and so is a two-dimensional array. 

### fn

The last term in a fetcher may be a _function_ node, which is a final processing step to run on the result of a chain of query fetchers. A function fetcher _cannot_ be used as a context for another fetcher, so fetcher functions can only be used at the end of a chain.

Available functions are defined in fetcherFunctions.js, and are passed an `inputResult` argument. This argument will be null, an Element, a ReactResult (containing one React node), or an array containing any of the above (although not _both_ Elements and ReactResults).

Note that a fetcher function may return anything; some will deeply map over the input result, but they may also simply return a scalar value, or whatever else you choose. However, it would _not_ be appropriate to return a ReactResult from a query function, since that would imply that the React component was to be returned to the SpecView framework.

### fnArgs

Additional arguments to be passed to `fn`.

## Query execution

Executing a query is a recursive cooperation between two tasks:

1. Normalize the context (convert it to an element/react node or array thereof)
2. Execute the query

We start this process with the head of the fetcher list (the last term of the query). Since normalizing the context comes first, we end up recursing to the very last context (the first term in the query), and typically execute a fetcher with respect to the document root. (It is also possible to execute a fetcher from a _snapshot_ SpecView, in which case we execute with respect to its single element. Currently, there is no notion of a snapshot SpecView representing multiple elements, or a React component.) As we pop up the call stack, we execute each query term in turn, producing the normalized context for the next term of the sequence.

As mentioned above, there is currently no way to represent React components directly in Ruby, so the executor will error if a fetcher's final result contains React components.