/**
 * TEAM: backend_infra
 * WATCHERS: osuushi
 */
// @noflow (this is injected through selenium, and does not go through the build pipeline)
/* eslint-disable flowtype/require-parameter-type */
/* global _SpecView, document, Element, NodeFilter */

/*
  This contains the querying architecture which allows lazy fetching of
  SpecView elements.

  Algorithm overview: (additional details in FetcherTechDetails.md)

  This runtime allows a SpecView object to send a single packet of information
  to the browser, and get back a structured result. To do this, we have a simple
  recursive data type called a "fetcher", which has the following structure:

  {
    context: "Where?"; can the document root, an DOM element, or a ReactResult
            (collection of react fiber instances), or a multidimensional array
            containing any of the above.

    query: "What?"; what selector, what matcher (see below), and is this a single element, or an array?
  }

  Consider an example component call chain:
    view.houses.bedrooms.bed.pillows

  This SpecView chain will construct a fetcher that fetches a structure like this:
  [
    [ // first house
      [ // first bed room
        first pillow,
        second pillow
      ], [ // second bedroom
        first pillow
      ]
    ]
  ]

  That is, every time we get to a _list_ component, we enter a new nesting level
  of the array. The fetcher that we produce for the above component would have
  something like the following pseudo structure.
  {
    query: multiple pillows
    context: {
      query: single bed
      context: {
        query: multiple bedrooms
        context: {
          query: multiple houses
          context: root
        }
      }
    }
  }

  Note that while we say "single bed", this fetcher as a whole examines multiple
  beds. "Multiple" or "single" in a query should be taken as "per context
  element". So we get multiple pillows per bed, one bed per bedroom, multiple
  bedrooms per house, and multiple houses in the overall document. In general,
  your result will be an N-dimensional array, where N is the total number of
  "multiple" queries found in fetcher. So if the original chain were:

    view.house.bedroom.bed.pillow

  then our output would be a single element (a zero-dimensional array, so to
  speak), and the fetcher would be identical to the above, except "single" at
  every level. If the query were either:

    view.houses.bedroom.bed.pillow
  or
    view.house.bedroom.bed.pillows

  then we'd get a simple flat array of results, and the fetcher would have
  "single" at each query, except "multiple houses" or "multiple pillows",
  respectively.

  Executing fetchers is broken into two phases:
  1. Normalize the context
  2. Execute the query

  Breaking it into these two phases makes query execution simple, because it only has to deal with three cases:
  1. null -> just return null
  2. ReactResult or element -> search the element's descendents
  3. Array -> map over the array and recurse

  So the first normalization step converts the query's context is one of the
  three cases above. The most common case that needs normalizing is when the
  context is a fetcher. In this case, we simply start the entire process over
  with the context fetcher, resulting in one of the three cases above.

  Context normalization can also deal with other cases; the "isRoot" sentinel is
  converted to the document body, for example. Multi-dimensional arrays of
  fetchers can also be converted into element arrays (this is not currently used
  by SpecView, but in the future this can be leveraged to speed up queries like:
    view.foo.bars.bazzes[1..-1].qux.gralts
  which currently require O(n) queries (where n = total number of bazzes).
*/

const {$} = _SpecView;

// Selected tag values (see https://github.com/facebook/react-devtools/blob/master/backend/attachRendererFiber.js)
const tagEnum = {
  // Supported
  functional: 0,
  class: 1,
  classLazy: 16,
  portal: 4,

  // Note: memo components are not ignored, but they cannot currently be
  // matched. This is also a problem in the react devtools chrome extension.
  // Theoretically, however that extension ultimately solves this problem, we
  // should be able to do the same thing.
  memo: 14,
  simpleMemo: 15,

  // (all other types are unsupported)
  host: 5,
};

// Caches for computing node indexes in constant average time.
function resetIdentityCache() {
  _SpecView.nodeIndexes = new Map();
}

function computeNodeIndex(node) {
  if (node.sibling == null) return 0;
  return nodeIndex(node.sibling) + 1;
}

function nodeIndex(node) {
  const cache = _SpecView.nodeIndexes;
  if (cache.has(node)) return cache.get(node);
  const index = computeNodeIndex(node);
  cache.set(node, index);
  return index;
}

