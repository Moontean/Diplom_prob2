// services/cssGenerator.js
// CSS Generator for color palette and CSS variables
//
// Extracts unique colors from parsed PDF structure and maps them
// to CSS custom properties like --color-1, --color-2, ...

/**
 * Normalize color string for consistent map keys
 * @param {string|null|undefined} color
 * @returns {string|null}
 */
function normalizeColor(color) {
    if (!color || typeof color !== 'string') return null;
    const trimmed = color.trim();
    if (!trimmed) return null;
    // Ignore fully transparent markers if any
    if (trimmed.toLowerCase() === 'transparent') return null;
    return trimmed.toLowerCase();
}

/**
 * Collect all unique colors from parsed PDF structure
 * @param {Object} parsedStructure
 * @returns {string[]} array of unique normalized color strings
 */
function collectColorsFromStructure(parsedStructure) {
    const unique = [];
    const seen = new Set();

    const addColor = (raw) => {
        const norm = normalizeColor(raw);
        if (!norm) return;
        // Skip pure white, it is used as default background
        if (norm === '#ffffff' || norm === '#fff') return;
        if (!seen.has(norm)) {
            seen.add(norm);
            unique.push(norm);
        }
    };

    const pages = parsedStructure?.pages || [];
    for (const page of pages) {
        // Exact backgrounds extracted from PDF
        (page.backgrounds || []).forEach((bg) => addColor(bg.color));

        // Separator lines from PDF
        (page.pdfLines || []).forEach((line) => addColor(line.color));

        // AI / heuristic color sections
        (page.colorSections || []).forEach((section) => addColor(section.backgroundColor));

        // Text blocks: background & text colors
        (page.blocks || []).forEach((block) => {
            if (block.background) addColor(block.background);
            if (block.textColor) addColor(block.textColor);
            if (block.font && block.font.color) addColor(block.font.color);
        });
    }

    return unique;
}

/**
 * Build mapping color -> CSS variable name and the corresponding :root block
 * @param {Object} parsedStructure
 * @returns {{ colorToVar: Object, cssVariables: string }}
 */
function buildColorVariables(parsedStructure) {
    const colors = collectColorsFromStructure(parsedStructure);
    const colorToVar = {};
    if (!colors.length) {
        console.log('🎨 PDF color palette: no non-white colors detected');
        return { colorToVar, cssVariables: '' };
    }

    console.log('🎨 PDF color palette (raw colors from PDF):', colors);

    colors.forEach((color, index) => {
        const varName = `--color-${index + 1}`;
        colorToVar[color] = varName;
    });

    const lines = [':root {'];
    colors.forEach((color) => {
        const varName = colorToVar[color];
        lines.push(`  ${varName}: ${color};`);
    });
    lines.push('}');

    const cssVariables = lines.join('\n');

    console.log('🎨 PDF color variables mapping:', colorToVar);
    return { colorToVar, cssVariables };
}

/**
 * Get CSS variable name for a given color, if it exists in map
 * @param {Object} colorToVar - map color -> var name
 * @param {string} color - raw color string (HEX or CSS)
 * @returns {string|null} CSS variable name like "--color-1" or null
 */
function getColorVar(colorToVar, color) {
    if (!colorToVar || !color) return null;
    const norm = normalizeColor(color);
    if (!norm) return null;
    return colorToVar[norm] || null;
}

module.exports = {
    buildColorVariables,
    getColorVar,
};
