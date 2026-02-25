/**
 * Placeholder Engine - Reactive CV Data Binding System
 * 
 * Handles real-time binding between form inputs and CV template placeholders.
 * Uses data attributes for field mapping and provides two-way binding.
 */

class PlaceholderEngine {
    constructor(options = {}) {
        this.container = options.container || document;
        this.formContainer = options.formContainer || null;
        this.onChange = options.onChange || null;
        this.state = {};
        this.fieldBindings = {};
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 50;

        this.init();
    }

    /**
     * Initialize the engine
     */
    init() {
        this.scanFields();
        this.setupFormBindings();
        this.setupEditableBindings();
    }

    /**
     * Scan document for all placeholder fields
     */
    scanFields() {
        const elements = this.container.querySelectorAll('[data-field]');
        this.fieldBindings = {};

        elements.forEach((el, index) => {
            const field = el.dataset.field;
            const blockId = el.dataset.blockId || `auto_${index}`;

            if (!this.fieldBindings[field]) {
                this.fieldBindings[field] = [];
            }

            this.fieldBindings[field].push({
                element: el,
                blockId,
                originalText: el.dataset.original || el.textContent,
                placeholder: el.dataset.placeholder || el.textContent
            });

            // Initialize state from existing content
            if (!this.state[field] && el.dataset.isPlaceholder !== 'true') {
                this.state[field] = el.textContent;
            }
        });

        return this.fieldBindings;
    }

    /**
     * Setup bindings for form inputs
     */
    setupFormBindings() {
        if (!this.formContainer) return;

        const inputs = this.formContainer.querySelectorAll('input, textarea, select');

        inputs.forEach(input => {
            const fieldName = input.dataset.field || input.name || input.id;
            if (!fieldName) return;

            // Set initial value from state
            if (this.state[fieldName]) {
                input.value = this.state[fieldName];
            }

            // Bind input events
            input.addEventListener('input', (e) => {
                this.updateField(fieldName, e.target.value);
            });

            // Also handle change for select elements
            input.addEventListener('change', (e) => {
                this.updateField(fieldName, e.target.value);
            });
        });
    }

    /**
     * Setup bindings for contenteditable elements
     */
    setupEditableBindings() {
        const editables = this.container.querySelectorAll('[contenteditable="true"][data-field]');

        editables.forEach(el => {
            const fieldName = el.dataset.field;

            el.addEventListener('input', () => {
                this.updateFieldFromElement(fieldName, el);
            });

            el.addEventListener('blur', () => {
                this.updateFieldFromElement(fieldName, el);
            });

            // Handle placeholder behavior
            el.addEventListener('focus', () => {
                if (el.dataset.isPlaceholder === 'true') {
                    el.textContent = '';
                    el.dataset.isPlaceholder = 'false';
                }
            });
        });
    }

    /**
     * Update a field value and sync to all bound elements
     */
    updateField(fieldName, value, options = {}) {
        const { skipHistory = false, source = 'input' } = options;

        // Save to history for undo
        if (!skipHistory) {
            this.saveToHistory();
        }

        // Update state
        this.state[fieldName] = value;

        // Update all bound elements
        const bindings = this.fieldBindings[fieldName] || [];
        bindings.forEach(binding => {
            const el = binding.element;

            if (value && value.trim()) {
                el.textContent = value;
                el.dataset.isPlaceholder = 'false';
            } else {
                el.textContent = binding.placeholder;
                el.dataset.isPlaceholder = 'true';
            }
        });

        // Update form inputs if change came from element
        if (source !== 'input' && this.formContainer) {
            const input = this.formContainer.querySelector(`[data-field="${fieldName}"], [name="${fieldName}"], #${fieldName}`);
            if (input && input.value !== value) {
                input.value = value || '';
            }
        }

        // Trigger onChange callback
        if (this.onChange) {
            this.onChange(fieldName, value, this.state);
        }

        return this;
    }

    /**
     * Update field from a contenteditable element
     */
    updateFieldFromElement(fieldName, element) {
        const value = element.textContent;
        this.updateField(fieldName, value, { source: 'element' });
    }

