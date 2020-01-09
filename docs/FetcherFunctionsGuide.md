# Fetcher Functions

Fetcher functions are a powerful feature of the SpecView runtime which allow you to define custom operations on query results that run in the browser without an extra roundtrip. For example, the `text`, `exists`, `count` and `prop` methods on `SpecView::Base` are all implemented as fetcher functions. 

Fetcher functions are preferable to calling custom javascript via `execute_script` or `call_script_function` for several reasons:
- They're faster, because they don't require an extra roundtrip to the browser.
- They can operate directly on React components.
- They are safer. Finding an element and then passing it back to the browser runs the risk of stale element errors. With a fetcher function, everything happens in a single browser tick, so that risk is eliminated.
- They make it easy to provide a standard API that fits with the rest of SpecView.

This guide will walk you through adding a new fetcher function, and hooking it up to the SpecView base class. For this tutorial, we'll suppose that we want to add a new function that returns the `clientWidth` DOM property for an element.

## Adding a fetcher function to the runtime

Fetcher functions are defined in runtime/fetcherFunctions.js. Each function is defined as a property of the `_SpecView.fetcherFunctions` object defined in that file.

To start out, let's add a dummy fetcher function:

```js
_SpecView.fetcherFunctions = {
  // ...
  clientWidth: {
    fn(inputResult) {
      return "Hello";
    }
  }
  // ...
}
```

This fetcher function will return the single string `"Hello"`, no matter what component you call it on.

The `inputResult` argument will always be one of the following:

- `null`, in the case that nothing was found
- an `Array`, if this is a list component. This array may be multi-dimensional, and will contain `Element`s or `ReactResult`s
- an `Element`, if this is a plain HTML component
- a `ReactResult`, if this is a React component. The `ReactResult` will always represent an individual React component.

You'll generally need to handle each of these cases. For now, let's just handle the null and element cases:

```js
clientWidth: {
  fn(inputResult) {
    if (inputResult == null) return null;
    if (inputResult instanceof Element) {
      return inputResult.clientWidth;
    }
    throw new Error("clientWidth can only be used with an element")
  }
}
```

Now we have an implementation that will work with single elements (or null), but will error if we give it a list component or react component.

Except in special cases, fetcher functions are expected to "deeply map" over arrays. That is, if your component is an N-dimensional list (e.g. `view.lists.items.paragraphs` would be a 3-dimensional list), then the output of your fetcher function would be an N-dimensional list of results. There are some exceptions to this, of course, like `count`.

To make this easier, you can handle the array case automatically by using the `deepMap` function. We can modify our function to use this like so:

```js
clientWidth: {
  fn(inputResult) {
    return deepMap(inputResult, item => {
      if (item == null) return null;
      if (item instanceof Element) {
        return item.clientWidth;
      }
      throw new Error("clientWidth can only be used with an element")
    }
  }
}
```

With `deepMap`, you don't have to handle the array case yourself; it will automatically drill into the input array and call your callback on the inner elements. Note that `deepMap` also works on a single input (you can kind of think of them as "zero-dimensional arrays"), and will just pass the input along to your callback.

Finally, we should also handle `ReactResult` inputs. A `ReactResult` is a handle for a React component instance with facilities for accessing the component:

 - `toJQuery()` will give a jQuery result for all of the _top level_ HTML elements in the React component. In most cases, this will be a single element, but if a component has `React.Fragment` at its base, `toJQuery()` can give you multiple elements. How you should handle that case depends on the query function you're implementing.
 - `findJQuery(selector)` is similar to jQuery `find`, and will search for DOM elements inside the component. The reason for using this instead of `result.toJQuery().find(selector)` is that `findJQuery` will also match the selector against the top level elements of the component. The tl;dr here is that if you want to search a `ReactResult` for a jQuery selector, you probably want `findJQuery`
 - `text()` gives the concatenated text of the entire React component.
 - `props()` returns a hash of the component's props

With that in mind, we can modify our fetcher function to handle the `ReactResult` case:

```js
clientWidth: {
  fn(inputResult) {
    return deepMap(inputResult, item => {
      if (item == null) return null;
      if (item instanceof Element) {
        return item.clientWidth;
      }
      // ReactResult
      const firstElement = item.toJQuery()[0];
      return firstElement && firstElement.clientWidth;
    }
  }
}
```

For this example, we handle the multiple element case by just using the first element. This is because `clientWidth` doesn't have a clear meaning over multiple elements. Throwing an error or aggregating the results are also reasonable strategies, depending on what your fetcher function does. You should **not** switch to returning an array in response to finding a multi-element React component, as that will lead to type confusion when people try to use your function – remember, the general rule is N-dimensional array in → N-dimensional array out.

## Adding your fetcher function to the SpecView base class

Now that you've added your function to the runtime, you need to add a method to the SpecView base class so that people can access it. Fetcher functions are global, so you should add your function to `SpecView::Base`. It's super easy:

```rb
module SpecView
  #...
  def client_width
    call_fetcher_function("clientWidth")
  end
  #...
end
```

Now tests can easily use your fetcher function like so:

```rb
it "has the correct widths" do
  expect(view.list_items.client_width).to eql([32, 38, 39])
end
```

## Arguments and return values

Our example function doesn't take any arguments, but adding arguments is pretty simple. Here's a very pointless fetcher function that takes two arguments:

in fetcherFunctions.js

```js
add: {
  fn(a, b) {
    return a + b;
  }
}
```

in spec_view/base.rb

```rb
def add(a, b)
  call_fetcher_function("add", a, b)
end
```

(Hopefully, in your own tests, you can find a more efficient way to sum two numbers)

In general, arguments and return values can be anything that can be JSON serialized, as well as raw HTML elements.