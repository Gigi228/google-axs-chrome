// Copyright 2013 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Tools for interframe communication. To use this class, every
 * window that wants to communicate with its child iframes should enumerate
 * them using document.getElementsByTagName('iframe'), create an ID to
 * associate with that iframe, then call cvox.Interframe.sendIdToIFrame
 * on each of them. Then use cvox.Interframe.sendMessageToIFrame to send
 * messages to that iframe and cvox.Interframe.addListener to receive
 * replies. When a reply is received, it will automatically contain the ID of
 * that iframe as a parameter.
 *
 * @author dmazzoni@google.com (Dominic Mazzoni)
 */

goog.provide('cvox.Interframe');

goog.require('cvox.ChromeVoxJSON');
goog.require('cvox.DomUtil');

/**
 * @constructor
 */
cvox.Interframe = function() {
};

/**
 * The prefix of all interframe messages.
 * @type {string}
 * @const
 */
cvox.Interframe.IF_MSG_PREFIX = 'cvox.INTERFRAME:';

/**
 * The message used to set the ID of a child frame so that it can send replies
 * to its parent frame.
 * @type {string}
 * @const
 */
cvox.Interframe.SET_ID = 'cvox.INTERFRAME_SET_ID';

/**
 * The ID of this window (relative to its parent farme).
 * @type {number|string|undefined}
 */
cvox.Interframe.id;

/**
 * Array of functions that have been registered as listeners to interframe
 * messages send to this window.
 * @type {Array.<function(Object)>}
 */
cvox.Interframe.listeners = [];

/**
 * Flag for unit testing. When false, skips over iframe.contentWindow check
 * in sendMessageToIframe. This is needed because in the wild, ChromeVox may
 * not have access to iframe.contentWindow due to the same-origin security
 * policy. There is no reason to set this outside of a test.
 * @type {boolean}
 */
cvox.Interframe.allowAccessToIframeContentWindow = true;

/**
 * Initializes the cvox.Interframe module. (This is called automatically.)
 */
cvox.Interframe.init = function() {
  cvox.Interframe.messageListener = function(event) {
    if (typeof event.data === 'string' &&
        event.data.indexOf(cvox.Interframe.IF_MSG_PREFIX) == 0) {
      var suffix = event.data.substr(cvox.Interframe.IF_MSG_PREFIX.length);
      var message = /** @type {Object} */ (
          cvox.ChromeVoxJSON.parse(suffix));
      if (message['command'] == cvox.Interframe.SET_ID) {
        cvox.Interframe.id = message['id'];
      }
      for (var i = 0, listener; listener = cvox.Interframe.listeners[i]; i++) {
        listener(message);
      }
    }
    return false;
  };
  window.addEventListener('message', cvox.Interframe.messageListener, true);
};

/**
 * Unregister the main window event listener. Intended for clean unit testing;
 * normally there's no reason to call this outside of a test.
 */
cvox.Interframe.shutdown = function() {
  window.removeEventListener('message', cvox.Interframe.messageListener, true);
};

/**
 * Register a function to listen to all interframe communication messages.
 * Messages from a child frame will have a parameter 'id' that you assigned
 * when you called cvox.Interframe.sendIdToIFrame.
 * @param {function(Object)} listener The listener function.
 */
cvox.Interframe.addListener = function(listener) {
  cvox.Interframe.listeners.push(listener);
};

/**
 * Send a message to another window.
 * @param {Object} message The message to send.
 * @param {Window} window The window to receive the message.
 */
cvox.Interframe.sendMessageToWindow = function(message, window) {
  var encodedMessage = cvox.Interframe.IF_MSG_PREFIX +
      cvox.ChromeVoxJSON.stringify(message, null, null);
  window.postMessage(encodedMessage, '*');
};

/**
 * Send a message to another iframe.
 * @param {Object} message The message to send. The message must have an 'id'
 *     parameter in order to be sent.
 * @param {HTMLIFrameElement} iframe The iframe to send the message to.
 */
cvox.Interframe.sendMessageToIFrame = function(message, iframe) {
  if (cvox.Interframe.allowAccessToIframeContentWindow &&
      iframe.contentWindow) {
    cvox.Interframe.sendMessageToWindow(message, iframe.contentWindow);
    return;
  }

  // A content script can't access window.parent, but the page can, so
  // inject a tiny bit of javascript into the page.
  var encodedMessage = cvox.Interframe.IF_MSG_PREFIX +
      cvox.ChromeVoxJSON.stringify(message, null, null);
  var script = document.createElement('script');
  script.type = 'text/javascript';

  // TODO: Make this logic more like makeNodeReference_ inside api.js
  // (line 126) so we can use an attribute instead of a classname
  if (iframe.hasAttribute('id') &&
      document.getElementById(iframe.id) == iframe) {
    // Ideally, try to send it based on the iframe's existing id.
    script.innerHTML =
        'document.getElementById(decodeURI(\'' +
        encodeURI(iframe.id) + '\')).contentWindow.postMessage(decodeURI(\'' +
        encodeURI(encodedMessage) + '\'), \'*\');';
  } else {
    // If not, add a style name and send it based on that.
    var styleName = 'cvox_iframe' + message['id'];
    if (iframe.className === '') {
      iframe.className = styleName;
    } else if (iframe.className.indexOf(styleName) == -1) {
      iframe.className += ' ' + styleName;
    }

    script.innerHTML =
        'document.getElementsByClassName(decodeURI(\'' +
        encodeURI(styleName) +
        '\'))[0].contentWindow.postMessage(decodeURI(\'' +
        encodeURI(encodedMessage) + '\'), \'*\');';
  }

  // Remove the script so we don't leave any clutter.
  document.head.appendChild(script);
  window.setTimeout(function() {
    document.head.removeChild(script);
  }, 1000);
};

/**
 * Send a message to the parent window of this window, if any. If the parent
 * assigned this window an ID, sends back the ID in the reply automatically.
 * @param {Object} message The message to send.
 */
cvox.Interframe.sendMessageToParentWindow = function(message) {
  if (!cvox.Interframe.isIframe()) {
    return;
  }

  message['sourceId'] = cvox.Interframe.id;
  if (window.parent) {
    cvox.Interframe.sendMessageToWindow(message, window.parent);
    return;
  }

  // A content script can't access window.parent, but the page can, so
  // use window.location.href to execute a simple line of javascript in
  // the page context.
  var encodedMessage = cvox.Interframe.IF_MSG_PREFIX +
      cvox.ChromeVoxJSON.stringify(message, null, null);
  window.location.href =
      'javascript:window.parent.postMessage(\'' +
      encodeURI(encodedMessage) + '\', \'*\');';
};

/**
 * Send the given ID to a child iframe.
 * @param {number|string} id The ID you want to receive in replies from
 *     this iframe.
 * @param {HTMLIFrameElement} iframe The iframe to assign.
 */
cvox.Interframe.sendIdToIFrame = function(id, iframe) {
  var message = {'command': cvox.Interframe.SET_ID, 'id': id};
  cvox.Interframe.sendMessageToIFrame(message, iframe);
};

/**
 * Returns true if inside iframe
 * @return {boolean} true if inside iframe.
 */
cvox.Interframe.isIframe = function() {
  return (window != window.parent);
};

cvox.Interframe.init();
