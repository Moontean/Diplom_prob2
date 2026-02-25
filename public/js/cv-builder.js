class CVBuilder {
    constructor() {
        this.currentSections = new Set(['employment', 'education', 'skills', 'languages']);
        this.itemCounters = {};
        this.isSaving = false;
        this.saveScheduled = false;
        this.selectedDocxTemplate = null; // Выбранный DOCX шаблон
        // Режим превью: 'pdf' (пример файла) или 'html' (редактируемый шаблон)
        try {
            this.previewMode = localStorage.getItem('previewMode') || 'pdf';
        } catch (_) {
            this.previewMode = 'pdf';
        }
        this.userData = {
            personalInfo: {},
            employment: [],
            education: [],
            skills: [],
            languages: [],
            additionalSections: {},
            template: 'modern',
            settings: {
                fontSize: 'medium',
                colorScheme: 'blue',
                includePhoto: true
            }
        };
        this.coverLetterUI = null;
        this.previewTimer = null;
        // Маппинг DOCX-шаблонов для экспорта
        this.docxTemplateMap = {
            'experienced': '/cv_templates/free-experienced-template-resume.docx',
            'entry-level': '/cv_templates/free-resume-example-entry-level.docx'
        };

        this.init();
    }

    init() { // посмотреть гайды
        this.attachEventListeners();
        this.setupPreviewStatusWatcher();
        this.applyTemplateFromQuery();
        this.loadExistingCVById();
        this.loadSavedData();
        this.setupAutoSave();
        this.setupCoverLetterUI();
        this.setupDragAndDropSections();
        this.setupQuickStyles();
        this.setupHistoryControls();
        this.setupSidebarUI();
        this.loadTemplateFromQuery(); // Загрузить выбранный шаблон из URL (в конце, когда DOM готов)
        this.updateTemplateLabel();
        // Если ранее был загружен пользовательский PDF шаблон — восстановим предпросмотр
        this.restoreCustomPdfTemplate();
    }

    attachEventListeners() {
        // Примечание: прямые обработчики для .add-section-btn, .add-section-item, .add-field-btn
        // убраны в пользу глобального делегирования (см. DOMContentLoaded handler внизу файла)

        // Живой предпросмотр: отслеживаем изменения формы и отправляем обновление в превью
        const formRoot = document.getElementById('cv-form');
        if (formRoot) {
            formRoot.addEventListener('input', () => this.schedulePreviewUpdate());
            formRoot.addEventListener('change', () => this.schedulePreviewUpdate());
        }

        // Флажок "использовать как заголовок" для должности
        const useAsHeadline = document.getElementById('use-as-headline');
        if (useAsHeadline) {
            useAsHeadline.addEventListener('change', () => {
                // Toggle visual state on wrapper for blue animation
                const wrapper = useAsHeadline.parentElement;
                if (wrapper) {
                    if (useAsHeadline.checked) {
                        wrapper.classList.add('toggle-on');
                    } else {
                        wrapper.classList.remove('toggle-on');
                    }
                }

                // Persist flag and update preview immediately
                try {
                    this.userData.personalInfo = this.userData.personalInfo || {};
                    this.userData.personalInfo.useAsHeadline = !!useAsHeadline.checked;
                } catch (_) { }
                this.pushLivePreview();
            });
        }

        // Отправить данные, когда iframe превью загрузится
        const previewFrame = document.getElementById('live-preview-frame');
        if (previewFrame) {
            previewFrame.addEventListener('load', () => this.sendPreviewMessage(this.userData));
        }

        // Загрузка фото
        const photoButton = document.getElementById('photo-upload');
        const photoInput = document.getElementById('photo-input');

        if (photoButton && photoInput) {
            photoButton.addEventListener('click', () => photoInput.click());
            photoInput.addEventListener('change', (e) => this.handlePhotoUpload(e));
        }

        // Кнопки в панели инструментов
        const downloadBtn = document.getElementById('download-btn');
        const downloadDocxBtn = document.getElementById('download-docx-btn');
        const coverLetterBtn = document.getElementById('generate-cover-letter-btn');
        const previewBtn = document.getElementById('preview-btn');
        const saveBtn = document.getElementById('save-btn');
        const saveToDashboardBtn = document.getElementById('save-to-dashboard-btn');
        const saveBottomBtn = document.getElementById('save-bottom-btn');
        const optionsBtn = document.getElementById('options-btn');
        const optionsMenu = document.getElementById('options-menu');
        const saveFromOptionsBtn = document.getElementById('save-from-options-btn');
        const clearFormBtn = document.getElementById('clear-form-btn');
        const addTestResultsBtn = document.getElementById('add-test-results-btn');
        const openSamplePdfBtn = document.getElementById('open-sample-pdf-btn');
        const togglePreviewModeBtn = document.getElementById('toggle-preview-mode-btn');
        const uploadPdfTemplateBtn = document.getElementById('upload-pdf-template-btn');
        const convertPdfToHtmlBtn = document.getElementById('convert-pdf-to-html-btn');
        const convertPdfToHtmlStrictBtn = document.getElementById('convert-pdf-to-html-strict-btn');
        const convertPdfPipelineBtn = document.getElementById('convert-pdf-pipeline-btn');
        const pdfTemplateInput = document.getElementById('pdf-template-input');
        const pdfPipelineInput = document.getElementById('pdf-pipeline-input');

        if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadCV());
        if (downloadDocxBtn) downloadDocxBtn.addEventListener('click', () => this.downloadDocx());
        const downloadPngBtn = document.getElementById('download-png-btn');
        if (downloadPngBtn) downloadPngBtn.addEventListener('click', () => this.requestPngExport());
        const downloadPdfHtmlBtn = document.getElementById('download-pdf-html-btn');
        if (downloadPdfHtmlBtn) downloadPdfHtmlBtn.addEventListener('click', () => this.requestPdfExport());
        if (coverLetterBtn) coverLetterBtn.addEventListener('click', () => this.generateCoverLetter());
        if (previewBtn) previewBtn.addEventListener('click', () => this.showPreview());
        if (saveBtn) saveBtn.addEventListener('click', async () => {
            await this.saveData({ immediate: true });
            // небольшая визуальная обратная связь
            saveBtn.classList.add('can-hover:active:bg-brand-100');
            setTimeout(() => saveBtn.classList.remove('can-hover:active:bg-brand-100'), 200);
        });
        if (saveToDashboardBtn) saveToDashboardBtn.addEventListener('click', async () => {
            await this.saveData({ immediate: true });
            window.location.href = '/pages/dashboard';
        });
        if (saveBottomBtn) saveBottomBtn.addEventListener('click', async () => {
            await this.saveData({ immediate: true });
            window.location.href = '/pages/dashboard';
        });
        if (optionsBtn && optionsMenu) {
            optionsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                optionsMenu.classList.toggle('hidden');
            });
            document.addEventListener('click', (e) => {
                if (!optionsMenu.classList.contains('hidden') && !optionsMenu.contains(e.target) && e.target !== optionsBtn) {
                    optionsMenu.classList.add('hidden');
                }
            });
        }
        if (clearFormBtn) {
            clearFormBtn.addEventListener('click', () => {
                this.clearAllFields();
                if (optionsMenu) optionsMenu.classList.add('hidden');
            });
        }
        if (saveFromOptionsBtn) {
            saveFromOptionsBtn.addEventListener('click', async () => {
                await this.saveData({ immediate: true });
                if (optionsMenu) optionsMenu.classList.add('hidden');
            });
        }
        if (addTestResultsBtn) {
            addTestResultsBtn.addEventListener('click', async () => {
                if (optionsMenu) optionsMenu.classList.add('hidden');
                try {
                    let payload = null;
                    // Сначала пробуем с сервера
                    const res = await fetch('/api/assessment/latest');
                    if (res.status === 401) {
                        this.redirectToAuthRequired();
                        return;
                    }
                    const data = await res.json();
                    if (res.ok && data && data.success) {
                        payload = data.result;
                    }

                    // Фолбэк на локально сохранённый результат (кнопка "Сохранить результат" в тесте)
                    if (!payload) {
                        try {
                            const saved = JSON.parse(localStorage.getItem('savedAssessmentResult') || 'null');
                            if (saved && typeof saved.score === 'number') {
                                payload = {
                                    profession: saved.profession,
                                    difficulty: saved.difficulty,
                                    totalQuestions: saved.totalQuestions,
                                    score: saved.score,
                                    submittedAt: saved.submittedAt,
                                    breakdown: saved.breakdown
                                };
                            }
                        } catch (_) { }
                    }

                    if (!payload || typeof payload.score !== 'number') {
                        alert((data && data.message) || 'Нет сохранённых результатов теста. Пройдите тест и сохраните результат (>65%).');
                        return;
                    }

                    const { profession, difficulty, totalQuestions, score, submittedAt } = payload;
                    const percent = Math.round(score * 100);
                    if (percent < 65) {
                        alert('Добавление к CV доступно при результате от 65%');
                        return;
                    }
                    const summary = [
                        profession ? `Профессия: ${profession}` : null,
                        difficulty ? `Уровень: ${difficulty}` : null,
                        typeof totalQuestions === 'number' ? `Вопросов: ${totalQuestions}` : null,
                        percent != null ? `Итоговый балл: ${percent}%` : null,
                        submittedAt ? `Дата: ${new Date(submittedAt).toLocaleDateString('ru-RU')}` : null
                    ].filter(Boolean).join(' | ');

                    // Добавляем/создаём секцию "Результаты теста"
                    if (!this.currentSections.has('assessment')) {
                        this.addNewSection('assessment');
                    }
                    const textarea = document.querySelector('#assessment-items textarea');
                    if (textarea) {
                        const baseText = summary || 'Результаты AI-теста';
                        const note = '\n\u2022 Добавьте детали: сильные стороны, темы для улучшения.';
                        textarea.value = baseText + note;
                    }

                    await this.saveData({ immediate: true });
                    this.pushLivePreview();
                    alert('Результаты теста добавлены в резюме.');
                } catch (error) {
                    console.error('Ошибка при добавлении результатов теста:', error);
                    alert('Не удалось получить результаты теста. Попробуйте позже.');
                }
            });
        }
        if (openSamplePdfBtn) {
            openSamplePdfBtn.addEventListener('click', () => {
                try {
                    const template = (this.userData && this.userData.template) || 'modern';
                    const pdfMap = {
                        classic: '/cv_templates/free-experienced-template-resume.pdf',
                        minimal: '/cv_templates/free-resume-example-entry-level.pdf'
                    };
                    const url = pdfMap[template];
                    const frame = document.getElementById('live-preview-frame');
                    if (url && frame) {
                        const abs = url.startsWith('/') ? url : `/cv_templates/${url}`;
                        frame.src = `/pages/pdf-overlay?src=${encodeURIComponent(abs)}`;
                        // отправим данные спустя короткую задержку
                        setTimeout(() => this.sendPreviewMessage(this.userData), 200);
                        this.ensurePreviewVisible();
                    } else {
                        alert('Для выбранного шаблона пример PDF отсутствует');
                    }
                } catch (_) { }
                if (optionsMenu) optionsMenu.classList.add('hidden');
            });
        }

        if (uploadPdfTemplateBtn && pdfTemplateInput) {
            uploadPdfTemplateBtn.addEventListener('click', () => {
                pdfTemplateInput.click();
            });
            pdfTemplateInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                if (file.type !== 'application/pdf') {
                    alert('Пожалуйста, выберите PDF файл шаблона');
                    return;
                }
                try {
                    const fd = new FormData();
                    fd.append('template', file);
                    const resp = await fetch('/api/templates/upload', { method: 'POST', body: fd });
                    if (resp.status === 401) { this.redirectToAuthRequired(); return; }
                    const data = await resp.json();
                    if (!resp.ok || !data?.success || !data?.url) throw new Error(data?.message || 'Не удалось загрузить шаблон');
                    this.customPdfTemplateUrl = data.url;
                    try { localStorage.setItem('customPdfTemplateUrl', this.customPdfTemplateUrl); } catch (_) { }
                    // Открываем новую страницу предпросмотра с оверлеями
                    const frame = document.getElementById('live-preview-frame');
                    if (frame) {
                        const url = `/pages/pdf-overlay?src=${encodeURIComponent(this.customPdfTemplateUrl)}`;
                        frame.src = url;
                        // отправим данные спустя короткую задержку
                        setTimeout(() => this.sendPreviewMessage(this.userData), 200);
                        this.ensurePreviewVisible();
                    }
                    if (optionsMenu) optionsMenu.classList.add('hidden');
                } catch (err) {
                    console.error('Upload template error:', err);
                    alert((err && err.message) || 'Ошибка загрузки шаблона');
                } finally {
                    // reset input value to allow re-uploading same file later
                    e.target.value = '';
                }
            });
        }

        // AI: конвертация текущего PDF превью в автономный HTML
        if (convertPdfToHtmlBtn) {
            convertPdfToHtmlBtn.addEventListener('click', async () => {
                try {
                    const frame = document.getElementById('live-preview-frame');
                    if (!frame || !frame.contentWindow) {
                        alert('Предпросмотр не готов');
                        return;
                    }
                    // Запросим PNG из оверлея (первая страница)
                    this.sendPreviewMessage(this.userData);
                    frame.contentWindow.postMessage({ type: 'export-png' }, window.location.origin);
                    const dataUrl = await new Promise((resolve, reject) => {
                        const handler = (e) => {
                            const msg = e && e.data;
                            if (!msg || msg.type !== 'export-png-result') return;
                            window.removeEventListener('message', handler);
                            if (msg.error) reject(new Error(msg.error)); else resolve(msg.dataUrl);
                        };
                        window.addEventListener('message', handler);
                        // Таймаут
                        setTimeout(() => {
                            window.removeEventListener('message', handler);
                            reject(new Error('Не удалось получить PNG из предпросмотра'));
                        }, 10000);
                    });
                    if (!dataUrl) throw new Error('PNG пустой');
                    const resp = await fetch('/api/templates/ai-html', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ imageDataUrl: dataUrl, title: this.getDocumentTitle() || 'Resume' })
                    });
                    if (resp.status === 401) { this.redirectToAuthRequired(); return; }
                    let result;
                    try { result = await resp.json(); } catch (_) { result = { success: false }; }
                    if (!resp.ok || !result || !result.success || !result.url) throw new Error((result && result.message) || 'AI конвертация не удалась');
                    // Заменяем превью на сгенерированный HTML
                    frame.src = result.url;
                    this.ensurePreviewVisible();
                    if (optionsMenu) optionsMenu.classList.add('hidden');
                } catch (err) {
                    console.error('AI HTML error:', err);
                    alert((err && err.message) || 'Не удалось сконвертировать PDF');
                }
            });
        }

        if (convertPdfToHtmlStrictBtn) {
            convertPdfToHtmlStrictBtn.addEventListener('click', async () => {
                try {
                    const frame = document.getElementById('live-preview-frame');
                    if (!frame || !frame.contentWindow) {
                        alert('Предпросмотр не готов');
                        return;
                    }
                    // Дождаться готовности iframe (pdf-overlay отправляет cv-ready)
                    const waitReady = () => new Promise((resolve) => {
                        let resolved = false;
                        const handler = (e) => {
                            const msg = e?.data;
                            if (msg && msg.type === 'cv-ready') {
                                resolved = true;
                                window.removeEventListener('message', handler);
                                resolve(true);
                            }
                        };
                        window.addEventListener('message', handler);
                        setTimeout(() => {
                            if (!resolved) {
                                window.removeEventListener('message', handler);
                                resolve(false);
                            }
                        }, 8000);
                    });
                    await waitReady();
                    // Если оверлей сообщает о проблеме с PDF, покажем подсказку
                    const pdfErrorCheck = () => new Promise((resolve) => {
                        let timer;
                        const handler = (e) => {
                            const msg = e?.data;
                            if (msg && msg.type === 'pdf-error') {
                                window.removeEventListener('message', handler);
                                clearTimeout(timer);
                                alert('Не удалось открыть PDF шаблон. Убедитесь, что путь доступен.');
                                resolve(true);
                            }
                        };
                        window.addEventListener('message', handler);
                        timer = setTimeout(() => { window.removeEventListener('message', handler); resolve(false); }, 1500);
                    });
                    const hadPdfError = await pdfErrorCheck();
                    if (hadPdfError) return;
                    // Пытаемся сначала строгую AI-конвертацию
                    this.sendPreviewMessage(this.userData);
                    frame.contentWindow.postMessage({ type: 'export-png' }, window.location.origin);
                    const dataUrl = await new Promise((resolve, reject) => {
                        const handler = (e) => {
                            const msg = e?.data;
                            if (!msg || msg.type !== 'export-png-result') return;
                            window.removeEventListener('message', handler);
                            if (msg.error) reject(new Error(msg.error)); else resolve(msg.dataUrl);
                        };
                        window.addEventListener('message', handler);
                        setTimeout(() => {
                            window.removeEventListener('message', handler);
                            reject(new Error('Не удалось получить PNG из предпросмотра'));
                        }, 10000);
                    });
                    if (!dataUrl) throw new Error('PNG пустой');
                    let resp = await fetch('/api/templates/ai-html-strict', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ imageDataUrl: dataUrl, title: this.getDocumentTitle() || 'Resume' })
                    });
                    if (resp.status === 401) { this.redirectToAuthRequired(); return; }
                    let result;
                    try { result = await resp.json(); } catch (_) { result = { success: false }; }
                    const needFallback = (!resp.ok || !result || !result.success || !result.url || result.type === 'image');
                    if (needFallback) {
                        // Приоритет: векторный HTML (SVG/текст), затем – текстовый PNG-фолбэк как последний шанс
                        let html = null;
                        try {
                            frame.contentWindow.postMessage({ type: 'export-strict-html-vector' }, window.location.origin);
                            html = await new Promise((resolve, reject) => {
                                const handler = (e) => {
                                    const msg = e && e.data;
                                    if (!msg || msg.type !== 'export-strict-html-vector-result') return;
                                    window.removeEventListener('message', handler);
                                    if (msg.error) reject(new Error(msg.error)); else resolve(msg.html);
                                };
                                window.addEventListener('message', handler);
                                setTimeout(() => {
                                    window.removeEventListener('message', handler);
                                    reject(new Error('Не удалось получить векторный HTML'));
                                }, 10000);
                            });
                        } catch (vectorErr) {
                            console.warn('Vector export failed, fallback to canvas HTML:', vectorErr?.message || vectorErr);
                        }

                        if (!html) {
                            frame.contentWindow.postMessage({ type: 'export-strict-html' }, window.location.origin);
                            html = await new Promise((resolve, reject) => {
                                const handler = (e) => {
                                    const msg = e && e.data;
                                    if (!msg || msg.type !== 'export-strict-html-result') return;
                                    window.removeEventListener('message', handler);
                                    if (msg.error) {
                                        reject(new Error(msg.error));
                                    } else if (!msg.html || msg.html.length < 200) {
                                        reject(new Error('Пустой или некорректный HTML от export-strict-html'));
                                    } else {
                                        resolve(msg.html);
                                    }
                                };
                                window.addEventListener('message', handler);
                                setTimeout(() => {
                                    window.removeEventListener('message', handler);
                                    reject(new Error('Не удалось получить текстовый HTML (таймаут)'));
                                }, 10000);
                            });
                        }

                        if (!html) throw new Error('Пустой HTML');
                        resp = await fetch('/api/templates/save-html', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ html, title: this.getDocumentTitle() || 'Resume' })
                        });
                        if (resp.status === 401) { this.redirectToAuthRequired(); return; }
                        try { result = await resp.json(); } catch (_) { result = { success: false }; }
                        if (!resp.ok || !result || !result.success || !result.url) throw new Error((result && result.message) || 'Сохранение HTML не удалось');
                    }
                    frame.src = result.url;
                    this.ensurePreviewVisible();
                    if (optionsMenu) optionsMenu.classList.add('hidden');
                } catch (err) {
                    console.error('AI HTML strict error:', err);
                    alert((err && err.message) || 'Не удалось получить текстовый HTML');
                }
            });
        }

        // Server-side PDF Pipeline conversion (more reliable)
        if (convertPdfPipelineBtn && pdfPipelineInput) {
            convertPdfPipelineBtn.addEventListener('click', () => {
                pdfPipelineInput.click();
            });

            pdfPipelineInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;

                if (file.type !== 'application/pdf') {
                    alert('Пожалуйста, выберите PDF файл');
                    return;
                }

                try {
                    // Show loading state
                    convertPdfPipelineBtn.disabled = true;
                    convertPdfPipelineBtn.textContent = 'Конвертация...';

                    // Use new pipeline
                    const result = await this.convertPdfWithPipeline(file, {
                        usePlaceholders: true,
                        useAI: true
                    });

                    if (result && result.html) {
                        await this.showPipelineResult(result);

                        // Show success message
                        const fieldsCount = Object.keys(result.fieldBindings || {}).length;
                        console.log(`PDF converted: ${result.metadata?.pages || 1} pages, ${fieldsCount} fields detected`);
                    }

                    if (optionsMenu) optionsMenu.classList.add('hidden');
                } catch (err) {
                    console.error('PDF Pipeline error:', err);
                    alert((err && err.message) || 'Ошибка конвертации PDF');
                } finally {
                    // Restore button state
                    convertPdfPipelineBtn.disabled = false;
                    convertPdfPipelineBtn.textContent = '📄 PDF → HTML (Pipeline)';
                    e.target.value = '';
                }
            });
        }

        if (togglePreviewModeBtn) {
            const refreshLabel = () => {
                const mode = this.previewMode === 'html' ? 'HTML → PDF' : 'PDF → HTML';
                togglePreviewModeBtn.textContent = `Переключить режим превью: ${mode}`;
            };
            refreshLabel();
            togglePreviewModeBtn.addEventListener('click', () => {
                this.previewMode = this.previewMode === 'html' ? 'pdf' : 'html';
                try { localStorage.setItem('previewMode', this.previewMode); } catch (_) { }
                refreshLabel();
                // Перепривязать превью под текущий шаблон
                const tpl = (this.userData && this.userData.template) || 'modern';
                this.applyPreviewForTemplate(tpl);
                if (optionsMenu) optionsMenu.classList.add('hidden');
            });
        }

        // Выбор шаблона
        const templateButtons = document.querySelectorAll('.template-option');
        templateButtons.forEach(btn => {
            btn.addEventListener('click', () => this.selectTemplate(btn.dataset.template));
        });

        // Загрузка файлов
        const fileUpload = document.getElementById('file-upload');
        if (fileUpload) {
            fileUpload.addEventListener('change', (e) => this.handleFileUpload(e));
        }

        // Импорт LinkedIn
        const linkedinBtn = document.getElementById('linkedin-import-btn');
        if (linkedinBtn) {
            linkedinBtn.addEventListener('click', () => this.importLinkedIn());
        }

        // Сохранение изменений в названии документа
        const documentTitle = document.getElementById('document-title');
        if (documentTitle) {
            documentTitle.addEventListener('blur', () => this.saveData());
            documentTitle.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.target.blur();
                }
            });
        }

        // Обработка всех полей формы для автосохранения
        document.addEventListener('input', (e) => {
            if (e.target.matches('input, textarea, select')) {
                this.saveData();
                this.pushHistoryDebounced();
            }
        });
    }

    restoreCustomPdfTemplate() {
        try {
            const stored = localStorage.getItem('customPdfTemplateUrl');
            if (!stored) return;
            this.customPdfTemplateUrl = stored;
            const frame = document.getElementById('live-preview-frame');
            if (!frame) return;
            frame.src = `/pages/pdf-overlay?src=${encodeURIComponent(stored)}`;
            setTimeout(() => this.sendPreviewMessage(this.userData), 200);
            this.ensurePreviewVisible();
        } catch (_) { }
    }

    /**
     * Convert PDF to HTML using server-side pipeline
     * Uses: PDF parsing → Semantic analysis → HTML generation
     */
    async convertPdfWithPipeline(pdfFile, options = {}) {
        const { usePlaceholders = true, useAI = true } = options;

        try {
            const formData = new FormData();
            formData.append('pdf', pdfFile);
            formData.append('usePlaceholders', usePlaceholders.toString());
            formData.append('useAI', useAI.toString());

            // Include current user data if not using placeholders
            if (!usePlaceholders && this.userData) {
                formData.append('userData', JSON.stringify(this.mapUserDataToFields()));
            }

            const response = await fetch('/api/templates/pdf-to-html', {
                method: 'POST',
                body: formData
            });

            if (response.status === 401) {
                this.redirectToAuthRequired();
                return null;
            }

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Ошибка конвертации PDF');
            }

            // Store field bindings for placeholder updates
            this.pipelineFieldBindings = result.fieldBindings;
            this.pipelinePlaceholders = result.placeholders;

            return result;
        } catch (err) {
            console.error('PDF pipeline conversion error:', err);
            throw err;
        }
    }

    /**
     * Map CVBuilder userData to placeholder field names
     */
    mapUserDataToFields() {
        const pi = this.userData.personalInfo || {};
        const mapped = {
            fullName: [pi.firstName, pi.lastName].filter(Boolean).join(' ') || '',
            firstName: pi.firstName || '',
            lastName: pi.lastName || '',
            jobTitle: pi.title || pi.jobTitle || '',
            email: pi.email || '',
            phone: pi.phone || '',
            address: pi.address || '',
            city: pi.city || '',
            zipCode: pi.zip || pi.zipCode || '',
            country: pi.country || '',
            linkedin: pi.linkedin || '',
            website: pi.website || '',
            github: pi.github || '',
            summary: pi.summary || pi.professionalSummary || ''
        };

        // Map employment to experience fields (first entry)
        const employment = this.userData.employment || [];
        if (employment.length > 0) {
            const job = employment[0];
            mapped.companyName = job.company || '';
            mapped.position = job.position || job.title || '';
            mapped.dateRange = [job.startDate, job.endDate].filter(Boolean).join(' - ') || '';
            mapped.description = job.description || '';
        }

        // Map education (first entry)
        const education = this.userData.education || [];
        if (education.length > 0) {
            const edu = education[0];
            mapped.institution = edu.institution || edu.school || '';
            mapped.degree = edu.degree || '';
            mapped.fieldOfStudy = edu.field || edu.fieldOfStudy || '';
            mapped.graduationDate = edu.graduationDate || edu.endDate || '';
        }

        // Map skills
        const skills = this.userData.skills || [];
        if (skills.length > 0) {
            mapped.skill = skills.map(s => typeof s === 'string' ? s : s.name || s.skill).join(', ');
        }

        // Map languages
        const languages = this.userData.languages || [];
        if (languages.length > 0) {
            mapped.language = languages.map(l => typeof l === 'string' ? l : l.name || l.language).join(', ');
        }

        return mapped;
    }

    /**
     * Initialize PlaceholderEngine for an iframe
     */
    initPlaceholderEngine(iframe) {
        if (!iframe || !iframe.contentWindow || !iframe.contentDocument) return null;

        try {
            const PlaceholderEngine = iframe.contentWindow.PlaceholderEngine;
            if (!PlaceholderEngine) {
                console.warn('PlaceholderEngine not available in iframe');
                return null;
            }

            const engine = new PlaceholderEngine({
                container: iframe.contentDocument.body,
                onChange: (field, value, state) => {
                    // Sync changes back to CVBuilder userData
                    this.syncFromPlaceholder(field, value);
                }
            });

            // Apply current userData
            engine.setState(this.mapUserDataToFields());

            return engine;
        } catch (err) {
            console.error('Failed to init PlaceholderEngine:', err);
            return null;
        }
    }

    /**
     * Sync placeholder changes back to userData
     */
    syncFromPlaceholder(field, value) {
        const pi = this.userData.personalInfo = this.userData.personalInfo || {};

        const fieldMap = {
            fullName: () => {
                const parts = (value || '').split(' ');
                pi.firstName = parts[0] || '';
                pi.lastName = parts.slice(1).join(' ') || '';
            },
            firstName: () => { pi.firstName = value; },
            lastName: () => { pi.lastName = value; },
            jobTitle: () => { pi.title = value; },
            email: () => { pi.email = value; },
            phone: () => { pi.phone = value; },
            address: () => { pi.address = value; },
            city: () => { pi.city = value; },
            zipCode: () => { pi.zip = value; },
            country: () => { pi.country = value; },
            linkedin: () => { pi.linkedin = value; },
            website: () => { pi.website = value; },
            github: () => { pi.github = value; },
            summary: () => { pi.summary = value; }
        };

        if (fieldMap[field]) {
            fieldMap[field]();
            this.schedulePreviewUpdate();
        }
    }

    /**
     * Show converted HTML in preview with placeholder binding
     */
    async showPipelineResult(result) {
        const frame = document.getElementById('live-preview-frame');
        if (!frame) return;

        // Save HTML and get URL
        const saveResp = await fetch('/api/templates/save-html', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                html: result.html,
                title: this.getDocumentTitle() || 'Resume'
            })
        });

        if (saveResp.status === 401) {
            this.redirectToAuthRequired();
            return;
        }

        const saveResult = await saveResp.json();
        if (!saveResult.success || !saveResult.url) {
            throw new Error(saveResult.message || 'Не удалось сохранить HTML');
        }

        // Load in iframe
        frame.src = saveResult.url;
        this.ensurePreviewVisible();

        // Initialize placeholder engine after load
        frame.addEventListener('load', () => {
            setTimeout(() => {
                this.placeholderEngine = this.initPlaceholderEngine(frame);
            }, 300);
        }, { once: true });
    }

    setupSidebarUI() {
        const headers = document.querySelectorAll('#left-sidebar .sidebar-group-header');
        headers.forEach((btn) => {
            const targetSel = btn.getAttribute('data-collapse-target');
            const target = targetSel ? document.querySelector(targetSel) : null;
            if (!target) return;

            const setState = (expanded) => {
                btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                target.classList.toggle('hidden', !expanded);
            };

            // initialize expanded true unless explicitly false
            setState(btn.getAttribute('aria-expanded') !== 'false');

            const toggle = () => setState(btn.getAttribute('aria-expanded') === 'false');

            btn.addEventListener('click', toggle);
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                }
            });
        });
    }

    setupCollapsibleSections() {
        const sectionButtons = document.querySelectorAll('.collapsible-section button[type="button"]');
        sectionButtons.forEach(btn => {
            if (!btn.classList.contains('add-section-item') && !btn.classList.contains('add-field-btn')) {
                btn.addEventListener('click', (e) => this.toggleSection(e));
            }
        });
    }

    // ---------- Drag & Drop секций ----------
    setupDragAndDropSections() {
        const container = document.getElementById('resume-sections');
        if (!container) return;
        let dragEl = null;
        let placeholder = document.createElement('div');
        placeholder.style.height = '8px';
        placeholder.style.background = '#bfdbfe';
        placeholder.style.borderRadius = '4px';
        placeholder.style.margin = '4px 0';

        const sections = () => Array.from(container.querySelectorAll('.draggable-section'));
        const setDraggable = (el) => { el.setAttribute('draggable', 'true'); };
        sections().forEach(setDraggable);

        container.addEventListener('dragstart', (e) => {
            const target = e.target.closest('.draggable-section');
            if (!target) return;
            dragEl = target;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'reorder');
            setTimeout(() => { dragEl.classList.add('opacity-50'); }, 0);
        });
        container.addEventListener('dragover', (e) => {
            if (!dragEl) return;
            e.preventDefault();
            const after = Array.from(container.children).find(child => {
                if (child === placeholder) return false;
                if (!child.classList.contains('draggable-section')) return false;
                const rect = child.getBoundingClientRect();
                return e.clientY < rect.top + rect.height / 2;
            });
            if (after) {
                container.insertBefore(placeholder, after);
            } else {
                container.appendChild(placeholder);
            }
        });
        container.addEventListener('drop', (e) => {
            if (!dragEl) return;
            e.preventDefault();
            container.insertBefore(dragEl, placeholder);
            this.saveData();
            this.pushLivePreview();
        });
        container.addEventListener('dragend', () => {
            if (dragEl) dragEl.classList.remove('opacity-50');
            if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
            dragEl = null;
        });
        // Observe for newly added sections
        const mo = new MutationObserver(() => sections().forEach(setDraggable));
        mo.observe(container, { childList: true });
    }

    // ---------- Быстрые стили ----------
    setupQuickStyles() {
        const applyColor = (color) => {
            this.userData.settings = this.userData.settings || {};
            this.userData.settings.colorScheme = color;
            this.saveData();
            this.pushLivePreview();
        };
        const applyFont = (size) => {
            this.userData.settings = this.userData.settings || {};
            this.userData.settings.fontSize = size;
            this.saveData();
            this.pushLivePreview();
        };
        document.querySelectorAll('#quick-colors [data-color], #quick-colors-mobile [data-color]').forEach(btn => {
            btn.addEventListener('click', () => applyColor(btn.dataset.color));
        });
        const fs = document.getElementById('quick-fontsize');
        if (fs) fs.addEventListener('change', () => applyFont(fs.value));
        const fsM = document.getElementById('quick-fontsize-mobile');
        if (fsM) fsM.addEventListener('change', () => applyFont(fsM.value));
    }

    // ---------- История (Undo/Redo) ----------
    setupHistoryControls() {
        this.__history = [];
        this.__future = [];
        this.__historyTimer = null;
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        undoBtn?.addEventListener('click', () => this.undo());
        redoBtn?.addEventListener('click', () => this.redo());
        document.addEventListener('keydown', (e) => {
            const cmd = (e.ctrlKey || e.metaKey) && !e.shiftKey;
            if (cmd && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); }
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
                e.preventDefault(); this.redo();
            }
        });
        // initial snapshot
        this.pushHistory();
    }
    snapshot() {
        return JSON.stringify(this.userData);
    }
    restoreFromSnapshot(snap) {
        try {
            const data = JSON.parse(snap);
            this.userData = data;
            this.rebuildUIForUserData();
            this.saveData();
            this.pushLivePreview();
        } catch (_) { }
    }
    pushHistory() {
        try { this.__history.push(this.snapshot()); } catch (_) { }
        this.__future = [];
    }
    pushHistoryDebounced() {
        clearTimeout(this.__historyTimer);
        this.__historyTimer = setTimeout(() => this.pushHistory(), 800);
    }
    undo() {
        if (!this.__history || this.__history.length <= 1) return;
        const current = this.__history.pop();
        const prev = this.__history[this.__history.length - 1];
        this.__future.push(current);
        this.restoreFromSnapshot(prev);
    }
    redo() {
        if (!this.__future || this.__future.length === 0) return;
        const next = this.__future.pop();
        this.__history.push(next);
        this.restoreFromSnapshot(next);
    }
    rebuildUIForUserData() {
        // Reset dynamic containers without nuking userData
        ['employment', 'education', 'skills', 'languages'].forEach(section => {
            const container = document.getElementById(`${section}-items`);
            if (container) { container.innerHTML = ''; container.classList.add('hidden'); }
            this.itemCounters[section] = 0;
        });
        // Remove extra sections blocks
        document.querySelectorAll('#resume-sections .draggable-section').forEach((el, idx) => {
            if (idx > 3) el.remove(); // keep the first 4 base sections
        });
        this.currentSections = new Set(['employment', 'education', 'skills', 'languages']);
        // Repopulate
        this.populateForm();
    }

    // ---------- Экспорт PNG через превью ----------
    requestPngExport() {
        const frame = document.getElementById('live-preview-frame');
        if (!frame || !frame.contentWindow) {
            alert('Предпросмотр недоступен');
            return;
        }
        // Ensure latest data
        this.saveData();
        this.sendPreviewMessage(this.userData);
        frame.contentWindow.postMessage({ type: 'export-png' }, window.location.origin);
        window.addEventListener('message', (event) => {
            const msg = event.data;
            if (!msg || msg.type !== 'export-png-result') return;
            const url = msg.dataUrl;
            if (!url) return;
            const a = document.createElement('a');
            a.href = url; a.download = `${this.getDocumentTitle() || 'resume'}.png`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }, { once: true });
    }

    // Экспорт PDF из HTML-превью
    requestPdfExport() {
        const frame = document.getElementById('live-preview-frame');
        if (!frame || !frame.contentWindow) {
            alert('Предпросмотр недоступен');
            return;
        }
        this.saveData();
        this.sendPreviewMessage(this.userData);
        frame.contentWindow.postMessage({ type: 'export-pdf' }, window.location.origin);
        window.addEventListener('message', (event) => {
            const msg = event.data;
            if (!msg || msg.type !== 'export-pdf-result') return;
            if (!msg.url) {
                alert(msg.error || 'Не удалось сформировать PDF');
                return;
            }
            const a = document.createElement('a');
            a.href = msg.url; a.download = `${this.getDocumentTitle() || 'resume'}.pdf`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(msg.url), 5000);
        }, { once: true });
    }

    setupCollapsibleSections() {
        const sectionButtons = document.querySelectorAll('.collapsible-section button[type="button"]');
        sectionButtons.forEach(btn => {
            if (!btn.classList.contains('add-section-item') && !btn.classList.contains('add-field-btn')) {
                btn.addEventListener('click', (e) => this.toggleSection(e));
            }
        });
    }

    setupCoverLetterUI() {
        const modal = document.getElementById('cover-letter-modal');
        if (!modal) return;
        this.coverLetterUI = {
            modal,
            text: document.getElementById('cover-letter-text'),
            status: document.getElementById('cover-letter-status'),
            close: document.getElementById('cover-letter-close'),
            close2: document.getElementById('cover-letter-close-2'),
            copy: document.getElementById('cover-letter-copy')
        };
        const hide = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        };
        this.coverLetterUI.close?.addEventListener('click', hide);
        this.coverLetterUI.close2?.addEventListener('click', hide);
        this.coverLetterUI.copy?.addEventListener('click', async () => {
            const textVal = this.coverLetterUI.text?.value || '';
            try {
                await navigator.clipboard.writeText(textVal);
                this.coverLetterUI.status.textContent = 'Скопировано в буфер обмена';
            } catch (_) {
                this.coverLetterUI.status.textContent = 'Не удалось скопировать, выделите текст вручную';
            }
        });
    }

    openCoverLetterModal({ text = '', status = '' }) {
        if (!this.coverLetterUI) return;
        this.coverLetterUI.text.value = text;
        this.coverLetterUI.status.textContent = status;
        this.coverLetterUI.modal.classList.remove('hidden');
        this.coverLetterUI.modal.classList.add('flex');
    }

    async generateCoverLetter() {
        if (!this.coverLetterUI) {
            alert('Модальное окно письма не инициализировалось');
            return;
        }
        this.saveData();
        this.openCoverLetterModal({ text: '', status: 'Генерируем письмо из ваших данных...' });
        try {
            const response = await fetch('/api/cv/cover-letter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.userData)
            });
            if (response.status === 401) {
                this.redirectToAuthRequired();
                return;
            }
            const data = await response.json();
            if (!response.ok || !data?.success) {
                throw new Error(data?.message || 'Не удалось создать письмо');
            }
            this.openCoverLetterModal({
                text: data.letter || '',
                status: 'Письмо сгенерировано. Можно скопировать и при необходимости отредактировать.'
            });
        } catch (error) {
            console.error('Ошибка генерации письма:', error);
            this.openCoverLetterModal({
                text: '',
                status: 'Ошибка: ' + (error.message || 'неизвестная ошибка')
            });
        }
    }

    async loadExistingCVById() {
        try {
            const url = new URL(window.location.href);
            const id = url.searchParams.get('id');
            if (!id) return;
            const res = await fetch(`/api/cv/${id}`);
            if (res.status === 401) {
                this.redirectToAuthRequired();
                return;
            }
            const data = await res.json();
            if (res.ok && data?.success && data.cv) {
                const cv = data.cv;
                this.userData = {
                    _id: cv._id,
                    title: cv.title || '',
                    personalInfo: cv.personalInfo || {},
                    employment: Array.isArray(cv.employment) ? cv.employment : [],
                    education: Array.isArray(cv.education) ? cv.education : [],
                    skills: Array.isArray(cv.skills) ? cv.skills : [],
                    languages: Array.isArray(cv.languages) ? cv.languages : [],
                    additionalSections: cv.additionalSections || {},
                    template: cv.template || 'modern',
                    settings: {
                        fontSize: 'medium',
                        colorScheme: 'blue',
                        includePhoto: true,
                        ...(cv.settings || {})
                    }
                };
                localStorage.setItem('cvBuilderData', JSON.stringify(this.userData));
                this.populateForm();
            }
        } catch (err) {
            console.error('Ошибка загрузки CV по id:', err);
        }
    }

    toggleSection(e) {
        const button = e.currentTarget;
        const section = button.closest('.collapsible-section');
        const content = section.querySelector('.w-full:not(.flex)');
        const arrow = button.querySelector('svg path');

        if (content) {
            if (content.classList.contains('hidden')) {
                content.classList.remove('hidden');
                // Поворот стрелки вниз
                if (arrow) {
                    arrow.setAttribute('d', 'M480-542.463 317.076-379.539q-8.307 8.308-20.884 8.5t-21.268-8.5q-8.693-8.692-8.693-21.076t8.693-21.077l179.769-179.769q5.615-5.615 11.846-7.923T480-611.691t13.461 2.307q6.231 2.308 11.846 7.923l179.769 179.769q8.308 8.308 8.5 20.884t-8.5 21.269T664-370.847t-21.076-8.692z');
                }
            } else {
                content.classList.add('hidden');
                // Поворот стрелки вправо
                if (arrow) {
                    arrow.setAttribute('d', 'M381.539-480l162.923-162.924q8.308-8.307 8.5-20.884t-8.5-21.268q-8.692-8.693-21.076-8.693t-21.077 8.693L322.54-505.307Q311.694-494.461 311.694-480t10.846 25.307l179.769 179.769q8.308 8.308 20.884 8.5t21.269-8.5q8.692-8.692 8.692-21.076t-8.692-21.077z');
                }
            }
        }
    }

    addPersonalField(fieldType) {
        const container = document.querySelector('.flex-wrap.pt-5.pb-3.gap-2');
        const button = container.querySelector(`[data-field="${fieldType}"]`);

        if (button) {
            button.style.display = 'none';
        }

        const fieldsContainer = document.querySelector('.flex-grow.max-w-full');
        const fieldHtml = this.getPersonalFieldHTML(fieldType);

        fieldsContainer.insertAdjacentHTML('beforeend', fieldHtml);
        this.saveData();
        this.pushHistory();
    }

    getPersonalFieldHTML(fieldType) {
        const fieldConfigs = {
            birthdate: {
                label: 'Дата рождения',
                type: 'date',
                placeholder: 'дд.мм.гггг',
                autocomplete: 'bday'
            },
            website: {
                label: 'Веб-сайт',
                type: 'url',
                placeholder: 'https://example.com',
                autocomplete: 'url'
            },
            linkedin: {
                label: 'LinkedIn',
                type: 'url',
                placeholder: 'https://linkedin.com/in/username',
                autocomplete: 'url'
            }
        };

        const config = fieldConfigs[fieldType];
        if (!config) return '';

        return `
        <div class="py-2" data-field-type="${fieldType}">
            <div class="flex items-center mb-1">
                <label for="${fieldType}" class="flex-grow truncate cursor-pointer block font-medium text-gray-600 text-sm">${config.label}</label>
                <button type="button" class="remove-field-btn text-gray-400 hover:text-red-500 ml-2" data-field="${fieldType}">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" class="w-5 h-5">
                        <path fill="currentColor" d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                    </svg>
                </button>
            </div>
            <div class="relative flex flex-row border focus-within:border-brand-400 focus-within:bg-brand-50 rounded text-gray-800 border-transparent bg-gray-100">
                <input id="${fieldType}" 
                       size="1" 
                       autocomplete="${config.autocomplete}" 
                       maxlength="200" 
                       class="flex-1 appearance-none outline-none rounded py-2 ps-3 text-base pe-3 bg-transparent" 
                       type="${config.type}" 
                       placeholder="${config.placeholder}">
            </div>
        </div>`;
    }

    addSectionItem(sectionType) {
        const itemsContainer = document.getElementById(`${sectionType}-items`);
        if (!itemsContainer) return;

        if (!this.itemCounters[sectionType]) {
            this.itemCounters[sectionType] = 0;
        }

        const itemId = `${sectionType}-${++this.itemCounters[sectionType]}`;
        const itemHtml = this.getSectionItemHTML(sectionType, itemId);

        itemsContainer.classList.remove('hidden');
        itemsContainer.insertAdjacentHTML('beforeend', itemHtml);
        this.saveData();
    }

    getSectionItemHTML(sectionType, itemId) {
        const templates = {
            employment: this.getEmploymentItemHTML(itemId),
            education: this.getEducationItemHTML(itemId),
            skills: this.getSkillsItemHTML(itemId),
            languages: this.getLanguagesItemHTML(itemId)
        };

        return templates[sectionType] || '';
    }

    getEmploymentItemHTML(itemId) {
        return `
        <div class="border-b border-gray-200 pb-4 mb-4" data-item-id="${itemId}">
            <div class="flex justify-between items-start mb-4">
                <h4 class="font-medium text-gray-800">Опыт работы</h4>
                <button type="button" class="remove-item-btn text-gray-400 hover:text-red-500" data-item="${itemId}">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" class="w-5 h-5">
                        <path fill="currentColor" d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                    </svg>
                </button>
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Должность</label>
                    <input type="text" class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                           placeholder="Например: Frontend Developer" name="${itemId}_position">
                </div>
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Компания</label>
                    <input type="text" class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                           placeholder="Название компании" name="${itemId}_company">
                </div>
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Начало работы</label>
                    <input type="month" class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                           name="${itemId}_start_date">
                </div>
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Окончание работы</label>
                    <input type="month" class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                           name="${itemId}_end_date">
                    <label class="flex items-center mt-1">
                        <input type="checkbox" class="mr-2" name="${itemId}_current" onchange="this.checked ? this.parentElement.previousElementSibling.disabled = true : this.parentElement.previousElementSibling.disabled = false">
                        <span class="text-sm text-gray-600">Работаю в настоящее время</span>
                    </label>
                </div>
                <div class="sm:col-span-2">
                    <label class="block font-medium text-gray-600 text-sm mb-1">Описание обязанностей</label>
                    <textarea class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                              rows="3" placeholder="Опишите ваши обязанности и достижения" name="${itemId}_description"></textarea>
                </div>
            </div>
        </div>`;
    }

    getEducationItemHTML(itemId) {
        return `
        <div class="border-b border-gray-200 pb-4 mb-4" data-item-id="${itemId}">
            <div class="flex justify-between items-start mb-4">
                <h4 class="font-medium text-gray-800">Образование</h4>
                <button type="button" class="remove-item-btn text-gray-400 hover:text-red-500" data-item="${itemId}">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" class="w-5 h-5">
                        <path fill="currentColor" d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                    </svg>
                </button>
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="sm:col-span-2">
                    <label class="block font-medium text-gray-600 text-sm mb-1">Учебное заведение</label>
                    <input type="text" class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                           placeholder="Название университета/института" name="${itemId}_school">
                </div>
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Специальность</label>
                    <input type="text" class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                           placeholder="Специальность" name="${itemId}_degree">
                </div>
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Степень</label>
                    <select class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" name="${itemId}_level">
                        <option value="">Выберите степень</option>
                        <option value="bachelor">Бакалавр</option>
                        <option value="master">Магистр</option>
                        <option value="phd">Доктор наук</option>
                        <option value="specialist">Специалист</option>
                    </select>
                </div>
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Год начала</label>
                    <input type="number" class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                           min="1950" max="2030" placeholder="2020" name="${itemId}_start_year">
                </div>
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Год окончания</label>
                    <input type="number" class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                           min="1950" max="2030" placeholder="2024" name="${itemId}_end_year">
                </div>
            </div>
        </div>`;
    }

    getSkillsItemHTML(itemId) {
        return `
        <div class="border-b border-gray-200 pb-4 mb-4" data-item-id="${itemId}">
            <div class="flex justify-between items-start mb-4">
                <h4 class="font-medium text-gray-800">Навыки</h4>
                <button type="button" class="remove-item-btn text-gray-400 hover:text-red-500" data-item="${itemId}">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" class="w-5 h-5">
                        <path fill="currentColor" d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                    </svg>
                </button>
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Навык</label>
                    <input type="text" class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                           placeholder="Например: JavaScript" name="${itemId}_skill">
                </div>
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Уровень</label>
                    <select class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" name="${itemId}_level">
                        <option value="">Выберите уровень</option>
                        <option value="beginner">Начальный</option>
                        <option value="intermediate">Средний</option>
                        <option value="advanced">Продвинутый</option>
                        <option value="expert">Эксперт</option>
                    </select>
                </div>
            </div>
        </div>`;
    }

    getLanguagesItemHTML(itemId) {
        return `
        <div class="border-b border-gray-200 pb-4 mb-4" data-item-id="${itemId}">
            <div class="flex justify-between items-start mb-4">
                <h4 class="font-medium text-gray-800">Язык</h4>
                <button type="button" class="remove-item-btn text-gray-400 hover:text-red-500" data-item="${itemId}">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" class="w-5 h-5">
                        <path fill="currentColor" d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                    </svg>
                </button>
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Язык</label>
                    <input type="text" class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                           placeholder="Например: Английский" name="${itemId}_language">
                </div>
                <div>
                    <label class="block font-medium text-gray-600 text-sm mb-1">Уровень</label>
                    <select class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" name="${itemId}_level">
                        <option value="">Выберите уровень</option>
                        <option value="a1">A1 - Начальный</option>
                        <option value="a2">A2 - Элементарный</option>
                        <option value="b1">B1 - Средний</option>
                        <option value="b2">B2 - Средне-продвинутый</option>
                        <option value="c1">C1 - Продвинутый</option>
                        <option value="c2">C2 - Свободное владение</option>
                        <option value="native">Родной язык</option>
                    </select>
                </div>
            </div>
        </div>`;
    }

    addNewSection(sectionType) {
        if (this.currentSections.has(sectionType)) return;

        const sectionsContainer = document.getElementById('resume-sections');
        const sectionHtml = this.getNewSectionHTML(sectionType);

        sectionsContainer.insertAdjacentHTML('beforeend', sectionHtml);
        this.currentSections.add(sectionType);

        // Скрыть кнопку добавления этой секции
        const addBtn = document.querySelector(`[data-section="${sectionType}"]`);
        if (addBtn && addBtn.textContent.trim() !== '+') {
            addBtn.style.display = 'none';
        }

        this.saveData();
    }

    getNewSectionHTML(sectionType) {
        const sectionConfigs = {
            profile: {
                title: 'Профиль',
                template: 'textarea'
            },
            projects: {
                title: 'Проекты',
                template: 'textarea'
            },
            certificates: {
                title: 'Сертификаты',
                template: 'textarea'
            },
            courses: { title: 'Курсы', template: 'textarea' },
            internships: { title: 'Стажировки', template: 'textarea' },
            activities: { title: 'Дополнительные виды деятельности', template: 'textarea' },
            references: { title: 'Рекомендации', template: 'textarea' },
            qualities: { title: 'Качества', template: 'textarea' },
            achievements: { title: 'Достижения', template: 'textarea' },
            signature: { title: 'Подпись', template: 'textarea' },
            footer: { title: 'Нижний колонтитул', template: 'textarea' },
            assessment: { title: 'Результаты теста', template: 'textarea' },
            custom: { title: 'Собственный раздел', template: 'textarea' }
        };

        const config = sectionConfigs[sectionType];
        if (!config) return '';

        return `
        <div class="flex w-full items-center relative bg-white rounded-large draggable-section">
            <button type="button" class="remove-section-btn absolute top-2 right-2 z-10 inline-flex items-center justify-center text-gray-500 hover:text-red-600 bg-white/95 border border-gray-200 rounded-full p-2 shadow-sm focus-visible:ring-2 ring-red-200" data-section="${sectionType}" aria-label="Удалить раздел">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" class="w-4 h-4">
                    <path fill="currentColor" d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
            </button>
            <div class="w-full flex relative flex-col">
                <div class="w-full border-b border-gray-200 collapsible-section">
                    <div class="flex items-stretch w-full">
                        <button type="button" class="flex-grow py-3 pe-10 text-start overflow-hidden rounded focus-visible:ring-4 ring-brand-200 ring-inset">
                            <h3 class="text-xl truncate text-gray-800 font-bold select-none">${config.title}</h3>
                        </button>
                        <div class="py-6 flex whitespace-nowrap items-start gap-2">
                            ${config.template !== 'textarea' ? `
                            <button class="add-section-item inline-flex border justify-center rounded-brand relative overflow-hidden max-w-full focus-visible:ring-4 ring-brand-200 items-center bg-transparent active:bg-brand-100 can-hover:active:bg-brand-100 text-gray-700 border-gray-400 can-hover:hover:bg-brand-50 can-hover:hover:border-brand-400 font-medium py-1 ps-1 pe-1 text-base" 
                                    type="button" 
                                    data-section="${sectionType}"
                                    style="outline: none;">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" class="pointer-events-none flex-shrink-0 box-content h-6 w-6">
                                    <path fill="currentColor" d="M450.001-450.001h-200q-12.75 0-21.375-8.628t-8.625-21.384 8.625-21.371 21.375-8.615h200v-200q0-12.75 8.628-21.375t21.384-8.625 21.371 8.625 8.615 21.375v200h200q12.75 0 21.375 8.628t8.625 21.384-8.625 21.371-21.375 8.615h-200v200q0 12.75-8.628 21.375t-21.384 8.625-21.371-8.625-8.615-21.375z"></path>
                                </svg>
                            </button>` : ''}
                        </div>
                    </div>
                    <div id="${sectionType}-items" class="${config.template === 'textarea' ? 'mb-4' : 'hidden'}">
                        ${this.getSectionContentHTML(sectionType, config.template)}
                    </div>
                </div>
            </div>
        </div>`;
    }

    getSectionContentHTML(sectionType, template) {
        if (template === 'textarea') {
            return `
            <div class="mb-4">
                <textarea class="w-full border border-gray-300 rounded py-2 px-3 focus:border-brand-400 focus:bg-brand-50" 
                          rows="4" 
                          placeholder="Краткое описание о себе, ваших целях и профессиональных качествах" 
                          name="${sectionType}_content"></textarea>
            </div>`;
        }
        return '';
    }

    handlePhotoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Проверка типа файла
        if (!file.type.startsWith('image/')) {
            alert('Пожалуйста, выберите изображение');
            return;
        }

        // Проверка размера файла (максимум 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('Размер файла не должен превышать 5MB');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const photoButton = document.getElementById('photo-upload');
            photoButton.style.backgroundImage = `url(${e.target.result})`;
            photoButton.innerHTML = '';
            this.userData.personalInfo.photo = e.target.result;
            this.saveData();
        };

        reader.readAsDataURL(file);
    }

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Проверка формата файла
        const allowedTypes = ['.pdf', '.doc', '.docx'];
        const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

        if (!allowedTypes.includes(fileExtension)) {
            alert('Поддерживаются только файлы PDF, DOC и DOCX');
            return;
        }

        // Здесь можно добавить логику для парсинга загруженного резюме
        alert('Функция загрузки резюме находится в разработке');
    }

    importLinkedIn() {
        // Здесь можно добавить интеграцию с LinkedIn API
        alert('Функция импорта из LinkedIn находится в разработке');
    }

    downloadCV() {
        // Сохранение данных перед скачиванием
        this.saveData();

        // Отправка данных на сервер для генерации PDF
        fetch('/api/cv/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(this.userData)
        })
            .then(async (response) => {
                const ct = response.headers.get('content-type') || '';
                if (response.ok && ct.includes('application/pdf')) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${this.getDocumentTitle() || 'resume'}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    return;
                }
                // сервер пока возвращает JSON-заглушку
                const data = await response.json().catch(() => ({ success: false }));
                if (response.status === 401) {
                    this.redirectToAuthRequired();
                    return;
                }
                const msg = data?.message || 'Ошибка при генерации PDF';
                throw new Error(msg);
            })
            .catch(error => {
                console.error('Ошибка:', error);
                alert(`Не удалось скачать резюме: ${error.message || 'неизвестная ошибка'}`);
            });
    }

    downloadDocx() {
        this.saveData();

        // Проверяем, выбран ли шаблон
        if (!this.selectedDocxTemplate) {
            alert('Пожалуйста, выберите шаблон резюме на странице создания.');
            window.location.href = '/pages/template-selection';
            return;
        }

        fetch('/api/cv/download-docx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userData: this.userData,
                selectedTemplate: this.selectedDocxTemplate
            })
        })
            .then(async (response) => {
                const ct = response.headers.get('content-type') || '';
                if (response.ok && ct.includes('officedocument.wordprocessingml.document')) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${this.getDocumentTitle() || 'resume'}.docx`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    return;
                }
                const data = await response.json().catch(() => ({ success: false }));
                if (response.status === 401) {
                    this.redirectToAuthRequired();
                    return;
                }
                const msg = data?.message || 'Ошибка при генерации DOCX';
                throw new Error(msg);
            })
            .catch(error => {
                console.error('Ошибка DOCX:', error);
                alert(`Не удалось скачать DOCX: ${error.message || 'неизвестная ошибка'}`);
            });
    }

    showPreview() {
        // Сохранение данных и принудительное включение панели превью справа
        this.saveData();
        document.body.classList.toggle('force-preview');
        // Отправить актуальные данные в iframe
        this.pushLivePreview();
    }

    applyTemplateFromQuery() {
        try {
            const url = new URL(window.location.href);
            const tpl = url.searchParams.get('template');
            const allowed = new Set(['modern', 'classic', 'minimal', 'creative', 'european', 'europass']);
            if (tpl && allowed.has(tpl)) {
                this.userData.template = tpl;
                // визуально отметить
                document.querySelectorAll('.template-option').forEach(btn => {
                    if (btn.dataset.template === tpl) {
                        btn.classList.add('ring-2', 'ring-brand-400', 'border-brand-400');
                    } else {
                        btn.classList.remove('ring-2', 'ring-brand-400', 'border-brand-400');
                    }
                });
                this.setPreviewSrc(tpl);
            }
        } catch (_) { }
    }

    loadTemplateFromQuery() {
        try {
            const url = new URL(window.location.href);
            const template = url.searchParams.get('template');
            const exampleUrl = url.searchParams.get('example');

            // Если пришёл пример из папки cv_templates, показываем его справа
            if (exampleUrl) {
                const decoded = decodeURIComponent(exampleUrl);
                this.ensurePreviewVisible();

                // Определим визуальный шаблон по имени файла примера
                let visualTpl = this.userData?.template || 'modern';
                try {
                    if (/free-experienced-template-resume\.pdf$/i.test(decoded)) {
                        visualTpl = 'classic';
                    } else if (/free-resume-example-entry-level\.pdf$/i.test(decoded)) {
                        visualTpl = 'minimal';
                    }
                } catch (_) { }

                // Учитываем выбранный режим превью: PDF или HTML
                if (this.previewMode === 'pdf') {
                    this.setPreviewToUrl(decoded);
                } else {
                    // В HTML-режиме показываем редактируемое превью шаблона
                    this.userData.template = visualTpl;
                    // Подсветим выбор визуально
                    document.querySelectorAll('.template-option').forEach(btn => {
                        if (btn.dataset.template === visualTpl) {
                            btn.classList.add('ring-2', 'ring-brand-400', 'border-brand-400');
                        } else {
                            btn.classList.remove('ring-2', 'ring-brand-400', 'border-brand-400');
                        }
                    });
                    this.setPreviewSrc(visualTpl);
                }

                // Если одновременно передан визуальный шаблон — отметим выбор в UI
                const visualSet = new Set(['modern', 'classic', 'minimal', 'creative', 'european', 'europass']);
                if (template && visualSet.has(template)) {
                    this.selectTemplate(template);
                }
                this.updateTemplateLabel();
                return;
            }
            // Если передан визуальный шаблон из страницы выбора — применяем его напрямую
            const visualSet = new Set(['modern', 'classic', 'minimal', 'creative', 'european', 'europass']);
            if (template && visualSet.has(template)) {
                // Приоритет выбранного на странице шаблонов над локально сохранённым
                this.selectTemplate(template);
                this.ensurePreviewVisible();
                this.updateTemplateLabel();
                this.showTemplateToast(template);
                // Для известных примеров показываем реальный файл из cv_templates справа
                const pdfMap = {
                    classic: '/cv_templates/free-experienced-template-resume.pdf',
                    minimal: '/cv_templates/free-resume-example-entry-level.pdf'
                };
                if (pdfMap[template]) {
                    if (this.previewMode === 'pdf') {
                        this.setPreviewToUrl(pdfMap[template]);
                    } else {
                        this.setPreviewSrc(template);
                    }
                } else {
                    this.setPreviewSrc(template);
                }
                return;
            }

            // Маппинг шаблонов на файлы DOCX
            const templateMap = {
                'experienced': '/cv_templates/free-experienced-template-resume.docx',
                'entry-level': '/cv_templates/free-resume-example-entry-level.docx',
                'custom': null // Создание с нуля - используем обычный конструктор
            };

            if (template && templateMap[template]) {
                this.selectedDocxTemplate = templateMap[template];
                console.log('Загружен шаблон:', template, '→', this.selectedDocxTemplate);

                // Отобразить соответствующий визуальный шаблон в превью
                const visualMap = {
                    'experienced': 'classic',
                    'entry-level': 'minimal',
                    'custom': 'modern'
                };
                const visualTpl = visualMap[template] || 'modern';
                this.userData.template = visualTpl;
                // Подсветить выбор, если есть кнопки вариантов
                document.querySelectorAll('.template-option').forEach(btn => {
                    if (btn.dataset.template === visualTpl) {
                        btn.classList.add('ring-2', 'ring-brand-400', 'border-brand-400');
                    } else {
                        btn.classList.remove('ring-2', 'ring-brand-400', 'border-brand-400');
                    }
                });
                // Обновить превью сразу
                this.ensurePreviewVisible();
                this.pushLivePreview();
                this.updateTemplateLabel();

                // Яркое уведомление пользователю
                this.showTemplateToast(visualTpl, { docxId: template });
                // Для соответствующих DOCX-примеров показываем PDF-вариант справа
                const docxToPdf = {
                    'experienced': '/cv_templates/free-experienced-template-resume.pdf',
                    'entry-level': '/cv_templates/free-resume-example-entry-level.pdf'
                };
                if (docxToPdf[template]) {
                    if (this.previewMode === 'pdf') {
                        this.setPreviewToUrl(docxToPdf[template]);
                    } else {
                        this.setPreviewSrc(visualTpl);
                    }
                } else {
                    this.setPreviewSrc(visualTpl);
                }
            } else if (template === 'custom') {
                this.selectedDocxTemplate = null;
                console.log('Режим создания с нуля');
                this.userData.template = 'modern';
                this.ensurePreviewVisible();
                this.pushLivePreview();
                this.updateTemplateLabel();
                this.showTemplateToast('modern');
                this.setPreviewSrc('modern');
            }
        } catch (err) {
            console.error('Ошибка загрузки шаблона:', err);
        }
    }

    // Яркий тост «Шаблон применён» с названием шаблона и автоскрытием
    showTemplateToast(templateKey, opts = {}) {
        try {
            const nameMap = {
                modern: 'Современный',
                classic: 'Классический',
                minimal: 'Минималистичный',
                creative: 'Креативный',
                european: 'Европейский',
                europass: 'Europass'
            };
            const docxMap = { 'experienced': 'Experienced', 'entry-level': 'Entry-level' };
            const label = nameMap[templateKey] || 'Шаблон';
            const docxNote = opts.docxId && docxMap[opts.docxId] ? ` · DOCX: ${docxMap[opts.docxId]}` : '';

            const toast = document.createElement('div');
            toast.className = 'fixed top-6 right-6 z-50 w-[380px] max-w-[90vw] bg-white border border-blue-200 shadow-xl rounded-xl overflow-hidden';
            toast.innerHTML = `
              <div class="h-1 w-full bg-gradient-to-r from-blue-500 via-sky-400 to-cyan-400"></div>
              <div class="p-4 flex items-start gap-3">
                <div class="shrink-0 rounded-md bg-blue-50 text-blue-600 p-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-5 h-5"><path fill="currentColor" d="M10.6 13.8L8.2 11.4l-1.4 1.4l3.8 3.8l7.8-7.8l-1.4-1.4z"/></svg>
                </div>
                <div class="flex-1">
                  <div class="font-semibold text-gray-900">Шаблон применён: ${label}${docxNote}</div>
                  <div class="text-sm text-gray-600 mt-0.5">Предпросмотр справа открыт и обновляется автоматически при вводе.</div>
                </div>
                <button type="button" class="text-gray-400 hover:text-gray-600" aria-label="Закрыть" data-close-toast>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-5 h-5"><path fill="currentColor" d="m12 13.4l-4.9 4.9l-1.4-1.4L10.6 12L5.7 7.1l1.4-1.4L12 10.6l4.9-4.9l1.4 1.4L13.4 12l4.9 4.9l-1.4 1.4z"/></svg>
                </button>
              </div>`;

            document.body.appendChild(toast);
            const close = () => {
                toast.classList.add('opacity-0', 'transition-opacity', 'duration-300');
                setTimeout(() => toast.remove(), 320);
            };
            toast.querySelector('[data-close-toast]')?.addEventListener('click', close);
            setTimeout(close, 4800);
        } catch (_) { }
    }

    getDocumentTitle() {
        const titleInput = document.getElementById('document-title');
        return titleInput ? titleInput.value : '';
    }

    redirectToAuthRequired() {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/pages/auth-required.html?next=${next}`;
    }

    collectFormData() {
        const formData = {
            personalInfo: {},
            employment: [],
            education: [],
            skills: [],
            languages: [],
            additionalSections: {},
            template: this.userData.template || 'modern',
            settings: {
                fontSize: 'medium',
                colorScheme: 'blue',
                includePhoto: true,
                ...(this.userData.settings || {})
            }
        };

        // Сбор персональных данных
        const personalFields = [
            'given-name', 'family-name', 'job-position', 'email',
            'phone', 'address', 'postal-code', 'city', 'birthdate',
            'website', 'linkedin'
        ];

        personalFields.forEach(field => {
            const element = document.getElementById(field);
            if (element && element.value) {
                formData.personalInfo[field] = element.value;
            }
        });

        // Флаг использования должности как заголовка
        const useAsHeadlineEl = document.getElementById('use-as-headline');
        if (useAsHeadlineEl) {
            formData.personalInfo.useAsHeadline = !!useAsHeadlineEl.checked;
        }

        // Добавление фото
        if (this.userData.personalInfo.photo) {
            formData.personalInfo.photo = this.userData.personalInfo.photo;
        }

        // Сбор данных по разделам
        ['employment', 'education', 'skills', 'languages'].forEach(section => {
            const container = document.getElementById(`${section}-items`);
            if (container) {
                const items = container.querySelectorAll('[data-item-id]');
                items.forEach(item => {
                    const itemData = {};
                    const inputs = item.querySelectorAll('input, textarea, select');
                    inputs.forEach(input => {
                        if (input.value) {
                            const fieldName = input.name.split('_').slice(1).join('_');
                            itemData[fieldName] = input.type === 'checkbox' ? input.checked : input.value;
                        }
                    });
                    if (Object.keys(itemData).length > 0) {
                        formData[section].push(itemData);
                    }
                });
            }
        });

        // Сбор дополнительных секций
        ['profile', 'projects', 'certificates', 'courses', 'internships', 'activities', 'references', 'qualities', 'achievements', 'signature', 'footer', 'assessment', 'custom'].forEach(section => {
            const container = document.getElementById(`${section}-items`);
            if (container) {
                const textarea = container.querySelector('textarea');
                if (textarea && textarea.value) {
                    formData.additionalSections[section] = textarea.value;
                }
            }
        });

        return formData;
    }


    schedulePreviewUpdate() {
        clearTimeout(this.previewTimer);
        this.previewTimer = setTimeout(() => this.pushLivePreview(), 200);
    }

    pushLivePreview() {
        const data = this.collectFormData();
        data.title = this.getDocumentTitle();
        if (this.userData && this.userData._id) {
            data._id = this.userData._id;
        }
        this.userData = data;
        try {
            localStorage.setItem('cvBuilderData', JSON.stringify(data));
        } catch (_) { }
        this.sendPreviewMessage(data);
    }

    sendPreviewMessage(data) {
        const frame = document.getElementById('live-preview-frame');
        if (frame && frame.contentWindow) {
            const targetOrigin = window.location.origin || '*';
            frame.contentWindow.postMessage({ type: 'cv-data', payload: data }, targetOrigin);
        }
    }

    setupPreviewStatusWatcher() {
        const panel = document.getElementById('live-preview-panel');
        if (!panel) return;
        let ready = false;
        let barEl = null;
        const warn = () => {
            if (ready) return;
            barEl = document.createElement('div');
            barEl.className = 'flex items-center justify-between gap-3 px-3 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200';
            const next = encodeURIComponent('/pages/cv-builder' + window.location.search);
            barEl.innerHTML = `
                <span>Предпросмотр не загрузился. Возможно, требуется вход или сервер не запущен.</span>
                <span class="flex items-center gap-2">
                  <a href="/pages/login?next=${next}" class="inline-flex items-center px-2 py-1 rounded border border-amber-300 text-amber-800 bg-white hover:bg-amber-100">Войти</a>
                  <button type="button" id="reload-preview-btn" class="inline-flex items-center px-2 py-1 rounded border border-amber-300 text-amber-800 bg-white hover:bg-amber-100">Перезагрузить</button>
                </span>`;
            panel.insertBefore(barEl, panel.firstChild);
            const btn = barEl.querySelector('#reload-preview-btn');
            btn?.addEventListener('click', () => {
                const iframe = document.getElementById('live-preview-frame');
                if (iframe) iframe.src = '/pages/cv-preview';
            });
        };
        const timer = setTimeout(warn, 2500);
        window.addEventListener('message', (e) => {
            if (e?.data?.type === 'cv-ready') {
                ready = true;
                clearTimeout(timer);
                if (barEl && barEl.parentNode) barEl.parentNode.removeChild(barEl);
            }
        });
    }

    async saveData({ immediate = false } = {}) {
        // Собираем данные и сохраняем локально
        this.userData = this.collectFormData();
        this.userData.title = this.getDocumentTitle();
        if (this.userData._id == null && typeof this._id === 'string') {
            this.userData._id = this._id;
        }
        localStorage.setItem('cvBuilderData', JSON.stringify(this.userData));

        // Не отправляем на сервер, пока явно не попросили (immediate)
        if (!immediate) return;

        // Если сохранение уже идёт — помечаем, что нужно выполнить ещё одно после текущего
        if (this.isSaving) {
            this.saveScheduled = true;
            return;
        }

        this.isSaving = true;
        try {
            const res = await fetch('/api/cv/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.userData)
            });
            if (res.status === 401) {
                this.redirectToAuthRequired();
                return;
            }
            const data = await res.json().catch(() => ({}));
            if (res.ok && data?.cv?._id) {
                this._id = data.cv._id;
                this.userData._id = data.cv._id;
                localStorage.setItem('cvBuilderData', JSON.stringify(this.userData));
            }
        } catch (error) {
            console.error('Ошибка сохранения на сервере:', error);
        } finally {
            this.isSaving = false;
        }

        // Если за время сохранения накопился ещё один запрос — выполняем его один раз (коалессим бурст)
        if (this.saveScheduled && !immediate) {
            this.saveScheduled = false;
            // Запускаем ещё одно сохранение, но не рекурсивно без конца
            return this.saveData();
        }
    }

    restoreSectionItems(section, items, fillCb) {
        if (!Array.isArray(items) || items.length === 0) return;
        const container = document.getElementById(`${section}-items`);
        items.forEach(() => this.addSectionItem(section));
        const added = container.querySelectorAll('[data-item-id]');
        added.forEach((el, idx) => {
            const itemId = el.getAttribute('data-item-id');
            fillCb(itemId, items[idx] || {});
        });
    }

    loadSavedData() {
        // Загрузка из localStorage
        const savedData = localStorage.getItem('cvBuilderData');
        if (savedData) {
            try {
                this.userData = JSON.parse(savedData);
                this.populateForm();
            } catch (error) {
                console.error('Ошибка при загрузке сохранённых данных:', error);
            }
        }
    }

    populateForm() {
        // Заполнение персональных данных
        Object.keys(this.userData.personalInfo || {}).forEach(key => {
            if (key === 'photo') {
                const photoButton = document.getElementById('photo-upload');
                if (photoButton && this.userData.personalInfo.photo) {
                    photoButton.style.backgroundImage = `url(${this.userData.personalInfo.photo})`;
                    photoButton.innerHTML = '';
                }
                return;
            }

            const element = document.getElementById(key);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = !!this.userData.personalInfo[key];
                } else {
                    element.value = this.userData.personalInfo[key];
                }
            }
        });

        // Заполнение заголовка документа
        if (this.userData.title) {
            const titleElement = document.getElementById('document-title');
            if (titleElement) {
                titleElement.value = this.userData.title;
            }
        }

        // Заполнение разделов из сохранённых данных
        this.restoreSectionItems('employment', this.userData.employment, (itemId, item) => {
            const root = document.querySelector(`[data-item-id="${itemId}"]`);
            if (!root) return;
            const mapping = {
                position: `${itemId}_position`,
                company: `${itemId}_company`,
                start_date: `${itemId}_start_date`,
                end_date: `${itemId}_end_date`,
                description: `${itemId}_description`,
                startDate: `${itemId}_start_date`,
                endDate: `${itemId}_end_date`,
            };
            Object.entries(mapping).forEach(([srcKey, name]) => {
                const el = root.querySelector(`[name="${name}"]`);
                if (el && item[srcKey]) el.value = item[srcKey];
            });
            const current = root.querySelector(`[name="${itemId}_current"]`);
            if (current && typeof item.current === 'boolean') {
                current.checked = item.current;
                current.dispatchEvent(new Event('change'));
            }
        });

        this.restoreSectionItems('education', this.userData.education, (itemId, item) => {
            const root = document.querySelector(`[data-item-id="${itemId}"]`);
            if (!root) return;
            const mapping = {
                school: `${itemId}_school`,
                degree: `${itemId}_degree`,
                level: `${itemId}_level`,
                start_year: `${itemId}_start_year`,
                end_year: `${itemId}_end_year`,
                startYear: `${itemId}_start_year`,
                endYear: `${itemId}_end_year`,
            };
            Object.entries(mapping).forEach(([srcKey, name]) => {
                const el = root.querySelector(`[name="${name}"]`);
                if (el && item[srcKey]) el.value = item[srcKey];
            });
        });

        this.restoreSectionItems('skills', this.userData.skills, (itemId, item) => {
            const root = document.querySelector(`[data-item-id="${itemId}"]`);
            if (!root) return;
            const mapping = { skill: `${itemId}_skill`, level: `${itemId}_level` };
            Object.entries(mapping).forEach(([srcKey, name]) => {
                const el = root.querySelector(`[name="${name}"]`);
                if (el && item[srcKey]) el.value = item[srcKey];
            });
        });

        this.restoreSectionItems('languages', this.userData.languages, (itemId, item) => {
            const root = document.querySelector(`[data-item-id="${itemId}"]`);
            if (!root) return;
            const mapping = { language: `${itemId}_language`, level: `${itemId}_level` };
            Object.entries(mapping).forEach(([srcKey, name]) => {
                const el = root.querySelector(`[name="${name}"]`);
                if (el && item[srcKey]) el.value = item[srcKey];
            });
        });

        // Отметить выбранный шаблон
        if (this.userData.template) {
            const current = this.userData.template;
            document.querySelectorAll('.template-option').forEach(btn => {
                if (btn.dataset.template === current) {
                    btn.classList.add('ring-2', 'ring-brand-400', 'border-brand-400');
                } else {
                    btn.classList.remove('ring-2', 'ring-brand-400', 'border-brand-400');
                }
            });
        }

        // Восстановление текстовых дополнительных секций (textarea)
        const extraSections = ['profile', 'projects', 'certificates', 'courses', 'internships', 'activities', 'references', 'qualities', 'achievements', 'signature', 'footer', 'assessment', 'custom'];
        extraSections.forEach(section => {
            const value = this.userData?.additionalSections?.[section];
            if (!value) return;
            if (!this.currentSections.has(section)) {
                this.addNewSection(section);
            }
            const textarea = document.querySelector(`#${section}-items textarea`);
            if (textarea) {
                textarea.value = value;
            }
        });

        this.pushLivePreview();
    }

    setupAutoSave() {
        // Автосохранение каждые 30 секунд
        setInterval(() => {
            this.saveData(); // теперь только локально, без отправки на сервер
            this.sendPreviewMessage(this.userData);
        }, 30000);

        // Сохранение при закрытии страницы
        window.addEventListener('beforeunload', () => {
            this.saveData(); // только локально
            this.sendPreviewMessage(this.userData);
        });
    }

    selectTemplate(templateName) {
        if (!templateName) return;
        this.userData.template = templateName;
        // Обновить визуальную подсветку выбранного шаблона
        document.querySelectorAll('.template-option').forEach(btn => {
            if (btn.dataset.template === templateName) {
                btn.classList.add('ring-2', 'ring-brand-400', 'border-brand-400');
            } else {
                btn.classList.remove('ring-2', 'ring-brand-400', 'border-brand-400');
            }
        });
        this.updateTemplateLabel();
        // Синхронизировать базовый DOCX для экспорта
        const docxVisualMap = {
            'classic': 'experienced',
            'minimal': 'entry-level',
            'modern': null,
            'creative': null,
            'european': null,
            'europass': null
        };
        const docxId = docxVisualMap[templateName];
        this.selectedDocxTemplate = docxId ? this.docxTemplateMap[docxId] : null;
        try {
            const toast = document.createElement('div');
            toast.className = 'fixed bottom-4 right-4 bg-white border border-gray-200 shadow-lg rounded-lg px-4 py-2 text-sm text-gray-700 z-50';
            toast.textContent = this.selectedDocxTemplate ? 'Экспорт DOCX: базовый шаблон выбран автоматически' : 'Экспорт DOCX: создание с нуля';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
        } catch (_) { }
        this.saveData(); // только локально; сервер — по кнопке
        this.ensurePreviewVisible();
        this.pushLivePreview();
        this.applyPreviewForTemplate(templateName);
    }

    // Применяет iframe превью согласно текущему режиму и выбранному шаблону
    applyPreviewForTemplate(template) {
        try {
            const pdfMap = {
                classic: '/cv_templates/free-experienced-template-resume.pdf',
                minimal: '/cv_templates/free-resume-example-entry-level.pdf'
            };
            if (this.previewMode === 'pdf' && pdfMap[template]) {
                this.setPreviewToUrl(pdfMap[template]);
            } else {
                // В HTML-режиме открываем пер-шаблонную страницу
                const frame = document.getElementById('live-preview-frame');
                if (!frame) return;
                const routeMap = {
                    classic: '/templates/classic.html',
                    minimal: '/templates/minimal.html'
                };
                const url = routeMap[template] || '/pages/cv-preview';
                frame.src = `${url}`;
                // отправим данные после короткой задержки (страница загрузится)
                setTimeout(() => this.sendPreviewMessage(this.userData), 150);
            }
        } catch (_) { }
    }

    updateTemplateLabel() {
        const el = document.getElementById('current-template-label');
        if (!el) return;
        const map = {
            modern: 'Современный',
            classic: 'Классический',
            minimal: 'Минималистичный',
            creative: 'Креативный',
            european: 'Европейский',
            europass: 'Europass'
        };
        const name = map[this.userData?.template] || 'Современный';
        el.textContent = name;
    }

    ensurePreviewVisible() {
        try {
            document.body.classList.add('force-preview');
            const frame = document.getElementById('live-preview-frame');
            if (frame && frame.contentWindow) {
                // Небольшая задержка для показа панели перед отправкой
                setTimeout(() => this.sendPreviewMessage(this.userData), 50);
            }
        } catch (_) { }
    }

    // Устанавливает src iframe с выбранным шаблоном (fallback до postMessage)
    setPreviewSrc(template) {
        try {
            const frame = document.getElementById('live-preview-frame');
            if (!frame) return;
            const base = '/pages/cv-preview';
            const ts = Date.now();
            frame.src = `${base}?template=${encodeURIComponent(template)}&ts=${ts}`;
        } catch (_) { }
    }

    // Устанавливает превью на произвольный URL (пример из /cv_templates)
    setPreviewToUrl(url) {
        try {
            const frame = document.getElementById('live-preview-frame');
            if (!frame) return;
            const isDocx = /\.docx(?:$|\?)/i.test(url);
            const isPdf = /\.pdf(?:$|\?)/i.test(url);
            if (isPdf) {
                const abs = url.startsWith('/') ? url : `/cv_templates/${url}`;
                frame.src = `/pages/pdf-overlay?src=${encodeURIComponent(abs)}`;
                setTimeout(() => this.sendPreviewMessage(this.userData), 200);
            } else if (isDocx) {
                // Для DOCX показываем информативную заглушку внутри cv-preview
                const abs = url.startsWith('/') ? url : `/cv_templates/${url}`;
                frame.src = `/pages/cv-preview?docx=${encodeURIComponent(abs)}`;
            } else {
                frame.src = url;
            }
        } catch (_) { }
    }

    clearAllFields() {
        // Сброс базовых полей
        document.querySelectorAll('#cv-form input, #cv-form textarea, #cv-form select').forEach(el => {
            if (el.type === 'checkbox' || el.type === 'radio') {
                el.checked = false;
            } else {
                el.value = '';
            }
        });

        // Сброс фото
        const photoButton = document.getElementById('photo-upload');
        if (photoButton) {
            photoButton.style.backgroundImage = '';
            photoButton.innerHTML = '<div class="sr-only">Обновить фото</div><span class="relative"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" class="w-8 text-gray-400"><path fill="currentColor" d="M440-275.39q68.85 0 116.73-47.88T604.61-440t-47.88-116.73T440-604.61t-116.73 47.88T275.39-440t47.88 116.73T440-275.39"></path></svg></span>';
        }

        // Удаление динамических элементов разделов
        ['employment', 'education', 'skills', 'languages'].forEach(section => {
            const container = document.getElementById(`${section}-items`);
            if (container) {
                container.innerHTML = '';
                container.classList.add('hidden');
            }
            this.itemCounters[section] = 0;
        });

        // Очистка дополнительных секций (textarea)
        ['profile', 'projects', 'certificates', 'courses', 'internships', 'activities', 'references', 'qualities', 'achievements', 'signature', 'footer', 'custom'].forEach(section => {
            const container = document.getElementById(`${section}-items`);
            if (container) {
                const textarea = container.querySelector('textarea');
                if (textarea) textarea.value = '';
            }
        });

        // Удаление дополнительных полей персональной информации
        document.querySelectorAll('[data-field-type]').forEach(el => el.remove());
        document.querySelectorAll('.add-field-btn').forEach(btn => btn.style.display = '');

        // Сброс выбранного шаблона на modern
        this.selectTemplate('modern');

        // Сброс локальных данных
        this.userData = {
            personalInfo: {},
            employment: [],
            education: [],
            skills: [],
            languages: [],
            additionalSections: {},
            template: 'modern',
            settings: { fontSize: 'medium', colorScheme: 'blue', includePhoto: true }
        };
        localStorage.removeItem('cvBuilderData');
    }
}

