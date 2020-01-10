/**
 * TEAM: backend_infra
 */
// @noflow (this is part of a chrome extension, and does not go through the build pipeline)
/* global chrome */
/* eslint-disable no-console */

let ports = []; // open connections that we forward network messages to

// Listen for incomming connections from content script instances (there will be
// one of these per tab, opened at page load)
console.log("Listening for incoming connections");
chrome.runtime.onConnect.addListener(port => {
  const {id} = port.sender.tab;
  console.log(`Got new connection ${id}`);
  ports.push(port);
  // Remove the port from the list on disconnect
  port.onDisconnect.addListener(() => {
    console.log(`Disconnected ${id}`);
    ports = ports.filter(p => p !== port);
  });
});

const broadcastMessage = (type, data) => {
  ports.forEach(p => p.postMessage({type, data}));
};

const listenerUrls = {urls: ["<all_urls>"]};

// Tell all the ports about new requests
chrome.webRequest.onBeforeRequest.addListener(details => {
  console.log(`Got request ${details.requestId} ${details.url}`);
  broadcastMessage("networkMonitorAddRequest", details);
}, listenerUrls);

const requestEndedCallback = (eventName, details) => {
  console.log(
    `Request ${details.requestId} ${details.url} ended (${eventName})`
  );
  broadcastMessage("networkMonitorRemoveRequest", details);
};

const endEvents = ["onBeforeRedirect", "onCompleted", "onErrorOccurred"];
endEvents.forEach(event => {
  chrome.webRequest[event].addListener(
    details => requestEndedCallback(event, details),
    listenerUrls
  );
});
