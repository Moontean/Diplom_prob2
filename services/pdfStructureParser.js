// services/pdfStructureParser.js
// PDF Structure Parser - extracts exact layout, coordinates, fonts, blocks from PDF
// This is the "source of truth" for geometry - NOT AI generated

const fs = require('fs');
const path = require('path');
const { createCanvas, Image } = require('canvas');
const { execSync } = require('child_process');

// Lazy-load pdfjs-dist to avoid startup issues
let pdfjsLib = null;

// Логируем ошибку рендера страниц PDF→canvas только один раз,
// чтобы не засорять консоль одинаковыми сообщениями для каждой страницы.
let hasLoggedImageRenderError = false;

/**
 * Render PDF page using Poppler (pdftoppm) - FULL COLOR support
 * @param {string} pdfPath - Path to PDF file
 * @param {number} pageNum - Page number (1-based)
 * @param {number} dpi - Resolution (default 150 for good quality + reasonable size)
 * @returns {Promise<string|null>} Base64 PNG image or null on error
 */
async function renderPageWithPoppler(pdfPath, pageNum, dpi = 150) {
    try {
        // Create temp output path
        const tempDir = path.join(path.dirname(pdfPath), 'temp_render');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const outputPrefix = path.join(tempDir, `page_${pageNum}`);

        // Run pdftoppm: render single page to PNG
        const cmd = `pdftoppm -png -r ${dpi} -f ${pageNum} -l ${pageNum} "${pdfPath}" "${outputPrefix}"`;
        console.log(`🎨 Poppler render: page ${pageNum} at ${dpi} DPI`);

        execSync(cmd, { stdio: 'pipe' });

        // Find output file (pdftoppm adds page number suffix)
        const outputFile = `${outputPrefix}-${pageNum}.png`;
        const altOutputFile = `${outputPrefix}-${String(pageNum).padStart(2, '0')}.png`; // Sometimes uses 01, 02...

        let pngPath = null;
        if (fs.existsSync(outputFile)) {
            pngPath = outputFile;
        } else if (fs.existsSync(altOutputFile)) {
            pngPath = altOutputFile;
        } else {
            // Try to find any PNG in temp dir
            const files = fs.readdirSync(tempDir).filter(f => f.startsWith(`page_${pageNum}`) && f.endsWith('.png'));
            if (files.length > 0) {
                pngPath = path.join(tempDir, files[0]);
            }
        }

        if (!pngPath || !fs.existsSync(pngPath)) {
            console.warn(`⚠️ Poppler output not found for page ${pageNum}`);
            return null;
        }

        // Read PNG and convert to base64
        const pngBuffer = fs.readFileSync(pngPath);
        const base64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;

        // Cleanup temp file
        fs.unlinkSync(pngPath);

        console.log(`✅ Poppler: page ${pageNum} rendered (${base64.length} chars)`);
        return base64;

    } catch (err) {
        console.error(`❌ Poppler render failed for page ${pageNum}:`, err.message);
        return null;
    }
}

/**
 * NodeCanvasFactory for PDF.js to work with node-canvas
 */
class NodeCanvasFactory {
    create(width, height) {
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        return {
            canvas,
            context
        };
    }

    reset(canvasAndContext, width, height) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
    }

    destroy(canvasAndContext) {
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
    }
}

/**
 * NodeCanvasFactory with image support for PDF.js
 */
class NodeCanvasFactoryWithImages extends NodeCanvasFactory {
    createImage() {
        const img = new Image();
        return img;
    }
}

