import { getSidsData } from './api_utils.js'

const defaultParties = 'ГЕРБ;ГЕРБ-СДС;ДПС;ДПС-Пеев;ДПС-Доган';

// Load SUS data files - maps source key to URL and label
const susDataSources = {
    'АКФ': {
        url: 'https://raw.githubusercontent.com/pbakalov/skriptove_za_izbori/refs/heads/master/data/sus/acf_sids.csv',
        label: 'АКФ'
    },
    'КС': {
        url: 'https://raw.githubusercontent.com/pbakalov/skriptove_za_izbori/refs/heads/master/data/sus/ks50.csv',
        label: 'КС_ТОП50'
    },
    'МАХАЛИ': {
        url: 'https://raw.githubusercontent.com/pbakalov/skriptove_za_izbori/refs/heads/master/data/sus/rom_sids.csv',
        label: 'МАХАЛИ'
    }
};

// Map to store SID to its SUS flags (which lists it appears in)
let sidFlagsMap = {}; // { sid: [label1, label2, ...] }
let allSusSids = []; // all unique SIDs from all lists
let sidLocationMap = {};

// Filter state
let selectedFilters = new Set(); // set of selected filter labels
let allSidsData = []; // stores all SID data for filtering

async function initPage() {
    try {
        // Load place data to map ekatte to municipality and place names
        await loadPlaceData();
        
        // Load all SUS data sources and combine them
        await loadAllSusData();
        
        // Initialize filter options
        initializeFilter();
        
        // Populate table
        await populateTable();
        
    } catch (error) {
        console.error('Error initializing page:', error);
        document.getElementById('loadingMsg').textContent = 'Грешка при зареждане на данни';
        document.getElementById('loadingMsg').style.display = 'block';
    }
}

async function loadPlaceData() {
    try {
        const response = await fetch('assets/data/geo/place_data.csv');
        const csvText = await response.text();
        const rows = csvText.split("\n").map(row => row.trim());
        rows.shift(); // remove headers
        
        rows.forEach(row => {
            if (!row) return;
            const [ind, ekatte, region_name, municipality_name, place, notes, nuts4] = row.split(";");
            if (ekatte && place) {
                sidLocationMap[ekatte] = {
                    ekatte: ekatte.trim(),
                    municipality: municipality_name.trim(),
                    place: place.trim(),
                    region: region_name.trim()
                };
            }
        });
    } catch (error) {
        console.error('Error loading place data:', error);
    }
}

async function loadAllSusData() {
    sidFlagsMap = {};
    allSusSids = [];
    
    try {
        // Load data from all sources
        for (const [sourceKey, sourceData] of Object.entries(susDataSources)) {
            try {
                const response = await fetch(sourceData.url);
                const csvText = await response.text();
                const rows = csvText.split("\n").map(row => row.trim());
                rows.shift(); // remove headers
                
                rows.forEach(row => {
                    if (!row) return;
                    const [rowNum, sid] = row.split(",");
                    if (!sid) return;
                    
                    const cleanedSid = sid.trim();
                    
                    // Add SID to flags map
                    if (!sidFlagsMap[cleanedSid]) {
                        sidFlagsMap[cleanedSid] = [];
                        allSusSids.push(cleanedSid);
                    }
                    
                    // Add label if not already present
                    if (!sidFlagsMap[cleanedSid].includes(sourceData.label)) {
                        sidFlagsMap[cleanedSid].push(sourceData.label);
                    }
                });
                
            } catch (error) {
                console.error(`Error loading SUS data from ${sourceKey}:`, error);
            }
        }
        
    } catch (error) {
        console.error('Error loading all SUS data:', error);
    }
}

