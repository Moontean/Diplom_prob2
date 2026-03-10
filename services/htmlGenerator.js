/**
 * HTML/CSS Generator Service
 * 
 * Converts parsed PDF structure + semantic analysis into production HTML/CSS
 * with absolute positioning and data attributes for field binding.
 * 
 * Key principles:
 * - Geometry from PDF parser
 * - Semantics from AI analyzer  
 * - NO text placeholders ({{...}}) in HTML output!
 * - Data binding via JavaScript + data-field attributes
 */

/**
 * Supported CV field types for semantic mapping
 * Used for validation and documentation, NOT for text output
 */
const CV_FIELD_TYPES = [
    'fullName', 'firstName', 'lastName', 'jobTitle',
    'email', 'phone', 'address', 'city', 'zipCode', 'country',
    'linkedin', 'website', 'github', 'summary',
    'experienceHeader', 'companyName', 'position', 'dateRange', 'description',
    'educationHeader', 'institution', 'degree', 'fieldOfStudy', 'graduationDate',
    'skillsHeader', 'skill',
    'languagesHeader', 'language',
    'certificationsHeader', 'certification',
    'projectsHeader', 'projectName', 'projectDescription',
    'referencesHeader', 'reference',
    'unknown'
];

/**
 * Mapping field names -> textual placeholders.
 * Kept for backward compatibility with older flows, even though the
 * current generator старается не использовать {{...}} в новом HTML.
 */
const PLACEHOLDER_VALUES = CV_FIELD_TYPES
    .filter((name) => name !== 'unknown')
    .reduce((acc, field) => {
        acc[field] = `{{${field}}}`;
        return acc;
    }, {});

// Color palette & CSS variable generator
const { buildColorVariables, getColorVar } = require('./cssGenerator');

/**
 * Generate complete HTML document from parsed structure and semantics
 * @param {Object} parsedStructure - From pdfStructureParser
 * @param {Object} semanticAnalysis - From semanticAnalyzer
 * @param {Object} options - Generation options
 * @returns {string} Complete HTML document
 */