    /**
     * Update multiple fields at once
     */
    updateFields(data, options = {}) {
        const { skipHistory = false } = options;

        if (!skipHistory) {
            this.saveToHistory();
        }

        Object.entries(data).forEach(([field, value]) => {
            this.updateField(field, value, { skipHistory: true });
        });

        return this;
    }

    /**
     * Get current state of all fields
     */
    getState() {
        return { ...this.state };
    }

    /**
     * Set complete state
     */
    setState(state, options = {}) {
        this.state = { ...state };

        Object.entries(state).forEach(([field, value]) => {
            this.updateField(field, value, { skipHistory: true, ...options });
        });

        return this;
    }

    /**
     * Reset all fields to placeholders
     */
    reset() {
        this.saveToHistory();
        this.state = {};

        Object.values(this.fieldBindings).flat().forEach(binding => {
            binding.element.textContent = binding.placeholder;
            binding.element.dataset.isPlaceholder = 'true';
        });

        // Clear form inputs
        if (this.formContainer) {
            const inputs = this.formContainer.querySelectorAll('input, textarea');
            inputs.forEach(input => { input.value = ''; });
        }

        return this;
    }

    /**
     * Reset a specific field to placeholder
     */
    resetField(fieldName) {
        this.saveToHistory();
        delete this.state[fieldName];

        const bindings = this.fieldBindings[fieldName] || [];
        bindings.forEach(binding => {
            binding.element.textContent = binding.placeholder;
            binding.element.dataset.isPlaceholder = 'true';
        });

        return this;
    }

    /**
     * Save current state to history for undo
     */
    saveToHistory() {
        // Remove any forward history
        this.history = this.history.slice(0, this.historyIndex + 1);

        // Add current state
        this.history.push(JSON.stringify(this.state));
        this.historyIndex = this.history.length - 1;

        // Limit history size
        if (this.history.length > this.maxHistory) {
            this.history.shift();
            this.historyIndex--;
        }
    }

    /**
     * Undo last change
     */
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            const prevState = JSON.parse(this.history[this.historyIndex]);
            this.setState(prevState, { skipHistory: true });
        }
        return this;
    }

    /**
     * Redo last undone change
     */
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            const nextState = JSON.parse(this.history[this.historyIndex]);
            this.setState(nextState, { skipHistory: true });
        }
        return this;
    }

    /**
     * Get list of all available field names
     */
    getFieldNames() {
        return Object.keys(this.fieldBindings);
    }

    /**
     * Get bindings for a specific field
     */
    getFieldBindings(fieldName) {
        return this.fieldBindings[fieldName] || [];
    }

    /**
     * Check if a field has a value
     */
    hasValue(fieldName) {
        return !!this.state[fieldName];
    }

    /**
     * Get value for a field
     */
    getValue(fieldName) {
        return this.state[fieldName] || '';
    }

    /**
     * Export state as JSON
     */
    exportJson() {
        return JSON.stringify(this.state, null, 2);
    }

    /**
     * Import state from JSON
     */
    importJson(json) {
        try {
            const data = typeof json === 'string' ? JSON.parse(json) : json;
            this.setState(data);
            return true;
        } catch (e) {
            console.error('Failed to import JSON:', e);
            return false;
        }
    }

    /**
     * Highlight all placeholder elements
     */
    highlightPlaceholders() {
        Object.values(this.fieldBindings).flat().forEach(binding => {
            if (binding.element.dataset.isPlaceholder === 'true') {
                binding.element.classList.add('placeholder-highlight');
            }
        });
        return this;
    }

    /**
     * Remove placeholder highlights
     */
    removeHighlights() {
        this.container.querySelectorAll('.placeholder-highlight').forEach(el => {
            el.classList.remove('placeholder-highlight');
        });
        return this;
    }

    /**
     * Get completion status (how many fields are filled)
     */
    getCompletionStatus() {
        const total = Object.keys(this.fieldBindings).length;
        const filled = Object.keys(this.state).filter(k => this.state[k]).length;
        return {
            total,
            filled,
            percentage: total > 0 ? Math.round((filled / total) * 100) : 0,
            missing: Object.keys(this.fieldBindings).filter(k => !this.state[k])
        };
    }

    /**
     * Destroy the engine and remove event listeners
     */
    destroy() {
        // Note: In a real implementation, we'd need to track and remove
        // all event listeners. For now, this is a placeholder.
        this.container = null;
        this.formContainer = null;
        this.state = {};
        this.fieldBindings = {};
        this.history = [];
    }
}