async function populateTable() {
    document.getElementById('loadingMsg').style.display = 'block';
    const tableBody = document.getElementById('tableBody');
    tableBody.innerHTML = '';
    
    try {
        const response = await getSidsData(allSusSids);
        
        if (!response || !response.data) {
            console.error('Failed to fetch SID data');
            return;
        }
        
        const sidDataMap = response.data;
        let rowNumber = 1;
        
        for (const sid of allSusSids) {
            try {
                const sidData = sidDataMap[sid];
                
                if (!sidData) continue;
                
                const place = sidData.place || 'н.д.';
                const ekatte = sidData.ekatte;
                const municipality = sidData.municipality_name || 'н.д.';
                const address = sidData.address || 'н.д.';
                const flags = sidFlagsMap[sid] || [];
                
                // Create table row
                const row = document.createElement('tr');
                
                // Row number cell
                const rowNumCell = document.createElement('td');
                rowNumCell.className = 'row-number';
                rowNumCell.textContent = rowNumber;
                row.appendChild(rowNumCell);
                rowNumber++;
                
                // SID cell (clickable)
                const sidCell = document.createElement('td');
                sidCell.className = 'sid-cell';
                const sidLink = document.createElement('a');
                sidLink.href = `hist.html?sid=${sid}&party=${encodeURIComponent(defaultParties)}`;
                sidLink.textContent = sid;
                sidLink.target = '_blank';
                sidCell.appendChild(sidLink);
                row.appendChild(sidCell);
                
                // Municipality cell
                const munCell = document.createElement('td');
                munCell.textContent = municipality;
                row.appendChild(munCell);
                
                // Place cell (clickable)
                const placeCell = document.createElement('td');
                const placeLink = document.createElement('a');
                placeLink.href = `hist.html?ekatte=${ekatte}&party=${encodeURIComponent(defaultParties)}`;
                placeLink.textContent = place;
                placeLink.target = '_blank';
                placeLink.className = 'place-link';
                placeCell.appendChild(placeLink);
                row.appendChild(placeCell);
                
                // Address cell
                const addressCell = document.createElement('td');
                addressCell.textContent = address;
                row.appendChild(addressCell);
                
                // SUS flags cell - show all applicable flags
                const susCell = document.createElement('td');
                susCell.className = 'sus-flags';
                flags.forEach(flag => {
                    const flagBadge = document.createElement('div');
                    flagBadge.className = 'flag-badge';
                    // Add class based on flag type (using lowercase for CSS class)
                    flagBadge.classList.add(flag.toLowerCase());
                    flagBadge.textContent = '⚠ ' + flag;
                    susCell.appendChild(flagBadge);
                });
                row.appendChild(susCell);
                
                tableBody.appendChild(row);
                
            } catch (error) {
                console.error(`Error processing SID ${sid}:`, error);
            }
        }
        
    } catch (error) {
        console.error('Error populating table:', error);
    } finally {
        document.getElementById('loadingMsg').style.display = 'none';
        updateCounter();
    }
}

// Initialize page when DOM is ready
document.addEventListener('DOMContentLoaded', initPage);

function initializeFilter() {
    const filterInput = document.getElementById('susFilterInput');
    const filterOptions = document.getElementById('filterOptions');
    const filterTags = document.getElementById('filterTags');
    
    // Get all unique filter labels
    const allLabels = new Set();
    for (const labels of Object.values(sidFlagsMap)) {
        labels.forEach(label => allLabels.add(label));
    }
    
    // Render filter options
    allLabels.forEach(label => {
        const optionEl = document.createElement('div');
        optionEl.className = 'filter-option';
        optionEl.textContent = label;
        optionEl.dataset.label = label;
        
        optionEl.addEventListener('click', () => {
            toggleFilter(label, optionEl, filterTags);
        });
        
        filterOptions.appendChild(optionEl);
    });
    
    // Show/hide filter options on input focus
    filterInput.addEventListener('focus', () => {
        filterOptions.classList.add('visible');
    });
    
    // Close filter options when clicking outside
    document.addEventListener('click', (e) => {
        if (!filterInput.contains(e.target) && !filterOptions.contains(e.target)) {
            filterOptions.classList.remove('visible');
        }
    });
}

function toggleFilter(label, optionEl, filterTagsContainer) {
    if (selectedFilters.has(label)) {
        selectedFilters.delete(label);
        optionEl.classList.remove('selected');
    } else {
        selectedFilters.add(label);
        optionEl.classList.add('selected');
    }
    
    updateFilterTags(filterTagsContainer);
    filterAndDisplayTable();
}

function updateFilterTags(container) {
    container.innerHTML = '';
    
    selectedFilters.forEach(label => {
        const tag = document.createElement('div');
        tag.className = 'filter-tag';
        
        const tagText = document.createElement('span');
        tagText.textContent = label;
        
        const removeBtn = document.createElement('span');
        removeBtn.className = 'filter-tag-remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
            selectedFilters.delete(label);
            // Update the option UI
            const optionEl = document.querySelector(`[data-label="${label}"]`);
            if (optionEl) optionEl.classList.remove('selected');
            updateFilterTags(container);
            filterAndDisplayTable();
        });
        
        tag.appendChild(tagText);
        tag.appendChild(removeBtn);
        container.appendChild(tag);
    });
}

function filterAndDisplayTable() {
    const tableBody = document.getElementById('tableBody');
    const rows = Array.from(tableBody.querySelectorAll('tr'));
    
    rows.forEach(row => {
        if (selectedFilters.size === 0) {
            // No filters selected, show all
            row.style.display = '';
        } else {
            // Check if this row has any of the selected filters
            const flagsCell = row.querySelector('.sus-flags');
            const hasSelectedFlag = Array.from(flagsCell.querySelectorAll('.flag-badge')).some(badge => {
                const badgeText = badge.textContent.trim().replace('⚠ ', '');
                return selectedFilters.has(badgeText);
            });
            
            row.style.display = hasSelectedFlag ? '' : 'none';
        }
    });
    
    updateCounter();
}

function updateCounter() {
    const tableBody = document.getElementById('tableBody');
    const counterMsg = document.getElementById('counterMsg');
    
    const totalRows = tableBody.querySelectorAll('tr').length;
    const visibleRows = Array.from(tableBody.querySelectorAll('tr')).filter(row => row.style.display !== 'none').length;
    
    if (totalRows === 0) {
        counterMsg.textContent = '';
    } else {
        counterMsg.textContent = `${visibleRows} секции показани от общо ${totalRows} съмнителни`;
    }
}

