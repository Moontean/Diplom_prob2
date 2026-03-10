// services/convertApiService.js
// ConvertAPI Service - converts PDF to HTML using ConvertAPI cloud service

const fs = require('fs');
const path = require('path');

const CONVERT_API_SECRET = process.env.CONVERT_API_SECRET || '';

/**
 * Convert PDF to HTML using ConvertAPI
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<{html: string, success: boolean, error?: string}>}
 */
async function convertPdfToHtml(pdfPath) {
    if (!CONVERT_API_SECRET) {
        console.error('❌ CONVERT_API_SECRET not set in environment variables');
        return {
            success: false,
            error: 'ConvertAPI не настроен. Добавьте CONVERT_API_SECRET в .env файл.'
        };
    }

    try {
        console.log('📄 Converting PDF to HTML via ConvertAPI:', pdfPath);

        // Read PDF file as base64
        const pdfBuffer = fs.readFileSync(pdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');
        const fileName = path.basename(pdfPath);

        // Prepare request to ConvertAPI
        const requestBody = {
            Parameters: [
                {
                    Name: 'File',
                    FileValue: {
                        Name: fileName,
                        Data: pdfBase64
                    }
                },
                {
                    Name: 'StoreFile',
                    Value: true
                }
            ]
        };

        // Call ConvertAPI
        const response = await fetch(`https://v2.convertapi.com/convert/pdf/to/html?Secret=${CONVERT_API_SECRET}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ ConvertAPI error:', response.status, errorText);
            return {
                success: false,
                error: `ConvertAPI вернул ошибку: ${response.status}`
            };
        }

        const result = await response.json();

        if (!result.Files || result.Files.length === 0) {
            return {
                success: false,
                error: 'ConvertAPI не вернул результат'
            };
        }

        // Get HTML content from the first file (base64 encoded)
        const htmlFile = result.Files[0];
        let htmlContent = '';

        if (htmlFile.FileData) {
            // Decode base64 HTML
            htmlContent = Buffer.from(htmlFile.FileData, 'base64').toString('utf-8');
        } else if (htmlFile.Url) {
            // Download HTML from URL
            const htmlResponse = await fetch(htmlFile.Url);
            htmlContent = await htmlResponse.text();
        }

        console.log('✅ PDF converted successfully, HTML length:', htmlContent.length);

        return {
            success: true,
            html: htmlContent,
            fileName: htmlFile.FileName || 'converted.html'
        };

    } catch (error) {
        console.error('❌ ConvertAPI conversion failed:', error);
        return {
            success: false,
            error: error.message || 'Ошибка конвертации'
        };
    }
}

/**
 * Convert PDF buffer to HTML using ConvertAPI
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {string} fileName - Original file name
 * @returns {Promise<{html: string, success: boolean, error?: string}>}
 */
async function convertPdfBufferToHtml(pdfBuffer, fileName = 'document.pdf') {
    if (!CONVERT_API_SECRET) {
        console.error('❌ CONVERT_API_SECRET not set in environment variables');
        return {
            success: false,
            error: 'ConvertAPI не настроен. Добавьте CONVERT_API_SECRET в .env файл.'
        };
    }

    try {
        console.log('📄 Converting PDF buffer to HTML via ConvertAPI');

        const pdfBase64 = pdfBuffer.toString('base64');

        const requestBody = {
            Parameters: [
                {
                    Name: 'File',
                    FileValue: {
                        Name: fileName,
                        Data: pdfBase64
                    }
                },
                {
                    Name: 'StoreFile',
                    Value: true
                }
            ]
        };

        const response = await fetch(`https://v2.convertapi.com/convert/pdf/to/html?Secret=${CONVERT_API_SECRET}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ ConvertAPI error:', response.status, errorText);
            return {
                success: false,
                error: `ConvertAPI вернул ошибку: ${response.status}`
            };
        }

        const result = await response.json();

        if (!result.Files || result.Files.length === 0) {
            return {
                success: false,
                error: 'ConvertAPI не вернул результат'
            };
        }

        const htmlFile = result.Files[0];
        let htmlContent = '';

        if (htmlFile.FileData) {
            htmlContent = Buffer.from(htmlFile.FileData, 'base64').toString('utf-8');
        } else if (htmlFile.Url) {
            const htmlResponse = await fetch(htmlFile.Url);
            htmlContent = await htmlResponse.text();
        }

        console.log('✅ PDF buffer converted successfully, HTML length:', htmlContent.length);

        return {
            success: true,
            html: htmlContent,
            fileName: htmlFile.FileName || 'converted.html'
        };

    } catch (error) {
        console.error('❌ ConvertAPI conversion failed:', error);
        return {
            success: false,
            error: error.message || 'Ошибка конвертации'
        };
    }
}

/**
 * Post-process ConvertAPI HTML for better editing experience
 * - Fixes SVG stacking order
 * - Adds data attributes for color editing
 * - Ensures text is selectable and editable
 * @param {string} html - Raw HTML from ConvertAPI
 * @returns {string} Processed HTML
 */
function postProcessConvertedHtml(html) {
    // Add wrapper and styles for color editing
    const enhancedHtml = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PDF Конвертер - Редактор цвета</title>
    <style>
        /* Base styles */
        body {
            margin: 0;
            padding: 20px;
            background: #f0f0f0;
            font-family: Arial, sans-serif;
        }
        
        .converted-content {
            background: white;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin: 0 auto;
            position: relative;
        }
        
        /* Fix SVG stacking - SVG backgrounds go behind text */
        .converted-content svg.graphic,
        .converted-content svg[class*="background"],
        .converted-content svg:not([class*="icon"]) {
            position: absolute !important;
            z-index: -2 !important;
            pointer-events: none !important;
        }
        
        .converted-content > div {
            position: relative;
        }
        
        /* Ensure text is always on top */
        .converted-content span,
        .converted-content p,
        .converted-content div:not(:has(svg)) {
            position: relative;
            z-index: 1;
        }
        
        /* Color editing mode styles */
        .color-edit-mode .editable-element:hover {
            outline: 2px dashed #2196F3 !important;
            outline-offset: 2px;
            cursor: pointer;
        }
        
        .color-edit-mode .editable-element.selected {
            outline: 3px solid #2196F3 !important;
            outline-offset: 2px;
            box-shadow: 0 0 10px rgba(33, 150, 243, 0.3);
        }
        
        /* Color picker popup */
        .color-picker-popup {
            position: fixed;
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.25);
            padding: 16px;
            z-index: 10000;
            min-width: 220px;
            font-family: Arial, sans-serif;
        }
        
        .color-picker-popup h4 {
            margin: 0 0 12px 0;
            font-size: 14px;
            color: #333;
        }
        
        .color-picker-row {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
            gap: 10px;
        }
        
        .color-picker-row label {
            flex: 0 0 100px;
            font-size: 13px;
            color: #666;
        }
        
        .color-picker-row input[type="color"] {
            width: 50px;
            height: 30px;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
            padding: 0;
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
        
        .color-picker-popup .close-btn:hover {
            color: #333;
        }
        
        /* Toolbar styles */
        .color-editor-toolbar {
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            padding: 10px 20px;
            display: flex;
            gap: 12px;
            align-items: center;
            z-index: 9999;
            font-family: Arial, sans-serif;
        }
        
        .color-editor-toolbar button {
            background: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .color-editor-toolbar button:hover {
            background: #e8e8e8;
        }
        
        .color-editor-toolbar button.active {
            background: #2196F3;
            color: white;
            border-color: #1976D2;
        }
        
        .color-editor-toolbar button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .color-editor-toolbar .separator {
            width: 1px;
            height: 30px;
            background: #ddd;
        }
    </style>
</head>
<body>
    <!-- Toolbar -->
    <div class="color-editor-toolbar">
        <button id="toggle-edit-mode" title="Включить/выключить режим редактирования цвета">
            🎨 Режим редактирования
        </button>
        <div class="separator"></div>
        <button id="undo-btn" disabled title="Отменить последнее изменение">
            ↩️ Отменить
        </button>
        <button id="redo-btn" disabled title="Повторить отменённое изменение">
            ↪️ Повторить
        </button>
        <div class="separator"></div>
        <button id="download-html-btn" title="Скачать результат">
            💾 Скачать HTML
        </button>
    </div>

    <!-- Converted content wrapper -->
    <div class="converted-content" id="converted-content">
        ${extractBodyContent(html)}
    </div>

    <!-- Color picker popup (hidden by default) -->
    <div class="color-picker-popup" id="color-picker-popup" style="display: none;">
        <button class="close-btn" id="close-picker">&times;</button>
        <h4>Изменить цвета</h4>
        <div class="color-picker-row">
            <label>Цвет фона:</label>
            <input type="color" id="bg-color-picker" value="#ffffff">
        </div>
        <div class="color-picker-row">
            <label>Цвет текста:</label>
            <input type="color" id="text-color-picker" value="#000000">
        </div>
    </div>

    <script>
        ${getColorEditorScript()}
    </script>
</body>
</html>`;

    return enhancedHtml;
}

/**
 * Extract body content from full HTML document
 */
function extractBodyContent(html) {
    // Try to extract just the body content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
        return bodyMatch[1];
    }
    // If no body tag, return as-is (might be a fragment)
    return html;
}

/**
 * Get the color editor JavaScript code
 */
function getColorEditorScript() {
    return `
(function() {
    'use strict';
    
    // State
    let isEditMode = false;
    let selectedElement = null;
    let history = [];
    let historyIndex = -1;
    const MAX_HISTORY = 50;
    
    // Elements
    const content = document.getElementById('converted-content');
    const toggleBtn = document.getElementById('toggle-edit-mode');
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    const downloadBtn = document.getElementById('download-html-btn');
    const colorPicker = document.getElementById('color-picker-popup');
    const bgColorInput = document.getElementById('bg-color-picker');
    const textColorInput = document.getElementById('text-color-picker');
    const closePickerBtn = document.getElementById('close-picker');
    
    // Initialize
    fixSvgStacking();
    makeElementsEditable();
    
    // Event listeners
    toggleBtn.addEventListener('click', toggleEditMode);
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    downloadBtn.addEventListener('click', downloadHtml);
    closePickerBtn.addEventListener('click', () => hideColorPicker());
    
    bgColorInput.addEventListener('input', function() {
        if (selectedElement) {
            applyBackgroundColor(selectedElement, this.value);
        }
    });
    
    textColorInput.addEventListener('input', function() {
        if (selectedElement) {
            applyTextColor(selectedElement, this.value);
        }
    });
    
    // Close picker on outside click
    document.addEventListener('click', function(e) {
        if (colorPicker.style.display !== 'none' && 
            !colorPicker.contains(e.target) && 
            e.target !== selectedElement &&
            !e.target.closest('.editable-element')) {
            hideColorPicker();
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            undo();
        }
        if (e.ctrlKey && e.key === 'y') {
            e.preventDefault();
            redo();
        }
        if (e.key === 'Escape') {
            deselectAll();
            hideColorPicker();
        }
    });
    
    /**
     * Fix SVG stacking - ensure SVG backgrounds are behind text
     */
    function fixSvgStacking() {
        console.log('🔧 Fixing SVG stacking...');
        
        const svgs = content.querySelectorAll('svg');
        svgs.forEach(svg => {
            // Check if this SVG looks like a background (large, positioned absolutely)
            const rect = svg.getBoundingClientRect();
            const isLarge = rect.width > 100 || rect.height > 100;
            const hasGraphicClass = svg.classList.contains('graphic') || 
                                   svg.className.includes('background');
            
            if (isLarge || hasGraphicClass) {
                svg.style.position = 'absolute';
                svg.style.zIndex = '-2';
                svg.style.pointerEvents = 'none';
                
                // Ensure parent has relative positioning
                const parent = svg.parentElement;
                if (parent && getComputedStyle(parent).position === 'static') {
                    parent.style.position = 'relative';
                }
            }
        });
        
        console.log('✅ SVG stacking fixed');
    }
    
    /**
     * Make elements editable for color changes
     */
    function makeElementsEditable() {
        // Add editable class to text elements and blocks
        const textElements = content.querySelectorAll('span, p, div, h1, h2, h3, h4, h5, h6, li, td, th');
        textElements.forEach(el => {
            // Skip SVGs and their children
            if (el.closest('svg')) return;
            // Skip empty elements
            if (!el.textContent.trim() && !el.querySelector('*')) return;
            
            el.classList.add('editable-element');
            el.dataset.originalBg = getComputedStyle(el).backgroundColor;
            el.dataset.originalColor = getComputedStyle(el).color;
        });
        
        // Also make SVG paths editable (for background fills)
        const svgPaths = content.querySelectorAll('svg path, svg rect, svg circle, svg polygon');
        svgPaths.forEach(el => {
            el.classList.add('editable-element');
            el.dataset.originalFill = el.getAttribute('fill') || getComputedStyle(el).fill;
        });
    }
    
    /**
     * Toggle color edit mode
     */
    function toggleEditMode() {
        isEditMode = !isEditMode;
        content.classList.toggle('color-edit-mode', isEditMode);
        toggleBtn.classList.toggle('active', isEditMode);
        toggleBtn.textContent = isEditMode ? '✅ Режим редактирования' : '🎨 Режим редактирования';
        
        if (isEditMode) {
            content.addEventListener('click', handleElementClick);
        } else {
            content.removeEventListener('click', handleElementClick);
            deselectAll();
            hideColorPicker();
        }
    }
    
    /**
     * Handle click on editable element
     */
    function handleElementClick(e) {
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
    }
    
    /**
     * Select an element
     */
    function selectElement(el) {
        deselectAll();
        el.classList.add('selected');
        selectedElement = el;
        
        // Update color picker values
        const bgColor = rgbToHex(getComputedStyle(el).backgroundColor);
        const textColor = rgbToHex(getComputedStyle(el).color);
        
        bgColorInput.value = bgColor || '#ffffff';
        textColorInput.value = textColor || '#000000';
    }
    
    /**
     * Deselect all elements
     */
    function deselectAll() {
        document.querySelectorAll('.editable-element.selected').forEach(el => {
            el.classList.remove('selected');
        });
        selectedElement = null;
    }
    
    /**
     * Show color picker near clicked position
     */
    function showColorPicker(x, y, target) {
        colorPicker.style.display = 'block';
        
        // Position the picker
        const pickerRect = colorPicker.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let left = x + 10;
        let top = y + 10;
        
        // Adjust if going off screen
        if (left + pickerRect.width > viewportWidth) {
            left = x - pickerRect.width - 10;
        }
        if (top + pickerRect.height > viewportHeight) {
            top = y - pickerRect.height - 10;
        }
        
        colorPicker.style.left = Math.max(10, left) + 'px';
        colorPicker.style.top = Math.max(10, top) + 'px';
    }
    
    /**
     * Hide color picker
     */
    function hideColorPicker() {
        colorPicker.style.display = 'none';
    }
    
    /**
     * Apply background color to element
     */
    function applyBackgroundColor(el, color) {
        saveToHistory();
        
        // Check if it's an SVG element
        if (el.tagName === 'path' || el.tagName === 'rect' || 
            el.tagName === 'circle' || el.tagName === 'polygon') {
            // For SVG shapes, apply to parent div instead
            const parentDiv = el.closest('div');
            if (parentDiv) {
                parentDiv.style.backgroundColor = color;
            }
        } else {
            el.style.backgroundColor = color;
        }
        
        // Auto-adjust text color for contrast
        ensureTextContrast(el, color);
    }
    
    /**
     * Apply text color to element
     */
    function applyTextColor(el, color) {
        saveToHistory();
        
        // Check if it's an SVG text element
        if (el.closest('svg')) {
            el.style.fill = color;
            // Also update stroke if needed
            const textElements = el.querySelectorAll('text, tspan');
            textElements.forEach(t => {
                t.style.fill = color;
            });
        } else {
            el.style.color = color;
            // Also update child spans
            el.querySelectorAll('span').forEach(span => {
                span.style.color = color;
            });
        }
    }
    
    /**
     * Ensure text remains readable against background
     */
    function ensureTextContrast(el, bgColor) {
        const luminance = getColorLuminance(bgColor);
        const isDark = luminance < 0.5;
        
        // Get all text elements within this element
        const textElements = el.querySelectorAll('span, p, div');
        const allElements = [el, ...textElements];
        
        allElements.forEach(textEl => {
            const currentColor = rgbToHex(getComputedStyle(textEl).color);
            const currentLuminance = getColorLuminance(currentColor);
            
            // Check contrast ratio
            const contrastRatio = (Math.max(luminance, currentLuminance) + 0.05) / 
                                 (Math.min(luminance, currentLuminance) + 0.05);
            
            // WCAG AA requires 4.5:1 for normal text
            if (contrastRatio < 4.5) {
                // Switch to black or white based on background
                const newColor = isDark ? '#ffffff' : '#000000';
                if (!textEl.closest('svg')) {
                    textEl.style.color = newColor;
                } else {
                    textEl.style.fill = newColor;
                }
            }
        });
    }
    
    /**
     * Calculate relative luminance of a color
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
     * Convert RGB string to hex
     */
    function rgbToHex(rgb) {
        if (!rgb) return '#ffffff';
        if (rgb.startsWith('#')) return rgb;
        
        const match = rgb.match(/\\d+/g);
        if (!match || match.length < 3) return '#ffffff';
        
        const [r, g, b] = match.map(Number);
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }
    
    /**
     * Convert hex to RGB object
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
     * Save current state to history
     */
    function saveToHistory() {
        const state = content.innerHTML;
        
        // Remove any future states if we're in the middle of history
        history = history.slice(0, historyIndex + 1);
        
        history.push(state);
        historyIndex = history.length - 1;
        
        // Limit history size
        if (history.length > MAX_HISTORY) {
            history.shift();
            historyIndex--;
        }
        
        updateHistoryButtons();
    }
    
    /**
     * Undo last change
     */
    function undo() {
        if (historyIndex > 0) {
            historyIndex--;
            content.innerHTML = history[historyIndex];
            fixSvgStacking();
            makeElementsEditable();
            deselectAll();
            hideColorPicker();
            updateHistoryButtons();
        }
    }
    
    /**
     * Redo undone change
     */
    function redo() {
        if (historyIndex < history.length - 1) {
            historyIndex++;
            content.innerHTML = history[historyIndex];
            fixSvgStacking();
            makeElementsEditable();
            deselectAll();
            hideColorPicker();
            updateHistoryButtons();
        }
    }
    
    /**
     * Update undo/redo button states and notify parent
     */
    function updateHistoryButtons() {
        undoBtn.disabled = historyIndex <= 0;
        redoBtn.disabled = historyIndex >= history.length - 1;
        
        // Notify parent window about history state
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'history-update',
                canUndo: historyIndex > 0,
                canRedo: historyIndex < history.length - 1
            }, '*');
        }
    }
    
    function insertElementFromParent(type) {
        if (!content) return;
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
            case 'bulleted-list':
                el = document.createElement('ul');
                var li1 = document.createElement('li');
                li1.textContent = 'Пункт списка 1';
                var li2 = document.createElement('li');
                li2.textContent = 'Пункт списка 2';
                el.appendChild(li1);
                el.appendChild(li2);
                break;
            case 'highlight-box':
                el = document.createElement('div');
                el.style.margin = '12px 0';
                el.style.padding = '12px 16px';
                el.style.background = '#eff6ff';
                el.style.borderRadius = '8px';
                el.textContent = 'Важный блок. Используйте его для выделения ключевой информации.';
                break;
        }
        if (!el) return;
        el.classList.add('editable-element');
        content.appendChild(el);
        makeElementsEditable();
        deselectAll();
        hideColorPicker();
        saveToHistory();
    }
    
    /**
     * Listen for commands from parent window
     */
    window.addEventListener('message', function(event) {
        const data = event.data;
        if (!data || !data.type) return;
        
        switch (data.type) {
            case 'toggle-edit-mode':
                toggleEditMode();
                break;
            case 'undo':
                undo();
                break;
            case 'redo':
                redo();
                break;
            case 'download':
                downloadHtml();
                break;
            case 'get-html':
                sendHtmlToParent();
                break;
            case 'insert-element':
                insertElementFromParent(data.elementType);
                break;
        }
    });
    
    /**
     * Send clean HTML to parent
     */
    function sendHtmlToParent() {
        const clone = content.cloneNode(true);
        clone.querySelectorAll('.editable-element').forEach(el => {
            el.classList.remove('editable-element', 'selected');
        });
        clone.classList.remove('color-edit-mode');
        
        const htmlContent = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Converted PDF</title></head><body>' + 
                           clone.innerHTML + '</body></html>';
        
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'html-content',
                html: htmlContent
            }, '*');
        }
    }
    
    /**
     * Download the edited HTML
     */
    function downloadHtml() {
        // Get clean HTML without editing classes
        const clone = content.cloneNode(true);
        clone.querySelectorAll('.editable-element').forEach(el => {
            el.classList.remove('editable-element', 'selected');
        });
        clone.classList.remove('color-edit-mode');
        
        const htmlContent = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Converted PDF</title></head><body>' + 
                           clone.innerHTML + '</body></html>';
        
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'edited-document.html';
        a.click();
        
        URL.revokeObjectURL(url);
    }
    
    // Save initial state
    saveToHistory();
    
    console.log('🎨 Color editor initialized');
})();
`;
}

/**
 * Convert PDF to PNG images using ConvertAPI (pixel-perfect)
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<{images: Array, success: boolean, error?: string}>}
 */
async function convertPdfToImages(pdfPath) {
    if (!CONVERT_API_SECRET) {
        console.error('❌ CONVERT_API_SECRET not set');
        return { success: false, error: 'ConvertAPI не настроен. Добавьте CONVERT_API_SECRET в .env файл.' };
    }

    try {
        console.log('🖼️ Converting PDF to PNG images via ConvertAPI:', pdfPath);

        const pdfBuffer = fs.readFileSync(pdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');
        const fileName = path.basename(pdfPath);

        const requestBody = {
            Parameters: [
                { Name: 'File', FileValue: { Name: fileName, Data: pdfBase64 } },
                { Name: 'StoreFile', Value: true },
                { Name: 'ImageResolution', Value: 300 },
                { Name: 'ImageHeight', Value: 2000 }
            ]
        };

        const response = await fetch(`https://v2.convertapi.com/convert/pdf/to/png?Secret=${CONVERT_API_SECRET}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ ConvertAPI error:', response.status, errorText);
            return { success: false, error: `ConvertAPI вернул ошибку: ${response.status}` };
        }

        const result = await response.json();

        if (!result.Files || result.Files.length === 0) {
            return { success: false, error: 'ConvertAPI не вернул результат' };
        }

        const images = [];
        for (let i = 0; i < result.Files.length; i++) {
            const file = result.Files[i];
            let imageData = '';

            if (file.FileData) {
                imageData = file.FileData;
            } else if (file.Url) {
                const imgResponse = await fetch(file.Url);
                const imgBuffer = await imgResponse.arrayBuffer();
                imageData = Buffer.from(imgBuffer).toString('base64');
            }

            images.push({
                data: `data:image/png;base64,${imageData}`,
                page: i + 1,
                fileName: file.FileName || `page-${i + 1}.png`
            });
        }

        console.log(`✅ PDF converted to ${images.length} PNG images`);

        return { success: true, images, pageCount: images.length };

    } catch (error) {
        console.error('❌ ConvertAPI image conversion failed:', error);
        return { success: false, error: error.message || 'Ошибка конвертации' };
    }
}

