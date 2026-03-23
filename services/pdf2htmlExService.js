// services/pdf2htmlExService.js
// PDF to HTML conversion using pdf2htmlEX (pixel-perfect conversion)

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const execPromise = util.promisify(exec);

// Configuration
const USE_DOCKER = process.env.PDF2HTMLEX_DOCKER !== 'false'; // Use Docker by default
const DOCKER_IMAGE = process.env.PDF2HTMLEX_DOCKER_IMAGE || 'pdf2htmlex/pdf2htmlex:0.18.8.rc2-master-20200820-ubuntu-20.04-x86_64';
const PDF2HTMLEX_PATH = process.env.PDF2HTMLEX_PATH || 'pdf2htmlEX';

/**
 * Convert Windows path to Docker-compatible path
 */
function toDockerPath(winPath) {
    // D:\folder\file.pdf -> /d/folder/file.pdf
    return winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, letter) => `/${letter.toLowerCase()}`);
}

/**
 * Check if pdf2htmlEX is available (Docker or native)
 */
async function checkPdf2htmlEx() {
    try {
        if (USE_DOCKER) {
            // Check if Docker is available and image exists
            const { stdout } = await execPromise('docker images --format "{{.Repository}}:{{.Tag}}"');
            if (stdout.includes('pdf2htmlex')) {
                return { available: true, mode: 'docker' };
            } else {
                return {
                    available: false,
                    error: 'Docker образ pdf2htmlEX не найден. Выполните: docker pull pdf2htmlex/pdf2htmlex:0.18.8.rc2-master-20200820-ubuntu-20.04-x86_64'
                };
            }
        } else {
            await execPromise(`${PDF2HTMLEX_PATH} --version`);
            return { available: true, mode: 'native' };
        }
    } catch (error) {
        return {
            available: false,
            error: USE_DOCKER
                ? 'Docker не доступен или образ pdf2htmlEX не установлен'
                : 'pdf2htmlEX не найден. Установите его или используйте Docker'
        };
    }
}

/**
 * Convert PDF to HTML using pdf2htmlEX
 * @param {string} pdfPath - Path to the PDF file
 * @param {Object} options - Conversion options
 * @returns {Promise<{html: string, success: boolean, error?: string}>}
 */
async function convertPdfToHtml(pdfPath, options = {}) {
    const {
        zoom = 1.3,
        embedFont = true,
        embedImage = true,
        embedCss = true,
        embedJs = true,
        splitPages = false,
        destDir = null
    } = options;

    try {
        console.log('📄 Converting PDF to HTML via pdf2htmlEX:', pdfPath);

        // Create output directory - use absolute path
        const absolutePdfPath = path.resolve(pdfPath);
        const pdfDir = path.dirname(absolutePdfPath);
        const outputDir = destDir || path.join(pdfDir, 'pdf2html_output');

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const baseName = path.basename(pdfPath, '.pdf');
        const outputFile = path.join(outputDir, `${baseName}.html`);

        let result;

        if (USE_DOCKER) {
            // Docker execution
            const dockerPdfDir = toDockerPath(pdfDir);
            const dockerOutputDir = toDockerPath(outputDir);
            const pdfFileName = path.basename(pdfPath);

            // Build Docker command
            const dockerArgs = [
                'run', '--rm',
                '-v', `${dockerPdfDir}:/pdf:ro`,
                '-v', `${dockerOutputDir}:/output`,
                DOCKER_IMAGE,
                `--zoom=${zoom}`,
                embedFont ? '--embed-font=1' : '--embed-font=0',
                embedImage ? '--embed-image=1' : '--embed-image=0',
                embedCss ? '--embed-css=1' : '--embed-css=0',
                embedJs ? '--embed-javascript=1' : '--embed-javascript=0',
                splitPages ? '--split-pages=1' : '--split-pages=0',
                '--process-outline=0',
                '--printing=0',
                '--dest-dir=/output',
                `/pdf/${pdfFileName}`
            ];

            result = await new Promise((resolve, reject) => {
                const proc = spawn('docker', dockerArgs);
                let stdout = '';
                let stderr = '';

                proc.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                proc.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve({ stdout, stderr });
                    } else {
                        reject(new Error(`pdf2htmlEX (Docker) exited with code ${code}: ${stderr}`));
                    }
                });

                proc.on('error', (err) => {
                    reject(err);
                });
            });
        } else {
            // Native execution
            const args = [
                `--zoom=${zoom}`,
                embedFont ? '--embed-font=1' : '--embed-font=0',
                embedImage ? '--embed-image=1' : '--embed-image=0',
                embedCss ? '--embed-css=1' : '--embed-css=0',
                embedJs ? '--embed-javascript=1' : '--embed-javascript=0',
                splitPages ? '--split-pages=1' : '--split-pages=0',
                '--process-outline=0',
                '--printing=0',
                `--dest-dir=${outputDir}`,
                absolutePdfPath
            ];

            result = await new Promise((resolve, reject) => {
                const proc = spawn(PDF2HTMLEX_PATH, args);
                let stdout = '';
                let stderr = '';

                proc.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                proc.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve({ stdout, stderr });
                    } else {
                        reject(new Error(`pdf2htmlEX exited with code ${code}: ${stderr}`));
                    }
                });

                proc.on('error', (err) => {
                    reject(err);
                });
            });
        }

        // Read the generated HTML
        if (!fs.existsSync(outputFile)) {
            // Try to find any HTML file in outputDir
            const files = fs.readdirSync(outputDir);
            const htmlFile = files.find(f => f.endsWith('.html'));
            if (htmlFile) {
                const altOutputFile = path.join(outputDir, htmlFile);
                let htmlContent = fs.readFileSync(altOutputFile, 'utf-8');
                console.log('✅ PDF converted successfully, HTML length:', htmlContent.length);
                return {
                    success: true,
                    html: htmlContent,
                    outputPath: altOutputFile,
                    outputDir: outputDir
                };
            }
            throw new Error('HTML file was not generated');
        }

        let htmlContent = fs.readFileSync(outputFile, 'utf-8');
        console.log('✅ PDF converted successfully, HTML length:', htmlContent.length);

        return {
            success: true,
            html: htmlContent,
            outputPath: outputFile,
            outputDir: outputDir
        };

    } catch (error) {
        console.error('❌ pdf2htmlEX conversion failed:', error);
        return {
            success: false,
            error: error.message || 'Ошибка конвертации'
        };
    }
}

