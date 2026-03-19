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

        .resize-touchbar {
            position: fixed;
            top: 0;
            left: 0;
            width: 0;
            height: 0;
            display: none;
            z-index: 11000;
            pointer-events: none;
        }

        .resize-handle {
            position: fixed;
            width: 12px;
            height: 12px;
            border-radius: 999px;
            background: #ffffff;
            border: 2px solid #3b82f6;
            box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.4);
            pointer-events: auto;
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

    <div class="resize-touchbar" id="resize-touchbar">
        <div class="resize-handle" data-pos="nw"></div>
        <div class="resize-handle" data-pos="n"></div>
        <div class="resize-handle" data-pos="ne"></div>
        <div class="resize-handle" data-pos="e"></div>
        <div class="resize-handle" data-pos="se"></div>
        <div class="resize-handle" data-pos="s"></div>
        <div class="resize-handle" data-pos="sw"></div>
        <div class="resize-handle" data-pos="w"></div>
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
        <div class="color-picker-row">
            <label>Размер текста:</label>
            <select id="font-size-picker">
                <option value="12px">12</option>
                <option value="14px">14</option>
                <option value="16px" selected>16</option>
                <option value="18px">18</option>
                <option value="20px">20</option>
                <option value="24px">24</option>
                <option value="28px">28</option>
                <option value="32px">32</option>
            </select>
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

    // Drag state for user-inserted elements
    let isDragging = false;
    let dragElement = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let elemStartLeft = 0;
    let elemStartTop = 0;

    // Resize state for user-inserted elements
    let isResizing = false;
    let resizeStartX = 0;
    let resizeStartY = 0;
    let resizeStartWidth = 0;
    let resizeStartHeight = 0;
    let resizeElement = null;
    let resizeHandlePos = null;
    
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
    const fontSizePicker = document.getElementById('font-size-picker');
    const resizeBar = document.getElementById('resize-touchbar');
    const resizeHandles = resizeBar ? Array.from(resizeBar.querySelectorAll('.resize-handle')) : [];
    
    // Initialize
    fixSvgStacking();
    makeElementsEditable();
    // Allow direct text editing inside converted content
    if (content) {
        content.contentEditable = 'true';
    }
    
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

    if (fontSizePicker) {
        fontSizePicker.addEventListener('change', function() {
            if (selectedElement) {
                applyFontSize(selectedElement, this.value);
            }
        });
    }

    if (resizeHandles.length) {
        resizeHandles.forEach(handle => {
            handle.addEventListener('mousedown', function(e) {
                if (!selectedElement) return;

                const rect = selectedElement.getBoundingClientRect();

                resizeHandlePos = handle.getAttribute('data-pos') || null;

                // Set transform origin so opposite side stays fixed
                let originX = '50%';
                let originY = '50%';
                switch (resizeHandlePos) {
                    case 'n':
                        originY = '100%';
                        break;
                    case 's':
                        originY = '0%';
                        break;
                    case 'w':
                        originX = '100%';
                        break;
                    case 'e':
                        originX = '0%';
                        break;
                    case 'nw':
                        originX = '100%';
                        originY = '100%';
                        break;
                    case 'ne':
                        originX = '0%';
                        originY = '100%';
                        break;
                    case 'sw':
                        originX = '100%';
                        originY = '0%';
                        break;
                    case 'se':
                        originX = '0%';
                        originY = '0%';
                        break;
                }
                selectedElement.style.transformOrigin = originX + ' ' + originY;

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
        });
    }
    
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

    // Drag handlers for draggable elements (user-inserted blocks)
    content.addEventListener('mousedown', function(e) {
        if (!isEditMode) return;
        if (resizeBar && (e.target === resizeBar || resizeBar.contains(e.target))) return;
        const target = e.target.closest('.editable-element');
        if (!target || target.dataset.draggable !== 'true') return;

        e.preventDefault();

        const parent = target.parentElement;
        if (!parent) return;

        const rect = target.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();

        isDragging = true;
        dragElement = target;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        // Use existing left/top in % if present, otherwise compute from geometry
        const currentLeft = parseFloat(target.style.left);
        const currentTop = parseFloat(target.style.top);
        if (!isNaN(currentLeft) && !isNaN(currentTop)) {
            elemStartLeft = currentLeft;
            elemStartTop = currentTop;
        } else {
            elemStartLeft = ((rect.left - parentRect.left) / parentRect.width) * 100;
            elemStartTop = ((rect.top - parentRect.top) / parentRect.height) * 100;
        }

        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
    });

    function onDragMove(e) {
        if (!isDragging || !dragElement) return;
        const parent = dragElement.parentElement;
        if (!parent) return;

        const parentRect = parent.getBoundingClientRect();
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;

        let newLeft = elemStartLeft + (dx / parentRect.width) * 100;
        let newTop = elemStartTop + (dy / parentRect.height) * 100;

        // Clamp within page bounds
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
        // Record final position
        saveToHistory();
        updateResizeBarPosition();
    }

    function onResizeMove(e) {
        if (!isResizing || !resizeElement) return;

        const dx = e.clientX - resizeStartX;
        const dy = e.clientY - resizeStartY;

        // Flip movement for north/west handles so dragging outward always enlarges
        let effDx = dx;
        let effDy = dy;
        if (resizeHandlePos && resizeHandlePos.indexOf('w') !== -1) {
            effDx = -dx;
        }
        if (resizeHandlePos && resizeHandlePos.indexOf('n') !== -1) {
            effDy = -dy;
        }

        const widthFactor = (resizeStartWidth + effDx) / resizeStartWidth;
        const heightFactor = (resizeStartHeight + effDy) / resizeStartHeight;

        let factor;
        if (resizeHandlePos === 'e' || resizeHandlePos === 'w') {
            // Side handles: change width only
            factor = widthFactor;
        } else if (resizeHandlePos === 'n' || resizeHandlePos === 's') {
            // Top/bottom: change height only
            factor = heightFactor;
        } else {
            // Corners: proportional diagonal resize
            factor = Math.max(widthFactor, heightFactor);
        }

        factor = Math.max(0.5, Math.min(2.0, factor));

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
            // allow direct text editing
            el.contentEditable = 'true';
            el.dataset.originalBg = getComputedStyle(el).backgroundColor;
            el.dataset.originalColor = getComputedStyle(el).color;
        });
        
        // Also make SVG paths editable (for background fills)
        const svgPaths = content.querySelectorAll('svg path, svg rect, svg circle, svg polygon');
        svgPaths.forEach(el => {
            el.classList.add('editable-element');
            el.dataset.originalFill = el.getAttribute('fill') || getComputedStyle(el).fill;
        });

        attachDeleteHandles();
    }

    function attachDeleteHandles() {
        const elements = content.querySelectorAll('.editable-element');
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

        // Update font size UI if available
        if (fontSizePicker) {
            const computedSize = getComputedStyle(el).fontSize || '16px';
            fontSizePicker.value = computedSize;
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
     * Deselect all elements
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

    function updateResizeBarPosition() {
        if (!resizeBar) return;
        if (!selectedElement) {
            resizeBar.style.display = 'none';
            return;
        }

        const handles = resizeBar.querySelectorAll('.resize-handle');
        if (!handles.length) {
            resizeBar.style.display = 'none';
            return;
        }

        const rect = selectedElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const positions = {
            nw: { x: rect.left, y: rect.top },
            n: { x: rect.left + rect.width / 2, y: rect.top },
            ne: { x: rect.right, y: rect.top },
            e: { x: rect.right, y: rect.top + rect.height / 2 },
            se: { x: rect.right, y: rect.bottom },
            s: { x: rect.left + rect.width / 2, y: rect.bottom },
            sw: { x: rect.left, y: rect.bottom },
            w: { x: rect.left, y: rect.top + rect.height / 2 }
        };

        handles.forEach(handle => {
            const pos = handle.getAttribute('data-pos');
            const cfg = positions[pos];
            if (!cfg) return;

            const size = handle.offsetWidth || 12;
            let left = cfg.x - size / 2;
            let top = cfg.y - size / 2;

            left = Math.max(0, Math.min(viewportWidth - size, left));
            top = Math.max(0, Math.min(viewportHeight - size, top));

            handle.style.left = left + 'px';
            handle.style.top = top + 'px';
        });

        resizeBar.style.display = 'block';
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

    function applyFontSize(el, size) {
        saveToHistory();
        el.style.fontSize = size;
        // apply to direct text children for consistency
        el.querySelectorAll('span, p, div, li').forEach(child => {
            child.style.fontSize = size;
        });
    }

    function resizeSelected(factor) {
        if (!selectedElement || selectedElement.dataset.draggable !== 'true') return;

        const currentScale = parseFloat(selectedElement.dataset.scale || '1');
        let newScale = currentScale * factor;
        newScale = Math.max(0.5, Math.min(2.0, newScale));
        if (newScale === currentScale) return;

        saveToHistory();
        selectedElement.dataset.scale = String(newScale);
        selectedElement.style.transformOrigin = 'top left';
        selectedElement.style.transform = 'scale(' + newScale + ')';

        updateResizeBarPosition();
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

        // Try to place the element on the main "page" canvas, not below it
        var targetContainer = null;
        var pageCandidates = content.querySelectorAll('.page, .sheet, #page, #page-container, .pc, .pf, [class*="page"]');
        if (pageCandidates.length > 0) {
            // Use the last page so new content appears on the last visible sheet
            targetContainer = pageCandidates[pageCandidates.length - 1];
        } else {
            targetContainer = content.firstElementChild || content;
        }

        // Ensure relative positioning so absolutely positioned children are anchored to the page
        var currentPos = window.getComputedStyle(targetContainer).position;
        if (!currentPos || currentPos === 'static') {
            targetContainer.style.position = 'relative';
        }

        // Place element as overlay on the page rather than below it
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
        if (!content) return;

        var el = document.createElement('div');
        el.className = 'editable-element';
        el.dataset.draggable = 'true';

        // Try to place the block on the main page canvas
        var targetContainer = null;
        var pageCandidates = content.querySelectorAll('.page, .sheet, #page, #page-container, .pc, .pf, [class*="page"]');
        if (pageCandidates.length > 0) {
            targetContainer = pageCandidates[pageCandidates.length - 1];
        } else {
            targetContainer = content.firstElementChild || content;
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
            case 'insert-assessment-result':
                insertAssessmentResult(data.result);
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
    
    window.addEventListener('resize', updateResizeBarPosition);

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
