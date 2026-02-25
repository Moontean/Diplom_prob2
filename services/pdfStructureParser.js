// services/pdfStructureParser.js
// PDF Structure Parser - extracts exact layout, coordinates, fonts, blocks from PDF
// This is the "source of truth" for geometry - NOT AI generated

const fs = require('fs');
const path = require('path');

// Lazy-load pdfjs-dist to avoid startup issues
let pdfjsLib = null;

async function ensurePdfJs() {
    if (pdfjsLib) return;
    try {
        // Use legacy build for Node.js compatibility
        pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

        // Set worker source to the actual worker file
        // On Windows, we need to use file:// URL format
        const workerPath = path.join(
            path.dirname(require.resolve('pdfjs-dist/package.json')),
            'legacy/build/pdf.worker.mjs'
        );

        // Convert to file:// URL for ESM loader compatibility
        const { pathToFileURL } = require('url');
        const workerUrl = pathToFileURL(workerPath).href;

        // For Node.js, we need to provide the worker path
        if (pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        }
    } catch (err) {
        console.error('Failed to load pdfjs-dist:', err.message);
        throw new Error('pdfjs-dist initialization failed');
    }
}

/**
 * Parse PDF and extract structured blocks with coordinates
 * @param {Buffer|string} pdfInput - PDF buffer or file path
 * @returns {Promise<Object>} Parsed structure with pages and blocks
 */
async function parsePdfStructure(pdfInput) {
    await ensurePdfJs();

    // Load PDF data
    let data;
    if (Buffer.isBuffer(pdfInput)) {
        data = new Uint8Array(pdfInput);
    } else if (typeof pdfInput === 'string') {
        if (pdfInput.startsWith('data:')) {
            // Base64 data URL
            const base64 = pdfInput.replace(/^data:.*?;base64,/, '');
            data = new Uint8Array(Buffer.from(base64, 'base64'));
        } else {
            // File path
            const buf = fs.readFileSync(pdfInput);
            data = new Uint8Array(buf);
        }
    } else {
        throw new Error('Invalid PDF input: expected Buffer or path string');
    }

    const loadingTask = pdfjsLib.getDocument({
        data,
        useSystemFonts: true,
        isEvalSupported: false,
        disableFontFace: true
    });
    const pdf = await loadingTask.promise;

    const result = {
        numPages: pdf.numPages,
        pages: []
    };

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });
        const textContent = await page.getTextContent();

        const pageData = {
            pageNumber: pageNum,
            width: viewport.width,
            height: viewport.height,
            blocks: []
        };

        let blockId = 0;

        // Process text items
        for (const item of textContent.items) {
            if (!item.str || !item.str.trim()) continue;

            const transform = item.transform || [1, 0, 0, 1, 0, 0];
            const [a, b, c, d, e, f] = transform;

            // Calculate font size from transform matrix
            const fontSize = Math.abs(d) || Math.hypot(a, b) || 12;

            // e = x position, f = y position (PDF coordinate system, origin at bottom-left)
            // Convert to top-left origin for HTML
            const x = e;
            const y = viewport.height - f;

            // Estimate width based on string length and font size
            const width = item.width || (item.str.length * fontSize * 0.6);
            const height = fontSize * 1.2;

            // Detect font weight from font name
            const fontName = item.fontName || '';
            const isBold = /bold|black|heavy|semibold|medium/i.test(fontName);
            const isItalic = /italic|oblique/i.test(fontName);
            const fontWeight = isBold ? 700 : 400;
            const fontStyle = isItalic ? 'italic' : 'normal';

            // Normalize font family
            let fontFamily = 'Inter, system-ui, Arial, sans-serif';
            if (/serif/i.test(fontName) && !/sans/i.test(fontName)) {
                fontFamily = 'Georgia, Times New Roman, serif';
            } else if (/mono|courier|consolas/i.test(fontName)) {
                fontFamily = 'Consolas, Monaco, monospace';
            }

            pageData.blocks.push({
                id: `block_${pageNum}_${blockId++}`,
                type: 'text',
                text: item.str,
                bbox: {
                    x: Math.round(x * 100) / 100,
                    y: Math.round(y * 100) / 100,
                    width: Math.round(width * 100) / 100,
                    height: Math.round(height * 100) / 100
                },
                font: {
                    family: fontFamily,
                    size: Math.round(fontSize * 100) / 100,
                    weight: fontWeight,
                    style: fontStyle,
                    original: fontName
                },
                transform: transform,
                color: '#000000' // Default, can be enhanced with operator list parsing
            });
        }

        // Group blocks into lines (same baseline)
        pageData.lines = groupBlocksIntoLines(pageData.blocks);

        result.pages.push(pageData);
    }

    return result;
}

