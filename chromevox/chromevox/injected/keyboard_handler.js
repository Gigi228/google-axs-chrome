// Copyright 2012 Google Inc.
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

goog.provide('cvox.ChromeVoxKbHandler');

goog.require('cvox.ChromeVox');
goog.require('cvox.ChromeVoxUserCommands');
goog.require('cvox.History');
goog.require('cvox.KeyMap');
goog.require('cvox.KeySequence');
goog.require('cvox.KeyUtil');
goog.require('cvox.KeyboardHelpWidget');

/**
 * @fileoverview Handles user keyboard input events.
 *
 * @author clchen@google.com (Charles L. Chen)
 */
cvox.ChromeVoxKbHandler = {};

/**
 * The key map
 *
 * @type {cvox.KeyMap}
 */
cvox.ChromeVoxKbHandler.handlerKeyMap;

/**
 * Loads the key bindings into the keyToFunctionsTable.
 *
 * @param {string} keyToFunctionsTable The key bindings table in JSON form.
 */
cvox.ChromeVoxKbHandler.loadKeyToFunctionsTable = function(
    keyToFunctionsTable) {
  if (!window.JSON) {
    return;
  }

  cvox.ChromeVoxKbHandler.handlerKeyMap =
      cvox.KeyMap.fromJSON(keyToFunctionsTable, true);
};

/**
 * Converts the key bindings table into an array that is sorted by the lengths
 * of the key bindings. After the sort, the key bindings that describe single
 * keys will come before the key bindings that describe multiple keys.
 * @param {Object.<string, string>} keyToFunctionsTable Contains each key
 * binding and its associated function name.
 * @return {Array.<Array.<string>>} The sorted key bindings table in
 * array form. Each entry in the array is itself an array containing the
 * key binding and its associated function name.
 * @private
 */
cvox.ChromeVoxKbHandler.sortKeyToFunctionsTable_ = function(
    keyToFunctionsTable) {
  var sortingArray = [];

  for (var keySeqStr in keyToFunctionsTable) {
    sortingArray.push([keySeqStr, keyToFunctionsTable[keySeqStr]]);
  }

  function compareKeyStr(a, b) {
    // Compare the lengths of the key bindings.
    if (a[0].length < b[0].length) {
      return -1;
    } else if (b[0].length < a[0].length) {
      return 1;
    } else {
      // The keys are the same length. Sort lexicographically.
      return a[0].localeCompare(b[0]);
    }
  };

  sortingArray.sort(compareKeyStr);
  return sortingArray;
};


/**
 * Checks if ChromeVox must pass the enter key to the browser.
 * For example, if the user has focus on an input field, link, button,
 * etc., then that takes precedence over anything else ChromeVox
 * might be doing and so it must pass the enter key to the browser.
 *
 * @return {boolean} True if an Enter key event must be passed to the browser.
 */
cvox.ChromeVoxKbHandler.mustPassEnterKey = function() {
  var activeElement = document.activeElement;
  if (!activeElement) {
    return false;
  }
  return (activeElement.isContentEditable) ||
         (activeElement.getAttribute('role') == 'textbox') ||
         (activeElement.tagName == 'INPUT') ||
         (activeElement.tagName == 'A' &&
             !cvox.DomUtil.isInternalLink(activeElement)) ||
         (activeElement.tagName == 'SELECT') ||
         (activeElement.tagName == 'BUTTON') ||
         (activeElement.tagName == 'TEXTAREA');
};

/**
 * Handles key down events.
 *
 * @param {Event} evt The key down event to process.
 * @return {boolean} True if the default action should be performed.
 */
cvox.ChromeVoxKbHandler.basicKeyDownActionsListener = function(evt) {
  // The enter key can be handled either by ChromeVox or by the browser.
  if (evt.keyCode == 13 && cvox.ChromeVox.isActive) {
    // TODO(stoarca): This block belongs inside actOnCurrentItem
    // If this is an internal link, try to sync to it.
    if (document.activeElement.tagName == 'A' &&
        cvox.DomUtil.isInternalLink(document.activeElement)) {
      var targetNode;
      var targetId = document.activeElement.href.split('#')[1];
      targetNode = document.getElementById(targetId);
      if (!targetNode) {
        var nodes = document.getElementsByName(targetId);
        if (nodes.length > 0) {
          targetNode = nodes[0];
        }
      }
      if (targetNode) {
        cvox.ChromeVox.navigationManager.updateSelToArbitraryNode(targetNode);
        cvox.ChromeVoxUserCommands.finishNavCommand('');
        return true;
      }
    }

    // If the user is focused on something that explicitly takes the
    // enter key, that has precedence. Always let the key through.
    if (cvox.ChromeVoxKbHandler.mustPassEnterKey()) {
      return true;
    }
    // Act on this element.
    return cvox.ChromeVoxUserCommands.commands['actOnCurrentItem']();
  }

  var keySequence = cvox.KeyUtil.keyEventToKeySequence(evt);

  var functionName;
  if (cvox.ChromeVoxKbHandler.handlerKeyMap != undefined) {
    functionName =
        cvox.ChromeVoxKbHandler.handlerKeyMap.commandForKey(keySequence);
  } else {
    functionName = null;
  }

  // TODO (clchen): Disambiguate why functions are null. If the user pressed
  // something that is not a valid combination, make an error noise so there
  // is some feedback.

  if (!functionName) {
    return !cvox.KeyUtil.sequencing;
  }

  // If ChromeVox isn't active, ignore every command except the one
  // to toggle ChromeVox active again.
  if (!cvox.ChromeVox.isActive && functionName != 'toggleChromeVox') {
    return true;
  }

  if ((functionName != 'skipForward') && (functionName != 'skipBackward')) {
    // Do not immediately interrupt TTS since we do not want to stop speech
    // in some cases such as adjusting the TTS properties. Any cases where we
    // should be interrupting speech are already handled in
    // ChromeVoxUserCommands.
    cvox.ChromeVox.navigationManager.stopReading(false);
  }

  // This is the key event handler return value - true if the event should
  // propagate and the default action should be performed, false if we eat
  // the key.
  var returnValue = true;

  var func = cvox.ChromeVoxUserCommands.commands[functionName];
  if (func) {
    var history = cvox.History.getInstance();
    history.enterUserCommand(functionName);
    returnValue = func();
    history.exitUserCommand(functionName);
  } else if (keySequence.cvoxModifier) {
    // Modifier/prefix is active -- prevent default action
    returnValue = false;
  }

  // If the whole document is hidden from screen readers, let the app
  // catch keys as well.
  if (cvox.ChromeVox.entireDocumentIsHidden) {
    returnValue = true;
  }
  return returnValue;
};