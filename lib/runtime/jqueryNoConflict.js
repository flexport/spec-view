/**
 * TEAM: backend_infra
 * WATCHERS: osuushi
 */
// @noflow (this is injected through selenium, and does not go through the build pipeline)
/* eslint-disable flowtype/require-parameter-type */
/* global _SpecView, jQuery */

// Use noConflict to give SpecView its own copy of jQuery

_SpecView.$ = jQuery.noConflict(true);