// Инициализация CV Builder при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.__cvBuilderInstance = new CVBuilder();
    } catch (err) {
        console.error('CVBuilder init failed:', err);
    }

    // Обработчик удаления элементов
    document.addEventListener('click', (e) => {
        if (e.target.closest('.remove-item-btn')) {
            const itemId = e.target.closest('.remove-item-btn').dataset.item;
            const item = document.querySelector(`[data-item-id="${itemId}"]`);
            if (item) {
                item.remove();
                // Проверка, есть ли ещё элементы в разделе
                const container = item.closest('[id$="-items"]');
                if (container && container.children.length === 0) {
                    container.classList.add('hidden');
                }
            }
        }

        if (e.target.closest('.remove-field-btn')) {
            const fieldType = e.target.closest('.remove-field-btn').dataset.field;
            const field = document.querySelector(`[data-field-type="${fieldType}"]`);
            if (field) {
                field.remove();
                // Показать кнопку добавления поля снова
                const button = document.querySelector(`[data-field="${fieldType}"]`);
                if (button) {
                    button.style.display = '';
                }
            }
        }

        if (e.target.closest('.remove-section-btn')) {
            const sectionType = e.target.closest('.remove-section-btn').dataset.section;
            const section = e.target.closest('.draggable-section');
            if (section) {
                section.remove();
                try { window.__cvBuilderInstance?.pushHistory(); } catch (_) { }
                // Показать кнопку добавления секции снова
                const button = document.querySelector(`[data-section="${sectionType}"]`);
                if (button && button.textContent.trim() !== '+') {
                    button.style.display = '';
                }
            }
        }

        // Глобальное делегирование кликов для устойчивости
        const addSectionBtn = e.target.closest('.add-section-btn');
        if (addSectionBtn) {
            e.preventDefault();
            e.stopPropagation();
            try {
                window.__cvBuilderInstance?.addNewSection(addSectionBtn.dataset.section);
            } catch (err) {
                console.error('Error adding section:', err);
            }
        }
        const addItemBtn = e.target.closest('.add-section-item');
        if (addItemBtn) {
            e.preventDefault();
            try {
                window.__cvBuilderInstance?.addSectionItem(addItemBtn.dataset.section);
            } catch (err) {
                console.error('Error adding item:', err);
            }
        }
        const addFieldBtn = e.target.closest('.add-field-btn');
        if (addFieldBtn) {
            e.preventDefault();
            try {
                window.__cvBuilderInstance?.addPersonalField(addFieldBtn.dataset.field);
            } catch (err) {
                console.error('Error adding field:', err);
            }
        }
        const templateBtn = e.target.closest('.template-option');
        if (templateBtn) {
            try {
                window.__cvBuilderInstance?.selectTemplate(templateBtn.dataset.template);
            } catch (err) {
                console.error('Error selecting template:', err);
            }
        }
        const photoBtn = e.target.closest('#photo-upload');
        if (photoBtn) {
            const input = document.getElementById('photo-input');
            if (input) input.click();
        }
    });

    // Глобальная обработка изменения фото
    const photoInput = document.getElementById('photo-input');
    if (photoInput) {
        photoInput.addEventListener('change', (e) => {
            try { window.__cvBuilderInstance?.handlePhotoUpload(e); } catch (_) { }
        });
    }
});