/**
 * Convert PDF buffer to HTML
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {string} fileName - Original file name
 * @param {Object} options - Conversion options
 */
async function convertPdfBufferToHtml(pdfBuffer, fileName = 'document.pdf', options = {}) {
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'pdf_temp');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const tempPdfPath = path.join(uploadsDir, `temp_${Date.now()}_${fileName}`);

    try {
        // Write buffer to temp file
        fs.writeFileSync(tempPdfPath, pdfBuffer);

        // Convert
        const result = await convertPdfToHtml(tempPdfPath, options);

        // Clean up temp PDF
        fs.unlinkSync(tempPdfPath);

        return result;
    } catch (error) {
        // Clean up on error
        if (fs.existsSync(tempPdfPath)) {
            fs.unlinkSync(tempPdfPath);
        }
        throw error;
    }
}

/**
 * Post-process HTML for color editing
 * @param {string} html - Raw HTML from pdf2htmlEX
 * @returns {string} Processed HTML with color editor
 */
function postProcessHtml(html) {
    // Extract body content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;

    // Extract style content
    const styleMatches = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
    const styles = styleMatches.join('\n');

    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PDF Editor</title>
    ${styles}
    <style>
        /* Color Editor Styles */
        * {
            box-sizing: border-box;
        }
        
        body {
            margin: 0;
            padding: 0;
            background: #1a1a2e;
            min-height: 100vh;
        }
        
        .editor-toolbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 12px 20px;
            display: flex;
            gap: 12px;
            align-items: center;
            z-index: 10000;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            flex-wrap: wrap;
        }
        
        .toolbar-section {
            display: flex;
            gap: 8px;
            align-items: center;
            padding: 0 15px;
            border-right: 1px solid rgba(255,255,255,0.2);
        }
        
        .toolbar-section:last-child {
            border-right: none;
        }
        
        .toolbar-label {
            color: rgba(255,255,255,0.8);
            font-size: 12px;
            font-weight: 500;
        }
        
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .btn-tool {
            background: rgba(255,255,255,0.15);
            color: white;
        }
        
        .btn-tool:hover {
            background: rgba(255,255,255,0.25);
        }
        
        .btn-tool.active {
            background: white;
            color: #667eea;
        }
        
        .btn-primary {
            background: white;
            color: #667eea;
        }
        
        .btn-primary:hover {
            background: #f0f0f0;
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .color-picker-group {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(255,255,255,0.1);
            padding: 6px 10px;
            border-radius: 6px;
        }
        
        .color-picker-group input[type="color"] {
            width: 36px;
            height: 36px;
            border: 2px solid white;
            border-radius: 6px;
            cursor: pointer;
            padding: 0;
        }
        
        .color-picker-group span {
            color: white;
            font-size: 12px;
        }
        
        .content-wrapper {
            margin-top: 70px;
            padding: 30px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        
        /* Make pdf2htmlEX content visible and editable */
        #page-container, .pc, .pf {
            background: white !important;
            box-shadow: 0 10px 40px rgba(0,0,0,0.4);
            margin-bottom: 30px;
            position: relative;
        }
        
        /* Editable elements */
        .editable-element {
            cursor: pointer;
            transition: outline 0.2s;
        }
        
        .editable-element:hover {
            outline: 2px dashed rgba(102, 126, 234, 0.5);
        }
        
        .editable-element.selected {
            outline: 3px solid #667eea !important;
            box-shadow: 0 0 10px rgba(102, 126, 234, 0.3);
        }
        
        .color-edit-mode .editable-element {
            cursor: crosshair;
        }
        
        /* Color picker popup */
        .color-picker-popup {
            position: fixed;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            padding: 16px;
            z-index: 10001;
            display: none;
            min-width: 200px;
        }
        
        .color-picker-popup h4 {
            margin: 0 0 12px 0;
            color: #333;
            font-size: 14px;
        }
        
        .color-picker-popup .color-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }
        
        .color-picker-popup .color-row label {
            width: 80px;
            font-size: 13px;
            color: #666;
        }
        
        .color-picker-popup .color-row input[type="color"] {
            width: 40px;
            height: 32px;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .color-picker-popup .close-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            color: #999;
        }

        /* Delete handle for editable elements */
        .editable-delete {
            position: absolute;
            top: -8px;
            right: -8px;
            width: 18px;
            height: 18px;
            border-radius: 999px;
            background: #f97373;
            border: 1px solid #b91c1c;
            color: white;
            font-size: 12px;
            line-height: 16px;
            text-align: center;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s ease, transform 0.15s ease;
            transform: scale(0.9);
        }

        .color-edit-mode .editable-element:hover .editable-delete,
        .color-edit-mode .editable-element.selected .editable-delete {
            opacity: 1;
            pointer-events: auto;
            transform: scale(1);
        }

        /* SVG fixes */
        svg {
            pointer-events: auto !important;
        }
        
        .instructions-bar {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.85);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 13px;
            z-index: 10000;
        }
        
        .instructions-bar kbd {
            background: rgba(255,255,255,0.2);
            padding: 2px 8px;
            border-radius: 4px;
            font-family: monospace;
            margin: 0 4px;
        }
        
        .resize-touchbar {
            position: fixed;
            display: none;
            width: 14px;
            height: 14px;
            border-radius: 999px;
            background: #ffffff;
            border: 2px solid #3b82f6;
            box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.4);
            z-index: 11000;
            cursor: se-resize;
        }
    </style>
