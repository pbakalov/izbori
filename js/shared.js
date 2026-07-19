export const GHP_ROOT = "https://pbakalov.github.io";

export const renameMap = {
    'eligible_voters' : 'По списък',
    'n_stations' : 'Секции',
    'invalid' : 'Невалидни',
    'total' : 'Общо гласували',
    'total_valid' : 'Валидни (вкл. НПН)',
    'npn' : 'Не подкрепям никого',
    'place' : 'Населено място',
    'address' : 'Адрес',
    'ekatte' : 'ЕКАТТЕ',
    'municipality_name' : 'Община',
    'region_name' : 'Избирателен район',
    'country_name' : 'Държава',
    'station_type' : 'Вид секция',
}

export class CSVCombobox {
    constructor(options, {
        inputId,
        listId,
        hiddenValueId,
        delimiter = ';',
        multiSelect = false,
        tagsContainerId = null,
        placeholder = 'избери партии'
    } = {}) {
        // DOM Elements
        this.input = document.getElementById(inputId);
        this.optionsList = document.getElementById(listId);
        this.hiddenValueInput = document.getElementById(hiddenValueId);
        this.tagsContainer = tagsContainerId
            ? document.getElementById(tagsContainerId)
            : null;

        // Configuration
        this.delimiter = delimiter;
        this.multiSelect = multiSelect;
        this.placeholder = placeholder;
        this.rawOptions = options;

        // State
        this.selectedValues = new Set();
        this.allOptions = [];
        this.optionsByValue = new Map();

        // Initialize asynchronously
        this.init();
    }

    async init() {
        // Add loading state
        this.input.classList.add('loading');
        this.optionsList.classList.add('loading');

        try {
            // Normalize options to {value, label, ...metadata} for internal use
            this.transformOptions(this.rawOptions);

            // Setup event listeners and render options
            this.setupEventListeners();
            this.renderOptions();
        } catch (error) {
            console.error('Error initializing combobox:', error);
            this.input.placeholder = 'Error loading options';
        } finally {
            // Remove loading state
            this.input.classList.remove('loading');
            this.optionsList.classList.remove('loading');
        }
    }

    // Each entry is either a plain string (value; label derived from renameMap)
    // or an already-formed {value, label, ...metadata} object (label used as-is).
    transformOptions(options) {
        this.allOptions = options.map(entry => {
            if (typeof entry === 'string') {
                return { value: entry, label: renameMap[entry] || entry };
            }
            return entry;
        });
        this.optionsByValue = new Map(this.allOptions.map(option => [option.value, option]));
    }

    // Look up an option's full data (value, label, and any extra metadata) by value.
    getOption(value) {
        return this.optionsByValue.get(value);
    }

    renderOptions() {
        this.optionsList.innerHTML = '';
        this.allOptions.forEach(option => {
            const { value, label } = option;

            const optionElement = document.createElement('div');
            optionElement.textContent = label;
            optionElement.dataset.value = value;

            // Mark as selected if already in selectedValues
            if (this.selectedValues.has(value)) {
                optionElement.classList.add('selected');
            }

            optionElement.addEventListener('click', () => this.selectOption(label, value));
            this.optionsList.appendChild(optionElement);
        });
    }

    setupEventListeners() {
        // Input handling
        this.input.addEventListener('input', (e) => this.filterOptions(e.target.value));
        this.input.addEventListener('focus', () => this.showOptions());

        // Close options when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.input.contains(e.target) && !this.optionsList.contains(e.target)) {
                this.hideOptions();
            }
        });
    }

    filterOptions(searchTerm) {
        const filteredOptions = this.allOptions.filter(option =>
            option.label.toLowerCase().includes(searchTerm.toLowerCase())
        );

        this.optionsList.innerHTML = '';
        filteredOptions.forEach(option => {
            const { value, label } = option;

            const optionElement = document.createElement('div');
            optionElement.textContent = label;
            optionElement.dataset.value = value;

            // Mark as selected if already in selectedValues
            if (this.selectedValues.has(value)) {
                optionElement.classList.add('selected');
            }

            optionElement.addEventListener('click', () => this.selectOption(label, value));
            this.optionsList.appendChild(optionElement);
        });

        this.showOptions();
    }

    selectOption(label, value) {
        if (this.multiSelect) {
            // Multi-select logic
            if (this.selectedValues.has(value)) {
                // Deselect
                this.selectedValues.delete(value);
                this.updateMultiSelectDisplay();
            } else {
                // Select
                this.selectedValues.add(value);
                this.updateMultiSelectDisplay();
            }
        } else {
            // Single-select logic
            this.selectedValues.clear();
            this.selectedValues.add(value);
            this.input.value = label;
        }


        // Update hidden input with comma-separated values
        this.hiddenValueInput.value = Array.from(this.selectedValues).join(this.delimiter);
        this.hiddenValueInput.dispatchEvent(new Event('change'));
        
        // Re-render options to update selected state
        this.renderOptions();
        
        // Hide options for single-select, keep open for multi-select
        if (!this.multiSelect) {
            this.hideOptions();
        }
    }

    updateMultiSelectDisplay() {
        if (!this.tagsContainer) return;

        // Clear existing tags
        this.tagsContainer.innerHTML = '';

        // Create tags for each selected option
        this.selectedValues.forEach(value => {
            const option = this.optionsByValue.get(value);
            if (!option) return;

            const label = option.label;

            // Create tag element
            const tagElement = document.createElement('div');
            tagElement.classList.add('multi-select-tag');
            tagElement.innerHTML = `
                <span>${label}</span>
                <span class="multi-select-tag-remove" data-value="${value}">×</span>
            `;

            // Add remove functionality
            tagElement.querySelector('.multi-select-tag-remove').addEventListener('click', () => {
                this.selectedValues.delete(value);
                this.updateMultiSelectDisplay();
                this.hiddenValueInput.value = Array.from(this.selectedValues).join(this.delimiter);
                this.hiddenValueInput.dispatchEvent(new Event('change'));
                this.renderOptions();
            });

            this.tagsContainer.appendChild(tagElement);
        });

        // Update input placeholder
        this.input.placeholder = this.selectedValues.size
            ? `${this.selectedValues.size} избрани`
            : this.placeholder;
    }

    setOptions(selectedOptions, silent = false) { // pass options "from outside"
        this.selectedValues.clear();

        // add new options (& validate)
        selectedOptions.forEach(value => {
            if (this.allOptions.some(option => option.value.toLowerCase() === value.toLowerCase())) {
                this.selectedValues.add(value);
            };
        });

        // update tags below combobox
        this.updateMultiSelectDisplay();
        // update background colors of the selected options
        this.renderOptions();

        // update this.hiddenValueInput.value + dispatch event
        this.hiddenValueInput.value = Array.from(this.selectedValues).join(this.delimiter);
        if (!silent) {
            this.hiddenValueInput.dispatchEvent(new Event('change'));
        }
    }

    showOptions() {
        this.optionsList.classList.add('visible');
    }

    hideOptions() {
        this.optionsList.classList.remove('visible');
    }
}

export function isMobile() {
    return window.innerWidth <= 768;
}

