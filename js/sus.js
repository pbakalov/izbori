import { getSidDetails } from './api_utils.js'

const defaultParties = 'ГЕРБ;ГЕРБ-СДС;ДПС;ДПС-Пеев;ДПС-Доган';

// Load SUS data files - maps source key to URL and label
const susDataSources = {
    'АКФ': {
        url: 'https://raw.githubusercontent.com/pbakalov/skriptove_za_izbori/refs/heads/master/data/sus/acf_sids.csv',
        label: 'АКФ'
    },
    'КС': {
        url: 'https://raw.githubusercontent.com/pbakalov/skriptove_za_izbori/refs/heads/master/data/sus/ks50.csv',
        label: 'КС'
    }
};

// Map to store SID to its SUS flags (which lists it appears in)
let sidFlagsMap = {}; // { sid: [label1, label2, ...] }
let allSusSids = []; // all unique SIDs from all lists
let sidLocationMap = {};

async function initPage() {
    try {
        // Load place data to map ekatte to municipality and place names
        await loadPlaceData();
        
        // Load all SUS data sources and combine them
        await loadAllSusData();
        
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
        for (const sid of allSusSids) {
            try {
                const sidDetails = await getSidDetails('2024-10-27ns', sid);
                
                if (!sidDetails) continue;
                
                const place = sidDetails.place[sid] || 'н.д.';
                const ekatte = sidDetails.ekatte[sid];
                const municipality = sidDetails.municipality_name[sid] || 'н.д.';
                const address = sidDetails.address[sid] || 'н.д.';
                const flags = sidFlagsMap[sid] || [];
                
                // Create table row
                const row = document.createElement('tr');
                
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
    }
}

// Initialize page when DOM is ready
document.addEventListener('DOMContentLoaded', initPage);
