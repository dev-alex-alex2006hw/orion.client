/*******************************************************************************
 * @license
 * Copyright (c) 2013, 2016 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License v1.0
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html).
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/
/*eslint-env amd*/
define([
	'orion/Deferred',
	'orion/objects',
	'javascript/lru',
	"javascript/util",
	"acorn/dist/acorn",
	"acorn/dist/acorn_loose",
	"javascript/orionAcorn",
], function(Deferred, Objects, LRU, Util, acorn, acorn_loose, OrionAcorn) {
	var registry;

	/**
	 * Provides a shared AST.
	 * @name javascript.ASTManager
	 * @class Provides a shared AST.
	 * @param {Object} esprima The esprima parser that this ASTManager will use.
	 * @param {Object} serviceRegistry The platform service registry
	 */
	function ASTManager(serviceRegistry) {
		this.cache = new LRU(10);
		this.orionAcorn = new OrionAcorn();
		registry = serviceRegistry;
	}
	
	/**
	 * @description Delegate to log timings to the metrics service
	 * @param {Number} end The end time
	 * @since 12.0
	 */
	function logTiming(end) {
		if(registry) {
			var metrics = registry.getService("orion.core.metrics.client"); //$NON-NLS-1$
			if(metrics) {
				metrics.logTiming('language tools', 'parse', end, 'application/javascript'); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			}
		}
	}
	
	Objects.mixin(ASTManager.prototype, /** @lends javascript.ASTManager.prototype */ {
		/**
		 * @param {orion.editor.EditorContext} editorContext
		 * @returns {orion.Promise} A promise resolving to the AST.
		 */
		getAST: function(editorContext) {
			var _self = this;
			return editorContext.getFileMetadata().then(function(metadata) {
				var loc = _self._getKey(metadata);
				var ast = _self.cache.get(loc);
				if (ast) {
					return new Deferred().resolve(ast);
				}
				return editorContext.getText().then(function(text) {
					ast = _self.parse(text, metadata ? metadata.location : 'unknown'); //$NON-NLS-1$
					_self.cache.put(loc, ast);
					return ast;
				});
			});
		},
		/**
		 * Returns the key to use when caching
		 * @param {Object} metadata The file infos
		 * @since 8.0
		 */
		_getKey: function _getKey(metadata) {
			if(!metadata || !metadata.location) {
				return 'unknown'; //$NON-NLS-1$
			}
			return metadata.location;
		},
		/**
		 * @private
		 * @param {String} text The code to parse.
		 * @param {String} file The file name that we parsed
		 * @returns {Object} The AST.
		 */
		parse: function(text, file) {
			this.orionAcorn.initialize();
			var start = Date.now();
			var ast;
			var options = Object.create(null);
			this.orionAcorn.preParse(text, options, acorn, acorn_loose, file);
			try {
				ast = acorn.parse(text, options);
			} catch(e) {
				ast = acorn_loose.parse_dammit(text, options);
			}
			this.orionAcorn.postParse(ast, text);
			logTiming(Date.now() - start);
			return ast;
		},
		
		/**
		 * Callback from the orion.edit.model service
		 * @param {Object} event An <tt>orion.edit.model</tt> event.
		 * @see https://wiki.eclipse.org/Orion/Documentation/Developer_Guide/Plugging_into_the_editor#orion.edit.model
		 */
		onModelChanging: function(event) {
			if(this.inputChanged) {
				//TODO haxxor, eat the first model changing event which immediately follows
				//input changed
				this.inputChanged = null;
			} else {
				this.cache.remove(this._getKey(event.file));
			}
		},
		/**
		 * Callback from the orion.edit.model service
		 * @param {Object} event An <tt>orion.edit.model</tt> event.
		 * @see https://wiki.eclipse.org/Orion/Documentation/Developer_Guide/Plugging_into_the_editor#orion.edit.model
		 */
		onInputChanged: function(event) {
			this.inputChanged = event;
		},
		/**
		 * Callback from the FileClient
		 * @param {Object} event a <tt>fileChanged</tt> event
		 */
		onFileChanged: function(event) {
			if(event && event.type === 'FileContentChanged' && Array.isArray(event.files)) {
				//event = {type, files: [{name, location, metadata: {contentType}}]}
				event.files.forEach(function(file) {
					if(file.metadata && file.metadata.contentType === 'application/javascript') {
						this.cache.remove(this._getKey(file));
					}
				}.bind(this));
			}
		}
	});
	return { ASTManager : ASTManager };
});
