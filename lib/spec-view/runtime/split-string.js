/**
 * TEAM: backend_infra
 * WATCHERS: osuushi
 */
// @noflow (this is injected through selenium, and does not go through the build pipeline)
/* global _SpecView */
// prettier-ignore

// Module wrapper around jonschlinkert/split-string.
// See: https://github.com/jonschlinkert/split-string

/*
The MIT License (MIT)

Copyright (c) 2015-present, Jon Schlinkert.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
const module = {};

/* eslint-disable */
("use strict");
module.exports = (input, options = {}, fn) => {
  if (typeof input !== "string") throw new TypeError("expected a string");

  if (typeof options === "function") {
    fn = options;
    options = {};
  }

  let separator = options.separator || ".";
  let ast = {type: "root", nodes: [], stash: [""]};
  let stack = [ast];
  let state = {input, separator, stack};
  let string = input;
  let value, node;
  let i = -1;

  state.bos = () => i === 0;
  state.eos = () => i === string.length;
  state.prev = () => string[i - 1];
  state.next = () => string[i + 1];

  let quotes = options.quotes || [];
  let openers = options.brackets || {};

  if (options.brackets === true) {
    openers = {"[": "]", "(": ")", "{": "}", "<": ">"};
  }
  if (options.quotes === true) {
    quotes = ['"', "'", "`"];
  }

  let closers = invert(openers);
  let keep = options.keep || (value => value !== "\\");

  const block = () => (state.block = stack[stack.length - 1]);
  const peek = () => string[i + 1];
  const next = () => string[++i];
  const append = value => {
    state.value = value;
    if (value && keep(value, state) !== false) {
      state.block.stash[state.block.stash.length - 1] += value;
    }
  };

  const closeIndex = (value, startIdx) => {
    let idx = string.indexOf(value, startIdx);
    if (idx > -1 && string[idx - 1] === "\\") {
      idx = closeIndex(value, idx + 1);
    }
    return idx;
  };

  for (; i < string.length - 1; ) {
    state.value = value = next();
    state.index = i;
    block();

    // handle escaped characters
    if (value === "\\") {
      if (peek() === "\\") {
        append(value + next());
      } else {
        // if the next char is not '\\', allow the "append" function
        // to determine if the backslashes should be added
        append(value);
        append(next());
      }
      continue;
    }

    // handle quoted strings
    if (quotes.includes(value)) {
      let pos = i + 1;
      let idx = closeIndex(value, pos);

      if (idx > -1) {
        append(value); // append opening quote
        append(string.slice(pos, idx)); // append quoted string
        append(string[idx]); // append closing quote
        i = idx;
        continue;
      }

      append(value);
      continue;
    }

    // handle opening brackets, if not disabled
    if (options.brackets !== false && openers[value]) {
      node = {type: "bracket", nodes: []};
      node.stash = keep(value) !== false ? [value] : [""];
      node.parent = state.block;
      state.block.nodes.push(node);
      stack.push(node);
      continue;
    }

    // handle closing brackets, if not disabled
    if (options.brackets !== false && closers[value]) {
      if (stack.length === 1) {
        append(value);
        continue;
      }

      append(value);
      node = stack.pop();
      block();
      append(node.stash.join(""));
      continue;
    }

    // push separator onto stash
    if (value === separator && state.block.type === "root") {
      if (typeof fn === "function" && fn(state) === false) {
        append(value);
        continue;
      }
      state.block.stash.push("");
      continue;
    }

    // append value onto the last string on the stash
    append(value);
  }

  node = stack.pop();

  while (node !== ast) {
    if (options.strict === true) {
      let column = i - node.stash.length + 1;
      throw new SyntaxError(
        `Unmatched: "${node.stash[0]}", at column ${column}`
      );
    }

    value = node.parent.stash.pop() + node.stash.join(".");
    node.parent.stash = node.parent.stash.concat(value.split("."));
    node = stack.pop();
  }

  return node.stash;
};

function invert(obj) {
  let inverted = {};
  for (const key of Object.keys(obj)) inverted[obj[key]] = key;
  return inverted;
}
/* eslint-enable */
_SpecView.splitString = module.exports;
