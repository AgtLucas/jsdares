/*jshint node:true jquery:true*/
"use strict";

var clayer = require('../clayer');

module.exports = function(editor) {
	editor.Box = function() { return this.init.apply(this, arguments); };
	editor.Message = function() { return this.init.apply(this, arguments); };
	editor.AutoCompleteBox = function() { return this.init.apply(this, arguments); };
	editor.Surface = function() { return this.init.apply(this, arguments); };
	
	editor.Box.prototype = {
		init: function($marking, surface) {
			this.$marking = $marking;
			this.surface = surface;
			this.$element = $('<div class="editor-box"></div>');
			this.surface.addElement(this.$element);
			this.$element.hide();
			this.$arrow = $('<div class="editor-box-arrow"></div>');
			this.$element.append(this.$arrow);
			this.$message = $('<div class="editor-box-message"></div>');
			this.$element.append(this.$message);
		},

		updatePosition: function(css) {
			this.$marking.css(css);
			var left = css.left+css.width/2;
			var newLeft = Math.max(-8, left-this.$element.outerWidth()/2);
			this.$element.css('left', newLeft);
			this.$arrow.css('left', left-newLeft);
			this.$element.css('top', css.top+css.height);
		},

		html: function(html, css) {
			// first place in top-left corner, so text wrapping etc. wont happen due to being at a border
			this.$element.css('left', 0);
			this.$element.css('top', 0);
			this.$message.html(html);
			this.updatePosition(css);
			// now force re-rendering at the new location
			this.$message.html('');
			this.$message.html(html);
		},

		remove: function() {
			this.$element.remove();
		}
	};

	editor.Message.prototype = {
		init: function(surface) {
			this.surface = surface;
			this.$marginIcon = $('<div class="editor-margin-icon"></div>');
			this.surface.addElementToMargin(this.$marginIcon);
			this.$marking = $('<div class="editor-marking"></div>');
			this.surface.addElement(this.$marking);
			this.$marking.hide();
			this.box = new editor.Box(this.$marking, this.surface);
			this.$marginIcon.on('click', this.toggleMesssage.bind(this));
			this.$marking.on('click', this.toggleMesssage.bind(this));
			this.box.$element.on('click', this.toggleMesssage.bind(this));
			this.visible = false;
			this.messageOpen = false;
			this.location = null;
			this.html = '';
			this.isCurrentlyShown = false;
			this.type = '';
		},

		showAtLocation: function(type, location, html) {
			this.switchType(type);
			if (!this.visible) {
				this.visible = true;
				this.$marginIcon.addClass('editor-margin-icon-visible');
			}
			this.$marginIcon.css('top', this.surface.lineToY(location.line));
			this.location = location;
			this.html = html;
			this.updateMessage();
		},

		openMessage: function() {
			this.messageOpen = true;
			this.updateMessage();
		},

		closeMessage: function() {
			this.messageOpen = false;
			this.updateMessage();
		},

		hide: function() {
			if (this.visible) {
				this.visible = false;
				this.$marginIcon.removeClass('editor-margin-icon-visible');
			}
			this.updateMessage();
		},

		remove: function() {
			this.$marginIcon.remove();
			this.$marking.remove();
			this.box.remove();
		},

		/// INTERNAL FUNCTIONS ///
		switchType: function(type) {
			if (this.type !== type) {
				this.$marginIcon.removeClass('editor-margin-message-icon-' + this.type);
				this.type = type;
				this.$marginIcon.addClass('editor-margin-message-icon-' + this.type);
			}
		},

		toggleMesssage: function() {
			this.messageOpen = !this.messageOpen;
			this.updateMessage();
		},

		updateMessage: function() {
			if (this.visible && this.messageOpen && this.location !== null) {
				if (!this.isCurrentlyShown) {
					this.isCurrentlyShown = true;
					this.$marking.hide().fadeIn(150);
					this.box.$element.hide().fadeIn(150);
				}
				this.box.html(this.html, this.surface.makeElementLocationRange(this.location));
			} else {
				if (this.isCurrentlyShown) {
					this.isCurrentlyShown = false;
					this.$marking.show().fadeOut(150);
					this.box.$element.show().fadeOut(150);
				}
			}
		}
	};

	editor.AutoCompleteBox.prototype = {
		init: function(surface, delegate, line, column, offset) {
			this.$element = $('<div class="editor-autocomplete-box"><div class="editor-autocomplete-arrow"></div></div>');
			surface.addElement(this.$element);

			this.$content = $('<div class="editor-autocomplete-content"></div>');
			this.$element.append(this.$content);

			this.$element.append('<div class="editor-autocomplete-hint"><i class="icon-keyboard icon-white"></i> press <strong>enter</strong> to insert, hold <strong>shift</strong> to insert only names</div>');

			this.$marginIcon = $('<div class="editor-margin-icon editor-margin-message-icon-preview"></div>');
			surface.addElementToMargin(this.$marginIcon);
			this.$marginIcon.css('top', surface.lineToY(line));
			this.$marginIcon.hide();
			this.$marginIcon.fadeIn(150);

			this.line = line; this.column = column, this.offset = offset;
			this.$element.css(surface.makeElementLocation(line+1, column));

			this.delegate = delegate;
			this.width = 0;
			this.offset = offset;
			this.selected = -1;
			this.examples = [];
			this.previousExample = '';
			this.shiftPressed = false;
		},

		setExamples: function(examples, text) {
			this.storePreviousExample();
			this.examples = examples.examples;
			this.prefix = examples.prefix;
			this.width = examples.width;
			this.text = text;
			this.updateExamples();
		},

		remove: function() {
			this.$element.remove();
			this.$marginIcon.remove();
		},

		up: function() {
			if (this.examples.length > 0) {
				if (this.selected > 0) {
					this.select(this.selected-1);
				} else {
					this.select(this.examples.length-1);
				}
				this.scrollToSelected();
			}
		},

		down: function() {
			if (this.examples.length > 0) {
				if (this.selected < this.examples.length-1) {
					this.select(this.selected+1);
				} else {
					this.select(0);
				}
				this.scrollToSelected();
			}
		},

		shift: function(value) {
			var scrollTop = this.$content.scrollTop();
			this.shiftPressed = value;
			this.storePreviousExample();
			this.updateExamples();
			this.$content.stop().scrollTop(scrollTop);
		},

		enter: function() {
			if (this.selected >= 0 && this.selected < this.examples.length) {
				this.insert();
			} else {
				this.cancel();
			}
		},

		cancel: function() {
			this.delegate.disableAutoCompletion();
		},

		/// INTERNAL FUNCTIONS ///
		storePreviousExample: function() {
			if (this.examples[this.selected] !== undefined) {
				this.previousExample = this.examples[this.selected][0];
			}
		},

		updateExamples: function() {
			this.$content.children('.editor-autocomplete-line').remove(); // prevent $.data leaks
			this.$lines = [];
			var selected = 0;
			this.selected = -1;
			if (this.examples.length > 0) {
				this.$element.show();
				for (var i=0; i<this.examples.length; i++) {
					var $line = $('<div class="editor-autocomplete-line"></div>');
					var example = this.examples[i][0];
					var suffix = this.examples[i][1];
					$line.html(this.prefix + '<strong>' + example.substring(0, this.width) + '</strong>' + example.substring(this.width) + (!this.shiftPressed ? suffix : ''));
					$line.on('mousemove', this.mouseMove.bind(this));
					$line.on('click', this.click.bind(this));
					$line.data('example-number', i);
					this.$content.append($line);
					this.$lines.push($line);
					if (example === this.previousExample) selected = i;
				}
				this.select(selected);
				this.scrollToSelected();
			} else {
				this.$element.hide();
			}
		},

		select: function(number) {
			if (this.selected !== number) {
				this.$content.children('.editor-autocomplete-line').removeClass('editor-autocomplete-selected');
				this.selected = number;
				if (this.selected >= 0) {
					this.$lines[this.selected].addClass('editor-autocomplete-selected');
					var example = this.examples[this.selected];
					this.delegate.previewExample(this.offset, this.offset+this.width, example[0] + (!this.shiftPressed ? example[1] : ''));
				} else {
					this.delegate.previewExample(this.offset, this.offset+this.width, '');
				}
			}
		},

		scrollToSelected: function() {
			if (this.selected >= 0) {
				// the offset is weird since .position().top changes when scrolling
				var y = this.$lines[this.selected].position().top + this.$content.scrollTop();
				y = Math.max(0, y - this.$content.height()/2);
				this.$content.stop(true).animate({scrollTop : y}, 150, 'linear');
			} else {
				this.$content.stop(true).animate({scrollTop : 0}, 150, 'linear');
			}
		},

		insert: function(number) {
			number = number || this.selected;
			var example = this.examples[number];
			this.delegate.insertExample(this.offset, this.offset+this.width, example[0] + (!this.shiftPressed ? example[1] : ''));
		},

		mouseMove: function(event) {
			this.select($(event.delegateTarget).data('example-number'));
		},

		click: function(event) {
			event.preventDefault(); // e.g. selecting stuff
			this.insert($(event.delegateTarget).data('example-number'));
		}
	};

	editor.Surface.prototype = {
		init: function($div, delegate) {
			this.$div = $div;
			this.$div.addClass('editor');
			this.delegate = delegate;

			// setting up textarea
			this.$textarea = $('<textarea class="editor-code" autocorrect="off" autocapitalize="off" spellcheck="false" wrap="off"></textarea>');
			this.$div.append(this.$textarea);

			this.$textarea.on('keydown', this.keyDown.bind(this));
			this.$textarea.on('keyup', this.keyUp.bind(this));
			this.$textarea.on('blur', this.lostFocus.bind(this));
			this.$textarea.on('click', this.click.bind(this));

			// setting up surface
			this.$surface = $('<div class="editor-surface"></div>');
			this.$div.append(this.$surface);

			// setting up margin
			this.$margin = $('<div class="editor-margin"></div>');
			this.$div.append(this.$margin);
			
			// setting up message
			this.message = new editor.Message(this);

			this.updateSize = this.updateSize.bind(this);
			$(window).on('resize', this.updateSize);

			this.initOffsets();

			this.text = '';
			this.userChangedText = false;
			this.autoCompleteBox = null;
			this.$timeHighlights = {};
			this.showElementsTimeout = null;
		},

		remove: function() {
			$(window).off('resize', this.updateSize);
			this.hideAutoCompleteBox();
			//this.$highlightMarking.remove();
			this.message.remove();
			this.$surface.children('.editor-time-highlight').remove();
			this.$margin.remove();
			this.$surface.remove();
			this.$textarea.remove();
			this.$div.html('');
			this.$div.removeClass('editor editor-error editor-step');
			this.$mirrorContainer.remove();
		},

		getText: function() {
			return this.text;
		},

		setText: function(newText) {
			this.lastSelectionStart = this.$textarea[0].selectionStart;
			this.lastSelectionEnd = this.$textarea[0].selectionEnd;
			this.$textarea.val(newText);
			this.text = newText;
			this.userChangedText = false;
			this.updateSize();
			this.$textarea[0].selectionStart = this.lastSelectionStart;
			this.$textarea[0].selectionEnd = this.lastSelectionStart;
		},

		enable: function() {
			this.$textarea.removeAttr('readonly');
		},

		disable: function() {
			this.$textarea.attr('readonly', 'readonly');
		},

		columnToX: function(column) {
			return Math.max(0, Math.min(column*this.charWidth, this.$surface.css('width').replace('px', '')-7));
		},

		lineToY: function(line) {
			return Math.max(0, (line-1)*this.lineHeight);
		},

		addElement: function($element) {
			this.$surface.append($element);
		},

		addElementToMargin: function($element) {
			this.$margin.append($element);
		},

		enableMouse: function() {
			this.$div.on('mousemove', this.mouseMove.bind(this));
			this.$div.on('mouseleave', this.mouseLeave.bind(this));
		},

		disableMouse: function() {
			this.$div.off('mousemove mouseleave');
		},

		showMessage: function(type, location, html) {
			this.message.showAtLocation(type, location, html);
			this.$div.removeClass('editor-error editor-step');
			if (type === 'error') {
				this.$div.addClass('editor-error');
			} else {
				this.$div.addClass('editor-step');
			}
		},

		hideMessage: function() {
			this.$div.removeClass('editor-error editor-step');
			this.message.hide();
		},

		openMessage: function() {
			this.message.openMessage();
		},

		closeMessage: function() {
			this.message.closeMessage();
		},

		enableHighlighting: function() {
			this.$div.addClass('editor-highlighting');
		},

		disableHighlighting: function() {
			this.$div.removeClass('editor-highlighting');
			this.removeHighlights();
		},

		addHighlight: function(location) {
			var $highlightMarking = $('<div class="editor-marking editor-highlight"></div>');
			this.addElement($highlightMarking);
			$highlightMarking.css(this.makeElementLocationRange(location));
		},

		showHighlight: function(location) {
			this.removeHighlights();
			this.addHighlight(location);
		},

		removeHighlights: function() {
			this.$surface.children('.editor-highlight').remove();
		},

		hideHighlight: function() {
			this.removeHighlights();
		},

		showFunctionHighlight: function(location) {
			this.hideFunctionHighlight();
			var $highlightMarking = $('<div class="editor-marking editor-highlight-function"></div>');
			this.addElement($highlightMarking);
			$highlightMarking.css(this.makeElementLocationRange(location));
		},

		hideFunctionHighlight: function() {
			this.$surface.children('.editor-highlight-function').remove();
		},

		showTimeHighlights: function(timeHighlights) {
			this.$margin.children('.editor-time-highlight').addClass('editor-time-highlight-remove');
			for (var name in timeHighlights) {
				if (this.$timeHighlights[name] === undefined)  {
					this.$timeHighlights[name] = $('<div class="editor-time-highlight editor-time-highlight-inactive"></div>');
					this.$timeHighlights[name].on({
						click: this.timeHighlightClick.bind(this),
						mousemove: this.timeHighlightMouseMove.bind(this),
						mouseleave: this.timeHighlightMouseLeave.bind(this)
					});
					this.$timeHighlights[name].data('name', name);
					this.addElementToMargin(this.$timeHighlights[name]);
				}
				this.$timeHighlights[name].removeClass('editor-time-highlight-remove');
				var y = this.lineToY(timeHighlights[name].line);
				this.$timeHighlights[name].css('top', y);
				this.$timeHighlights[name].height(this.lineToY(timeHighlights[name].line2+1) - y);
				this.$timeHighlights[name].show();
			}

			var $timeHighlights = this.$timeHighlights;
			this.$margin.children('.editor-time-highlight-remove').each(function(){
				var $this = $(this);
				delete $timeHighlights[$this.data('name')];
				$this.remove();
			});
		},

		timeHighlightMouseMove: function(event) {
			var $target = $(event.delegateTarget);
			if ($target.hasClass('editor-time-highlight-inactive')) {
				$target.removeClass('editor-time-highlight-inactive').addClass('editor-time-highlight-hover');
				this.delegate.timeHighlightHover($target.data('name'));
				this.delegate.timeHighlightActivate($target.data('name'));
			}
		},

		timeHighlightMouseLeave: function(event) {
			var $target = $(event.delegateTarget);
			if ($target.hasClass('editor-time-highlight-hover')) {
				$target.removeClass('editor-time-highlight-hover').addClass('editor-time-highlight-inactive');
				this.delegate.timeHighlightDeactivate($target.data('name'));
			}
		},

		timeHighlightClick: function(event) {
			var $target = $(event.delegateTarget);
			if ($target.hasClass('editor-time-highlight-active')) {
				$target.removeClass('editor-time-highlight-active').addClass('editor-time-highlight-hover');
				this.delegate.timeHighlightHover($target.data('name'));
			} else if ($target.hasClass('editor-time-highlight-hover')) {
				$target.removeClass('editor-time-highlight-hover').addClass('editor-time-highlight-active');
			} else {
				$target.removeClass('editor-time-highlight-inactive').addClass('editor-time-highlight-active');
				this.delegate.timeHighlightActivate($target.data('name'));
			}
		},

		hideTimeHighlights: function() {
			this.$margin.children('.editor-time-highlight').hide();
		},

		hideInactiveTimeHighlights: function() {
			for (var name in this.$timeHighlights) {
				if (this.$timeHighlights[name].hasClass('editor-time-highlight-hover')) {
					this.$timeHighlights[name].removeClass('editor-time-highlight-hover').addClass('editor-time-highlight-inactive');
					this.delegate.timeHighlightDeactivate(name);
				}
			}
			this.$margin.children('.editor-time-highlight-inactive').hide();
		},

		scrollToLine: function(line) {
			this.scrollToY(this.lineToY(line));
		},

		makeElementLocation: function(line, column) {
			return {
				left: this.columnToX(column),
				top: this.lineToY(line)
			};
		},

		makeElementLocationRange: function(location) {
			var x = this.columnToX(location.column), y = this.lineToY(location.line);
			return {
				left: x,
				top: y,
				width: this.columnToX(location.column2) - x,
				height: this.lineToY(location.line2) - y
			};
		},

		restoreCursor: function(from, offset) {
			if (this.lastSelectionStart !== null && this.lastSelectionEnd !== null) {
				if (this.lastSelectionStart >= from) this.$textarea[0].selectionStart = this.lastSelectionStart + offset;
				if (this.lastSelectionEnd >= from) this.$textarea[0].selectionEnd = this.lastSelectionEnd + offset;
			}
		},

		restoreCursorRange: function(offset1, offset2) {
			if (this.lastSelectionStart !== null && this.lastSelectionEnd !== null) {
				this.$textarea[0].selectionStart = this.lastSelectionStart + offset1;
				this.$textarea[0].selectionEnd = this.lastSelectionEnd + offset2;
			}
		},

		setCursor: function(start, end) {
			this.$textarea[0].selectionStart = start;
			this.$textarea[0].selectionEnd = end;
		},

		resetCursor: function() {
			this.lastSelectionStart = null;
			this.lastSelectionEnd = null;
		},

		showAutoCompleteBox: function(line, column, offset, examples) {
			if (this.autoCompleteBox !== null) {
				if (this.autoCompleteBox.offset !== offset) {
					this.autoCompleteBox.remove();
					this.autoCompleteBox = new editor.AutoCompleteBox(this, this.delegate, line, column, offset);
				}
			} else {
				this.autoCompleteBox = new editor.AutoCompleteBox(this, this.delegate, line, column, offset);
			}
			this.autoCompleteBox.setExamples(examples, this.text);
			this.hideMessage();
		},

		hideAutoCompleteBox: function() {
			if (this.autoCompleteBox !== null) {
				this.autoCompleteBox.remove();
				this.autoCompleteBox = null;
			}
		},

		autoCompleteNavigateDown: function(event) {
			if (event.keyCode === 38) { // 38 == up
				this.autoCompleteBox.up();
				event.preventDefault();
			} else if (event.keyCode === 40) { // 40 == down
				this.autoCompleteBox.down();
				event.preventDefault();
			} else if (event.keyCode === 16) { // 16 == shift
				this.autoCompleteBox.shift(true);
				event.preventDefault();
			} else if ([13, 9].indexOf(event.keyCode) >= 0) { // 13 == enter, 9 == tab
				this.autoCompleteBox.enter();
				event.preventDefault();
			} else if (event.keyCode === 27) { // 27 == escape
				this.autoCompleteBox.cancel();
				event.preventDefault();
			}
		},

		autoCompleteNavigateUp: function(event) {
			if (event.keyCode === 16) { // 16 == shift
				this.autoCompleteBox.shift(false);
				event.preventDefault();
			}
		},

		getTextArea: function() { // only for editables to add classes
			return this.$textarea;
		},

		/// INTERNAL FUNCTIONS ///
		initOffsets: function() {
			// setting up mirror
			this.$mirror = $('<div class="editor-mirror"></div>');
			this.$mirrorContainer = $('<div class="editor-mirror-container"></div>');
			this.$mirrorContainer.append(this.$mirror);
			$('body').append(this.$mirrorContainer);

			this.$mirror.text('a');
			this.textOffset = {x: this.$mirror.outerWidth(), y: this.$mirror.outerHeight()};

			// this trick of measuring a long string especially helps Firefox get an accurate character width
			this.$mirror.text('a' + new Array(100+1).join('a'));
			this.charWidth = (this.$mirror.outerWidth() - this.textOffset.x)/100;

			this.$mirror.text('a\na');
			this.lineHeight = this.$mirror.outerHeight() - this.textOffset.y;
			
			// this works assuming there is no padding on the right or bottom
			this.textOffset.x -= this.charWidth;
			this.textOffset.y -= this.lineHeight;

			// the offset is weird since .position().top changes when scrolling
			var textAreaOffset = {
				x: (this.$textarea.position().left + this.$div.scrollLeft()),
				y: (this.$textarea.position().top + this.$div.scrollTop())
			};

			this.$surface.css('left', textAreaOffset.x + this.textOffset.x);
			this.$surface.css('top', textAreaOffset.y + this.textOffset.y);
			this.$margin.css('top', textAreaOffset.y + this.textOffset.y);
		},

		updateSize: function() {
			this.$mirror.text(this.text);
			this.$textarea.width(this.$mirror.outerWidth());
			this.$textarea.height(this.$mirror.outerHeight() + 100);
		},

		showElements: function() {
			this.$div.removeClass('editor-typing');
			this.clearShowElementsTimeout();
		},

		hideElements: function() {
			this.$div.addClass('editor-typing');
			this.clearShowElementsTimeout();
			this.showElementsTimeout = setTimeout(this.showElements.bind(this), 1000);
		},

		clearShowElementsTimeout: function() {
			if (this.showElementsTimeout !== null) {
				clearTimeout(this.showElementsTimeout);
				this.showElementsTimeout = null;
			}
		},

		pageXToColumn: function(x) {
			return Math.floor((x-this.$textarea.offset().left-this.textOffset.x)/this.charWidth);
		},

		pageYToLine: function(y) {
			return 1+Math.floor((y-this.$textarea.offset().top-this.textOffset.y)/this.lineHeight);
		},

		scrollToY: function(y) {
			y = Math.max(0, y - this.$div.height()/2);
			this.$div.stop(true).animate({scrollTop : y}, 150, 'linear');
			//this.$div.scrollTop(y);
		},

		sanitizeTextArea: function() {
			this.$textarea.val(this.$textarea.val().replace(/\t/g, '  '));
		},

		keyDown: function(event) {
			// 17 == CTRL, 18 == ALT, (17, 91, 93, 224) == COMMAND, 27 == ESC, 113 = F2, 114 = F3
			// let these through for the keyboard shortcuts
			if ([17, 18, 91, 93, 224, 27, 113, 114].indexOf(event.keyCode) < 0) {
				event.stopPropagation();
			}

			this.sanitizeTextArea();
			if (this.$textarea.val() !== this.text) {
				// note: this will never be called at the first keypress, only when holding it!
				this.text = this.$textarea.val();
				this.updateSize();
				this.userChangedText = true;
			}

			// 38 == up, 40 == down, 13 == enter, 16 == shift, 9 == TAB, 17 == CTRL, 18 == ALT, (17, 91, 93, 224) == COMMAND, 113 = F2, 114 = F3
			if ([38, 40, 13, 16, 9, 17, 18, 91, 93, 224, 113, 114].indexOf(event.keyCode) < 0) {
				this.delegate.autoComplete(event, this.$textarea[0].selectionStart);
			} else if (this.autoCompleteBox !== null) {
				this.autoCompleteNavigateDown(event);
			} else {
				if (this.delegate.tabIndent(event, this.$textarea[0].selectionStart, this.$textarea[0].selectionEnd)) {
					this.userChangedText = true;
				}
			}

			if (this.userChangedText) {
				this.hideElements();
			}
		},

		keyUp: function(event) {
			// 17 == CTRL, 18 == ALT, (17, 91, 93, 224) == COMMAND, 27 == ESC, 113 = F2, 114 = F3
			// let these through for the keyboard shortcuts
			if ([17, 18, 91, 93, 224, 27, 113, 114].indexOf(event.keyCode) < 0) {
				event.stopPropagation();
			}
			
			this.sanitizeTextArea();
			if (this.$textarea.val() !== this.text) {
				this.text = this.$textarea.val();
				this.delegate.autoIndent(event, this.$textarea[0].selectionStart);
				this.updateSize();
				this.userChangedText = true;
			}

			// 38 == up, 40 == down, 13 == enter, 16 == shift, 9 == TAB, 17 == CTRL, 18 == ALT, (17, 91, 93, 224) == COMMAND, 113 = F2, 114 = F3
			if ([38, 40, 13, 16, 9, 17, 18, 91, 93, 224, 113, 114].indexOf(event.keyCode) < 0) {
				this.delegate.autoComplete(event, this.$textarea[0].selectionStart);
			} else if (this.autoCompleteBox !== null) {
				this.autoCompleteNavigateUp(event);
			}

			if (this.userChangedText) {
				this.userChangedText = false;
				this.showElements();
				if (this.autoCompleteBox === null) {
					this.delegate.userChangedText();
				}
			}
		},

		lostFocus: function(event) {
			if (this.userChangedText) {
				this.userChangedText = false;
				this.showElements();
				if (this.autoCompleteBox === null) {
					this.delegate.userChangedText();
				}
			}
		},

		click: function(event) {
			if (this.autoCompleteBox !== null) {
				this.delegate.autoComplete(event, this.$textarea[0].selectionStart);
			} else {
				this.delegate.disableAutoCompletion();
			}
		},

		mouseMove: function(event) {
			this.delegate.mouseMove(event, this.pageYToLine(event.pageY), this.pageXToColumn(event.pageX));
		},

		mouseLeave: function(event) {
			this.delegate.mouseLeave(event);
		}
	};
};