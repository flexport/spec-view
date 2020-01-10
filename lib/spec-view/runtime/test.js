/**
 * TEAM: backend_infra
 * WATCHERS: osuushi
 */
// @noflow (this is injected through selenium, and does not go through the build pipeline)
/* global _SpecView*/

// Used in tests to check that the runtime is installed
Object.assign(_SpecView, {
  runtimeTest() {
    return "Runtime installed!";
  },
});