/**
 * Group text blocks into logical lines based on baseline proximity
 * @param {Array} blocks - Array of text blocks
 * @returns {Array} Array of line objects
 */
function groupBlocksIntoLines(blocks) {
    if (!blocks.length) return [];

    // Sort by Y position first, then X
    const sorted = [...blocks].sort((a, b) => {
        const yDiff = a.bbox.y - b.bbox.y;
        if (Math.abs(yDiff) > 3) return yDiff;
        return a.bbox.x - b.bbox.x;
    });

    const lines = [];
    let currentLine = null;
    const baselineTolerance = 5; // pixels

    for (const block of sorted) {
        if (!currentLine) {
            currentLine = {
                id: `line_${lines.length}`,
                blocks: [block],
                baseline: block.bbox.y,
                minX: block.bbox.x,
                maxX: block.bbox.x + block.bbox.width,
                fontSize: block.font.size
            };
        } else {
            // Check if on same line
            const onSameLine = Math.abs(block.bbox.y - currentLine.baseline) <= baselineTolerance;

            if (onSameLine) {
                currentLine.blocks.push(block);
                currentLine.maxX = Math.max(currentLine.maxX, block.bbox.x + block.bbox.width);
                currentLine.fontSize = Math.max(currentLine.fontSize, block.font.size);
            } else {
                lines.push(finalizeLine(currentLine));
                currentLine = {
                    id: `line_${lines.length}`,
                    blocks: [block],
                    baseline: block.bbox.y,
                    minX: block.bbox.x,
                    maxX: block.bbox.x + block.bbox.width,
                    fontSize: block.font.size
                };
            }
        }
    }

    if (currentLine && currentLine.blocks.length) {
        lines.push(finalizeLine(currentLine));
    }

    return lines;
}

/**
 * Finalize a line by computing its combined text and bbox
 */
function finalizeLine(line) {
    // Sort blocks by X position
    line.blocks.sort((a, b) => a.bbox.x - b.bbox.x);

    // Combine text with proper spacing
    let combinedText = '';
    let lastX = 0;

    for (let i = 0; i < line.blocks.length; i++) {
        const block = line.blocks[i];
        if (i > 0) {
            const gap = block.bbox.x - lastX;
            // Add space if significant gap
            if (gap > line.fontSize * 0.3) {
                combinedText += ' ';
            }
        }
        combinedText += block.text;
        lastX = block.bbox.x + block.bbox.width;
    }

    line.text = combinedText;
    line.bbox = {
        x: line.minX,
        y: line.baseline,
        width: line.maxX - line.minX,
        height: line.fontSize * 1.2
    };

    return line;
}

/**
 * Detect semantic field type from text content using heuristics
 * @param {string} text - Text content to analyze
 * @returns {string|null} Detected field type or null
 */
