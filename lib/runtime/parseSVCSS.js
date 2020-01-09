/**
 * TEAM: backend_infra
 * WATCHERS: osuushi
 */
// @noflow (this is injected through selenium, and does not go through the build pipeline)
/* global _SpecView */

// Separate a CSS string with @ComponentName{property: 'foo'} strings in it into
// its jquery and react query components.
//
// Each query component has schema {type: 'jquery' | 'react', selector: string (jquery selector)}
// React components will be objects with {componentName: string, propertyMatcher: object | null}
//
// Note, only plain ancestor/descendent semantics are supported for react
// components. So this is valid:
//  div > span:not(.hidden) @Widget @Greeble{foo: 'bar'} span
// But these are not:
//  div > @Widget
//  @Greeble + @Widget
//  :not(@Greeble) div
//
// Property hashes are JS object literals (they are eval'd). You can daisychain
// these by comma separating them (without spaces in between). For example:
//  @Foo{bar: 'baz', qux: 'gralt'},{qux: 'gribble', answer: 42}
// is equivalent to:
//  @Foo{bar: 'baz', qux: 'gribble', answer: 42}
//
// You usually don't want to do this with a hand-written selector, but it makes
// it very easy to add properties onto an existing react selector; you can
// simply concatenate a new object literal onto the end. The merging is
// performed by simply passing them as the argument list to Object.assign, so it
// is a shallow merge with later props override older props.
//
// TODO: Add special react selector properties $has and $contains to help with
// narrowing messy components.
_SpecView.parseSVCSS = str => {
  // Split on spaces
  const rawParts = _SpecView.splitString(str, {
    quotes: true,
    brackets: true,
    separator: " ",
  });
  // Coalesce jquery parts and parse react parts
  const parts = [];
  let lastRun = [];

  const addLastRunIfNeeded = () => {
    if (lastRun.length === 0) return;
    parts.push({
      type: "jquery",
      selector: lastRun.join(" "),
    });
    lastRun = [];
  };

  rawParts.forEach(part => {
    if (part.length === 0) return; // skip empties
    if (part[0] === "@") {
      // @ sign marks react query part
      addLastRunIfNeeded();
      const reactPart = {type: "react"};
      const curlyIndex = part.indexOf("{");
      if (curlyIndex < 0) {
        // No property matcher
        reactPart.componentName = part.slice(1);
      } else {
        // Slice off and parse property matcher by evaling it
        const componentName = part.slice(1, curlyIndex);
        let propertyMatcher = part.slice(curlyIndex);
        // Convert to JSON from arbitrary JS
        try {
          // Put eval in a variable so that it doesn't get the local scope
          const evil = eval; // eslint-disable-line no-eval
          propertyMatcher = evil(`Object.assign({}, ...[${propertyMatcher}])`);
        } catch (err) {
          throw new Error(
            `Failed to parse property string ${propertyMatcher} – ${err}`
          );
        }

        reactPart.componentName = componentName;
        reactPart.propertyMatcher = propertyMatcher;
      }
      parts.push(reactPart);
    } else {
      // jquery fragment
      lastRun.push(part);
    }
  });
  // If the last part was jQuery, there's one more run to collect
  addLastRunIfNeeded();
  return parts;
};
