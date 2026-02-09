class CVBuilder {
    constructor() {
        this.currentSections = new Set(['employment', 'education', 'skills', 'languages']);
        this.itemCounters = {};
        this.isSaving = false;
        this.saveScheduled = false;
        this.selectedDocxTemplate = null; // Выбранный DOCX шаблон
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
                } catch (_) {}
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
        
        if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadCV());
        if (downloadDocxBtn) downloadDocxBtn.addEventListener('click', () => this.downloadDocx());
        const downloadPngBtn = document.getElementById('download-png-btn');
        if (downloadPngBtn) downloadPngBtn.addEventListener('click', () => this.requestPngExport());
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
                optionsMenu?.classList.add('hidden');
            });
        }
        if (saveFromOptionsBtn) {
            saveFromOptionsBtn.addEventListener('click', async () => {
                await this.saveData({ immediate: true });
                optionsMenu?.classList.add('hidden');
            });
        }
        if (addTestResultsBtn) {
            addTestResultsBtn.addEventListener('click', async () => {
                optionsMenu?.classList.add('hidden');
                try {
                    let payload = null;
                    // Сначала пробуем с сервера
                    const res = await fetch('/api/assessment/latest');
                    if (res.status === 401) {
                        this.redirectToAuthRequired();
                        return;
                    }
                    const data = await res.json();
                    if (res.ok && data?.success) {
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
                        } catch (_) {}
                    }

                    if (!payload || typeof payload.score !== 'number') {
                        alert(data?.message || 'Нет сохранённых результатов теста. Пройдите тест и сохраните результат (>65%).');
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
        } catch (_) {}
    }
    pushHistory() {
        try { this.__history.push(this.snapshot()); } catch (_) {}
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
        ['employment','education','skills','languages'].forEach(section => {
            const container = document.getElementById(`${section}-items`);
            if (container) { container.innerHTML = ''; container.classList.add('hidden'); }
            this.itemCounters[section] = 0;
        });
        // Remove extra sections blocks
        document.querySelectorAll('#resume-sections .draggable-section').forEach((el, idx) => {
            if (idx > 3) el.remove(); // keep the first 4 base sections
        });
        this.currentSections = new Set(['employment','education','skills','languages']);
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
                        fontSize:'medium',
                        colorScheme:'blue',
                        includePhoto:true,
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
            const data = await response.json().catch(() => ({ success:false }));
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
            const data = await response.json().catch(() => ({ success:false }));
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
            const allowed = new Set(['modern','classic','minimal','creative','european','europass']);
            if (tpl && allowed.has(tpl)) {
                this.userData.template = tpl;
                // визуально отметить
                document.querySelectorAll('.template-option').forEach(btn => {
                    if (btn.dataset.template === tpl) {
                        btn.classList.add('ring-2','ring-brand-400','border-brand-400');
                    } else {
                        btn.classList.remove('ring-2','ring-brand-400','border-brand-400');
                    }
                });
            }
        } catch (_) {}
    }

    loadTemplateFromQuery() {
        try {
            const url = new URL(window.location.href);
            const template = url.searchParams.get('template');
            
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
                        btn.classList.add('ring-2','ring-brand-400','border-brand-400');
                    } else {
                        btn.classList.remove('ring-2','ring-brand-400','border-brand-400');
                    }
                });
                // Обновить превью сразу
                this.ensurePreviewVisible();
                this.pushLivePreview();
                this.updateTemplateLabel();

                // Показать уведомление пользователю
                const notification = document.createElement('div');
                notification.className = 'fixed top-20 right-4 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg z-50';
                notification.innerHTML = `
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" class="w-5 h-5">
                            <path fill="currentColor" d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/>
                        </svg>
                        <span>Шаблон выбран! Заполните данные — превью справа обновляется автоматически.</span>
                    </div>
                `;
                document.body.appendChild(notification);
                setTimeout(() => notification.remove(), 5000);
            } else if (template === 'custom') {
                this.selectedDocxTemplate = null;
                console.log('Режим создания с нуля');
                this.userData.template = 'modern';
                this.ensurePreviewVisible();
                this.pushLivePreview();
                this.updateTemplateLabel();
            }
        } catch (err) {
            console.error('Ошибка загрузки шаблона:', err);
        }
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
        } catch (_) {}
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
        const warn = () => {
            if (ready) return;
            const bar = document.createElement('div');
            bar.className = 'px-4 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-200';
            bar.textContent = 'Предпросмотр не загрузился. Проверьте авторизацию и запуск сервера.';
            panel.insertBefore(bar, panel.firstChild);
        };
        const timer = setTimeout(warn, 2500);
        window.addEventListener('message', (e) => {
            if (e?.data?.type === 'cv-ready') {
                ready = true;
                clearTimeout(timer);
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
                    btn.classList.add('ring-2','ring-brand-400','border-brand-400');
                } else {
                    btn.classList.remove('ring-2','ring-brand-400','border-brand-400');
                }
            });
        }

        // Восстановление текстовых дополнительных секций (textarea)
        const extraSections = ['profile','projects','certificates','courses','internships','activities','references','qualities','achievements','signature','footer','assessment','custom'];
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
                btn.classList.add('ring-2','ring-brand-400','border-brand-400');
            } else {
                btn.classList.remove('ring-2','ring-brand-400','border-brand-400');
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
        } catch (_) {}
        this.saveData(); // только локально; сервер — по кнопке
        this.ensurePreviewVisible();
        this.pushLivePreview();
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
        } catch (_) {}
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
        ['employment','education','skills','languages'].forEach(section => {
            const container = document.getElementById(`${section}-items`);
            if (container) {
                container.innerHTML = '';
                container.classList.add('hidden');
            }
            this.itemCounters[section] = 0;
        });

        // Очистка дополнительных секций (textarea)
        ['profile','projects','certificates','courses','internships','activities','references','qualities','achievements','signature','footer','custom'].forEach(section => {
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
                try { window.__cvBuilderInstance?.pushHistory(); } catch(_){}
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
            } catch(err) {
                console.error('Error adding section:', err);
            }
        }
        const addItemBtn = e.target.closest('.add-section-item');
        if (addItemBtn) {
            e.preventDefault();
            try { 
                window.__cvBuilderInstance?.addSectionItem(addItemBtn.dataset.section); 
            } catch(err) {
                console.error('Error adding item:', err);
            }
        }
        const addFieldBtn = e.target.closest('.add-field-btn');
        if (addFieldBtn) {
            e.preventDefault();
            try { 
                window.__cvBuilderInstance?.addPersonalField(addFieldBtn.dataset.field); 
            } catch(err) {
                console.error('Error adding field:', err);
            }
        }
        const templateBtn = e.target.closest('.template-option');
        if (templateBtn) {
            try { 
                window.__cvBuilderInstance?.selectTemplate(templateBtn.dataset.template); 
            } catch(err) {
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
            try { window.__cvBuilderInstance?.handlePhotoUpload(e); } catch(_){}
        });
    }
});