function detectFieldType(text) {
    if (!text) return null;
    const s = text.trim();

    // Email pattern
    if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(s)) return 'email';

    // Phone pattern
    if (/^[\+]?[\d\s\(\)\-\.]{7,20}$/.test(s) && /\d{3,}/.test(s)) return 'phone';

    // LinkedIn URL
    if (/linkedin\.com/i.test(s)) return 'linkedin';

    // Generic URL
    if (/^https?:\/\//i.test(s)) return 'website';

    // Postal code (5-6 digits)
    if (/^\d{5,6}$/.test(s)) return 'postalCode';

    // Date patterns (various formats)
    if (/\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}/.test(s)) return 'date';
    if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)/i.test(s)) return 'date';

    // Skills keywords
    if (/\b(skills|навыки|умения|компетенции)\b/i.test(s)) return 'skillsHeader';

    // Experience keywords
    if (/\b(experience|опыт|работа|experience)\b/i.test(s)) return 'experienceHeader';

    // Education keywords
    if (/\b(education|образование|university|университет)\b/i.test(s)) return 'educationHeader';

    return null;
}

/**
 * Pre-analyze blocks for potential semantic fields
 * @param {Object} structure - Parsed PDF structure
 * @returns {Object} Structure with semantic hints
 */
function addSemanticHints(structure) {
    for (const page of structure.pages) {
        for (const block of page.blocks) {
            const fieldType = detectFieldType(block.text);
            if (fieldType) {
                block.semanticHint = fieldType;
            }
        }

        // Analyze lines
        for (const line of page.lines) {
            const fieldType = detectFieldType(line.text);
            if (fieldType) {
                line.semanticHint = fieldType;
            }

            // Check if line looks like a name (first line, large font, title case)
            if (!line.semanticHint && page.lines.indexOf(line) === 0) {
                const words = line.text.trim().split(/\s+/);
                if (words.length >= 1 && words.length <= 4) {
                    const allTitleCase = words.every(w => /^[A-ZА-ЯЁ][a-zа-яё]*$/.test(w));
                    if (allTitleCase && line.fontSize > 14) {
                        line.semanticHint = 'fullName';
                    }
                }
            }

            // Check if line looks like a job title (second line, medium-large font)
            if (!line.semanticHint && page.lines.indexOf(line) === 1) {
                if (line.fontSize > 12 && line.text.length > 3 && line.text.length < 60) {
                    line.semanticHint = 'jobTitle';
                }
            }
        }
    }

    return structure;
}

/**
 * Convert PDF to structured JSON for semantic analysis
 * @param {Buffer|string} pdfInput - PDF buffer or file path
 * @returns {Promise<Object>} Structured output ready for LLaVA
 */
async function extractPdfForSemantics(pdfInput) {
    const structure = await parsePdfStructure(pdfInput);
    return addSemanticHints(structure);
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[m]);
}

/**
 * Convert parsed PDF structure to HTML with absolute positioning
 * @param {Object} structure - Parsed PDF structure
 * @returns {string} HTML string with positioned blocks
 */
function convertToHtml(structure) {
    let html = '<div class="pdf-container" style="position: relative; background: #f5f5f5; padding: 20px;">\n';

    for (const page of structure.pages) {
        html += `  <div class="pdf-page" style="width: ${page.width}px; height: ${page.height}px; position: relative; background: white; border: 1px solid #ccc; margin: 20px auto; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">\n`;

        for (const block of page.blocks) {
            const style = [
                'position: absolute',
                `left: ${block.bbox.x}px`,
                `top: ${block.bbox.y}px`,
                `font-size: ${block.font.size}px`,
                `font-weight: ${block.font.weight}`,
                `font-style: ${block.font.style}`,
                `font-family: ${block.font.family}`,
                'white-space: nowrap',
                `color: ${block.color}`
            ].join('; ');

            html += `    <div style="${style}">${escapeHtml(block.text)}</div>\n`;
        }

        html += '  </div>\n';
    }

    html += '</div>';
    return html;
}

module.exports = {
    parsePdfStructure,
    extractPdfForSemantics,
    groupBlocksIntoLines,
    detectFieldType,
    addSemanticHints,
    convertToHtml,
    escapeHtml
};
