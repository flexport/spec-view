/**
 * TEAM: backend_infra
 * WATCHERS: osuushi
 */
// @noflow (this is injected through selenium, and does not go through the build pipeline)
/* eslint-disable flowtype/require-parameter-type */
/* global _SpecView, Element*/

// Each function should be defined as a config with schema:
//  {
//    fn: function(inputResult, ...arguments)
//  }

const {$} = _SpecView;

// Deeply map over an n-dimensional array (which may be an individual element rather than an array)
const deepMap = (item, fn) => {
  if (item instanceof Array) return item.map(x => deepMap(x, fn));
  return fn(item);
};

const existsHelper = item => {
  if (item == null) return false;

  if (item instanceof Array) {
    if (item.legnth === 0) return false;
    return item.some(existsHelper);
  }

  if (item instanceof _SpecView.ReactResult) {
    return item.list.length > 0;
  }

  return true;
};

const countHelper = item => {
  if (item == null) return 0;

  if (item instanceof Array) {
    return item.reduce((sum, each) => sum + countHelper(each), 0);
  }

  if (item instanceof _SpecView.ReactResult) {
    if (item.list.length === 0) {
      return 0;
    }

    return 1;
  }

  return 1;
};

// Can accept client rects, but only uses (and outputs) {x, y, width, height}
const unionRects = ([first, ...remainder]) => {
  if (remainder.length === 0) return first;
  const last = remainder.pop(); // order doesn't matter, but it's faster to pop than to shift

  // Minimum of origins
  const x = Math.min(first.x, last.x);
  const y = Math.min(first.y, last.y);

  // Convert to bottom right corner, and then back to size after maxing
  const width = Math.max(first.x + first.width, last.x + last.width) - x;
  const height = Math.max(first.y + first.height, last.y + last.height) - y;

  // Recurse with the union and the rest of the rectangles
  return unionRects([{x, y, width, height}, ...remainder]);
};

const highlightColor = alpha => `rgba(255, 170, 0, ${alpha})`;

const highlightHelper = (elements, uid) => {
  const rects = elements.map(el => el.getBoundingClientRect());
  const union = unionRects(rects);

  $("<div/>")
    .addClass("specview-highlight")
    .addClass(`specview-highlight-${uid}`)
    .css({
      position: "fixed",
      top: `${union.y}px`,
      left: `${union.x}px`,
      height: `${union.height}px`,
      width: `${union.width}px`,
      backgroundColor: highlightColor(0.5),
      border: `1px solid ${highlightColor(0.7)}`,
      zIndex: 100000,
      pointerEvents: "none",
    })
    .appendTo("body");
};

_SpecView.fetcherFunctions = {
  // Get the text of each result.
  text: {
    fn(inputResult) {
      return deepMap(inputResult, item => {
        if (item == null) return null;
        if (item instanceof Element) {
          return $(item).text();
        }
        if (item instanceof _SpecView.ReactResult) {
          return item.text();
        }
        throw new Error(
          `Cannot get text from unknown item type: ${item.constructor.name}`
        );
      });
    },
  },

  exists: {fn: existsHelper},
  count: {fn: countHelper},

  // Get an element for doing some kind of interaction to the query result.
  // Will throw if given an array, will simply pass through individual HTML
  // elements. For react components, it will return the first element it finds
  // according to the following order:
  // 1. A <textarea>
  // 2. An <input>
  // 3. A <button>
  // 4. The first top level element
  interactionElement: {
    fn(inputResult) {
      if (inputResult == null) return null;
      const throwMulti = () => {
        throw new Error(`Cannot interact with multiple elements at once`);
      };

      if (inputResult instanceof Array) throwMulti();

      if (inputResult instanceof Element) {
        return inputResult;
      }

      if (!(inputResult instanceof _SpecView.ReactResult)) {
        throw new Error(
          `Unknown argument type for interactionElement: ${
            inputResult.constructor.name
          }`
        );
      }

      if (inputResult.list.length > 1) throwMulti();
      if (inputResult.list.length < 1) return null;

      // Try to find a suitable element for interaction
      const predicates = [
        r => r.findJQuery("textarea"),
        r => r.findJQuery("input"),
        r => r.findJQuery("button"),
        r => r.findJQuery("select"),
        r => _SpecView.getReactElements(r.list[0]),
      ];
      // eslint-disable-next-line no-restricted-syntax
      for (const predicate of predicates) {
        const candidate = predicate(inputResult);
        if (candidate && candidate.length) return candidate[0];
      }
      return null; // nothing found
    },
  },

  // Get a single prop from a react component by key. Behavior is undefined if
  // the value can't be serialized.
  prop: {
    fn(inputResult, key) {
      return deepMap(inputResult, item => {
        if (item == null) return null;
        if (item instanceof Element) {
          throw new Error("Cannot get props from HTML element");
        }
        if (item instanceof _SpecView.ReactResult) {
          return item.props()[key];
        }
        throw new Error(
          `Cannot get props from unknown item type: ${item.constructor.name}`
        );
      });
    },
  },

  highlight: {
    fn(inputResult, timeout) {
      const uid = `${Math.random()}`.replace(".", "");
      deepMap(inputResult, item => {
        if (item == null) return;
        if (item instanceof Element) {
          highlightHelper([item], uid);
        } else if (item instanceof _SpecView.ReactResult) {
          highlightHelper(item.toJQuery().toArray(), uid);
        } else {
          throw new Error(
            `Cannot get highlight unknown item type: ${item.constructor.name}`
          );
        }
      });

      if (timeout) {
        setTimeout(() => $(`.specview-highlight-${uid}`).remove(), timeout);
      }

      return true;
    },
  },
};

_SpecView.getFetcherFunctionConfig = name => {
  const config = _SpecView.fetcherFunctions[name];
  if (!config) throw new Error(`Unknown query function ${name}`);
  return config;
};

_SpecView.callFetcherFunction = (name, inputResult, args) =>
  _SpecView.getFetcherFunctionConfig(name).fn(inputResult, ...args);
