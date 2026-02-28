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

    let css = generateCss(parsedStructure, options);
    let htmlPages = pages.map((page, pageIndex) =>
        generatePageHtml(page, pageIndex, fieldMappings, {
            usePlaceholders,
            includeDataAttributes,
            userData
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
            }
        };
        
        // Legacy alias for backward compatibility
        window.CVPlaceholders = window.CVFields;
    </script>
</body>
</html>`;
}

/**
 * Generate CSS for the document
 */
function generateCss(parsedStructure, options = {}) {
    const { scale = 1 } = options;
    const page = parsedStructure.pages?.[0];
    const width = page?.width || 612;
    const height = page?.height || 792;

    return `
/* CV Template Styles - Generated */
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

.cv-block {
    position: absolute;
    white-space: pre-wrap;
    overflow: hidden;
    line-height: 1.2;
    z-index: 1;
}

.cv-line {
    position: absolute;
    white-space: nowrap;
    overflow: visible;
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

/* Empty field indicator - shows hint when no user data */
[data-needs-data="true"]:empty::before {
    content: attr(data-field);
    color: #999;
    font-style: italic;
    opacity: 0.7;
}

/* Highlight fields that need data */
[data-needs-data="true"] {
    background: rgba(255, 235, 59, 0.15);
    border-radius: 2px;
    min-width: 50px;
    min-height: 1em;
}

[data-needs-data="true"]:hover {
    background: rgba(255, 235, 59, 0.3);
}

/* Editable mode */
.cv-block[contenteditable="true"]:focus,
.cv-line[contenteditable="true"]:focus,
.editable-field:focus {
    outline: 2px solid #2196F3;
    background: rgba(33, 150, 243, 0.05);
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
    const { usePlaceholders, includeDataAttributes, userData } = options;
    const lines = page.lines || [];
    const blocks = page.blocks || [];
    const backgrounds = page.backgrounds || [];

    // Generate background elements first (they go behind text)
    let backgroundsHtml = backgrounds.map((bg, idx) => {
        return `        <div class="cv-background" data-bg-id="${bg.id}" style="position: absolute; left: ${bg.bbox.x}px; top: ${bg.bbox.y}px; width: ${bg.bbox.width}px; height: ${bg.bbox.height}px; background-color: ${bg.color}; z-index: 0;"></div>`;
    }).join('\n');

    // Prefer lines if available, fallback to blocks
    const elements = lines.length > 0 ? lines : blocks;

    let elementsHtml = elements.map((element, idx) => {
        const blockId = element.id || `p${pageIndex}_b${idx}`;
        const fieldInfo = fieldMappings[blockId];
        const fieldType = fieldInfo?.fieldType || element.semanticHint || 'unknown';
        const confidence = fieldInfo?.confidence || 0;

        return generateElementHtml(element, {
            blockId,
            fieldType,
            confidence,
            usePlaceholders,
            includeDataAttributes,
            userData,
            pageIndex
        });
    }).join('\n');

    // Build page style - use backgrounds as base, background image only as fallback
    let pageStyle = `position: relative; width: ${page.width}px; height: ${page.height}px; margin: 20px auto; box-shadow: 0 2px 8px rgba(0,0,0,0.1);`;

    // Only use background image if no extracted backgrounds OR as fallback layer
    if (page.backgroundImage) {
        if (backgrounds.length === 0) {
            // No extracted backgrounds - use image as main background
            pageStyle += ` background-image: url('${page.backgroundImage}'); background-size: ${page.width}px ${page.height}px; background-repeat: no-repeat;`;
        } else {
            // Have extracted backgrounds - use image at lower opacity as fallback
            pageStyle += ` background-color: white;`;
        }
    } else {
        pageStyle += ` background: white;`;
    }

    return `
    <div class="cv-page" data-page="${pageIndex}" style="${pageStyle}">
        ${backgroundsHtml}
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
        pageIndex
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

    // Build style - text is ALWAYS visible (not transparent)
    const style = buildElementStyle(bbox, font, true);

    // Build data attributes for binding
    let dataAttrs = '';
    if (includeDataAttributes) {
        dataAttrs = ` data-block-id="${blockId}"`;
        dataAttrs += ` data-field="${fieldType}"`;
        dataAttrs += ` data-confidence="${confidence.toFixed(2)}"`;
        dataAttrs += ` data-original="${escapeHtml(originalText)}"`;
        dataAttrs += ` data-editable="true"`;
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
function buildElementStyle(bbox, font, shouldBeVisible = false) {
    const styles = [];

    // Position (PDF coordinates: origin at bottom-left, HTML: top-left)
    // Assuming bbox is already converted to top-left origin by parser
    if (bbox) {
        styles.push('position: absolute');
        styles.push(`left: ${bbox.x.toFixed(1)}px`);
        styles.push(`top: ${bbox.y.toFixed(1)}px`);
        styles.push('white-space: nowrap');

        // Width and height are optional
        if (bbox.width && bbox.width > 0) {
            styles.push(`width: ${bbox.width.toFixed(1)}px`);
        }
        // Height is implied by font-size, but can be explicit
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
        // Color: transparent for background layer, visible for placeholders
        if (shouldBeVisible) {
            if (font.color && font.color !== 'transparent') {
                styles.push(`color: ${font.color}`);
            } else {
                styles.push('color: #000000'); // Default visible color
            }
        } else {
            styles.push('color: transparent'); // Transparent for selection only
        }
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
    return generateCss(parsedStructure, options);
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

    return pages.map((page, pageIndex) =>
        generatePageHtml(page, pageIndex, fieldMappings, {
            usePlaceholders,
            includeDataAttributes,
            userData
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
