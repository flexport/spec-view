/**
 * TEAM: backend_infra
 * WATCHERS: osuushi
 */
// @noflow (this is injected through selenium, and does not go through the build pipeline)
/* eslint-disable flowtype/require-parameter-type */
/* global _SpecView mingo */

// This creates a jquery pseudo selector for finding elements associated with
// react components through the css function :react . See react_helper.rb for more
// complete documentation, but general usage looks like:
//
//   $("div:react(TakeoverHeader) :react(Button):contains(Save)")
//
// This (loosely) means "the element for a Button which says "Save" and is
// inside the div of a TakeoverHeader". Again, see react_helper.rb for details
// and caveats about how this is used.
//
// This entire file can be copied and pasted into the console if you want to
// debug your queries in the app.

const {$} = _SpecView;

let internalInstanceKey;
const internalInstanceKeyPrefix = "__reactInternalInstance";
// Private API monkeying to getting the react instance off of a DOM node.
function getReactInstance(el) {
  if (!internalInstanceKey) {
    // This key is the same for all elements, but is munged at page
    // load, so we have to search for it the first time
    internalInstanceKey = Object.keys(el).find(k =>
      k.startsWith(internalInstanceKeyPrefix)
    );
  }

  return el[internalInstanceKey];
}
_SpecView.getReactInstance = getReactInstance;

function findDirectReactAncestor(element, predicate = () => true) {
  // Start by getting the instance off of the element. This instance's stateNode
  // will be "element", so it won't tell us much by itself.
  const elementInstance = getReactInstance(element);

  // Some elements are outside of the react DOM, and don't have instances. These
  // are just ignored.
  if (!elementInstance) return null;

  // The "return" property of a react instance analogous to the stack frame it
  // returns to once it produces its output. For more details, see:
  // https://github.com/acdlite/react-fiber-architecture
  //
  // If element is at the top-level of a component, then parent will have a
  // react component as its stateNode.

  for (
    let instance = elementInstance.return;
    instance != null;
    instance = instance.return
  ) {
    // If the instance's type is a string, it means that we're now on the instance
    // of another HTML element. That implies that element is not the direct
    // descendent of the component we're looking for.
    if (typeof instance.type === "string") return null;
    if (predicate(instance)) {
      return instance;
    }
  }
  // If we hit a null instance, we found nothing
  return null;
}

_SpecView.findDirectReactAncestor = findDirectReactAncestor;

// This is the actual pseudo selector implementation. Note that this can also be
// implemented via the _debugOwner of FiberNode, but that's not available in
// production builds of react. This implementation works both in dev and prod
// environments.

// Parse a react query string into component name and property matcher (which
// can be omitted to match only by component name).
//
// Property matcher string is parsed as JSON, and then matched against the
// component properties. This supports nesting, as well as queries like
// {"foo.bar.baz": 5}.
//
//
// Examples:
//  SomeComponent {"title": "Hello", "isDisabled": true}
//  OtherComponent {"type": "normal", "options.0.text": "Pants"}
function parseReactQueryString(reactQueryString) {
  const parts = reactQueryString.match(/^\s*(\S+)\s*(.*)$/);
  if (parts == null) {
    throw new SyntaxError(`Invalid react query: ${reactQueryString}`);
  }
  const componentName = parts[1];
  let propertyMatcher;
  if (parts[2] === "") {
    propertyMatcher = {};
  } else {
    try {
      propertyMatcher = JSON.parse(parts[2]);
    } catch (err) {
      throw new SyntaxError(`Invalid property matcher string: ${parts[2]}`);
    }
  }
  return {componentName, propertyMatcher};
}

// Exported to _SpecView so we can run unit tests against it
_SpecView.parseReactQueryString = parseReactQueryString;

// According to the react devtools source code, displayName may not be a
// string (and when we build for production, it's not defined at all). In
// those cases, we have to fall back to the type name.
const getEffectiveName = instance => {
  if (typeof instance.type.displayName === "string") {
    return instance.type.displayName;
  }
  return instance.type.name;
};

_SpecView.getEffectiveName = getEffectiveName;

// Make a react predicate based on a component name and a property predicate
const makeReactPredicate = (componentName, propertyMatcher) => {
  const propertyQuery = new mingo.Query(propertyMatcher || {});
  return instance => {
    // Some instances have null types, but we never care about those.
    if (instance.type == null) return false;
    // String types are for DOM nodes
    if (instance.type === "string") return false;

    return (
      getEffectiveName(instance) === componentName &&
      propertyQuery.test(instance.memoizedProps)
    );
  };
};

_SpecView.makeReactPredicate = makeReactPredicate;

$.expr.pseudos.react = $.expr.createPseudo(reactQueryString => {
  const {componentName, propertyMatcher} = parseReactQueryString(
    reactQueryString
  );
  const predicate = makeReactPredicate(componentName, propertyMatcher);
  return element => {
    const instance = findDirectReactAncestor(element, predicate);
    return instance != null;
  };
});

$.expr.pseudos.reactKey = $.expr.createPseudo(key => element => {
  const instance = getReactInstance(element);
  return instance && instance.key === key;
});

// Add the :is(<selector>) pseudoselector, which matches elements only if
// $(element).is(<selector>) returns true.
$.expr.pseudos.is = $.expr.createPseudo(selector => element =>
  $(element).is(selector)
);

$.fn.extend({
  // Like $.fn.find, but searches as if from the react component owner of this
  // element. The search is rooted in the _parent_ of `element` but only
  // includes matches that are in the same component's subtree. So it can match
  // element, its siblings (if they are in the same named component), or any of
  // their descendents.
  //
  // This only operates on the first element, which must be the first child of
  // the react component.
  reactFind(reactQuery, selector) {
    // Convert property matcher to query object
    const predicate = makeReactPredicate(
      reactQuery.name,
      reactQuery.propertyMatcher
    );
    // Get the relevant instance from the element
    const instanceToMatch = findDirectReactAncestor(this[0], predicate);
    // Gather siblings which also have this direct react ancestor (remember,
    // elements can have multiple direct react ancestors)
    const siblings = [this[0]];
    for (
      let el = this[0].nextElementSibling;
      el != null;
      el = el.nextElementSibling
    ) {
      if (
        findDirectReactAncestor(el, instance => instance === instanceToMatch)
      ) {
        siblings.push(el);
      } else {
        break; // relevant siblings won't be discontinuous
      }
    }

    const root = $(siblings);
    // Find from the parent, then match only those in our root set
    return this.parent()
      .find(selector)
      .filter((_index, el) => {
        const $el = $(el);
        if ($el.closest(root).length) return true;
        if ($el.is(root)) return true;
        return false;
      });
  },

  // Search the current result set for selector including the current results in
  // the traversal. That is, search from the parent(s) and then filter only to
  // elements descended from (or equal to) the current result set. This is
  // important for react traversal, because we have an "imaginary" DOM node in
  // the form of the react component itself, so queries off of react components
  // must always include the react component's children.
  inclusiveFind(selector) {
    return this.parent()
      .find(selector)
      .filter((_i, el) => {
        const $el = $(el);
        if ($el.closest(this).length) return true; // descended from one of the initial results
        if ($el.is(this)) return true; // included in the original set
        return false; // some cousin element we don't care about
      });
  },
});
