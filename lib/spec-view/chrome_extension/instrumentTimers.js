/**
 * TEAM: backend_infra
 */
// @noflow (this is part of a chrome extension, and does not go through the build pipeline)
/* global window */
/* eslint-disable no-console */

(() => {
  const timerInstrumentingCode = window.INSTRUMENT_TIMERS_MONKEY_PATCH.toString()
    .split("\n")
    .slice(1, -1)
    .join("\n");

  const scriptEl = window.document.createElement("script");
  scriptEl.type = "text/javascript";
  scriptEl.textContent = timerInstrumentingCode;
  window.document.children[0].appendChild(scriptEl);
})();
