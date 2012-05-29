/*jshint node:true*/
"use strict";

module.exports = function(jsmm) {
	require('./jsmm.func')(jsmm);
	
	var getNode = function(obj) {
		return 'jsmmContext.tree.nodes[' + obj.id + ']';
	};

	var getScope = function() {
		return '(jsmmScope || jsmmContext.scope)';
	};

	var hooksBefore = function(node) {
		if (node.hooksBefore.length > 0) {
			return getNode(node) + '.runHooksBefore(jsmmContext, ' + getScope() + ');';
		} else {
			return '';
		}
	};

	var hooksAfter = function(node) {
		if (node.hooksAfter.length > 0) {
			return getNode(node) + '.runHooksAfter(jsmmContext, ' + getScope() + ');';
		} else {
			return '';
		}
	};

	var stringify = function(value) { // TODO: remove double functionality
		if (typeof value === 'function') return '[function]';
		else if (typeof value === 'object' && value.type === 'function') return '[function]';
		else if (Object.prototype.toString.call(value) === '[object Array]') return '[array]';
		else if (typeof value === 'object') return '[object]';
		else if (value === undefined) return 'undefined';
		else return JSON.stringify(value);
	};

	jsmm.CommandTracker = function() { return this.init.apply(this, arguments); };
	jsmm.CommandTracker.prototype = {
		init: function() {
			this.idsByLine = {};
			this.nodesById = {};
		},

		addCommand: function(node, id) {
			this.idsByLine[node.lineLoc.line] = this.idsByLine[node.lineLoc.line] || [];
			this.idsByLine[node.lineLoc.line].push(id);

			this.nodesById[id] = this.nodesById[id] || [];
			if (this.nodesById[id].indexOf(node) < 0) this.nodesById[id].push(node);
		},

		getHighlightIdsByLine: function(line) {
			return this.idsByLine[line] || [];
		},

		getHighlightNodesById: function(id) {
			return this.nodesById[id] || [];
		}
	};

	jsmm.ScopeTracker = function() { return this.init.apply(this, arguments); };
	jsmm.ScopeTracker.prototype = {
		init: function() {
			this.scopes = [];
			this.lines = {};
			this.calls = [];
		},

		logScope: function(stepNum, node, data) {
			if (data.type === 'assignment') {
				var obj = data.scope.find(data.name);
				if (obj !== undefined) {
					if (data.scope.level === 0 || data.scope.vars[data.name] === undefined) {
						this.addAssignment(stepNum, node, 0, data.name, obj.value, true);
					} else {
						this.addAssignment(stepNum, node, this.scopes.length-1, data.name, obj.value, true);
					}
				}
			} else if (data.type === 'return') {
				this.calls.push({type: 'return', stepNum: stepNum, node: node});
			} else { // data.type === 'enter'
				this.scopes.push({});
				this.calls.push({type: 'enter', stepNum: stepNum, node: node, name: data.name, position: this.scopes.length-1});

				for (var name in data.scope.vars) {
					this.addAssignment(stepNum, node, this.scopes.length-1, name, data.scope.vars[name].value, data.name !== 'global');
				}
			}
		},

		getState: function(stepNum) {
			var stack = [];

			for (var i=0; i<this.calls.length; i++) {
				var call = this.calls[i];
				if (call.stepNum > stepNum) break;

				if (call.type === 'assignment') {
					var level = stack[call.position === 0 ? 0 : stack.length-1];
					var scope = level.scope;
					if (scope[call.name] === undefined) {
						scope[call.name] = {id: call.position + '-' + call.name, name: call.name, value: call.value};
						level.names.push(call.name);
					}
					scope[call.name].value = call.value;
				} else if (call.type === 'return') {
					stack.pop();
				} else { // call.type === 'enter'
					stack.push({id: '' + call.position, name: call.name, names: [], scope: {}});
				}
			}
			return stack;
		},

		getHighlightNodesById: function(id) {
			var split = id.split('-');
			if (split.length < 2) return [];
			var scope = this.scopes[split[0]];
			if (scope === undefined) return [];
			return scope[split[1]] || [];
		},

		getHighlightIdsByLine: function(line) {
			return this.lines[line] || [];
		},

		/// INTERNAL FUNCTIONS ///
		addAssignment: function(stepNum, node, position, name, value, highlight) {
			if (highlight) {
				this.scopes[position][name] = this.scopes[position][name] || [];
				if (this.scopes[position][name].indexOf(node) < 0) this.scopes[position][name].push(node);

				this.lines[node.lineLoc.line] = this.lines[node.lineLoc.line] || [];
				this.lines[node.lineLoc.line].push(position + '-' + name);
			}

			this.calls.push({type: 'assignment', stepNum: stepNum, node: node, position: position, name: name, value: stringify(value)});
		}
	};

	jsmm.RunContext = function() { return this.init.apply(this, arguments); };
	jsmm.RunContext.prototype = {
		init: function(tree, scope, outputs) {
			this.tree = tree;
			this.scope = new jsmm.func.Scope(scope);
			this.outputs = outputs;
			this.executionCounter = 0;
			this.steps = [];
			this.callStack = [];
			this.callLinesByLine = {};
			this.commandTracker = new jsmm.CommandTracker();
			this.scopeTracker = new jsmm.ScopeTracker();
			this.outputStates = {};
			this.outputCalls = {};
			this.calledFunctions = [];
			this.callNode = null;
			this.error = null;
		},
		callOutputs: function(funcName) {
			for (var i=0; i<this.outputs.length; i++) {
				if (this.outputs[i][funcName] !== undefined) {
					this.outputs[i][funcName].apply(this.outputs[i], [].slice.call(arguments, 1));
				}
			}
		},
		runProgram: function() {
			this.callOutputs('outputClear', this);
			this.runFunction(this.tree.programNode.getRunFunction(), null);
		},
		runFunction: function(func, args) {
			this.error = null;
			this.callOutputs('outputStartRun', this);
			try {
				func(this, args);
			} catch (error) {
				this.callOutputs('outputError');
				if (error instanceof jsmm.msg.Error) {
					this.error = error;
				} else {
					throw error;
					//this.error = new jsmm.msg.Error({}, 'An unknown error has occurred', '', error);
				}
			} finally {
				this.callOutputs('outputEndRun', this);
			}
		},
		hasError: function() {
			return this.error !== null;
		},
		getError: function() {
			return this.error;
		},
		addOutputState: function(output, state) {
			this.outputStates[output] = state;
			this.outputCalls[output] = [];
			return this.outputCalls[output];
		},
		getCalls: function(output) {
			return this.outputCalls[output];
		},
		externalCall: function(node, funcValue, args) {
			this.callNode = node;
			for (var i=0; i<this.callStack.length; i++) {
				var line = this.callStack[i].lineLoc.line;
				if (this.callLinesByLine[line] === undefined) {
					this.callLinesByLine[line] = [];
				}
				if (this.callLinesByLine[line].indexOf(line) < 0) {
					this.callLinesByLine[line].push(node.lineLoc.line);
				}
			}
			try {
				return funcValue.func.call(null, this, funcValue.name, args);
			} catch (error) {
				// augmented functions should do their own error handling, so wrap the resulting strings in jsmm messages
				if (typeof error === 'string') {
					throw new jsmm.msg.Error(this, error);
				} else {
					throw error;
				}
			}
		},
		enterCall: function(node) {
			// copy callstack
			this.callStack = this.callStack.slice(0);
			this.callStack.push(node);

			if (this.callStack.length > jsmm.func.maxCallStackDepth) { // TODO
				throw new jsmm.msg.Error(node, 'Too many nested function calls have been made already, perhaps there is infinite recursion somewhere');
			}
		},
		leaveCall: function() {
			// copy callstack
			this.callStack = this.callStack.slice(0);
			this.callStack.pop();
		},
		inFunction: function() {
			return this.callStack.length > 0;
		},
		increaseExecutionCounter: function(node, amount) {
			this.executionCounter += amount;
			if (this.executionCounter > jsmm.func.maxExecutionCounter) { // TODO
				throw new jsmm.msg.Error(node, 'Program takes too long to run');
			}
		},
		newStep: function(array) {
			this.steps.push(array || []);
		},
		addToStep: function(msg) {
			this.steps[this.steps.length-1].push(msg);
		},
		getStepNum: function() {
			return this.steps.length;
		},
		addCommand: function(node, command) {
			this.commandTracker.addCommand(node, command);
		},
		callScope: function(node, data) {
			this.scopeTracker.logScope(this.getStepNum(), node, data);
		},
		getCallLinesByRange: function(line1, line2) {
			var lines = [];
			for (var line=line1; line<=line2; line++) {
				if (this.callLinesByLine[line] !== undefined) {
					for (var i=0; i<this.callLinesByLine[line].length; i++) {
						if (lines.indexOf(this.callLinesByLine[line][i]) < 0) {
							lines.push(this.callLinesByLine[line][i]);
						}
					}
				}
			}
			return lines;
		},
		getCallNode: function() {
			return this.callNode;
		},
		getCommandTracker: function() {
			return this.commandTracker;
		},
		getScopeTracker: function() {
			return this.scopeTracker;
		},
		addCalledFunction: function(name) {
			this.calledFunctions.push(name);
		},
		getCalledFunctions: function() {
			return this.calledFunctions;
		}
		/// INTERNAL FUNCTIONS ///
		
	};
	
	/* statementList */
	jsmm.nodes.Program.prototype.getRunCode = function() {
		var output = 'new function() {';
		output += 'return function(jsmmContext) {';
		output += 'var jsmmScope;\n';
		output += getNode(this) + '.runFunc(jsmmContext, ' + getScope() + ');\n';
		output += this.statementList.getRunCode() + '}; }';
		return output;
	};
	
	jsmm.nodes.Program.prototype.getRunFunction = function() {
		/*jshint evil:true*/
		return eval(this.getRunCode());
	};

	jsmm.nodes.Program.prototype.getFunctionCode = function() {
		var output = 'new function() {';
		output += 'return function(jsmmContext) {';
		output += 'var jsmmScope;\n';
		output += getNode(this) + '.runFunc(jsmmContext, ' + getScope() + ');\n';
		output += this.statementList.getFunctionCode() + '}; }';
		return output;
	};

	jsmm.nodes.Program.prototype.getFunctionFunction = function() {
		/*jshint evil:true*/
		return eval(this.getFunctionCode());
	};

	jsmm.nodes.Program.prototype.getCompareCode = function(functionNames) {
		return this.statementList.getCompareCode(functionNames);
	};
	
	/* statements */
	jsmm.nodes.StatementList.prototype.getRunCode = function() {
		var output = 'jsmmContext.increaseExecutionCounter(' + getNode(this) + ', ' + (this.statements.length+1) + ');\n';
		for (var i=0; i<this.statements.length; i++) {
			output += this.statements[i].getRunCode() + '\n\n';
			// if (jsmm.verbose) {
				// output += 'console.log("after line ' + this.statements[i].endPos.line + ':");\n';
				// output += 'console.log(jsmmContext);\n';
				// output += 'console.log(" ");\n';
			// }
		}
		return output;
	};

	jsmm.nodes.StatementList.prototype.getFunctionCode = function() {
		var output = '';
		for (var i=0; i<this.statements.length; i++) {
			if (this.statements[i].type === 'FunctionDeclaration') {
				output += this.statements[i].getRunCode() + '\n\n';
			}
		}
		return output;
	};

	jsmm.nodes.StatementList.prototype.getCompareCode = function(functionNames) {
		var output = '';
		for (var i=0; i<this.statements.length; i++) {
			if (this.statements[i].type !== 'FunctionDeclaration' || functionNames.indexOf(this.statements[i].name) >= 0) {
				output += this.statements[i].getRunCode() + '\n\n';
			}
		}
		return output;
	};
	
	/* statement */
	jsmm.nodes.CommonSimpleStatement.prototype.getRunCode = function() {
		return this.statement.getRunCode() + ";";
	};
	
	/* identifier, symbol */
	jsmm.nodes.PostfixStatement.prototype.getRunCode = function() {
		return getNode(this) + '.runFunc(jsmmContext, ' + getScope() + ', ' + this.identifier.getRunCode() + ', "' + this.symbol + '")';
	};
	
	/* identifier, symbol, expression */
	jsmm.nodes.AssignmentStatement.prototype.getRunCode = function() {
		return getNode(this) + '.runFunc(jsmmContext, ' + getScope() + ', ' + this.identifier.getRunCode() + ', "' + this.symbol + '", ' + this.expression.getRunCode() + ')';
	};
	
	/* items */
	jsmm.nodes.VarStatement.prototype.getRunCode = function() {
		var output = this.items[0].getRunCode();
		for (var i=1; i<this.items.length; i++) {
			output += ', ' + this.items[i].getRunCode();
		}
		return output;
	};
	
	/* name, assignment */
	jsmm.nodes.VarItem.prototype.getRunCode = function() {
		var output = getNode(this) + '.runFunc(jsmmContext, ' + getScope() + ', "' + this.name + '")';
		if (this.assignment !== null) {
			// ; is invalid in for loops
			// this should be possible in JS for normal statements as well
			output += ', ' + this.assignment.getRunCode();
		}
		return output;
	};
	
	/* expression */
	jsmm.nodes.ReturnStatement.prototype.getRunCode = function() {
		var output = '';
		var expressonCode = this.expression === null ? 'undefined' : this.expression.getRunCode();
		output += 'return ' + getNode(this) + '.runFunc(jsmmContext, ' + expressonCode + ');';
		return output;
	};
	
	/* expression1, symbol, expression2 */
	jsmm.nodes.BinaryExpression.prototype.getRunCode = function() {
		return getNode(this) + '.runFunc(jsmmContext, ' + this.expression1.getRunCode() + ', "' + this.symbol + '", ' + this.expression2.getRunCode() + ')';
	};
	
	/* symbol, expression */
	jsmm.nodes.UnaryExpression.prototype.getRunCode = function() {
		return getNode(this) + '.runFunc(jsmmContext, "' + this.symbol + '", ' + this.expression.getRunCode() + ')';
	};

	/* expression */
	jsmm.nodes.ParenExpression.prototype.getRunCode = function() {
		return '(' + this.expression.getRunCode() + ')';
	};
	
	/* number */
	jsmm.nodes.NumberLiteral.prototype.getRunCode = function() {
		return this.number;
	};
	
	/* str */
	jsmm.nodes.StringLiteral.prototype.getRunCode = function() {
		return JSON.stringify(this.str);
	};
	
	/* bool */
	jsmm.nodes.BooleanLiteral.prototype.getRunCode = function() {
		return this.bool ? 'true' : 'false';
	};
	
	/* name */
	jsmm.nodes.NameIdentifier.prototype.getRunCode = function() {
		return getNode(this) + '.runFunc(jsmmContext, ' + getScope() + ', "' + this.name + '")';
	};
	
	/* identifier, prop */
	jsmm.nodes.ObjectIdentifier.prototype.getRunCode = function() {
		return getNode(this) + '.runFunc(jsmmContext, ' + this.identifier.getRunCode() + ', "' + this.prop + '")';
	};
	
	/* identifier, expression */
	jsmm.nodes.ArrayIdentifier.prototype.getRunCode = function() {
		return getNode(this) + '.runFunc(jsmmContext, ' + this.identifier.getRunCode() + ', ' + this.expression.getRunCode() + ')';
	};
	
	/* identifier, expressionArgs */
	jsmm.nodes.FunctionCall.prototype.getRunCode = function() {
		var output = getNode(this) + '.runFunc(jsmmContext, ' + getScope() + ', ' + this.identifier.getRunCode() + ', [';
		if (this.expressionArgs.length > 0) output += this.expressionArgs[0].getRunCode();
		for (var i=1; i<this.expressionArgs.length; i++) {
			output += ", " + this.expressionArgs[i].getRunCode();
		}
		return output + '])';
	};
	
	/* expression, statementList, elseBlock */
	jsmm.nodes.IfBlock.prototype.getRunCode = function() {
		var output = 'if (' + getNode(this) + '.runFunc(jsmmContext, ' + this.expression.getRunCode() + ')) {\n';
		output += this.statementList.getRunCode() + '}';
		if (this.elseBlock !== null) {
			output += ' else {\n';
			output += this.elseBlock.getRunCode() + '\n';
			output += '}';
		}
		return output;
	};
	
	/* ifBlock */
	jsmm.nodes.ElseIfBlock.prototype.getRunCode = function() {
		return getNode(this) + '.runFunc(jsmmContext);\n' + this.ifBlock.getRunCode();
	};
	
	/* statementList */
	jsmm.nodes.ElseBlock.prototype.getRunCode = function() {
		return getNode(this) + '.runFunc(jsmmContext);\n' + this.statementList.getRunCode();
	};
	
	/* expression, statementList */
	jsmm.nodes.WhileBlock.prototype.getRunCode = function() {
		var output = 'while (' + getNode(this) + '.runFunc(jsmmContext, '  + this.expression.getRunCode() + '))';
		output += '{\n' + this.statementList.getRunCode() + '}';
		return output;
	};
	
	/* statement1, expression, statement2, statementList */
	jsmm.nodes.ForBlock.prototype.getRunCode = function() {
		var output = 'for (' + this.statement1.getRunCode() + '; ';
		output += getNode(this) + '.runFunc(jsmmContext, '  + this.expression.getRunCode() + '); ';
		output += this.statement2.getRunCode() + ') {\n' + this.statementList.getRunCode() + '}';
		return output;
	};
	
	/* name, nameArgs, statementList */
	jsmm.nodes.FunctionDeclaration.prototype.getRunCode = function() {
		var output = getNode(this) + '.runFuncDecl(jsmmContext, ' + getScope() + ', "' + this.name + '", ';
		output += 'function (jsmmContext, args) {\n';
		output += 'var jsmmScope = ' + getNode(this) + '.runFuncEnter(jsmmContext, args);\n';
		/*
		if (jsmm.verbose) {
			output += 'console.log("after entering ' + this.name + ':");\n';
			output += 'console.log(jsmmscopeInner);\n';
			output += 'console.log(" ");\n';
		}
		*/
		output += this.statementList.getRunCode();
		output += 'return ' + getNode(this) + '.runFuncLeave(jsmmContext);\n';
		output += '});';
		return output;
	};
};