/**
 * Create HTML editor with image-based rendering (pixel-perfect)
 * @param {Array} images - Array of base64 image data
 * @returns {string} HTML with image editor
 */
function createImageEditor(images) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PDF Editor - Pixel Perfect</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            min-height: 100vh;
        }
        .toolbar {
            position: fixed; top: 0; left: 0; right: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 12px 20px;
            display: flex; gap: 12px; align-items: center;
            z-index: 1000;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            flex-wrap: wrap;
        }
        .toolbar-section {
            display: flex; gap: 8px; align-items: center;
            padding: 0 15px;
            border-right: 1px solid rgba(255,255,255,0.2);
        }
        .toolbar-section:last-child { border-right: none; }
        .toolbar-label { color: rgba(255,255,255,0.8); font-size: 12px; font-weight: 500; }
        .btn {
            padding: 8px 16px; border: none; border-radius: 6px;
            cursor: pointer; font-size: 14px; font-weight: 500;
            transition: all 0.2s;
            display: flex; align-items: center; gap: 6px;
        }
        .btn-tool { background: rgba(255,255,255,0.15); color: white; }
        .btn-tool:hover { background: rgba(255,255,255,0.25); }
        .btn-tool.active { background: white; color: #667eea; }
        .btn-primary { background: white; color: #667eea; }
        .btn-primary:hover { background: #f0f0f0; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .color-group {
            display: flex; align-items: center; gap: 8px;
            background: rgba(255,255,255,0.1);
            padding: 6px 10px; border-radius: 6px;
        }
        .color-group input[type="color"] {
            width: 36px; height: 36px;
            border: 2px solid white; border-radius: 6px;
            cursor: pointer; padding: 0;
        }
        .color-group span { color: white; font-size: 12px; }
        .blend-select, .opacity-slider {
            padding: 8px 12px; border-radius: 6px; border: none;
            background: rgba(255,255,255,0.15); color: white;
            font-size: 14px; cursor: pointer;
        }
        .blend-select option { background: #333; color: white; }
        .opacity-slider { width: 100px; }
        .pages-container {
            margin-top: 80px;
            display: flex; flex-direction: column; align-items: center;
            gap: 30px; padding: 30px 20px 50px;
        }
        .page-wrapper {
            position: relative; background: white;
            box-shadow: 0 10px 40px rgba(0,0,0,0.4);
            border-radius: 4px; overflow: hidden;
        }
        .page-image { display: block; max-width: 100%; height: auto; }
        .color-overlay {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0;
            pointer-events: none; mix-blend-mode: multiply;
            background: transparent;
        }
        .overlay-region {
            position: absolute; background: transparent;
            cursor: crosshair; transition: all 0.2s;
        }
        .overlay-region:hover { outline: 2px dashed #667eea; }
        .overlay-region.selected {
            outline: 3px solid #667eea;
            box-shadow: 0 0 10px rgba(102, 126, 234, 0.5);
        }
        .drawing-mode .page-wrapper { cursor: crosshair; }
        .drawing-region {
            position: absolute;
            border: 2px dashed #667eea;
            background: rgba(102, 126, 234, 0.1);
            pointer-events: none;
        }
        .page-number {
            position: absolute; bottom: 10px; right: 10px;
            background: rgba(0,0,0,0.7); color: white;
            padding: 4px 12px; border-radius: 4px; font-size: 12px;
        }
        .instructions {
            position: fixed; bottom: 20px; left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.85); color: white;
            padding: 12px 24px; border-radius: 8px;
            font-size: 13px; z-index: 1000;
        }
        .instructions kbd {
            background: rgba(255,255,255,0.2);
            padding: 2px 8px; border-radius: 4px; margin: 0 4px;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-section">
            <span class="toolbar-label">Инструменты:</span>
            <button class="btn btn-tool" id="select-btn">👆 Выбор</button>
            <button class="btn btn-tool active" id="draw-btn">✏️ Рисовать</button>
            <button class="btn btn-tool" id="full-btn">🎨 Вся страница</button>
        </div>
        <div class="toolbar-section">
            <span class="toolbar-label">Цвет:</span>
            <div class="color-group">
                <input type="color" id="overlay-color" value="#3498db">
                <span>Заливка</span>
            </div>
            <select class="blend-select" id="blend-mode">
                <option value="multiply">Multiply (затемнение)</option>
                <option value="screen">Screen (осветление)</option>
                <option value="overlay">Overlay</option>
                <option value="color">Color (замена)</option>
                <option value="hue">Hue (оттенок)</option>
                <option value="normal">Normal</option>
            </select>
            <input type="range" class="opacity-slider" id="opacity" min="0" max="100" value="30">
            <span id="opacity-val" style="color:white;font-size:12px;min-width:35px;">30%</span>
        </div>
        <div class="toolbar-section">
            <button class="btn btn-tool" id="undo-btn" disabled>↩️ Отменить</button>
            <button class="btn btn-tool" id="redo-btn" disabled>↪️ Повторить</button>
            <button class="btn btn-tool" id="clear-btn">🗑️ Очистить</button>
        </div>
        <div class="toolbar-section">
            <button class="btn btn-primary" id="download-btn">📥 Скачать</button>
        </div>
    </div>
    
    <div class="pages-container" id="pages">
        ${images.map((img, i) => `
            <div class="page-wrapper" data-page="${i + 1}">
                <img src="${img.data}" alt="Page ${i + 1}" class="page-image">
                <div class="color-overlay" data-page="${i + 1}"></div>
                <div class="page-number">Страница ${i + 1} / ${images.length}</div>
            </div>
        `).join('')}
    </div>
    
    <div class="instructions">
        <kbd>Рисовать</kbd> — нарисуйте прямоугольник для цветового наложения |
        <kbd>Ctrl+Z</kbd> отменить |
        <kbd>Delete</kbd> удалить регион
    </div>
    
    <script>
    (function() {
        let tool = 'draw';
        let selectedRegion = null;
        let regions = [];
        let isDrawing = false;
        let drawStart = null;
        let drawEl = null;
        let history = [];
        let historyIdx = -1;
        let regionId = 0;
        
        const selectBtn = document.getElementById('select-btn');
        const drawBtn = document.getElementById('draw-btn');
        const fullBtn = document.getElementById('full-btn');
        const colorInput = document.getElementById('overlay-color');
        const blendSelect = document.getElementById('blend-mode');
        const opacitySlider = document.getElementById('opacity');
        const opacityVal = document.getElementById('opacity-val');
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        const clearBtn = document.getElementById('clear-btn');
        const downloadBtn = document.getElementById('download-btn');
        
        saveHistory();
        
        selectBtn.onclick = () => setTool('select');
        drawBtn.onclick = () => setTool('draw');
        
        function setTool(t) {
            tool = t;
            selectBtn.classList.toggle('active', t === 'select');
            drawBtn.classList.toggle('active', t === 'draw');
            document.body.classList.toggle('drawing-mode', t === 'draw');
        }
        
        fullBtn.onclick = () => {
            const color = colorInput.value;
            const blend = blendSelect.value;
            const opacity = opacitySlider.value / 100;
            document.querySelectorAll('.color-overlay').forEach(o => {
                o.style.background = color;
                o.style.mixBlendMode = blend;
                o.style.opacity = opacity;
            });
            saveHistory();
        };
        
        opacitySlider.oninput = () => {
            opacityVal.textContent = opacitySlider.value + '%';
            if (selectedRegion) {
                const r = regions.find(x => x.id === selectedRegion);
                if (r) { r.opacity = opacitySlider.value / 100; updateRegion(r); saveHistory(); }
            }
        };
        
        colorInput.oninput = () => {
            if (selectedRegion) {
                const r = regions.find(x => x.id === selectedRegion);
                if (r) { r.color = colorInput.value; updateRegion(r); saveHistory(); }
            }
        };
        
        blendSelect.onchange = () => {
            if (selectedRegion) {
                const r = regions.find(x => x.id === selectedRegion);
                if (r) { r.blend = blendSelect.value; updateRegion(r); saveHistory(); }
            }
        };
        
        document.querySelectorAll('.page-wrapper').forEach(page => {
            page.onmousedown = e => {
                if (tool !== 'draw') return;
                const rect = page.getBoundingClientRect();
                isDrawing = true;
                drawStart = { x: e.clientX - rect.left, y: e.clientY - rect.top, page };
                drawEl = document.createElement('div');
                drawEl.className = 'drawing-region';
                drawEl.style.left = drawStart.x + 'px';
                drawEl.style.top = drawStart.y + 'px';
                page.appendChild(drawEl);
            };
            
            page.onmousemove = e => {
                if (!isDrawing || !drawEl) return;
                const rect = page.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const w = x - drawStart.x;
                const h = y - drawStart.y;
                drawEl.style.width = Math.abs(w) + 'px';
                drawEl.style.height = Math.abs(h) + 'px';
                drawEl.style.left = (w < 0 ? x : drawStart.x) + 'px';
                drawEl.style.top = (h < 0 ? y : drawStart.y) + 'px';
            };
            
            page.onmouseup = e => {
                if (!isDrawing || !drawEl) return;
                const rect = page.getBoundingClientRect();
                const imgRect = page.querySelector('.page-image').getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const left = Math.min(drawStart.x, x);
                const top = Math.min(drawStart.y, y);
                const w = Math.abs(x - drawStart.x);
                const h = Math.abs(y - drawStart.y);
                
                drawEl.remove(); drawEl = null; isDrawing = false;
                
                if (w > 10 && h > 10) {
                    const region = {
                        id: ++regionId,
                        pageNum: parseInt(page.dataset.page),
                        x: (left / imgRect.width) * 100,
                        y: (top / imgRect.height) * 100,
                        w: (w / imgRect.width) * 100,
                        h: (h / imgRect.height) * 100,
                        color: colorInput.value,
                        blend: blendSelect.value,
                        opacity: opacitySlider.value / 100
                    };
                    regions.push(region);
                    createRegionEl(region, page);
                    saveHistory();
                }
            };
            
            page.onmouseleave = () => {
                if (drawEl) { drawEl.remove(); drawEl = null; }
                isDrawing = false;
            };
        });
        
        function createRegionEl(r, page) {
            const el = document.createElement('div');
            el.className = 'overlay-region';
            el.dataset.regionId = r.id;
            el.style.left = r.x + '%';
            el.style.top = r.y + '%';
            el.style.width = r.w + '%';
            el.style.height = r.h + '%';
            el.style.background = r.color;
            el.style.mixBlendMode = r.blend;
            el.style.opacity = r.opacity;
            el.style.pointerEvents = 'auto';
            el.onclick = e => { e.stopPropagation(); selectRegionEl(r.id); };
            page.appendChild(el);
        }
        
        function updateRegion(r) {
            const el = document.querySelector('[data-region-id="' + r.id + '"]');
            if (el) {
                el.style.background = r.color;
                el.style.mixBlendMode = r.blend;
                el.style.opacity = r.opacity;
            }
        }
        
        function selectRegionEl(id) {
            document.querySelectorAll('.overlay-region.selected').forEach(e => e.classList.remove('selected'));
            selectedRegion = id;
            const el = document.querySelector('[data-region-id="' + id + '"]');
            if (el) el.classList.add('selected');
            const r = regions.find(x => x.id === id);
            if (r) {
                colorInput.value = r.color;
                blendSelect.value = r.blend;
                opacitySlider.value = r.opacity * 100;
                opacityVal.textContent = Math.round(r.opacity * 100) + '%';
            }
        }
        
        function deleteRegion(id) {
            regions = regions.filter(x => x.id !== id);
            const el = document.querySelector('[data-region-id="' + id + '"]');
            if (el) el.remove();
            if (selectedRegion === id) selectedRegion = null;
            saveHistory();
        }
        
        clearBtn.onclick = () => {
            if (confirm('Удалить все наложения?')) {
                regions = [];
                document.querySelectorAll('.overlay-region').forEach(e => e.remove());
                document.querySelectorAll('.color-overlay').forEach(e => e.style.background = 'transparent');
                selectedRegion = null;
                saveHistory();
            }
        };
        
        function saveHistory() {
            const state = {
                regions: JSON.parse(JSON.stringify(regions)),
                overlays: Array.from(document.querySelectorAll('.color-overlay')).map(e => ({
                    page: e.dataset.page,
                    bg: e.style.background,
                    blend: e.style.mixBlendMode,
                    opacity: e.style.opacity
                }))
            };
            history = history.slice(0, historyIdx + 1);
            history.push(state);
            historyIdx = history.length - 1;
            if (history.length > 50) { history.shift(); historyIdx--; }
            updateHistoryBtns();
        }
        
        function restoreState(s) {
            document.querySelectorAll('.overlay-region').forEach(e => e.remove());
            regions = JSON.parse(JSON.stringify(s.regions));
            regionId = Math.max(0, ...regions.map(r => r.id));
            regions.forEach(r => {
                const page = document.querySelector('.page-wrapper[data-page="' + r.pageNum + '"]');
                if (page) createRegionEl(r, page);
            });
            s.overlays.forEach(o => {
                const el = document.querySelector('.color-overlay[data-page="' + o.page + '"]');
                if (el) {
                    el.style.background = o.bg;
                    el.style.mixBlendMode = o.blend;
                    el.style.opacity = o.opacity;
                }
            });
            selectedRegion = null;
        }
        
        function undo() { if (historyIdx > 0) { historyIdx--; restoreState(history[historyIdx]); updateHistoryBtns(); } }
        function redo() { if (historyIdx < history.length - 1) { historyIdx++; restoreState(history[historyIdx]); updateHistoryBtns(); } }
        function updateHistoryBtns() {
            undoBtn.disabled = historyIdx <= 0;
            redoBtn.disabled = historyIdx >= history.length - 1;
        }
        
        undoBtn.onclick = undo;
        redoBtn.onclick = redo;
        
        document.onkeydown = e => {
            if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
            else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
            else if (e.key === 'Delete' && selectedRegion) deleteRegion(selectedRegion);
            else if (e.key === 'Escape') {
                document.querySelectorAll('.overlay-region.selected').forEach(e => e.classList.remove('selected'));
                selectedRegion = null;
            }
        };
        
        downloadBtn.onclick = () => {
            const html = generateExport();
            const blob = new Blob([html], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'edited-document.html';
            a.click();
        };
        
        function generateExport() {
            let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Edited PDF</title><style>';
            html += 'body{margin:0;padding:20px;background:#f5f5f5;display:flex;flex-direction:column;align-items:center;gap:20px;}';
            html += '.page{position:relative;background:white;box-shadow:0 2px 10px rgba(0,0,0,0.1);}';
            html += '.page img{display:block;max-width:100%;}';
            html += '.layer,.region{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;}';
            html += '.region{top:auto;left:auto;right:auto;bottom:auto;}';
            html += '</style></head><body>';
            
            document.querySelectorAll('.page-wrapper').forEach((page, i) => {
                const img = page.querySelector('.page-image');
                const overlay = page.querySelector('.color-overlay');
                const pageNum = page.dataset.page;
                
                html += '<div class="page">';
                html += '<img src="' + img.src + '" alt="Page ' + (i+1) + '">';
                
                if (overlay.style.background && overlay.style.background !== 'transparent') {
                    html += '<div class="layer" style="background:' + overlay.style.background + ';mix-blend-mode:' + (overlay.style.mixBlendMode||'multiply') + ';opacity:' + (overlay.style.opacity||1) + ';"></div>';
                }
                
                regions.filter(r => r.pageNum === parseInt(pageNum)).forEach(r => {
                    html += '<div class="region" style="left:' + r.x + '%;top:' + r.y + '%;width:' + r.w + '%;height:' + r.h + '%;background:' + r.color + ';mix-blend-mode:' + r.blend + ';opacity:' + r.opacity + ';"></div>';
                });
                
                html += '</div>';
            });
            
            html += '</body></html>';
            return html;
        }
        
        window.addEventListener('message', e => {
            if (!e.data || !e.data.type) return;
            if (e.data.type === 'undo') undo();
            else if (e.data.type === 'redo') redo();
            else if (e.data.type === 'download') downloadBtn.click();
        });
        
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'history-update', canUndo: false, canRedo: false }, '*');
        }
        
        console.log('🖼️ Image-based PDF editor loaded');
    })();
    </script>
</body>
</html>`;
}

module.exports = {
    convertPdfToHtml,
    convertPdfBufferToHtml,
    postProcessConvertedHtml,
    convertPdfToImages,
    createImageEditor
};