/**
 * Create a form group element for a CV field
 */
function createFormField(fieldName, options = {}) {
    const {
        label = fieldName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()),
        type = 'text',
        placeholder = `Enter ${label.toLowerCase()}...`,
        required = false,
        multiline = false
    } = options;

    const div = document.createElement('div');
    div.className = 'form-group mb-4';

    const labelEl = document.createElement('label');
    labelEl.htmlFor = `cv-field-${fieldName}`;
    labelEl.className = 'block text-sm font-medium text-gray-700 mb-1';
    labelEl.textContent = label;
    if (required) {
        labelEl.innerHTML += ' <span class="text-red-500">*</span>';
    }

    const inputEl = multiline
        ? document.createElement('textarea')
        : document.createElement('input');

    inputEl.id = `cv-field-${fieldName}`;
    inputEl.name = fieldName;
    inputEl.dataset.field = fieldName;
    inputEl.placeholder = placeholder;
    inputEl.className = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500';

    if (!multiline) {
        inputEl.type = type;
    } else {
        inputEl.rows = 3;
    }

    if (required) {
        inputEl.required = true;
    }

    div.appendChild(labelEl);
    div.appendChild(inputEl);

    return div;
}

/**
 * Generate a complete form for CV fields
 */
function generateCVForm(fieldBindings, container) {
    // Group fields by category
    const categories = {
        personal: ['fullName', 'firstName', 'lastName', 'jobTitle', 'email', 'phone', 'address', 'city', 'zipCode', 'country'],
        links: ['linkedin', 'website', 'github'],
        summary: ['summary'],
        experience: ['companyName', 'position', 'dateRange', 'description'],
        education: ['institution', 'degree', 'fieldOfStudy', 'graduationDate'],
        skills: ['skill'],
        other: []
    };

    const multilineFields = ['summary', 'description', 'projectDescription'];

    // Sort fields into categories
    const categorizedFields = {};
    Object.keys(fieldBindings).forEach(field => {
        let found = false;
        for (const [cat, fields] of Object.entries(categories)) {
            if (fields.includes(field)) {
                if (!categorizedFields[cat]) categorizedFields[cat] = [];
                categorizedFields[cat].push(field);
                found = true;
                break;
            }
        }
        if (!found) {
            if (!categorizedFields.other) categorizedFields.other = [];
            categorizedFields.other.push(field);
        }
    });

    // Build form
    const form = document.createElement('form');
    form.className = 'cv-form space-y-6';
    form.onsubmit = (e) => e.preventDefault();

    const categoryLabels = {
        personal: 'Personal Information',
        links: 'Links & Social',
        summary: 'Professional Summary',
        experience: 'Work Experience',
        education: 'Education',
        skills: 'Skills',
        other: 'Other Fields'
    };

    Object.entries(categorizedFields).forEach(([category, fields]) => {
        if (fields.length === 0) return;

        const section = document.createElement('div');
        section.className = 'form-section';

        const heading = document.createElement('h3');
        heading.className = 'text-lg font-semibold mb-3 text-gray-800 border-b pb-2';
        heading.textContent = categoryLabels[category] || category;
        section.appendChild(heading);

        fields.forEach(field => {
            section.appendChild(createFormField(field, {
                multiline: multilineFields.includes(field)
            }));
        });

        form.appendChild(section);
    });

    if (container) {
        container.innerHTML = '';
        container.appendChild(form);
    }

    return form;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PlaceholderEngine, createFormField, generateCVForm };
}

// Also make available globally for browser
if (typeof window !== 'undefined') {
    window.PlaceholderEngine = PlaceholderEngine;
    window.CVFormUtils = { createFormField, generateCVForm };
}