// Because there can be multile Fiber nodes pointing at the same state node, we
// need a more forgiving notion of node identity for determining ancestry and scope.
function nodeIdentity(node) {
  // There's no appropriate direct object to use for functional components, so
  // we use an index from the parent identity (if the parent is also functional,
  // this will recurse until we can find a non-functional ancestor)
  if (node.tag === tagEnum.functional) {
    return `${nodeIdentity(node.return)}.${nodeIndex(node)}`;
  }
  const nodeIdentityObject = node.stateNode || node;

  // Convert to a string, so we can compose node identities into something that can be used in a hash or set
  return _SpecView.objectId(nodeIdentityObject);
}

function isSameComponent(aNode, bNode) {
  return nodeIdentity(aNode) === nodeIdentity(bNode);
}

function isComponentDirectAncestor(element, component) {
  return (
    _SpecView.findDirectReactAncestor(element, instance =>
      isSameComponent(instance, component)
    ) != null
  );
}

function getReactElements(component) {
  return $("*").filter((_i, el) => isComponentDirectAncestor(el, component));
}

// Wrapper for a result set of FiberNodes with jQuery-like search facilities
class ReactResult {
  constructor(components) {
    this.root = false;
    if (components === "root") {
      this.list = [];
      this.root = true;
    } else if (components instanceof Array) {
      this.list = components.filter(c => c != null);
    } else {
      this.list = [components];
    }
  }

  first() {
    if (this.list.length === 0) return this;
    return new ReactResult(this.list[0]);
  }

  // Get the props from the first node in the list, or an empty object if the
  // list is empty
  props() {
    if (this.list.length === 0) return {};
    return this.list[0].memoizedProps;
  }

  toArray() {
    return [...this.list];
  }

  // Turn into an array of ReactResult, each with one node
  toIndividualArray() {
    return this.list.map(node => new ReactResult(node));
  }

  // Get a jQuery result of all the top level elements of all the components in
  // this ReactResult
  toJQuery() {
    const elements = [];
    this.list.forEach(component =>
      elements.push(...getReactElements(component))
    );
    return $(elements);
  }

  // Single string text content of this. In order to be analogous to jQuery's
  // text(), this concatenates all of the text of the wrapped components'
  // elements.
  text() {
    return this.toJQuery().text();
  }

  // Query the dom elements under these react fiber nodes. Note: this only makes sense when dealing with fiber nodes that
  findJQuery(selector) {
    if (this.root) {
      // Hitting this means there's a bug in the runtime
      throw new Error("Should never call findJQuery on root ReactResult");
    }
    // If there's nothing in the list, always return an empty jquery object
    if (this.list.length === 0) return $();
    // Execute jQuery relative to each component's children, then concatenate the results
    const results = [];
    this.list.forEach(component => {
      // Search elements inclusively
      const elements = getReactElements(component).inclusiveFind(selector);
      results.push(...elements);
    });
    return $(results); // restores document order
  }