</head>
<body>
    <div class="editor-toolbar">
        <div class="toolbar-section">
            <button class="btn btn-tool active" id="toggle-edit-btn">
                🎨 Режим редактирования
            </button>
        </div>
        
        <div class="toolbar-section">
            <div class="color-picker-group">
                <input type="color" id="bg-color" value="#ffffff">
                <span>Фон</span>
            </div>
            <div class="color-picker-group">
                <input type="color" id="text-color" value="#000000">
                <span>Текст</span>
            </div>
            <div class="color-picker-group">
                <select id="font-size-select">
                    <option value="12px">12</option>
                    <option value="14px">14</option>
                    <option value="16px" selected>16</option>
                    <option value="18px">18</option>
                    <option value="20px">20</option>
                    <option value="24px">24</option>
                    <option value="28px">28</option>
                    <option value="32px">32</option>
                </select>
                <span>Размер</span>
            </div>
        </div>
        
        <div class="toolbar-section">
            <button class="btn btn-tool" id="undo-btn" disabled>
                ↩️ Отменить
            </button>
            <button class="btn btn-tool" id="redo-btn" disabled>
                ↪️ Повторить
            </button>
        </div>
        
        <div class="toolbar-section">
            <button class="btn btn-primary" id="download-btn">
                📥 Скачать HTML
            </button>
        </div>
    </div>
    
    <div class="content-wrapper" id="content-wrapper">
        ${bodyContent}
    </div>
    
    <div class="color-picker-popup" id="color-picker-popup">
        <button class="close-btn" id="close-picker">×</button>
        <h4>Изменить цвета</h4>
        <div class="color-row">
            <label>Фон:</label>
            <input type="color" id="popup-bg-color" value="#ffffff">
        </div>
        <div class="color-row">
            <label>Текст:</label>
            <input type="color" id="popup-text-color" value="#000000">
        </div>
    </div>
    
    <div class="instructions-bar">
        <kbd>Клик</kbd> выбрать элемент |
        <kbd>Ctrl+Z</kbd> отменить |
        <kbd>Ctrl+Y</kbd> повторить |
        <kbd>Esc</kbd> снять выделение
    </div>
    
    <div class="resize-touchbar" id="resize-touchbar"></div>
    
    <script>
    (function() {
        // State
        let isEditMode = true;
        let selectedElement = null;
        let history = [];
        let historyIndex = -1;
        const MAX_HISTORY = 50;

        // Drag state for user-inserted blocks
        let isDragging = false;
        let dragElement = null;
        let dragStartX = 0;
        let dragStartY = 0;
        let elemStartLeft = 0;
        let elemStartTop = 0;

        // Resize state for user-inserted blocks
        let isResizing = false;
        let resizeStartX = 0;
        let resizeStartY = 0;
        let resizeStartWidth = 0;
        let resizeStartHeight = 0;
        let resizeElement = null;
        
        // DOM
        const contentWrapper = document.getElementById('content-wrapper');
        const toggleBtn = document.getElementById('toggle-edit-btn');
        const bgColorInput = document.getElementById('bg-color');
        const textColorInput = document.getElementById('text-color');
        const fontSizeSelect = document.getElementById('font-size-select');
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        const downloadBtn = document.getElementById('download-btn');
        const colorPickerPopup = document.getElementById('color-picker-popup');
        const resizeBar = document.getElementById('resize-touchbar');
        const popupBgColor = document.getElementById('popup-bg-color');
        const popupTextColor = document.getElementById('popup-text-color');
        const closePicker = document.getElementById('close-picker');
        
        // Initialize
        makeElementsEditable();
        // Разрешаем редактирование текста во всём содержимом
        if (contentWrapper) {
            contentWrapper.contentEditable = 'true';
        }
        saveToHistory();
        
        if (resizeBar) {
            resizeBar.addEventListener('mousedown', (e) => {
                if (!selectedElement || selectedElement.dataset.draggable !== 'true') return;

                const rect = selectedElement.getBoundingClientRect();

                isResizing = true;
                resizeElement = selectedElement;
                resizeStartX = e.clientX;
                resizeStartY = e.clientY;
                resizeStartWidth = rect.width;
                resizeStartHeight = rect.height;

                document.addEventListener('mousemove', onResizeMove);
                document.addEventListener('mouseup', onResizeEnd);

                e.preventDefault();
                e.stopPropagation();
            });
        }
        
        /**
         * Make elements editable
         */
        function makeElementsEditable() {
            // Target pdf2htmlEX elements
            const selectors = [
                '.t', // text spans
                '.c', // characters
                'div[class^="p"]', // positioned divs
                '.ff0', '.ff1', '.ff2', '.ff3', '.ff4', '.ff5', // font spans
                'span[style*="color"]',
                'div[style*="background"]',
                'h1, h2, h3, h4, h5, h6',
                'p', 'ul', 'li',
                '.pc', '.pf', // page containers
                'svg rect', 'svg path', 'svg polygon', 'svg circle'
            ];
            
            const elements = contentWrapper.querySelectorAll(selectors.join(', '));
            
            elements.forEach(el => {
                // Skip if too small or empty
                if (!el.textContent?.trim() && !el.querySelector('*') && el.tagName !== 'rect' && el.tagName !== 'path') {
                    return;
                }
                
                el.classList.add('editable-element');
                // Разрешаем прямое редактирование текста для не-SVG элементов
                if (!(el.tagName === 'rect' || el.tagName === 'path' || el.tagName === 'polygon' || el.tagName === 'circle')) {
                    el.contentEditable = 'true';
                }
                
                // Store original styles
                const computed = getComputedStyle(el);
                el.dataset.originalBg = computed.backgroundColor;
                el.dataset.originalColor = computed.color;
                
                // For SVG elements
                if (el.tagName === 'rect' || el.tagName === 'path' || el.tagName === 'polygon' || el.tagName === 'circle') {
                    el.dataset.originalFill = el.getAttribute('fill') || computed.fill;
                }
            });
            
            console.log('✅ Made', elements.length, 'elements editable');
            attachDeleteHandles();
        }

        function attachDeleteHandles() {
            const elements = contentWrapper.querySelectorAll('.editable-element');
            elements.forEach(el => {
                if (el.querySelector('.editable-delete')) return;

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'editable-delete';
                btn.textContent = '×';
                btn.setAttribute('aria-label', 'Удалить блок');
                btn.contentEditable = 'false';

                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    e.preventDefault();
                    if (selectedElement === el) {
                        deselectAll();
                    }
                    el.remove();
                    saveToHistory();
                });

                const computedPos = getComputedStyle(el).position;
                if (computedPos === 'static') {
                    el.style.position = 'relative';
                }

                el.appendChild(btn);
            });
        }
        
        /**
         * Toggle edit mode
         */
        toggleBtn.addEventListener('click', () => {
            isEditMode = !isEditMode;
            toggleBtn.classList.toggle('active', isEditMode);
            toggleBtn.textContent = isEditMode ? '✅ Режим редактирования' : '🎨 Режим редактирования';
            contentWrapper.classList.toggle('color-edit-mode', isEditMode);
            
            if (!isEditMode) {
                deselectAll();
                hideColorPicker();
            }
        });
        
        /**
         * Handle element click
         */
        contentWrapper.addEventListener('click', (e) => {
            if (!isEditMode) return;
            
            const target = e.target.closest('.editable-element');
            if (!target) {
                deselectAll();
                hideColorPicker();
                return;
            }
            
            e.stopPropagation();
            selectElement(target);
            showColorPicker(e.clientX, e.clientY, target);
        });
        
        /**
         * Select element
         */
        function selectElement(el) {
            deselectAll();
            el.classList.add('selected');
            selectedElement = el;
            
            // Update toolbar colors
            const bgColor = rgbToHex(getComputedStyle(el).backgroundColor);
            const textColor = rgbToHex(getComputedStyle(el).color);
            
            bgColorInput.value = bgColor || '#ffffff';
            textColorInput.value = textColor || '#000000';
            popupBgColor.value = bgColor || '#ffffff';
            popupTextColor.value = textColor || '#000000';

            if (fontSizeSelect) {
                const computedSize = getComputedStyle(el).fontSize || '16px';
                fontSizeSelect.value = computedSize;
            }
            
            updateResizeBarPosition();
            placeCaretAtEnd(el);
        }

        function placeCaretAtEnd(el) {
            if (!el) return;
            if (typeof el.focus === 'function') {
                el.focus();
            }
            const selection = window.getSelection && window.getSelection();
            if (!selection || !document.createRange) return;
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }
        
        /**
         * Deselect all
         */
        function deselectAll() {
            document.querySelectorAll('.editable-element.selected').forEach(el => {
                el.classList.remove('selected');
            });
            selectedElement = null;
            if (resizeBar) {
                resizeBar.style.display = 'none';
            }
        }
        
        /**
         * Show color picker popup
         */
        function showColorPicker(x, y, target) {
            colorPickerPopup.style.display = 'block';
            
            // Position
            const rect = colorPickerPopup.getBoundingClientRect();
            let left = x + 10;
            let top = y + 10;
            
            if (left + rect.width > window.innerWidth) {
                left = x - rect.width - 10;
            }
            if (top + rect.height > window.innerHeight) {
                top = y - rect.height - 10;
            }
            
            colorPickerPopup.style.left = Math.max(10, left) + 'px';
            colorPickerPopup.style.top = Math.max(10, top) + 'px';
        }
        
        /**
         * Hide color picker
         */
        function hideColorPicker() {
            colorPickerPopup.style.display = 'none';
        }
        
        closePicker.addEventListener('click', hideColorPicker);
        
        function updateResizeBarPosition() {
            if (!resizeBar) return;
            if (!selectedElement || selectedElement.dataset.draggable !== 'true') {
                resizeBar.style.display = 'none';
                return;
            }
            
            resizeBar.style.display = 'block';
            
            const rect = selectedElement.getBoundingClientRect();
            const barRect = resizeBar.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            let left = rect.left + rect.width / 2 - barRect.width / 2;
            let top = rect.bottom + 8;
            
            if (top + barRect.height > viewportHeight - 8) {
                top = rect.top - barRect.height - 8;
            }
            
            left = Math.max(8, Math.min(viewportWidth - barRect.width - 8, left));
            
            resizeBar.style.left = left + 'px';
            resizeBar.style.top = top + 'px';
        }
        
        /**
         * Apply background color
         */
        function applyBgColor(color) {
            if (!selectedElement) return;
            saveToHistory();
            
            // For SVG elements
            if (selectedElement.tagName === 'rect' || selectedElement.tagName === 'path' || 
                selectedElement.tagName === 'polygon' || selectedElement.tagName === 'circle') {
                selectedElement.setAttribute('fill', color);
            } else {
                selectedElement.style.backgroundColor = color;
            }
            
            // Auto-adjust text contrast
            ensureTextContrast(selectedElement, color);
        }
        
        /**
         * Apply text color
         */
        function applyTextColor(color) {
            if (!selectedElement) return;
            saveToHistory();
            
            if (selectedElement.closest('svg')) {
                selectedElement.style.fill = color;
            } else {
                selectedElement.style.color = color;
                // Also update child text
                selectedElement.querySelectorAll('span, .t, .c').forEach(child => {
                    child.style.color = color;
                });
            }
        }

        function applyFontSize(size) {
            if (!selectedElement) return;
            saveToHistory();

            selectedElement.style.fontSize = size;
            selectedElement.querySelectorAll('span, .t, .c').forEach(child => {
                child.style.fontSize = size;
            });
        }
        
        // Color input handlers
        bgColorInput.addEventListener('input', (e) => applyBgColor(e.target.value));
        textColorInput.addEventListener('input', (e) => applyTextColor(e.target.value));
        popupBgColor.addEventListener('input', (e) => {
            bgColorInput.value = e.target.value;
            applyBgColor(e.target.value);
        });
        popupTextColor.addEventListener('input', (e) => {
            textColorInput.value = e.target.value;
            applyTextColor(e.target.value);
        });

        if (fontSizeSelect) {
            fontSizeSelect.addEventListener('change', (e) => {
                applyFontSize(e.target.value);
            });
        }
        
        /**
         * Ensure text contrast (WCAG AA)
         */
        function ensureTextContrast(el, bgColor) {
            const luminance = getColorLuminance(bgColor);
            const isDark = luminance < 0.5;
            
            const textElements = el.querySelectorAll('span, .t, .c');
            const allElements = [el, ...textElements];
            
            allElements.forEach(textEl => {
                const currentColor = rgbToHex(getComputedStyle(textEl).color);
                const currentLuminance = getColorLuminance(currentColor);
                
                const contrastRatio = (Math.max(luminance, currentLuminance) + 0.05) / 
                                     (Math.min(luminance, currentLuminance) + 0.05);
                
                if (contrastRatio < 4.5) {
                    const newColor = isDark ? '#ffffff' : '#000000';
                    textEl.style.color = newColor;
                }
            });
        }
        
        /**
         * Get color luminance
         */
        function getColorLuminance(hex) {
            const rgb = hexToRgb(hex);
            if (!rgb) return 0.5;
            
            const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(v => {
                v /= 255;
                return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            });
            
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        
        /**
         * RGB to Hex
         */
        function rgbToHex(rgb) {
            if (!rgb) return '#ffffff';
            if (rgb.startsWith('#')) return rgb;
            if (rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return '#ffffff';
            
            const match = rgb.match(/\\d+/g);
            if (!match || match.length < 3) return '#ffffff';
            
            const [r, g, b] = match.map(Number);
            return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
        }
        
        /**
         * Hex to RGB
         */
        function hexToRgb(hex) {
            const result = /^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : null;
        }
        
        /**
         * History management
         */
        function saveToHistory() {
            const state = contentWrapper.innerHTML;
            
            history = history.slice(0, historyIndex + 1);
            history.push(state);
            historyIndex = history.length - 1;
            
            if (history.length > MAX_HISTORY) {
                history.shift();
                historyIndex--;
            }
            
            updateHistoryButtons();
            notifyParent();
        }
        
        function undo() {
            if (historyIndex > 0) {
                historyIndex--;
                contentWrapper.innerHTML = history[historyIndex];
                makeElementsEditable();
                deselectAll();
                hideColorPicker();
                updateHistoryButtons();
                notifyParent();
            }
        }
        
        function redo() {
            if (historyIndex < history.length - 1) {
                historyIndex++;
                contentWrapper.innerHTML = history[historyIndex];
                makeElementsEditable();
                deselectAll();
                hideColorPicker();
                updateHistoryButtons();
                notifyParent();
            }
        }
        
        function updateHistoryButtons() {
            undoBtn.disabled = historyIndex <= 0;
            redoBtn.disabled = historyIndex >= history.length - 1;
        }
        
        undoBtn.addEventListener('click', undo);
        redoBtn.addEventListener('click', redo);
        
        function onDragMove(e) {
            if (!isDragging || !dragElement) return;
            const parent = dragElement.parentElement;
            if (!parent) return;

            const parentRect = parent.getBoundingClientRect();
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;

            let newLeft = elemStartLeft + (dx / parentRect.width) * 100;
            let newTop = elemStartTop + (dy / parentRect.height) * 100;

            newLeft = Math.max(0, Math.min(100, newLeft));
            newTop = Math.max(0, Math.min(100, newTop));

            dragElement.style.left = newLeft + '%';
            dragElement.style.top = newTop + '%';
        }

        function onDragEnd() {
            if (!isDragging || !dragElement) return;
            isDragging = false;
            dragElement = null;
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragEnd);
            saveToHistory();
            updateResizeBarPosition();
        }

        function onResizeMove(e) {
            if (!isResizing || !resizeElement) return;

            const dx = e.clientX - resizeStartX;
            const dy = e.clientY - resizeStartY;

            const widthFactor = (resizeStartWidth + dx) / resizeStartWidth;
            const heightFactor = (resizeStartHeight + dy) / resizeStartHeight;

            let factor = Math.max(widthFactor, heightFactor);
            factor = Math.max(0.5, Math.min(2.0, factor));

            resizeElement.style.transformOrigin = 'top left';
            resizeElement.style.transform = 'scale(' + factor + ')';
            resizeElement.dataset.scale = String(factor);

            updateResizeBarPosition();
        }

        function onResizeEnd() {
            if (!isResizing || !resizeElement) return;
            isResizing = false;
            resizeElement = null;
            document.removeEventListener('mousemove', onResizeMove);
            document.removeEventListener('mouseup', onResizeEnd);
            saveToHistory();
        }
        
        /**
         * Download HTML
         */
        downloadBtn.addEventListener('click', () => {
            const clone = contentWrapper.cloneNode(true);
            clone.querySelectorAll('.editable-element').forEach(el => {
                el.classList.remove('editable-element', 'selected');
            });
            
            // Get styles from head
            const styles = document.head.querySelectorAll('style');
            let styleContent = '';
            styles.forEach(s => {
                // Skip editor-specific styles
                if (!s.textContent.includes('.editor-toolbar')) {
                    styleContent += s.outerHTML;
                }
            });
            
            const htmlContent = \`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Edited Document</title>
\${styleContent}
</head>
<body>
\${clone.innerHTML}
</body>
</html>\`;

            // If running inside the pdf-converter iframe, let parent handle download
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'download-ready',
                    html: htmlContent,
                    fileName: 'resume-template.html'
                }, '*');
            } else {
                // Fallback: direct download when opened standalone
                const blob = new Blob([htmlContent], { type: 'text/html' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                a.download = 'edited-document.html';
                a.click();

                URL.revokeObjectURL(url);
            }
        });
        
        /**
         * Parent communication
         */
        function notifyParent() {
            if (window.parent !== window) {
                window.parent.postMessage({
                    type: 'history-update',
                    canUndo: historyIndex > 0,
                    canRedo: historyIndex < history.length - 1
                }, '*');
            }
        }
        
        function insertElementFromParent(type) {
            var el = null;
            switch (type) {
                case 'heading':
                    el = document.createElement('h2');
                    el.textContent = 'Новый заголовок';
                    break;
                case 'subheading':
                    el = document.createElement('h3');
                    el.textContent = 'Новый подзаголовок';
                    break;
                case 'paragraph':
                    el = document.createElement('p');
                    el.textContent = 'Новый абзац текста. Замените этот текст на свой.';
                    break;
                case 'bulleted-list': {
                    el = document.createElement('ul');
                    var li1 = document.createElement('li');
                    li1.textContent = 'Пункт списка 1';
                    var li2 = document.createElement('li');
                    li2.textContent = 'Пункт списка 2';
                    el.appendChild(li1);
                    el.appendChild(li2);
                    break;
                }
                case 'highlight-box': {
                    el = document.createElement('div');
                    el.style.margin = '12px 0';
                    el.style.padding = '12px 16px';
                    el.style.background = '#eff6ff';
                    el.style.borderRadius = '8px';
                    el.textContent = 'Важный блок. Используйте его для выделения ключевой информации.';
                    break;
                }
                case 'image-box': {
                    el = document.createElement('div');
                    el.style.width = '140px';
                    el.style.height = '140px';
                    el.style.borderRadius = '12px';
                    el.style.border = '2px dashed #9ca3af';
                    el.style.background = '#f9fafb';
                    el.style.display = 'flex';
                    el.style.alignItems = 'center';
                    el.style.justifyContent = 'center';
                    el.style.overflow = 'hidden';

                    var label = document.createElement('span');
                    label.textContent = 'Нажми, чтобы добавить фото';
                    label.style.fontSize = '11px';
                    label.style.color = '#6b7280';
                    label.style.textAlign = 'center';
                    label.style.padding = '8px';
                    label.style.pointerEvents = 'none';

                    el.appendChild(label);

                    el.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.style.display = 'none';
                        input.addEventListener('change', function () {
                            var file = input.files && input.files[0];
                            if (!file) return;
                            var reader = new FileReader();
                            reader.onload = function (ev) {
                                el.innerHTML = '';
                                var img = document.createElement('img');
                                img.src = ev.target && ev.target.result ? ev.target.result : '';
                                img.style.width = '100%';
                                img.style.height = '100%';
                                img.style.objectFit = 'cover';
                                el.appendChild(img);
                                saveToHistory();
                            };
                            reader.readAsDataURL(file);
                        });
                        document.body.appendChild(input);
                        input.click();
                        setTimeout(function () { input.remove(); }, 0);
                    });
                    break;
                }
                case 'tag-pill': {
                    el = document.createElement('span');
                    el.textContent = 'Новый тег';
                    el.style.display = 'inline-block';
                    el.style.padding = '4px 10px';
                    el.style.borderRadius = '999px';
                    el.style.background = '#e0f2fe';
                    el.style.color = '#0369a1';
                    el.style.fontSize = '11px';
                    el.style.fontWeight = '500';
                    break;
                }
            }
            if (!el) return;
            el.classList.add('editable-element');
            // mark as draggable overlay block
            el.dataset.draggable = 'true';

            // Insert into the main PDF page container so it appears on the canvas
            var targetContainer = null;
            var pageCandidates = contentWrapper.querySelectorAll('#page-container, .pc, .pf');
            if (pageCandidates.length > 0) {
                // Use the last page so new content appears on the last visible sheet
                targetContainer = pageCandidates[pageCandidates.length - 1];
            } else {
                targetContainer = contentWrapper.firstElementChild || contentWrapper;
            }

            // Ensure relative positioning so absolutely positioned overlays anchor correctly
            var currentPos = window.getComputedStyle(targetContainer).position;
            if (!currentPos || currentPos === 'static') {
                targetContainer.style.position = 'relative';
            }

            // Overlay new element on the page instead of pushing content down
            el.style.position = 'absolute';
            el.style.left = '10%';
            el.style.top = '10%';
            el.style.maxWidth = '80%';

            targetContainer.appendChild(el);
            makeElementsEditable();
            deselectAll();
            selectElement(el);
            if (typeof el.scrollIntoView === 'function') {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            hideColorPicker();
            saveToHistory();
        }
        
        function insertAssessmentResult(data) {
            var el = document.createElement('div');
            el.className = 'editable-element';
            el.dataset.draggable = 'true';

            var targetContainer = null;
            var pageCandidates = contentWrapper.querySelectorAll('#page-container, .pc, .pf');
            if (pageCandidates.length > 0) {
                targetContainer = pageCandidates[pageCandidates.length - 1];
            } else {
                targetContainer = contentWrapper.firstElementChild || contentWrapper;
            }

            var currentPos = window.getComputedStyle(targetContainer).position;
            if (!currentPos || currentPos === 'static') {
                targetContainer.style.position = 'relative';
            }

            el.style.position = 'absolute';
            el.style.left = '8%';
            el.style.top = '8%';
            el.style.maxWidth = '84%';
            el.style.padding = '14px 18px';
            el.style.background = '#ecfdf5';
            el.style.border = '1px solid #6ee7b7';
            el.style.borderRadius = '10px';
            el.style.fontSize = '13px';

            var title = document.createElement('div');
            title.textContent = 'Результаты AI-теста на профпригодность';
            title.style.fontWeight = '600';
            title.style.marginBottom = '6px';

            var summary = document.createElement('div');
            summary.textContent = data && data.summary ? data.summary : '';
            summary.style.marginBottom = '4px';

            var hint = document.createElement('div');
            hint.textContent = 'Совет: отметьте в резюме сильные стороны и области для развития на основе этого теста.';
            hint.style.fontSize = '12px';
            hint.style.color = '#4b5563';

            el.appendChild(title);
            if (data && data.summary) el.appendChild(summary);
            el.appendChild(hint);

            targetContainer.appendChild(el);
            makeElementsEditable();
            deselectAll();
            selectElement(el);
            if (typeof el.scrollIntoView === 'function') {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            hideColorPicker();
            saveToHistory();
        }
        
        window.addEventListener('message', (e) => {
            const data = e.data;
            if (!data || !data.type) return;
            
            switch (data.type) {
                case 'toggle-edit-mode':
                    toggleBtn.click();
                    break;
                case 'undo':
                    undo();
                    break;
                case 'redo':
                    redo();
                    break;
                case 'download':
                    downloadBtn.click();
                    break;
                case 'insert-element':
                    insertElementFromParent(data.elementType);
                    break;
                case 'insert-assessment-result':
                    insertAssessmentResult(data.result);
                    break;
                case 'insert-assessment-result':
                    insertAssessmentResult(data.result);
                    break;
            }
        });
        
        window.addEventListener('resize', updateResizeBarPosition);
        
        console.log('🎨 pdf2htmlEX color editor initialized');
    })();
    </script>
</body>
</html>`;
}

module.exports = {
    checkPdf2htmlEx,
    convertPdfToHtml,
    convertPdfBufferToHtml,
    postProcessHtml
};