function generateHtmlDocument(parsedStructure, semanticAnalysis, options = {}) {
    const {
        usePlaceholders = true,
        includeDataAttributes = true,
        userData = null,
        cssInline = false
    } = options;

    const pages = parsedStructure.pages || [];
    const fieldMappings = semanticAnalysis?.fieldMappings || {};

    // Build color palette and CSS variables once per document
    const { colorToVar, cssVariables } = buildColorVariables(parsedStructure);

    // Generate global CSS, injecting :root { --color-X: ... } block
    let css = generateCss(parsedStructure, { ...options, cssVariables });
    let htmlPages = pages.map((page, pageIndex) =>
        generatePageHtml(page, pageIndex, fieldMappings, {
            usePlaceholders,
            includeDataAttributes,
            userData,
            colorToVar
        })
    ).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CV Template</title>
    ${cssInline ? `<style>${css}</style>` : '<link rel="stylesheet" href="template-styles.css">'}
</head>
<body>
    <div class="cv-document">
        ${htmlPages}
    </div>
    <script>
        /**
         * CV Field Binding System
         * 
         * KEY PRINCIPLE: Direct DOM manipulation, no text placeholders!
         * - State lives in JavaScript object
         * - Updates happen via querySelectorAll + textContent
         * - No magic, no frameworks, pure DOM
         */
        window.CVFields = {
            // Internal state
            _state: {},
            
            /**
             * Update a single field in all matching elements
             * @param {string} fieldName - Field type (e.g., 'fullName', 'email')
             * @param {string} value - New value to display
             */
            update: function(fieldName, value) {
                this._state[fieldName] = value;
                const elements = document.querySelectorAll('[data-field="' + fieldName + '"]');
                elements.forEach(function(el) {
                    el.textContent = value || '';
                    // Remove needs-data flag if value provided
                    if (value) {
                        el.removeAttribute('data-needs-data');
                    }
                });
            },
            
            /**
             * Update multiple fields at once
             * @param {Object} data - Object with field:value pairs
             */
            updateAll: function(data) {
                var self = this;
                Object.keys(data).forEach(function(field) {
                    self.update(field, data[field]);
                });
            },
            
            /**
             * Get current state of all fields
             * @returns {Object} Current field values
             */
            getState: function() {
                return Object.assign({}, this._state);
            },
            
            /**
             * Get data from DOM (useful after user edits)
             * @returns {Object} Field values from DOM
             */
            getFromDOM: function() {
                var data = {};
                document.querySelectorAll('[data-field]').forEach(function(el) {
                    var field = el.dataset.field;
                    var text = el.textContent.trim();
                    if (text && field !== 'unknown') {
                        if (!data[field]) {
                            data[field] = text;
                        } else if (Array.isArray(data[field])) {
                            data[field].push(text);
                        } else {
                            data[field] = [data[field], text];
                        }
                    }
                });
                return data;
            },
            
            /**
             * Reset field to original PDF value
             * @param {string} fieldName - Field to reset
             */
            resetToOriginal: function(fieldName) {
                var elements = document.querySelectorAll('[data-field="' + fieldName + '"]');
                elements.forEach(function(el) {
                    var original = el.dataset.original || '';
                    el.textContent = original;
                });
                delete this._state[fieldName];
            },
            
            /**
             * Get list of all field types in document
             * @returns {Array} Unique field types
             */
            getFieldTypes: function() {
                var types = new Set();
                document.querySelectorAll('[data-field]').forEach(function(el) {
                    var field = el.dataset.field;
                    if (field && field !== 'unknown') {
                        types.add(field);
                    }
                });
                return Array.from(types);
            },
            
            /**
             * Make all editable fields contenteditable
             */
            enableEditing: function() {
                document.querySelectorAll('[data-editable="true"]').forEach(function(el) {
                    el.contentEditable = 'true';
                });
            },
            
            /**
             * Disable editing mode
             */
            disableEditing: function() {
                document.querySelectorAll('[contenteditable="true"]').forEach(function(el) {
                    el.contentEditable = 'false';
                });
            },
            
            // ============ SECTION COLOR API ============
            
            /**
             * Get all color sections in the document
             * @returns {Array} Array of section objects with id, name, backgroundColor
             */
            getSections: function() {
                var sections = [];
                document.querySelectorAll('.cv-section').forEach(function(el) {
                    sections.push({
                        id: el.dataset.sectionId,
                        name: el.dataset.sectionName,
                        backgroundColor: el.style.backgroundColor
                    });
                });
                return sections;
            },
            
            /**
             * Update section background color
             * @param {string} sectionId - Section ID
             * @param {string} color - HEX or CSS color value
             */
            updateSectionColor: function(sectionId, color) {
                var section = document.querySelector('[data-section-id="' + sectionId + '"]');
                if (section) {
                    section.style.backgroundColor = color;
                }
            },
            
            /**
             * Update text color for all elements in a section
             * @param {string} sectionId - Section ID  
             * @param {string} color - HEX or CSS color value
             */
            updateSectionTextColor: function(sectionId, color) {
                document.querySelectorAll('[data-section="' + sectionId + '"]').forEach(function(el) {
                    el.style.color = color;
                });
            },
            
            /**
             * Get color palette used in document
             * @returns {Object} Object with background and text colors arrays
             */
            getColorPalette: function() {
                var bgColors = new Set();
                var textColors = new Set();
                
                document.querySelectorAll('.cv-section').forEach(function(el) {
                    if (el.style.backgroundColor) bgColors.add(el.style.backgroundColor);
                });
                
                document.querySelectorAll('.cv-block, .cv-line').forEach(function(el) {
                    if (el.style.color) textColors.add(el.style.color);
                });
                
                return {
                    backgrounds: Array.from(bgColors),
                    text: Array.from(textColors)
                };
            },

            // ============ CANVA-LIKE EDITOR API ============
            
            _selectedElement: null,
            _isEditing: false,
            _history: [],
            _historyIndex: -1,
            
            /**
             * Initialize the visual editor
             */
            initEditor: function() {
                var self = this;
                
                // Create toolbar
                this._createToolbar();
                
                // Add click handlers to all editable elements
                document.querySelectorAll('.cv-block, .cv-line, .cv-section, .cv-background').forEach(function(el) {
                    // Single click - select
                    el.addEventListener('click', function(e) {
                        e.stopPropagation();
                        self._selectElement(el);
                    });
                    
                    // Double click - start editing (text only)
                    el.addEventListener('dblclick', function(e) {
                        e.stopPropagation();
                        if (el.classList.contains('cv-block') || el.classList.contains('cv-line')) {
                            self._startEditing(el);
                        }
                    });
                    
                    // Right click - context menu
                    el.addEventListener('contextmenu', function(e) {
                        e.preventDefault();
                        self._showContextMenu(e, el);
                    });
                });
                
                // Click outside to deselect
                document.addEventListener('click', function(e) {
                    if (!e.target.closest('.cv-block, .cv-line, .cv-section, .cv-background, .cv-editor-toolbar, .cv-context-menu')) {
                        self._deselectAll();
                    }
                });
                
                // Keyboard shortcuts
                document.addEventListener('keydown', function(e) {
                    // Escape - deselect/stop editing
                    if (e.key === 'Escape') {
                        if (self._isEditing) {
                            self._stopEditing();
                        } else {
                            self._deselectAll();
                        }
                    }
                    // Ctrl+Z - undo
                    if (e.ctrlKey && e.key === 'z') {
                        e.preventDefault();
                        self.undo();
                    }
                    // Ctrl+Y - redo
                    if (e.ctrlKey && e.key === 'y') {
                        e.preventDefault();
                        self.redo();
                    }
                    // Delete - delete selected element
                    if (e.key === 'Delete' && self._selectedElement && !self._isEditing) {
                        self._deleteSelected();
                    }
                });
                
                console.log('🎨 Canva-like editor initialized');
            },
            
            /**
             * Create the floating toolbar
             */
            _createToolbar: function() {
                var self = this;
                var existing = document.querySelector('.cv-editor-toolbar');
                if (existing) existing.remove();
                
                var toolbar = document.createElement('div');
                toolbar.className = 'cv-editor-toolbar';
                toolbar.innerHTML = 
                    '<button id="btn-bold" title="Bold (Ctrl+B)"><b>B</b></button>' +
                    '<button id="btn-italic" title="Italic (Ctrl+I)"><i>I</i></button>' +
                    '<button id="btn-underline" title="Underline (Ctrl+U)"><u>U</u></button>' +
                    '<div class="separator"></div>' +
                    '<label title="Text Color">🖌️<input type="color" id="color-text" value="#000000"></label>' +
                    '<label title="Background Color">🎨<input type="color" id="color-bg" value="#ffffff"></label>' +
                    '<div class="separator"></div>' +
                    '<select id="font-size" title="Font Size">' +
                        '<option value="">Size</option>' +
                        '<option value="10px">10</option>' +
                        '<option value="12px">12</option>' +
                        '<option value="14px">14</option>' +
                        '<option value="16px">16</option>' +
                        '<option value="18px">18</option>' +
                        '<option value="20px">20</option>' +
                        '<option value="24px">24</option>' +
                        '<option value="28px">28</option>' +
                        '<option value="32px">32</option>' +
                        '<option value="36px">36</option>' +
                    '</select>' +
                    '<div class="separator"></div>' +
                    '<button id="btn-undo" title="Undo (Ctrl+Z)">↩️</button>' +
                    '<button id="btn-redo" title="Redo (Ctrl+Y)">↪️</button>';
                
                document.body.appendChild(toolbar);
                
                // Bind toolbar events
                document.getElementById('btn-bold').onclick = function() { self._toggleStyle('fontWeight', 'bold', 'normal'); };
                document.getElementById('btn-italic').onclick = function() { self._toggleStyle('fontStyle', 'italic', 'normal'); };
                document.getElementById('btn-underline').onclick = function() { self._toggleStyle('textDecoration', 'underline', 'none'); };
                
                document.getElementById('color-text').onchange = function(e) {
                    if (self._selectedElement) {
                        self._saveToHistory();
                        self._selectedElement.style.color = e.target.value;
                    }
                };
                
                document.getElementById('color-bg').onchange = function(e) {
                    if (self._selectedElement) {
                        self._saveToHistory();
                        self._selectedElement.style.backgroundColor = e.target.value;
                    }
                };
                
                document.getElementById('font-size').onchange = function(e) {
                    if (self._selectedElement && e.target.value) {
                        self._saveToHistory();
                        self._selectedElement.style.fontSize = e.target.value;
                    }
                };
                
                document.getElementById('btn-undo').onclick = function() { self.undo(); };
                document.getElementById('btn-redo').onclick = function() { self.redo(); };
            },
            
            /**
             * Select an element
             */
            _selectElement: function(el) {
                this._deselectAll();
                el.classList.add('selected');
                this._selectedElement = el;
                
                // Update toolbar color inputs
                var colorText = document.getElementById('color-text');
                var colorBg = document.getElementById('color-bg');
                if (colorText) colorText.value = this._getColorHex(el.style.color) || '#000000';
                if (colorBg) colorBg.value = this._getColorHex(el.style.backgroundColor) || '#ffffff';
            },
            
            /**
             * Deselect all elements
             */
            _deselectAll: function() {
                this._stopEditing();
                document.querySelectorAll('.selected').forEach(function(el) {
                    el.classList.remove('selected');
                });
                this._selectedElement = null;
                this._hideContextMenu();
            },
            
            /**
             * Start editing text element
             */
            _startEditing: function(el) {
                this._saveToHistory();
                this._isEditing = true;
                el.classList.add('editing');
                el.contentEditable = 'true';
                el.focus();
                
                // Select all text
                var range = document.createRange();
                range.selectNodeContents(el);
                var sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            },
            
            /**
             * Stop editing
             */
            _stopEditing: function() {
                if (!this._isEditing) return;
                this._isEditing = false;
                document.querySelectorAll('.editing').forEach(function(el) {
                    el.classList.remove('editing');
                    el.contentEditable = 'false';
                });
            },
            
            /**
             * Toggle a style property
             */
            _toggleStyle: function(prop, onValue, offValue) {
                if (!this._selectedElement) return;
                this._saveToHistory();
                var current = this._selectedElement.style[prop];
                this._selectedElement.style[prop] = (current === onValue) ? offValue : onValue;
            },
            
            /**
             * Show context menu
             */
            _showContextMenu: function(e, el) {
                var self = this;
                this._hideContextMenu();
                this._selectElement(el);
                
                var menu = document.createElement('div');
                menu.className = 'cv-context-menu';
                
                var isTextElement = el.classList.contains('cv-block') || el.classList.contains('cv-line');
                
                var items = [
                    { label: '✏️ Edit', action: function() { if(isTextElement) self._startEditing(el); } },
                    { label: '📋 Copy', action: function() { self._copyElement(el); } },
                    { label: '📝 Duplicate', action: function() { self._duplicateElement(el); } },
                    { divider: true },
                    { label: '🔼 Bring to Front', action: function() { el.style.zIndex = 100; } },
                    { label: '🔽 Send to Back', action: function() { el.style.zIndex = 0; } },
                    { divider: true },
                    { label: '🗑️ Delete', className: 'danger', action: function() { self._deleteSelected(); } }
                ];
                
                items.forEach(function(item) {
                    if (item.divider) {
                        var div = document.createElement('div');
                        div.className = 'cv-context-menu-divider';
                        menu.appendChild(div);
                    } else {
                        var menuItem = document.createElement('div');
                        menuItem.className = 'cv-context-menu-item' + (item.className ? ' ' + item.className : '');
                        menuItem.textContent = item.label;
                        menuItem.onclick = function() {
                            item.action();
                            self._hideContextMenu();
                        };
                        menu.appendChild(menuItem);
                    }
                });
                
                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';
                document.body.appendChild(menu);
            },
            
            /**
             * Hide context menu
             */
            _hideContextMenu: function() {
                var menu = document.querySelector('.cv-context-menu');
                if (menu) menu.remove();
            },
            
            /**
             * Delete selected element
             */
            _deleteSelected: function() {
                if (this._selectedElement) {
                    this._saveToHistory();
                    this._selectedElement.remove();
                    this._selectedElement = null;
                }
            },
            
            /**
             * Duplicate element
             */
            _duplicateElement: function(el) {
                this._saveToHistory();
                var clone = el.cloneNode(true);
                clone.style.left = (parseFloat(el.style.left) + 10) + 'px';
                clone.style.top = (parseFloat(el.style.top) + 10) + 'px';
                clone.classList.remove('selected', 'editing');
                el.parentNode.appendChild(clone);
                this._selectElement(clone);
            },
            
            /**
             * Copy element text to clipboard
             */
            _copyElement: function(el) {
                navigator.clipboard.writeText(el.textContent || '');
            },
            
            /**
             * Convert color to hex
             */
            _getColorHex: function(color) {
                if (!color) return null;
                if (color.startsWith('#')) return color;
                if (color.startsWith('rgb')) {
                    var match = color.match(/\\d+/g);
                    if (match && match.length >= 3) {
                        return '#' + match.slice(0, 3).map(function(x) {
                            var hex = parseInt(x).toString(16);
                            return hex.length === 1 ? '0' + hex : hex;
                        }).join('');
                    }
                }
                return null;
            },
            
            /**
             * Save state to history for undo
             */
            _saveToHistory: function() {
                var state = document.querySelector('.cv-document').innerHTML;
                this._history = this._history.slice(0, this._historyIndex + 1);
                this._history.push(state);
                this._historyIndex = this._history.length - 1;
                if (this._history.length > 50) {
                    this._history.shift();
                    this._historyIndex--;
                }
            },
            
            /**
             * Undo last action
             */
            undo: function() {
                if (this._historyIndex > 0) {
                    this._historyIndex--;
                    document.querySelector('.cv-document').innerHTML = this._history[this._historyIndex];
                    this._deselectAll();
                }
            },
            
            /**
             * Redo action
             */
            redo: function() {
                if (this._historyIndex < this._history.length - 1) {
                    this._historyIndex++;
                    document.querySelector('.cv-document').innerHTML = this._history[this._historyIndex];
                    this._deselectAll();
                }
            }
        };
        
        // Auto-initialize editor
        document.addEventListener('DOMContentLoaded', function() {
            CVFields.initEditor();
        });
        
        // Legacy alias for backward compatibility
        window.CVPlaceholders = window.CVFields;
        
        console.log('✅ CV Editor ready. Use CVFields.initEditor() to enable Canva-like editing.');
    </script>
</body>
</html>`;
}

/**
 * Generate CSS for the document
 */
function generateCss(parsedStructure, options = {}) {
    const { scale = 1, cssVariables = '' } = options;
    const page = parsedStructure.pages?.[0];
    const width = page?.width || 612;
    const height = page?.height || 792;

    // Optional :root block with CSS variables (colors from PDF)
    const varsBlock = cssVariables ? `${cssVariables}\n\n` : '';

    return `${varsBlock}/* CV Template Styles - Generated */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: Arial, Helvetica, sans-serif;
    background: #f0f0f0;
    min-height: 100vh;
    display: flex;
    justify-content: center;
    padding: 20px;
}

