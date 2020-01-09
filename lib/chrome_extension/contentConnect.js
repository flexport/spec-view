/**
 * TEAM: backend_infra
 */
// @noflow (this is part of a chrome extension, and does not go through the build pipeline)
/* global chrome, window*/

/*
This may seem strangely designed, but the chrome extension API is of the
masocore school of API design, and this is actually the simplest way to do
things.

How this works is as follows:

First, we define a simple function for running arbitrary scripts inside the
tab's javascript context. This works by script tag injection, and the reason we
do it this way is that all official channels for running scripts are sandboxed,
so we can't maintain a global array that SpecView can see.

We then use this function to install a small handler runtime, which creates a
global function "onTestExtensionMessage" to receive messages from the content
script. There _is_ a built-in messaging system, but it would require the
background task to carefully manage connections, listening to when pages load
and unload, and injecting a listener at each stage. In other words, it ends up
being more complicated than this script, and still requires script tag
injection.

Sending a message is simply a matter of calling sendMessage, which converts the
message to JSON, then creates a script which calls onTestExtensionMessage.

Finally, after injecting the handler, we connect to the background task so that
it can broadcast network events to us, and we turn around and proxy those to the
handler described above. We must use the background task for this, because
content scripts are not allowed to access the API which lets you monitor network
requests.
*/

// Run a script inside the tab this content script goes with. inputFn should be
// a function, which can take arguments, and then any JSON-serializable
// arguments may be passed. This works by converting inputFn to a string, so the
// closure is not available, and only data that can be converted to JSON may be
// passed.

const runClientScript = (inputFn, ...args) => {
  // Convert into function call, passing in args as JSON
  const code = `(${inputFn})(...${JSON.stringify(args)})`;

  const script = window.document.createElement("script");
  // Wrap the code to execute in an immediate function, then append that text to
  // the script tag. This implicitly creates a TextNode with the string we pass,
  // which means we don't have to worry about escaping HTML
  script.append(`;(() => {
    ${code};
  })();`);
  // Appending a script causes its contents to execute immediately
  window.document.body.append(script);
  // Since the script has executed, we can clean up by removing it from the DOM.
  script.remove(); // The perfect crime.
};

// Messages queued before the window finishes loading
const messageQueue = [];
if (window.location.href.endsWith("?test-fake-requests")) {
  // used to test that we send queued messages after loading
  messageQueue.push([
    "networkMonitorAddRequest",
    {url: "FAKE REQUEST URL", requestId: -50},
  ]);
}

let isLoaded = false;

const sendMessage = (type, data) => {
  if (!isLoaded) {
    messageQueue.push([type, data]);
    return;
  }

  runClientScript(() => {
    if (!window.onTestExtensionMessage) {
      // eslint-disable-next-line no-alert
      window.alert(
        "Tried to send test extension manage with no injected handler"
      );
    }
  });

  // Inject a call to the message handler
  runClientScript(
    (type, data) => window.onTestExtensionMessage(type, data),
    type,
    data
  );
};

// Connect to background process
const port = chrome.runtime.connect();
port.onMessage.addListener(message => {
  sendMessage(message.type, message.data);
});

const tryInjectHandler = () => {
  if (window.document.readyState === "loading") return; // not ready to inject yet

  runClientScript(() => {
    // Request details array. When a request completes, it is removed from the
    // list by id. Note that the order of this array is undefined
    window.outstandingRequestDetails = [];
    const outstanding = window.outstandingRequestDetails;

    const addRequest = requestDetails => {
      outstanding.push(requestDetails);
    };

    // O(n) in-place reject which does not preserve ordering; working from the end
    // of the array, anything matching the predicate will be swapped with the last
    // element, and then the array truncated.
    const inplaceFilter = (inputArray, predicate) => {
      const array = inputArray;
      for (let i = array.length - 1; i >= 0; i -= 1) {
        if (!predicate(array[i])) {
          array[i] = array[array.length - 1];
          array.length -= 1;
        }
      }

      return array;
    };

    const removeRequest = requestDetails => {
      inplaceFilter(
        outstanding,
        rd => rd.requestId !== requestDetails.requestId
      );
    };

    window.onTestExtensionMessage = (type, data) => {
      switch (type) {
        case "networkMonitorAddRequest":
          addRequest(data);
          break;
        case "networkMonitorRemoveRequest":
          removeRequest(data);
          break;
        default:
          // Ignore all other messages
          break;
      }

      return false;
    };
  });

  isLoaded = true;
  messageQueue.forEach(([type, data]) => sendMessage(type, data));
};

// Inject the handler now, or on load
tryInjectHandler();
if (!isLoaded) {
  window.document.addEventListener("DOMContentLoaded", tryInjectHandler);
}
