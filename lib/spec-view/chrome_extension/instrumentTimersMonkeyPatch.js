/**
 * TEAM: backend_infra
 */
// @noflow (this is part of a chrome extension, and does not go through the build pipeline)
/* global _SpecView window */
/* eslint-disable no-console */

// This function is never called by the background page and must not try to
// access its scope. Its contents are what is injected at page load.
//
// Also, it is pased dumbly by trimming the first and last lines. So don't be
// weird about its formatting.

window.INSTRUMENT_TIMERS_MONKEY_PATCH = () => {
  // IIFE so that we aren't leaking any globals (remember, the function above is
  // unwrapped before injection into the page)
  (() => {
    try {
      // Create the _SpecView namespace if needed
      window._SpecView = window._SpecView || {};
      const TIMEOUT_TRACKING_CONSTANTS = {
        MAX_DELAY_MS: 6000,
        // Timers between 500 ms and 6 seconds can be filtered when waiting. We
        // don't do this for shorter timers because it's expensive to grab a
        // stack trace.
        MIN_BLACKLIST_DELAY_MS: 500,
      };

      // Save this here so that it can be modified in the SpecView metatests
      _SpecView.TIMEOUT_TRACKING_CONSTANTS = TIMEOUT_TRACKING_CONSTANTS;

      const activeTimers = new Map();
      // This is how the specview framework acccesses the value
      _SpecView.activeTimers = activeTimers;

      /* ******************** Instrumenting setTimeout ************************

        Below is a wrapper for setTimeout which tracks active timer ids. This
        allows tests to wait until timers have settled before proceeding, which
        reduces flakiness. Unfortunately, we can't instrument this through a
        chrome extension like we do with network waits, and not all usages of
        timers are related to what we care about in tests. As a result, we have to
        use some heuristics.

        Unfortunately, fuzzy robustness measures are generally necessary when it
        comes to integration test synchronization, so this won't fix all cases.
        It's just an extra layer of protection alongside network tracking,
        implicit element waiting, and explicit waits.

        The code below simply keeps track of active timer IDs. There are three
        cases:

        1. Timers longer than six seconds. These we don't track, because they are
           usually handling some low priority background process, or as a literal
           timeout on some operation.

        2. Timers between 500 ms and six seconds. These we do track, but we first
           grab a stack trace to try to ascertain where the timer came from. We
           search for the strings in timeoutTrackingBlacklist, and ignore any
           matches. Thereare several timer sources that frequently produce
           irrelevant timers in this range. Because we have the stack trace
           already, we save it in our tracking for these timers, in case they're
           needed for debugging.

        3. Timers below 500 ms. These we do track, and we do not check the
           blacklist. This is because stack traces are expensive, and timers in
           this length range are VERY common. For example, in some cases, loading
           a single page can cause hundreds of these timers to be created. These
           are unfiltered, as a result, but it doesn't make much difference
           because they resolve quickly.

        You can debug these in the console (assuming __TEST_ENV__ is true for your
        build) by looking at testHook.activeTimers.

      ************************************************************************/

      const contextFreeEval = window.eval; // eslint-disable-line no-eval

      const originalSetTimeout = window.setTimeout;
      const originalClearTimeout = window.clearTimeout;
      const originalClearInterval = window.clearInterval;

      const untrackId = id => activeTimers.delete(Number(id));

      window.setTimeout = (fnOrCode, delay = 0, ...params) => {
        let stack = "stack is only collected for long timeout delays";
        // Apply filters for exceptionally long timers
        const shouldTrack = (() => {
          if (delay > TIMEOUT_TRACKING_CONSTANTS.MAX_DELAY_MS) {
            // do not track timers longer than six seconds
            return false;
          } else if (
            delay >= TIMEOUT_TRACKING_CONSTANTS.MIN_BLACKLIST_DELAY_MS
          ) {
            // If the timer is greater than 500 ms (but still less than 6
            // seconds), grab its stack trace for filtering purposes.
            ({stack} = new Error());
          }
          // Track all very short timers
          return true;
        })();

        let fn;
        if (typeof fnOrCode === "function") {
          fn = fnOrCode;
        } else {
          const code = fnOrCode;
          fn = () => contextFreeEval(code);
        }
        const timerId = originalSetTimeout(
          (...args) => {
            fn(...args);
            untrackId(timerId);
          },
          delay,
          ...params
        );
        if (shouldTrack) {
          activeTimers.set(timerId, {stack, delay});
        }
        return timerId;
      };

      window.clearTimeout = id => {
        untrackId(id);
        return originalClearTimeout(id);
      };

      // This is some robustness because you are technically able to clear a
      // timeout by calling clearInterval on its id
      window.clearInterval = id => {
        untrackId(id);
        return originalClearInterval(id);
      };
    } catch (e) {
      window.alert(`Error in timer instrumentation setup: ${e}`); // eslint-disable-line no-alert
    }
  })();
};
