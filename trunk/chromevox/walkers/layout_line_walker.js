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
 * @fileoverview A JavaScript class for walking lines consisting of one or more
 * clickable nodes.
 * @author dtseng@google.com (David Tseng)
 */


goog.provide('cvox.LayoutLineWalker');

goog.require('cvox.AbstractWalker');
goog.require('cvox.StructuralLineWalker');


/**
 * @constructor
 * @extends {cvox.AbstractWalker}
 */
cvox.LayoutLineWalker = function() {
  this.subWalker_ = new cvox.StructuralLineWalker();
};
goog.inherits(cvox.LayoutLineWalker, cvox.AbstractWalker);


/**
 * @override
 */
cvox.LayoutLineWalker.prototype.next = function(sel) {
  // Collapse selection to the directed end.
  var endSel = new cvox.CursorSelection(sel.end, sel.end, sel.isReversed());

  // Sync to the line.
  var sync = this.subWalker_.sync(endSel);
  if (!sync) {
    return null;
  }

  // Compute the next selection.
  var start = this.subWalker_.next(endSel);
  if (!start) {
    return null;
  }
  start.setReversed(sel.isReversed());
  return this.extend_(start).setReversed(false);
};


/**
 * @override
 */
cvox.LayoutLineWalker.prototype.sync = function(sel) {
  var line = this.subWalker_.sync(sel);
  if (!line) {
    return null;
  }

  // Extend to both line breaks (in each direction).
  var end = this.extend_(line);
  var start = this.extend_(line.setReversed(!line.isReversed()));

  return new cvox.CursorSelection(start.end, end.end, sel.isReversed());
};


/**
 * @override
 */
cvox.LayoutLineWalker.prototype.getDescription = function(prevSel, sel) {
  var descriptions = [];
  var prev = prevSel;
  var absSel = sel.clone().setReversed(false);
  var cur = new cvox.CursorSelection(absSel.start, absSel.start);
  cur = this.subWalker_.sync(cur);
  if (!cur) {
    return [];
  }

  // No need to accumulate descriptions.
  if (absSel.start.node == absSel.end.node) {
    return this.subWalker_.getDescription(prevSel, sel);
  }

  // Walk through and collect descriptions for each line.
  while (cur && !cur.end.equals(absSel.end)) {
    descriptions =
        descriptions.concat(this.subWalker_.getDescription(prev, cur));
    prev = cur;
    cur = this.subWalker_.next(cur);
  }
  if (cur) {
    descriptions =
        descriptions.concat(this.subWalker_.getDescription(prev, cur));
  }
  return descriptions;
};


/**
 * @override
 */
cvox.LayoutLineWalker.prototype.getBraille = function(prevSel, sel) {
  var braille = new cvox.NavBraille({});
  var absSel = this.subWalker_.sync(sel.clone().setReversed(false));
  var layoutSel = this.sync(sel).setReversed(false);
  if (!layoutSel || !absSel) {
    return braille;
  }
  var cur = new cvox.CursorSelection(layoutSel.start, layoutSel.start);
  cur = this.subWalker_.sync(cur);
  if (!cur) {
    return braille;
  }

  // Walk through and collect braille for each line.
  while (cur && !cur.end.equals(layoutSel.end)) {
    this.appendBraille_(prevSel, absSel, cur, braille);
    prevSel = cur;
    cur = this.subWalker_.next(cur);
  }
  if (cur) {
    this.appendBraille_(prevSel, absSel, cur, braille);
  }
  return braille;
};


/**
 * @override
 */
cvox.LayoutLineWalker.prototype.getGranularityMsg = function() {
  return cvox.ChromeVox.msgs.getMsg('layout_line');
};


/**
 * Compares two selections and determines if the lie on the same horizontal
 * line as determined by their bounding rectangles.
 * @param {!cvox.CursorSelection} lSel Left selection.
 * @param {!cvox.CursorSelection} rSel Right selection.
 * @return {boolean} Whether lSel and rSel are on different visual lines.
 * @private
 */
cvox.LayoutLineWalker.prototype.isVisualLineBreak_ = function(lSel, rSel) {
  var lRect = lSel.getRange().getBoundingClientRect();
  var rRect = rSel.getRange().getBoundingClientRect();
  return lRect.bottom != rRect.bottom;
};


/**
 * Extends a given cursor selection up to the next visual line break.
 * @param {!cvox.CursorSelection} start The selection.
 * @return {!cvox.CursorSelection} The resulting selection.
 * @private
 */
cvox.LayoutLineWalker.prototype.extend_ = function(start) {
  // Extend the selection up to just before a new visual line break.
  var end = start;
  var next = start;

  do {
    end = next;
    next = this.subWalker_.next(end);
  } while (next && !this.isVisualLineBreak_(end, next));
  return new cvox.CursorSelection(start.start, end.end, start.isReversed());
};


/**
 * Private routine to append braille given three selections.
 * @param {!cvox.CursorSelection} prevSel A previous selection in walker
 * ordering.
 * @param {!cvox.CursorSelection} sel A selection that represents the location
 * of the braille cursor.
 * @param {!cvox.CursorSelection} cur The specific selection to append.
 * @param {!cvox.NavBraille} braille Braille on which to append.
 * @private
 */
cvox.LayoutLineWalker.prototype.appendBraille_ = function(
    prevSel, sel, cur, braille) {
  var item = this.subWalker_.getBraille(prevSel, cur).text;
  var valueSpanStart = item.getSpanStart(cvox.BrailleUtil.VALUE_SPAN);

  if (braille.text.getLength() > 0) {
    braille.text.append(cvox.BrailleUtil.ITEM_SEPARATOR);
  }

  var spanStart = braille.text.getLength();
  var spanEnd = spanStart + item.getLength();
  braille.text.append(item.toString());
  braille.text.setSpan(cur.start.node, spanStart, spanEnd);

  if (sel && cur.absEquals(sel)) {
    // TODO(jbroman): Generalize this to include contenteditable elements
    // via cvox.ContentEditableExtractor.
    if (valueSpanStart !== null &&
        (cvox.DomUtil.isInputTypeText(cur.start.node) ||
            cur.start.node instanceof HTMLTextAreaElement)) {
      var selectionStart = cur.start.node.selectionStart;
      var selectionEnd = cur.start.node.selectionEnd;
      braille.startIndex = spanStart + valueSpanStart + selectionStart;
      braille.endIndex = spanStart + valueSpanStart + selectionEnd;
    } else {
      braille.startIndex = spanStart;
      braille.endIndex = spanStart + 1;
    }
  }
};