async function ensurePdfJs() {
    if (pdfjsLib) return;
    try {
        // Make Canvas & Image available globally for PDF.js (Node environment)
        // Это важно для корректной работы inline-изображений: pdfjs-dist внутри
        // проверяет, что объект является экземпляром global.Image или global.Canvas.
        if (typeof global.Canvas === 'undefined') {
            // createCanvas(...) возвращает инстанс node-canvas Canvas,
            // берём его конструктор как класс Canvas.
            global.Canvas = createCanvas(1, 1).constructor;
            console.log('✅ Global Canvas class set from node-canvas');
        }
        if (typeof global.Image === 'undefined') {
            global.Image = Image;
            console.log('✅ Global Image class set from node-canvas');
        }

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
 * Render PDF page to canvas and return canvas object (for block extraction)
 * @param {Object} page - PDF.js page object
 * @param {number} scale - Render scale
 * @returns {Promise<{canvas, context, width, height, scale}|null>}
 */
async function renderPageToCanvas(page, scale = 2.0) {
    try {
        const viewport = page.getViewport({ scale });
        const canvasFactory = new NodeCanvasFactoryWithImages();
        const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
        const { canvas, context } = canvasAndContext;

        // White background
        context.fillStyle = 'white';
        context.fillRect(0, 0, viewport.width, viewport.height);

        await page.render({
            canvasContext: context,
            viewport: viewport,
            canvasFactory: canvasFactory,
            background: 'white',
            enableImageBitmaps: false
        }).promise;

        return {
            canvas,
            context,
            width: viewport.width,
            height: viewport.height,
            scale
        };
    } catch (err) {
        if (!hasLoggedImageRenderError) {
            console.error('❌ Error rendering page to canvas:', err.message);
            hasLoggedImageRenderError = true;
        }
        return null;
    }
}

/**
 * Get average color of a canvas region
 * @param {Object} canvas - node-canvas object
 * @param {number} x - start x
 * @param {number} y - start y  
 * @param {number} w - width
 * @param {number} h - height
 * @returns {{color: string, isSimple: boolean}} - hex color and whether it's uniform
 */
function getRegionColor(canvas, x, y, w, h) {
    try {
        const ctx = canvas.getContext('2d');
        const safeX = Math.max(0, Math.min(x, canvas.width - 1));
        const safeY = Math.max(0, Math.min(y, canvas.height - 1));
        const safeW = Math.min(w, canvas.width - safeX);
        const safeH = Math.min(h, canvas.height - safeY);

        if (safeW < 1 || safeH < 1) return { color: '#ffffff', isSimple: true };

        const imageData = ctx.getImageData(safeX, safeY, safeW, safeH);
        const data = imageData.data;

        let r = 0, g = 0, b = 0;
        let count = 0;

        // Sample every 4th pixel for speed
        for (let i = 0; i < data.length; i += 16) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
        }

        if (count === 0) return { color: '#ffffff', isSimple: true };

        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        // Check color variance
        let variance = 0;
        for (let i = 0; i < data.length; i += 16) {
            variance += Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b);
        }
        variance /= count;

        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

        return {
            color: hex,
            isSimple: variance < 30 // Low variance = solid color
        };
    } catch (err) {
        return { color: '#ffffff', isSimple: true };
    }
}

/**
 * Extract background fragment for a block
 * @param {Object} pageCanvas - rendered page canvas result
 * @param {Object} bbox - block bounding box {x, y, width, height}
 * @param {number} padding - extra padding around block
 * @returns {{color: string|null, imageData: string|null}}
 */
function extractBlockBackground(pageCanvas, bbox, padding = 2) {
    if (!pageCanvas || !pageCanvas.canvas) return { color: null, imageData: null };

    try {
        const scale = pageCanvas.scale;
        const expandedBbox = {
            x: Math.max(0, (bbox.x - padding) * scale),
            y: Math.max(0, (bbox.y - padding) * scale),
            width: (bbox.width + padding * 2) * scale,
            height: (bbox.height + padding * 2) * scale
        };

        // Get color info
        const colorInfo = getRegionColor(
            pageCanvas.canvas,
            expandedBbox.x,
            expandedBbox.y,
            expandedBbox.width,
            expandedBbox.height
        );

        // If simple solid color (not white), return just the color
        if (colorInfo.isSimple) {
            // Skip white/near-white backgrounds
            const isWhite = colorInfo.color.toLowerCase() === '#ffffff' ||
                colorInfo.color.toLowerCase() === '#fefefe' ||
                colorInfo.color.toLowerCase() === '#fdfdfd';
            return {
                color: isWhite ? null : colorInfo.color,
                imageData: null
            };
        }

        // Complex background - extract as image
        const blockCanvas = createCanvas(
            Math.ceil(expandedBbox.width),
            Math.ceil(expandedBbox.height)
        );
        const ctx = blockCanvas.getContext('2d');

        ctx.drawImage(
            pageCanvas.canvas,
            expandedBbox.x,
            expandedBbox.y,
            expandedBbox.width,
            expandedBbox.height,
            0, 0,
            expandedBbox.width,
            expandedBbox.height
        );

        return {
            color: null,
            imageData: blockCanvas.toDataURL('image/png')
        };
    } catch (err) {
        return { color: null, imageData: null };
    }
}

