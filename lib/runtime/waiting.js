/**
 * TEAM: backend_infra
 * WATCHERS: osuushi
 */
// @noflow (this is injected through selenium, and does not go through the build pipeline)
/* eslint-disable flowtype/require-parameter-type */
/* global _SpecView window */

const {$} = _SpecView;

// Convert a regex string into a regex.
const deserializeRegex = ([pattern, flags]) => new RegExp(pattern, flags);
Object.assign(_SpecView, {
  hasOutstandingRequests(inputIgnoredPatterns = []) {
    const regexes = inputIgnoredPatterns.map(deserializeRegex);
    // Predicate for whether an URL should be ignored
    const shouldIgnoreUrl = url => regexes.some(re => re.test(url));

    // Is there any outstanding request that we _don't_ ignore?
    return window.outstandingRequestDetails.some(
      requestDetails => !shouldIgnoreUrl(requestDetails.url)
    );
  },

  hasAnyJqueryAnimation() {
    return $(":animated:first").length > 0;
  },

  hasActiveTimer(ignoredTimerPatterns) {
    const regexes = ignoredTimerPatterns.map(deserializeRegex);
    const allTimers = [..._SpecView.activeTimers.values()];
    const shouldIgnoreTimer = ({stack}) => regexes.some(re => re.test(stack));
    return allTimers.some(t => !shouldIgnoreTimer(t));
  },

  hasViewActivity(ignoredTimerPatterns) {
    return (
      _SpecView.hasAnyJqueryAnimation() ||
      _SpecView.hasActiveTimer(ignoredTimerPatterns || [])
    );
  },

  hasNetworkOrViewActivity(ignoredNetworkPatterns, ignoredTimerPatterns) {
    return (
      this.hasViewActivity(ignoredTimerPatterns) ||
      this.hasOutstandingRequests(ignoredNetworkPatterns)
    );
  },
});