.cv-document {
    background: white;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.cv-page {
    position: relative;
    width: ${width * scale}px;
    height: ${height * scale}px;
    overflow: hidden;
    background: white;
    page-break-after: always;
}

.cv-page:last-child {
    page-break-after: avoid;
}

/* Background elements (extracted from PDF) */
.cv-background {
    position: absolute;
    z-index: 0;
    pointer-events: none;
}

/* AI-detected color sections */
.cv-section {
    position: absolute;
    z-index: 0;
    pointer-events: none;
    transition: background-color 0.3s ease;
}

/* Separator lines from PDF */
.cv-separator-line {
    position: absolute;
    z-index: 1;
    pointer-events: none;
}

.cv-block {
    position: absolute;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.25;
    z-index: 1;
}

.cv-line {
    position: absolute;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.25;
    z-index: 1;
}

/* Field-specific styling */
[data-field="fullName"] {
    font-weight: bold;
}

[data-field="jobTitle"] {
    font-style: italic;
}

[data-field$="Header"] {
    font-weight: bold;
    text-transform: uppercase;
}

/* Empty field indicator - shows hint when no user data.
 * Важно: не красим фон, чтобы не было жёлтых подсветок на реальном шаблоне. */
[data-needs-data="true"]:empty::before {
    content: attr(data-field);
    color: #999;
    font-style: italic;
    opacity: 0.7;
}

/* Поля без данных больше НЕ имеют жёлтого фона. */
[data-needs-data="true"] {
    background: transparent;
    border-radius: 0;
}

[data-needs-data="true"]:hover {
    background: transparent;
}

/* Editable mode */
.cv-block[contenteditable="true"]:focus,
.cv-line[contenteditable="true"]:focus,
.editable-field:focus {
    outline: 2px solid #2196F3;
    background: rgba(33, 150, 243, 0.05);
}

/* ========== CANVA-LIKE EDITOR STYLES ========== */

/* Hover effect - аккуратная синяя рамка на editable элементах (без жёлтого) */
.editable-field:hover,
.cv-block:hover,
.cv-line:hover,
.cv-section:hover,
.cv-background:hover {
    outline: 2px solid #2196F3;
    outline-offset: 2px;
    cursor: pointer;
    z-index: 10;
}

/* Active/selected element - blue outline */
.editable-field.selected,
.cv-block.selected,
.cv-line.selected,
.cv-section.selected,
.cv-background.selected {
    outline: 2px solid #2196F3;
    outline-offset: 2px;
    z-index: 11;
}

/* Editing mode - element being edited */
.editable-field.editing,
.cv-block.editing,
.cv-line.editing {
    outline: 3px solid #4CAF50;
    outline-offset: 2px;
    background: rgba(255, 255, 255, 0.95) !important;
    z-index: 12;
    cursor: text;
    white-space: pre-wrap !important;
    overflow: visible !important;
}

/* Resize handles for selected elements */
.resize-handle {
    position: absolute;
    width: 8px;
    height: 8px;
    background: #2196F3;
    border: 1px solid white;
    border-radius: 2px;
    z-index: 100;
}

.resize-handle.nw { top: -4px; left: -4px; cursor: nw-resize; }
.resize-handle.ne { top: -4px; right: -4px; cursor: ne-resize; }
.resize-handle.sw { bottom: -4px; left: -4px; cursor: sw-resize; }
.resize-handle.se { bottom: -4px; right: -4px; cursor: se-resize; }

/* Editor toolbar */
.cv-editor-toolbar {
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    padding: 8px 16px;
    display: flex;
    gap: 8px;
    align-items: center;
    z-index: 1000;
    font-family: Arial, sans-serif;
}

.cv-editor-toolbar button {
    background: #f5f5f5;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
}

.cv-editor-toolbar button:hover {
    background: #e0e0e0;
}

.cv-editor-toolbar button.active {
    background: #2196F3;
    color: white;
    border-color: #1976D2;
}

.cv-editor-toolbar .separator {
    width: 1px;
    height: 24px;
    background: #ddd;
    margin: 0 4px;
}

.cv-editor-toolbar input[type="color"] {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.cv-editor-toolbar select {
    padding: 6px 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
}

/* Context menu for right-click */
.cv-context-menu {
    position: fixed;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    padding: 8px 0;
    min-width: 180px;
    z-index: 2000;
    font-family: Arial, sans-serif;
}

.cv-context-menu-item {
    padding: 10px 16px;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.cv-context-menu-item:hover {
    background: #f5f5f5;
}

.cv-context-menu-item.danger {
    color: #f44336;
}

.cv-context-menu-divider {
    height: 1px;
    background: #eee;
    margin: 4px 0;
}

/* Text selection styling */
.cv-block::selection,
.cv-line::selection,
.editable-field::selection,
.text-block::selection {
    background: rgba(0, 123, 255, 0.3);
    color: #000000 !important;
}

.cv-block::-moz-selection,
.cv-line::-moz-selection,
.editable-field::-moz-selection,
.text-block::-moz-selection {
    background: rgba(0, 123, 255, 0.3);
    color: #000000 !important;
}

/* Print styles */
@media print {
    body {
        background: white;
        padding: 0;
    }
    
    .cv-document {
        box-shadow: none;
    }
    
    /* Hide empty field hints in print */
    [data-needs-data="true"] {
        background: transparent;
    }
    
    [data-needs-data="true"]:empty::before {
        display: none;
    }
}
`;
}

/**
 * Generate HTML for a single page
 */
function generatePageHtml(page, pageIndex, fieldMappings, options) {
    const { usePlaceholders, includeDataAttributes, userData, colorToVar } = options;
    const textLines = page.lines || []; // Text lines
    const blocks = page.blocks || [];
    const backgrounds = page.backgrounds || []; // EXACT rectangles from PDF
    const separatorLines = page.separatorLines || page.lines2 || []; // Separator lines (renamed to avoid conflict)
    const colorSections = page.colorSections || []; // AI-detected color sections (fallback)

    // Priority 1: Use EXACT backgrounds extracted from PDF (pixel-perfect)
    let backgroundsHtml = '';
    if (backgrounds.length > 0) {
        console.log(`📐 Page ${pageIndex + 1}: Using ${backgrounds.length} exact backgrounds from PDF`);
        backgroundsHtml = backgrounds.map((bg) => {
            const styleParts = [
                'position: absolute',
                `left: ${bg.bbox.x}px`,
                `top: ${bg.bbox.y}px`,
                `width: ${bg.bbox.width}px`,
                `height: ${bg.bbox.height}px`,
                'z-index: 0',
                'pointer-events: none'
            ];

            if (bg.color) {
                const varName = getColorVar(colorToVar, bg.color);
                if (varName) {
                    styleParts.push(`background-color: var(${varName})`);
                } else {
                    styleParts.push(`background-color: ${bg.color}`);
                }
            }

            return `        <div class="cv-background" data-bg-id="${bg.id}" style="${styleParts.join('; ')}"></div>`;
        }).join('\n');
    }

    // Priority 2: Fallback to AI-detected sections if no PDF backgrounds
    let sectionsHtml = '';
    if (backgroundsHtml === '' && colorSections.length > 0) {
        console.log(`🤖 Page ${pageIndex + 1}: Using ${colorSections.length} AI-detected sections (fallback)`);
        sectionsHtml = colorSections.map((section) => {
            if (!section.bbox) return '';

            const sectionStyles = [
                'position: absolute',
                `left: ${section.bbox.x}px`,
                `top: ${section.bbox.y}px`,
                `width: ${section.bbox.width}px`,
                `height: ${section.bbox.height}px`,
                'z-index: 0',
                'pointer-events: none'
            ];

            const bgColor = section.backgroundColor || '#FFFFFF';
            const varName = getColorVar(colorToVar, bgColor);
            if (varName) {
                sectionStyles.push(`background-color: var(${varName})`);
            } else {
                sectionStyles.push(`background-color: ${bgColor}`);
            }

            return `        <div class="cv-section" data-section-id="${section.id}" data-section-name="${section.name || 'unnamed'}" style="${sectionStyles}"></div>`;
        }).filter(html => html).join('\n');
    }

    // Render separator lines from PDF
    let linesHtml = '';
    const pdfLines = page.pdfLines || []; // From extractBackgrounds
    if (pdfLines.length > 0) {
        console.log(`📏 Page ${pageIndex + 1}: Rendering ${pdfLines.length} separator lines`);
        linesHtml = pdfLines.map((line) => {
            const lineStyle = [
                'position: absolute',
                `left: ${line.bbox.x}px`,
                `top: ${line.bbox.y}px`,
                `width: ${line.bbox.width}px`,
                `height: ${Math.max(line.bbox.height, line.width || 1)}px`,
                'z-index: 1',
                'pointer-events: none'
            ];

            if (line.color) {
                const varName = getColorVar(colorToVar, line.color);
                if (varName) {
                    lineStyle.push(`background-color: var(${varName})`);
                } else {
                    lineStyle.push(`background-color: ${line.color}`);
                }
            }

            return `        <div class="cv-separator-line" data-line-id="${line.id}" style="${lineStyle.join('; ')}"></div>`;
        }).join('\n');
    }

    const allBackgroundElements = (backgroundsHtml || sectionsHtml) + (linesHtml ? '\n' + linesHtml : '');

    // Prefer text lines if available, fallback to blocks
    const elements = textLines.length > 0 ? textLines : blocks;

    let elementsHtml = elements.map((element, idx) => {
        const blockId = element.id || `p${pageIndex}_b${idx}`;
        const fieldInfo = fieldMappings[blockId];
        const fieldType = fieldInfo?.fieldType || element.fieldType || element.semanticHint || 'unknown';
        const confidence = fieldInfo?.confidence || element.confidence || 0;

        return generateElementHtml(element, {
            blockId,
            fieldType,
            confidence,
            usePlaceholders,
            includeDataAttributes,
            userData,
            pageIndex,
            pageWidth: page.width || 612
        });
    }).join('\n');

    // Build page style - white background by default (sections provide colors)
    let pageStyle = `position: relative; width: ${page.width}px; height: ${page.height}px; margin: 20px auto; box-shadow: 0 2px 8px rgba(0,0,0,0.1); background: white; overflow: hidden;`;

    // Only use background image as last resort if no sections and no extracted backgrounds
    if (colorSections.length === 0 && backgrounds.length === 0 && page.backgroundImage) {
        pageStyle += ` background-image: url('${page.backgroundImage}'); background-size: ${page.width}px ${page.height}px; background-repeat: no-repeat;`;
    }

    return `
    <div class="cv-page" data-page="${pageIndex}" style="${pageStyle}">
        ${allBackgroundElements}
        ${elementsHtml}
    </div>`;
}

/**
 * Generate HTML for a single text element (block or line)
 * 
 * KEY PRINCIPLE: NO text placeholders like {{FULL_NAME}} in HTML!
 * - Display either user data (if provided) or original PDF text
 * - Use data-attributes for field binding
 * - JavaScript will update text via direct DOM manipulation
 */
function generateElementHtml(element, options) {
    const {
        blockId,
        fieldType,
        confidence,
        usePlaceholders,
        includeDataAttributes,
        userData,
        pageIndex,
        pageWidth,
        colorToVar
    } = options;

    const bbox = element.bbox;
    const originalText = element.text || '';
    const font = element.font || {};

    // Determine display text - NEVER use {{}} placeholders!
    // Priority: userData > originalText > empty
    let displayText = originalText;
    let hasUserData = false;

    if (fieldType !== 'unknown' && userData && userData[fieldType]) {
        displayText = userData[fieldType];
        hasUserData = true;
    }

    // Build style - use AI-determined textColor if available, otherwise font color
    // NOTE: backgroundColor is now handled by section divs, not individual blocks
    const textColor = element.textColor || font.color || null;
    const style = buildElementStyle(bbox, font, true, null, null, textColor, pageWidth, colorToVar);

    // Build data attributes for binding
    let dataAttrs = '';
    if (includeDataAttributes) {
        dataAttrs = ` data-block-id="${blockId}"`;
        dataAttrs += ` data-field="${fieldType}"`;
        dataAttrs += ` data-confidence="${confidence.toFixed(2)}"`;
        dataAttrs += ` data-original="${escapeHtml(originalText)}"`;
        dataAttrs += ` data-editable="true"`;
        if (element.sectionId) {
            dataAttrs += ` data-section="${element.sectionId}"`;
        }
        // Mark if field is empty (no user data and we want placeholders)
        if (usePlaceholders && !hasUserData && fieldType !== 'unknown') {
            dataAttrs += ` data-needs-data="true"`;
        }
    }

    // Use line class if element has multiple items, block otherwise
    const className = element.items ? 'cv-line editable-field' : 'cv-block editable-field';

    return `        <div class="${className}"${dataAttrs} style="${style}">${escapeHtml(displayText)}</div>`;
}

/**
 * Build inline style for element positioning
 */
function buildElementStyle(bbox, font, shouldBeVisible = false, backgroundColor = null, backgroundImage = null, textColor = null, pageWidth = 612, colorToVar = null) {
    const styles = [];

    // Position (PDF coordinates: origin at bottom-left, HTML: top-left)
    // Assuming bbox is already converted to top-left origin by parser
    if (bbox) {
        styles.push('position: absolute');
        styles.push(`left: ${bbox.x.toFixed(1)}px`);
        styles.push(`top: ${bbox.y.toFixed(1)}px`);

        // Width from PDF bbox
        if (bbox.width && bbox.width > 0) {
            styles.push(`width: ${bbox.width.toFixed(1)}px`);
        }
        // Height from PDF bbox - add 25% extra to prevent text cutoff
        if (bbox.height && bbox.height > 0) {
            const adjustedHeight = bbox.height * 1.25;
            styles.push(`height: ${adjustedHeight.toFixed(1)}px`);
        }
    }

    // Block background (only if explicitly provided - sections handle most backgrounds now)
    if (backgroundImage) {
        // Use background image (complex/gradient backgrounds)
        styles.push(`background-image: url(${backgroundImage})`);
        styles.push('background-size: 100% 100%');
        styles.push('background-repeat: no-repeat');
    } else if (backgroundColor && backgroundColor !== '#ffffff' && backgroundColor !== '#FFFFFF') {
        // Use solid background color (prefer CSS variable if available)
        const varName = getColorVar(colorToVar, backgroundColor);
        if (varName) {
            styles.push(`background-color: var(${varName})`);
        } else {
            styles.push(`background-color: ${backgroundColor}`);
        }
    }

    // Font styling
    if (font) {
        if (font.size) {
            styles.push(`font-size: ${font.size.toFixed(1)}px`);
        }
        if (font.family) {
            styles.push(`font-family: ${sanitizeFontFamily(font.family)}`);
        }
        if (font.weight) {
            styles.push(`font-weight: ${font.weight}`);
        }
        if (font.style === 'italic') {
            styles.push(`font-style: italic`);
        }
    }

    // Text color: priority is textColor (AI) > font.color > default
    if (shouldBeVisible) {
        let effectiveColor = null;
        if (textColor && textColor !== 'transparent') {
            effectiveColor = textColor;
        } else if (font?.color && font.color !== 'transparent') {
            effectiveColor = font.color;
        } else {
            effectiveColor = '#000000'; // Default visible color
        }

        const varName = getColorVar(colorToVar, effectiveColor);
        if (varName) {
            styles.push(`color: var(${varName})`);
        } else {
            styles.push(`color: ${effectiveColor}`);
        }
    } else {
        styles.push('color: transparent'); // Transparent for selection only
    }

    // Make text selectable
    styles.push('cursor: text');
    styles.push('user-select: text');

    return styles.join('; ');
}

/**
 * Sanitize font family for CSS
 */
function sanitizeFontFamily(family) {
    if (!family) return 'Arial, sans-serif';

    // Remove common PDF font suffixes
    let clean = family
        .replace(/-(Bold|Italic|BoldItalic|Regular|Light|Medium|Semibold)$/i, '')
        .replace(/,.*$/, '')
        .trim();

    // Map common PDF fonts to web-safe alternatives
    const fontMap = {
        'Arial': 'Arial, Helvetica, sans-serif',
        'ArialMT': 'Arial, Helvetica, sans-serif',
        'Helvetica': 'Helvetica, Arial, sans-serif',
        'TimesNewRoman': '"Times New Roman", Times, serif',
        'Times': '"Times New Roman", Times, serif',
        'Calibri': 'Calibri, Arial, sans-serif',
        'Cambria': 'Cambria, Georgia, serif',
        'Georgia': 'Georgia, serif',
        'Verdana': 'Verdana, Geneva, sans-serif',
        'Tahoma': 'Tahoma, Geneva, sans-serif',
        'CourierNew': '"Courier New", Courier, monospace',
        'Courier': '"Courier New", Courier, monospace'
    };

    return fontMap[clean] || `"${clean}", Arial, sans-serif`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Generate standalone CSS file content
 */
function generateCssFile(parsedStructure, options = {}) {
    const { cssVariables } = buildColorVariables(parsedStructure);
    return generateCss(parsedStructure, { ...options, cssVariables });
}

/**
 * Generate HTML fragment (without DOCTYPE, head, etc.) for embedding
 */
function generateHtmlFragment(parsedStructure, semanticAnalysis, options = {}) {
    const pages = parsedStructure.pages || [];
    const fieldMappings = semanticAnalysis?.fieldMappings || {};

    const {
        usePlaceholders = true,
        includeDataAttributes = true,
        userData = null
    } = options;

    // Reuse same color palette for HTML fragment
    const { colorToVar } = buildColorVariables(parsedStructure);

    return pages.map((page, pageIndex) =>
        generatePageHtml(page, pageIndex, fieldMappings, {
            usePlaceholders,
            includeDataAttributes,
            userData,
            colorToVar
        })
    ).join('\n');
}

/**
 * Apply user data to generated HTML
 * @param {string} html - Generated HTML with placeholders
 * @param {Object} userData - User data to apply
 * @returns {string} HTML with user data filled in
 */
function applyUserData(html, userData) {
    if (!userData) return html;

    let result = html;

    Object.entries(PLACEHOLDER_VALUES).forEach(([field, placeholder]) => {
        if (userData[field]) {
            const escapedPlaceholder = placeholder.replace(/[{}]/g, '\\$&');
            const regex = new RegExp(escapedPlaceholder, 'g');
            result = result.replace(regex, escapeHtml(userData[field]));
        }
    });

    return result;
}

/**
 * Generate editable HTML with contenteditable attributes
 */
function generateEditableHtml(parsedStructure, semanticAnalysis, options = {}) {
    const html = generateHtmlDocument(parsedStructure, semanticAnalysis, {
        ...options,
        includeDataAttributes: true
    });

    // Add contenteditable to all blocks
    return html.replace(
        /class="cv-(block|line)"/g,
        'class="cv-$1" contenteditable="true"'
    );
}

/**
 * Extract field mappings for placeholder binding
 * Returns a simple object mapping field names to their DOM selectors
 */
function getFieldBindings(semanticAnalysis) {
    const bindings = {};
    const fieldMappings = semanticAnalysis?.fieldMappings || {};

    Object.entries(fieldMappings).forEach(([blockId, info]) => {
        const fieldType = info.fieldType;
        if (!bindings[fieldType]) {
            bindings[fieldType] = [];
        }
        bindings[fieldType].push({
            selector: `[data-block-id="${blockId}"]`,
            blockId,
            confidence: info.confidence
        });
    });

    return bindings;
}

module.exports = {
    generateHtmlDocument,
    generateHtmlFragment,
    generateCss,
    generateCssFile,
    generateElementHtml,
    generateEditableHtml,
    applyUserData,
    getFieldBindings,
    PLACEHOLDER_VALUES,
    escapeHtml
};