/**
 * Render PDF page to canvas and return as base64 image
 * @param {Object} page - PDF.js page object
 * @param {number} scale - Render scale (default 2.0 for display, 0.5 for AI)
 * @param {Object} options - Options: { forAI: boolean, quality: number }
 * @returns {Promise<string>} Base64 encoded image
 */
async function renderPageToImage(page, scale = 2.0, options = {}) {
    const { forAI = false, quality = 0.8 } = options;
    // Use scale 1.0 for AI to get better color detection
    const effectiveScale = forAI ? Math.min(scale, 1.0) : scale;

    try {
        console.log(`\n🎨 Starting renderPageToImage with scale: ${effectiveScale} (forAI: ${forAI})`);
        const viewport = page.getViewport({ scale: effectiveScale });
        console.log(`📐 Viewport size: ${viewport.width}x${viewport.height}`);

        const canvasFactory = new NodeCanvasFactoryWithImages();
        const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
        const { canvas, context } = canvasAndContext;
        console.log(`✅ Canvas created via NodeCanvasFactoryWithImages`);

        // Set white background
        context.fillStyle = 'white';
        context.fillRect(0, 0, viewport.width, viewport.height);
        console.log(`✅ White background set`);

        console.log(`🖼️ Starting page.render()...`);
        const renderTask = page.render({
            canvasContext: context,
            viewport: viewport,
            canvasFactory: canvasFactory,
            background: 'white',
            // Disable ImageBitmap API (not available in Node.js)
            enableImageBitmaps: false
        });
        await renderTask.promise;
        console.log(`✅ page.render() completed`);

        // Convert canvas to base64
        // Use JPEG for AI (smaller size) or PNG for display (better quality)
        console.log(`📦 Converting to buffer...`);
        let buffer, mimeType;
        if (forAI) {
            buffer = canvas.toBuffer('image/jpeg', { quality });
            mimeType = 'image/jpeg';
        } else {
            buffer = canvas.toBuffer('image/png');
            mimeType = 'image/png';
        }
        console.log(`✅ Buffer created: ${buffer.length} bytes (${mimeType})`);

        const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
        console.log(`✅ Base64 created: ${base64.length} chars`);

        // Cleanup
        canvasFactory.destroy(canvasAndContext);

        return base64;
    } catch (err) {
        // Некорректные inline-изображения в некоторых PDF (особенно старых шаблонов)
        // могут вызывать ошибку "Image or Canvas expected" внутри pdfjs-dist.
        // Для нас это не критично: в таком случае просто возвращаем null,
        // чтобы остальной конвейер (текст, фоны) продолжал работать.
        if (!hasLoggedImageRenderError) {
            console.error('❌ Error rendering page to image (non-fatal):', err.message);
            console.error('   Подробнее: эта ошибка типична для некоторых inline-изображений в PDF при использовании node-canvas. Фоновые PNG просто не будут сгенерированы, но текстовая структура останется доступной.');
            hasLoggedImageRenderError = true;
        }
        return null;
    }
}

/**
 * Convert RGB values (0-1) to hex color
 */