  // Find all fiber nodes which descend from at least one fiber node in the
  // result set, and which correspond to a react component matching the
  // selector.
  findReact(query) {
    // Algorithm notes: We're trying to find matching fiber nodes which are
    // descendents of the nodes in scope of this.list. However, traversing fiber nodes
    // from root to leaf has been found to be unreliable for reasons that aren't
    // clear. It appears that sometimes we end up in an "alternate" node, which
    // what React Fiber docs exist describe as a "work in progress" version of
    // the node. However, it has been found that going in the direction from
    // leaf to root is reliable and consistent.
    //
    // This algorithm enumerates the DOM in document order (depth first, left to
    // right). At each node, it scans toward the root, searching for matching
    // fibers which are descendents of one of our scope nodes. We memoize the
    // answer to "in scope" and track which nodes we've visited, so even though
    // it scans from every document node, the scan actually only takes O(m*n)
    // time, where m is the number of scope nodes, and n is the number of
    // fiber nodes in the document.
    //
    // Note that although this enumerates the HTML DOM, it _traverses_ the React
    // DOM. As a result, this algorithm will correctly jump through portals.
    // However, it can only see react components which have at least one HTML
    // element child.
    if (!this.root && this.list.length === 0) return new ReactResult([]);
    const predicate = _SpecView.makeReactPredicate(
      query.componentName,
      query.propertyMatcher
    );

    let isInScope;
    const scope = new Set(this.list.map(nodeIdentity));
    if (this.root) {
      isInScope = () => true;
    } else {
      // Memoized ancestor search
      isInScope = (check => {
        const memo = new Map();
        return node => {
          if (memo.has(node)) {
            return memo.get(node);
          }
          const result = check(node);
          memo.set(node, result);
          return result;
        };
      })(node => {
        const parent = node.return;
        // If no parent, we've hit a root of the react DOM
        if (parent == null) return false;
        if (scope.has(nodeIdentity(parent))) return true;
        // Recurse to parent
        return isInScope(parent);
      });
    }

    // Functional components have null stateNodes in production mode, which
    // means we can't easily resolve their identity. That is, we could have two
    // fiber nodes pointing at the same functional component, and no way to know
    // for sure that they are the same component. This can be fixed by wrapping
    // the function in puritan, so it becomes an actual component instance.
    //
    // TODO: We should be able to support these components by constructing a
    // path of keys/indexes back until we see an ancestor with a state node in
    // order to check if two nodes should be considered equal. At least, that
    // should work for the short term purposes we care about.
    const validateComponentSupported = node => {
      const name = _SpecView.getEffectiveName(node) || "<unknown>";
      let expectStateNode = true;
      switch (node.tag) {
        case tagEnum.class:
        case tagEnum.classLazy:
        case tagEnum.portal:
          // These are supported tags
          break;
        case tagEnum.functional:
          // Supported, but we expect no state node
          expectStateNode = false;
          break;
        case tagEnum.memo:
        case tagEnum.simpleMemo:
          throw new Error(
            [
              `Component ${name} is a memo component, which is not currently supported.`,
              `You can, however, match components inside the memo component.`,
            ].join("\n")
          );
        default:
          // For tag codes see https://github.com/facebook/react-devtools/blob/master/backend/attachRendererFiber.js
          throw new Error(
            `Component ${name} is an unsupported node type (${
              node.tag
            }) and cannot be queried with SpecView`
          );
      }
      // If we get to this point, we do not expect to see a null state node
      if (expectStateNode && node.stateNode == null) {
        throw new Error(
          `Fiber for non-functional component ${name} has no stateNode`
        );
      }
    };

    // When we see an instance we've already checked, we can stop scanning up,
    // which will also prevent duplicates
    const seenNodes = new Set();

    const results = [];
    // Every time we walk up a branch of the tree, we reset this list, then
    // collect matching instances in this list. If the branch connects to our
    // search scope, we reverse this list (to preserve document order) and splat
    // it into the results list.
    const pathMatches = [];
    // Search all elements in the document
    const iterator = document.createNodeIterator(
      document.body,
      NodeFilter.SHOW_ELEMENT
    );
    let element;
    // eslint-disable-next-line no-cond-assign
    while ((element = iterator.nextNode())) {
      pathMatches.length = 0;
      const startingNode = _SpecView.getReactInstance(element);

      for (
        // Start at the fiber node for the element (which is not a component
        // fiber, by definition)
        let node = startingNode;
        // Continue until either we have no parent (root of the react DOM) or we
        // hit a node we've already handled
        node != null && !seenNodes.has(nodeIdentity(node));
        // Walk up the tree (note walking up the react DOM is not necessarily
        // the same as moving up the HTML DOM, because the react DOM can contain
        // portals)
        node = node.return
      ) {
        // Store query matches
        if (predicate(node) && isInScope(node)) {
          // We'll tolerate unsupported nodes so long as nobody is trying to look them up.
          validateComponentSupported(node);
          pathMatches.push(node);
        }
        // Mark the node as seen
        seenNodes.add(nodeIdentity(node));
      }

      // Reverse the results to preserve document order
      results.push(...pathMatches.reverse());
    }
    return new ReactResult(results);
  }
}

// Statics
Object.assign(ReactResult, {
  // Convert a list of HTML elements (or jQuery object) to a ReactResult. If needed, elements will be sorted in document order
  fromElementList(inputList) {
    let list = inputList;
    // Coerce document order
    if (list instanceof Array) list = $(list);
    // Get react instances, omitting nulls
    const instanceList = [];
    list.each((_index, element) => {
      const instance = _SpecView.getReactInstance(element);
      if (instance) instanceList.push(instance);
    });
    return new ReactResult(instanceList);
  },

  makeRoot() {
    return new ReactResult("root");
  },
});

// Execute part of a parsed SVCSS selector (either a jquery part, or a react part)
const executeSelectorPart = (previousResult, {type, ...subquery}) => {
  if (type === "jquery") {
    if (previousResult instanceof $) {
      // Find jQuery in jQuery scope (this should only happen for the first node
      // in an SVCSS selector)
      return previousResult.find(subquery.selector);
    }
    // Find jQuery in ReactResult scope
    return previousResult.findJQuery(subquery.selector);
  }

  if (type === "react") {
    let reactList;
    // React component query
    if (previousResult instanceof $) {
      // Convert to ReactResult
      reactList = ReactResult.fromElementList(previousResult);
    } else {
      reactList = previousResult;
    }
    return reactList.findReact(subquery);
  }

  throw new Error(`Unknown SVCSS selector part type ${type}`);
};

