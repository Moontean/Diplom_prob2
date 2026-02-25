/**
 * HTML/CSS Generator Service
 * 
 * Converts parsed PDF structure + semantic analysis into production HTML/CSS
 * with absolute positioning and placeholder data attributes.
 * 
 * Key principle: Geometry from PDF parser, semantics from AI analyzer
 */

const PLACEHOLDER_VALUES = {
    fullName: '{{FULL_NAME}}',
    firstName: '{{FIRST_NAME}}',
    lastName: '{{LAST_NAME}}',
    jobTitle: '{{JOB_TITLE}}',
    email: '{{EMAIL}}',
    phone: '{{PHONE}}',
    address: '{{ADDRESS}}',
    city: '{{CITY}}',
    zipCode: '{{ZIP_CODE}}',
    country: '{{COUNTRY}}',
    linkedin: '{{LINKEDIN}}',
    website: '{{WEBSITE}}',
    github: '{{GITHUB}}',
    summary: '{{SUMMARY}}',
    experienceHeader: '{{EXPERIENCE_HEADER}}',
    companyName: '{{COMPANY_NAME}}',
    position: '{{POSITION}}',
    dateRange: '{{DATE_RANGE}}',
    description: '{{DESCRIPTION}}',
    educationHeader: '{{EDUCATION_HEADER}}',
    institution: '{{INSTITUTION}}',
    degree: '{{DEGREE}}',
    fieldOfStudy: '{{FIELD_OF_STUDY}}',
    graduationDate: '{{GRADUATION_DATE}}',
    skillsHeader: '{{SKILLS_HEADER}}',
    skill: '{{SKILL}}',
    languagesHeader: '{{LANGUAGES_HEADER}}',
    language: '{{LANGUAGE}}',
    certificationsHeader: '{{CERTIFICATIONS_HEADER}}',
    certification: '{{CERTIFICATION}}',
    projectsHeader: '{{PROJECTS_HEADER}}',
    projectName: '{{PROJECT_NAME}}',
    projectDescription: '{{PROJECT_DESC}}',
    referencesHeader: '{{REFERENCES_HEADER}}',
    reference: '{{REFERENCE}}',
    unknown: '{{TEXT}}'
};

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
        // Placeholder binding system
        window.CVPlaceholders = {
            update: function(fieldName, value) {
                const elements = document.querySelectorAll('[data-field="' + fieldName + '"]');
                elements.forEach(el => {
                    el.textContent = value || el.dataset.placeholder;
                });
            },
            updateAll: function(data) {
                Object.entries(data).forEach(([field, value]) => {
                    this.update(field, value);
                });
            },
            getData: function() {
                const data = {};
                document.querySelectorAll('[data-field]').forEach(el => {
                    const field = el.dataset.field;
                    if (!data[field]) data[field] = [];
                    data[field].push(el.textContent);
                });
                return data;
            }
        };
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

.cv-block {
    position: absolute;
    white-space: pre-wrap;
    overflow: hidden;
    line-height: 1.2;
}

.cv-line {
    position: absolute;
    white-space: nowrap;
    overflow: visible;
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

/* Placeholder styling */
[data-is-placeholder="true"] {
    color: #666;
    background: rgba(255, 235, 59, 0.2);
    border-radius: 2px;
    padding: 0 2px;
}

[data-is-placeholder="true"]:hover {
    background: rgba(255, 235, 59, 0.4);
}

/* Editable mode */
.cv-block[contenteditable="true"]:focus {
    outline: 2px solid #2196F3;
    background: rgba(33, 150, 243, 0.05);
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
    
    [data-is-placeholder="true"] {
        background: transparent;
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

    return `
    <div class="cv-page" data-page="${pageIndex}" style="position: relative; width: ${page.width}px; height: ${page.height}px; background: white; margin: 20px auto; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        ${elementsHtml}
    </div>`;
}

/**
 * Generate HTML for a single text element (block or line)
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
    const text = element.text || '';
    const font = element.font || {};

    // Determine display text
    let displayText = text;
    let isPlaceholder = false;

    if (usePlaceholders && fieldType !== 'unknown') {
        // Check if user has provided data for this field
        if (userData && userData[fieldType]) {
            displayText = userData[fieldType];
        } else {
            displayText = PLACEHOLDER_VALUES[fieldType] || `{{${fieldType.toUpperCase()}}}`;
            isPlaceholder = true;
        }
    }

    // Build style
    const style = buildElementStyle(bbox, font);

    // Build data attributes
    let dataAttrs = '';
    if (includeDataAttributes) {
        dataAttrs = ` data-block-id="${blockId}"`;
        dataAttrs += ` data-field="${fieldType}"`;
        dataAttrs += ` data-confidence="${confidence.toFixed(2)}"`;
        dataAttrs += ` data-original="${escapeHtml(text)}"`;
        if (isPlaceholder) {
            dataAttrs += ` data-is-placeholder="true"`;
            dataAttrs += ` data-placeholder="${escapeHtml(displayText)}"`;
        }
    }

    // Use line class if element has multiple items, block otherwise
    const className = element.items ? 'cv-line' : 'cv-block';

    return `        <div class="${className}"${dataAttrs} style="${style}">${escapeHtml(displayText)}</div>`;
}

/**
 * Build inline style for element positioning
 */
function buildElementStyle(bbox, font) {
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
        if (font.color) {
            styles.push(`color: ${font.color}`);
        }
    }

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