function rgbToHex(r, g, b) {
    const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Extract text colors from PDF operator list
 */
async function extractTextColors(page) {
    try {
        const operatorList = await page.getOperatorList();
        const colors = [];
        let currentColor = '#000000';

        for (let i = 0; i < operatorList.fnArray.length; i++) {
            const fn = operatorList.fnArray[i];
            const args = operatorList.argsArray[i];

            // OPS.setFillRGBColor
            if (fn === 19 && args.length === 3) {
                const [r, g, b] = args;
                currentColor = rgbToHex(r, g, b);
                colors.push(currentColor);
            }
            // OPS.setFillGray
            else if (fn === 21 && args.length === 1) {
                const gray = Math.round(args[0] * 255);
                const hex = gray.toString(16).padStart(2, '0');
                currentColor = `#${hex}${hex}${hex}`;
                colors.push(currentColor);
            }
            // OPS.showText or similar - associate color with text
            else if ([17, 18, 27, 28].includes(fn)) {
                colors.push(currentColor);
            }
        }

        return colors;
    } catch (err) {
        console.warn('Could not extract colors:', err.message);
        return [];
    }
}

/**
 * Get PDF.js OPS constants dynamically
 * Используем реальные значения из pdfjsLib для совместимости между версиями
 */
function getOPS() {
    if (pdfjsLib && pdfjsLib.OPS) {
        return pdfjsLib.OPS;
    }
    // Fallback для случаев когда pdfjsLib ещё не загружен
    return {
        setFillRGBColor: 19,
        setStrokeRGBColor: 20,
        setFillGray: 21,
        setStrokeGray: 22,
        setFillCMYKColor: 23,
        setStrokeCMYKColor: 24,
        fill: 18,
        eoFill: 81,
        fillStroke: 82,
        constructPath: 91,
        rectangle: 92,
        transform: 12,
        save: 10,
        restore: 11
    };
}

/**
 * Extract background shapes (rectangles, paths) with colors from PDF
 * @param {Object} page - PDF.js page object
 * @param {Object} viewport - PDF viewport for coordinate conversion
 * @returns {Promise<Array>} Array of background elements
 */
async function extractBackgrounds(page, viewport) {
    const backgrounds = [];
    const OPS = getOPS();

    try {
        const operatorList = await page.getOperatorList();
        const { fnArray, argsArray } = operatorList;

        console.log(`🔍 Analyzing ${fnArray.length} PDF operators for backgrounds...`);

        // Debug: count operator types
        const opCounts = {};
        for (const fn of fnArray) {
            opCounts[fn] = (opCounts[fn] || 0) + 1;
        }
        // Log interesting operators
        const interestingOps = [OPS.setFillRGBColor, OPS.setFillGray, OPS.setFillCMYKColor, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.rectangle, OPS.constructPath];
        const foundOps = Object.entries(opCounts)
            .filter(([op]) => interestingOps.includes(Number(op)))
            .map(([op, count]) => `${op}:${count}`);
        console.log(`🎨 Interesting operators: ${foundOps.join(', ') || 'none'}`);

        // State tracking
        let currentFillColor = '#ffffff';
        let currentPath = [];
        let transformMatrix = [1, 0, 0, 1, 0, 0]; // Identity matrix
        const transformStack = [];

        // Debug: track found colors
        const foundColors = new Set();

        for (let i = 0; i < fnArray.length; i++) {
            const fn = fnArray[i];
            const args = argsArray[i];

            switch (fn) {
                // Save/Restore graphics state
                case OPS.save:
                    transformStack.push([...transformMatrix]);
                    break;
                case OPS.restore:
                    if (transformStack.length > 0) {
                        transformMatrix = transformStack.pop();
                    }
                    break;

                // Set fill color
                case OPS.setFillRGBColor:
                    if (args.length >= 3) {
                        currentFillColor = rgbToHex(args[0], args[1], args[2]);
                        foundColors.add(currentFillColor);
                    }
                    break;
                case OPS.setFillGray:
                    if (args.length >= 1) {
                        const gray = Math.round(args[0] * 255);
                        const hex = gray.toString(16).padStart(2, '0');
                        currentFillColor = `#${hex}${hex}${hex}`;
                        foundColors.add(currentFillColor);
                    }
                    break;
                case OPS.setFillCMYKColor:
                    // Convert CMYK to RGB (simplified)
                    if (args.length >= 4) {
                        const [c, m, y, k] = args;
                        const r = 1 - Math.min(1, c * (1 - k) + k);
                        const g = 1 - Math.min(1, m * (1 - k) + k);
                        const b = 1 - Math.min(1, y * (1 - k) + k);
                        currentFillColor = rgbToHex(r, g, b);
                        foundColors.add(currentFillColor);
                    }
                    break;

                // Rectangle
                case OPS.rectangle:
                    if (args.length >= 4) {
                        const [x, y, w, h] = args;
                        currentPath.push({
                            type: 'rect',
                            x, y, w, h
                        });
                    }
                    break;

                // Construct path (moveTo, lineTo, etc.)
                case OPS.constructPath:
                    // args: [opsArray, argsArray]; иногда в PDF попадаются странные записи,
                    // поэтому обязательно проверяем, что это массивы.
                    if (args && Array.isArray(args[0]) && Array.isArray(args[1])) {
                        const ops = args[0]; // Array of path operations
                        const pathArgs = args[1]; // Array of arguments
                        let argIndex = 0;
                        let minX = Infinity, minY = Infinity;
                        let maxX = -Infinity, maxY = -Infinity;

                        for (const op of ops) {
                            // Extract bounding box from path
                            if (op === 13 || op === 14) { // moveTo, lineTo
                                const px = pathArgs[argIndex++];
                                const py = pathArgs[argIndex++];
                                minX = Math.min(minX, px);
                                minY = Math.min(minY, py);
                                maxX = Math.max(maxX, px);
                                maxY = Math.max(maxY, py);
                            } else if (op === 15) { // curveTo (bezier)
                                argIndex += 6; // Skip 6 args
                            } else if (op === 18) { // rectangle
                                const rx = pathArgs[argIndex++];
                                const ry = pathArgs[argIndex++];
                                const rw = pathArgs[argIndex++];
                                const rh = pathArgs[argIndex++];
                                minX = Math.min(minX, rx);
                                minY = Math.min(minY, ry);
                                maxX = Math.max(maxX, rx + rw);
                                maxY = Math.max(maxY, ry + rh);
                            }
                        }

                        if (minX !== Infinity && maxX !== -Infinity) {
                            currentPath.push({
                                type: 'path',
                                x: minX,
                                y: minY,
                                w: maxX - minX,
                                h: maxY - minY
                            });
                        }
                    }
                    break;

                // Fill operations - commit current path as background
                case OPS.fill:
                case OPS.eoFill:
                case OPS.fillStroke:
                    for (const shape of currentPath) {
                        // Convert PDF coordinates to HTML (top-left origin)
                        const htmlY = viewport.height - shape.y - shape.h;

                        // Filter out very small shapes and pure white backgrounds
                        if (shape.w > 5 && shape.h > 5 && currentFillColor !== '#ffffff') {
                            backgrounds.push({
                                id: `bg_${backgrounds.length}`,
                                type: shape.type,
                                color: currentFillColor,
                                bbox: {
                                    x: Math.round(shape.x * 100) / 100,
                                    y: Math.round(htmlY * 100) / 100,
                                    width: Math.round(shape.w * 100) / 100,
                                    height: Math.round(shape.h * 100) / 100
                                }
                            });
                        }
                    }
                    currentPath = []; // Clear path after fill
                    break;
            }
        }

        console.log(`🎨 Extracted ${backgrounds.length} background elements`);
        console.log(`🎨 Found colors: ${[...foundColors].join(', ') || 'none'}`);
        if (backgrounds.length > 0) {
            console.log(`🎨 First 3 backgrounds:`, backgrounds.slice(0, 3));
        }
        return backgrounds;

    } catch (err) {
        console.warn('Could not extract backgrounds:', err.message);
        return [];
    }
}

/**
 * Determine font weight from font name
 */
function getFontWeight(fontName) {
    if (!fontName) return 'normal';
    const name = fontName.toLowerCase();
    if (name.includes('bold')) return 'bold';
    if (name.includes('heavy') || name.includes('black')) return '900';
    if (name.includes('semibold')) return '600';
    if (name.includes('medium')) return '500';
    if (name.includes('light')) return '300';
    return 'normal';
}

/**
 * Parse PDF and extract structured blocks with coordinates
 * @param {Buffer|string} pdfInput - PDF buffer or file path
 * @returns {Promise<Object>} Parsed structure with pages and blocks
 */
async function parsePdfStructure(pdfInput) {
    await ensurePdfJs();

    // Track PDF file path for Poppler rendering
    let pdfFilePath = null;

    // Load PDF data
    let data;
    if (Buffer.isBuffer(pdfInput)) {
        // Save buffer to temp file for Poppler
        const tempDir = path.join(__dirname, '..', 'uploads', 'temp_pdf');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        pdfFilePath = path.join(tempDir, `temp_${Date.now()}.pdf`);
        fs.writeFileSync(pdfFilePath, pdfInput);
        data = new Uint8Array(pdfInput);
    } else if (typeof pdfInput === 'string') {
        if (pdfInput.startsWith('data:')) {
            // Base64 data URL - save to temp file
            const base64 = pdfInput.replace(/^data:.*?;base64,/, '');
            const buf = Buffer.from(base64, 'base64');
            const tempDir = path.join(__dirname, '..', 'uploads', 'temp_pdf');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            pdfFilePath = path.join(tempDir, `temp_${Date.now()}.pdf`);
            fs.writeFileSync(pdfFilePath, buf);
            data = new Uint8Array(buf);
        } else {
            // File path - use directly for Poppler
            pdfFilePath = pdfInput;
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

        // Render page to image for background (includes colors, graphics, etc.)
        console.log(`\n📄 ========== Processing page ${pageNum} ==========`);
        let backgroundImage = null;
        let aiImage = null; // Compressed version for AI analysis
        let pageCanvas = null; // Canvas for block background extraction

        // PRIORITY 1: Use Poppler for FULL COLOR rendering (for AI analysis)
        if (pdfFilePath) {
            console.log(`🎨 Using Poppler for page ${pageNum}...`);
            aiImage = await renderPageWithPoppler(pdfFilePath, pageNum, 150);
            if (aiImage) {
                console.log(`✅ Poppler: Full color image ready for AI`);
            }
        }

        // PRIORITY 2: Try PDF.js canvas render (for block backgrounds, may be B&W)
        try {
            console.log(`🚀 Rendering page ${pageNum} to canvas (PDF.js)...`);
            pageCanvas = await renderPageToCanvas(page, 2.0);

            if (pageCanvas) {
                console.log(`✅ Page ${pageNum}: Canvas rendered (${pageCanvas.width}x${pageCanvas.height})`);
                backgroundImage = pageCanvas.canvas.toDataURL('image/png');
                console.log(`   📊 Background image: ${backgroundImage.length} chars`);
            }
        } catch (err) {
            console.warn(`⚠️ PDF.js canvas render failed: ${err.message}`);
        }

        // Use Poppler image as background if PDF.js failed
        if (!backgroundImage && aiImage) {
            backgroundImage = aiImage;
        }

        // Fallback: PDF.js renderPageToImage if Poppler failed
        if (!aiImage) {
            try {
                console.log(`🔄 Fallback to PDF.js for AI image...`);
                aiImage = await renderPageToImage(page, 2.0, { forAI: true, quality: 0.8 });
                if (aiImage) {
                    console.log(`✅ Page ${pageNum}: PDF.js AI image rendered (${aiImage.length} chars)`);
                }
            } catch (err) {
                console.error(`❌ All render methods failed for page ${pageNum}`);
            }
        }

        const pageData = {
            pageNumber: pageNum,
            width: viewport.width,
            height: viewport.height,
            backgroundImage: backgroundImage, // Base64 PNG image with all visual elements (null if render failed)
            aiImage: aiImage, // Compressed JPEG for AI analysis
            backgrounds: [], // Extracted background shapes with colors
            blocks: []
        };

        // Extract background shapes (rectangles, colored areas)
        try {
            pageData.backgrounds = await extractBackgrounds(page, viewport);
        } catch (err) {
            console.warn(`⚠️ Could not extract backgrounds for page ${pageNum}:`, err.message);
        }

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

            // Get font properties
            const fontName = item.fontName || '';
            const fontWeight = getFontWeight(fontName);
            const isItalic = /italic|oblique/i.test(fontName);
            const fontStyle = isItalic ? 'italic' : 'normal';

            // Normalize font family
            let fontFamily = 'Inter, system-ui, Arial, sans-serif';
            if (/serif/i.test(fontName) && !/sans/i.test(fontName)) {
                fontFamily = 'Georgia, Times New Roman, serif';
            } else if (/mono|courier|consolas/i.test(fontName)) {
                fontFamily = 'Consolas, Monaco, monospace';
            }

            // Extract background for this block from rendered canvas
            const bbox = {
                x: Math.round(x * 100) / 100,
                y: Math.round(y * 100) / 100,
                width: Math.round(width * 100) / 100,
                height: Math.round(height * 100) / 100
            };

            const blockBg = extractBlockBackground(pageCanvas, bbox, 3);

            pageData.blocks.push({
                id: `block_${pageNum}_${blockId++}`,
                type: 'text',
                text: item.str,
                bbox: bbox,
                font: {
                    family: fontFamily,
                    size: Math.round(fontSize * 100) / 100,
                    weight: fontWeight,
                    style: fontStyle,
                    original: fontName
                },
                transform: transform,
                color: 'transparent', // Text will be transparent, visible through background image
                background: blockBg.color, // Solid background color (if detected)
                backgroundImage: blockBg.imageData // Complex background as data URL
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
 * Convert parsed PDF structure to HTML with background image and transparent selectable text
 * @param {Object} structure - Parsed PDF structure
 * @returns {string} HTML string with positioned, selectable blocks
 */
function convertToHtml(structure) {
    // Add CSS for text selection visibility
    const css = `
        <style>
            .text-block::selection {
                background: rgba(0, 123, 255, 0.3);
                color: #000000 !important;
            }
            .text-block::-moz-selection {
                background: rgba(0, 123, 255, 0.3);
                color: #000000 !important;
            }
        </style>
    `;

    let html = css + '<div class="pdf-container" style="position: relative; background: #f5f5f5; padding: 20px;">\n';

    for (const page of structure.pages) {
        // Build background style
        const bgStyle = page.backgroundImage
            ? `background-image: url('${page.backgroundImage}'); background-size: ${page.width}px ${page.height}px; background-repeat: no-repeat;`
            : 'background: white;';

        // If no background image, make text visible (black)
        const hasBackground = !!page.backgroundImage;
        console.log(`Page has background: ${hasBackground}, length: ${page.backgroundImage ? page.backgroundImage.length : 0}`);

        html += `  <div class="pdf-page" style="width: ${page.width}px; height: ${page.height}px; position: relative; ${bgStyle} border: 1px solid #ccc; margin: 20px auto; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">\n`;

        for (const block of page.blocks) {
            // Use transparent text only if background image exists, otherwise use black
            const textColor = hasBackground ? 'transparent' : '#000000';

            const style = [
                'position: absolute',
                `left: ${block.bbox.x}px`,
                `top: ${block.bbox.y}px`,
                `font-size: ${block.font.size}px`,
                `font-weight: ${block.font.weight}`,
                `font-style: ${block.font.style}`,
                `font-family: ${block.font.family}`,
                'white-space: nowrap',
                `color: ${textColor}`,
                'cursor: text',
                'user-select: text',
                '-webkit-user-select: text',
                '-moz-user-select: text',
                '-ms-user-select: text'
            ].join('; ');

            const fieldType = block.semanticHint || block.fieldType || 'text';
            const dataAttrs = `data-field-type="${fieldType}" data-selectable="true" data-block-id="${block.id || ''}" data-original-text="${escapeHtml(block.text)}"`;

            html += `    <div class="text-block selectable-field" style="${style}" ${dataAttrs}>${escapeHtml(block.text)}</div>\n`;
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
    escapeHtml,
    renderPageToImage,
    extractTextColors,
    getFontWeight,
    rgbToHex
};