// Memoize selector parsing
const selectorCache = {};
const parseSelector = rawSelector => {
  const cached = selectorCache[rawSelector];
  if (cached != null) return cached;
  const parsed = _SpecView.parseSVCSS(rawSelector);
  selectorCache[rawSelector] = parsed;
  return parsed;
};

// Run a function node from the fetcher tree
function executeFunction(functionName, inputResult, args) {
  return _SpecView.callFetcherFunction(functionName, inputResult, args);
}

// Run a query node from the fetcher tree
function executeQuery(query, inputContext, allowReactResult = true) {
  let context = inputContext;
  // null contexts just get null results
  if (query == null) throw new Error("Query missing");
  if (context == null) return null;

  if (context instanceof Array) {
    // Recursively map over arrays
    return context.map(contextElement => executeQuery(query, contextElement));
  }

  const parsedSelector = parseSelector(query.selector);
  if (parsedSelector.length === 0) {
    throw new Error("Cannot query with empty selector");
  }

  if (
    !allowReactResult &&
    parsedSelector[parsedSelector.length - 1].type === "react"
  ) {
    throw new Error(
      "Cannot produce snapshot of react component. Try using el or els instead"
    );
  }

  // Handle root context case
  if (context.isRoot) {
    if (parsedSelector[0].type === "jquery") {
      // jQuery can just search from the document body
      context = document.body;
    } else {
      // React queries from document root are a special case, because the
      // document body has no fiber node
      context = ReactResult.makeRoot();
    }
  }

  // Starting results are the context we're searching (convert to jquery if element)
  let result = context;
  if (result instanceof Element) result = $(result);

  parsedSelector.forEach(selectorPart => {
    result = executeSelectorPart(result, selectorPart);
  });

  if (query.multi) {
    if (result instanceof $) {
      // jQuery turns into array of elements
      result = result.toArray();
    } else {
      // ReactResult turns into array of single-node ReactResult
      result = result.toIndividualArray();
    }
    let {at} = query;
    if (at != null) {
      // negative indexes from end
      if (at < 0) at += result.length;
      result = result[at];
    }
  } else {
    if (query.at != null) throw new Error("Can only use `at` on a multi query");
    if (result instanceof $) {
      // Convert to single element
      result = result.get(0);
    } else {
      // ReactResult of only the first node
      result = result.first();
    }
  }
  return result;
}

// Convert context into "where" and "react"
function normalizeContext(context) {
  if (context == null) return context;
  if (context.isRoot) return context;
  if (context instanceof Array) {
    return context.map(item => normalizeContext(item));
  }

  if (context instanceof Element) return context;
  if (context instanceof ReactResult) return context;

  // Only other valid context is a fetcher
  if (!("query" in context && "context" in context)) {
    throw new Error(
      `Unexpected context for normalizeContext: ${JSON.stringify(context)}`
    );
  }

  // Recursion between these functions only works if we can call one of them
  // before it's defined in the file.
  return executeFetcher(context);
}

function executeFetcher(fetcher, allowReactResult = true) {
  const context = normalizeContext(fetcher.context);
  let result;
  if (fetcher.query) {
    result = executeQuery(fetcher.query, context, allowReactResult);
  } else if (fetcher.fn) {
    // TODO: This provides a hole through which you can attempt to fetch react
    // results. We need to do that check as a preprocessing step instead.
    result = executeFunction(fetcher.fn, context, fetcher.args || []);
  } else {
    throw new Error("fetcher must have either a query or fn property");
  }
  return result;
}

// Exports for debugging purposes
Object.assign(_SpecView, {
  executeFetcher,
  executeSelectorPart,
  executeQuery,
  ReactResult,
  getReactElements,
  nodeIdentity,
  isSameComponent,
  isComponentDirectAncestor,
});

Object.assign(_SpecView, {
  // Given a query, return either an element, a multidimensional array of
  // elements (or nulls), or null
  // fetcher has the schema:
  //   {
  //     context: query | element | n-dimensional element array | {isRoot: true}
  //     query?: {
  //       selector: string (SVCSS selector)
  //       multi: bool (does this return an array or an element)
  //       at: number? (index into a multi result)
  //     }
  //     fn?: string (function name)
  //     fnArgs?: Array (arguments to fn
  //   }
  // (either query or fn must exist)
  fetch(fetcher) {
    resetIdentityCache();
    return executeFetcher(fetcher, false);
  },
});
