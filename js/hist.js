import { getSidsByDate, getSidResults, getPlaceResults, getElectionTotals, getSidHist, getPlaceHist, getParties, getAllSids, getElectionIds } from './api_utils.js'
import { CSVCombobox, isMobile, renameMap } from './shared.js'

function initializeMobileMenu() {
    if (!isMobile()) return;

    const menu = document.getElementById('mobileMenu');
    const header = document.getElementById('menuHeader');
    const summaryPlace = menu.querySelector('.selected-place');
    const summaryParties = menu.querySelector('.selected-parties');

    // Initial state
    menu.classList.add('collapsed');

    header.addEventListener('click', () => {
        menu.classList.toggle('collapsed');
        const button = header.querySelector('.toggle-button');
        button.textContent = menu.classList.contains('collapsed') ? '▼' : '▲';
    });

    function updateMenuSummary() { // possibly merge with updateSelection
        const placeValues = Array.from(placeCombobox.selectedValues);
        const partyValues = Array.from(partyCombobox.selectedValues);

        summaryPlace.textContent = placeValues.length ? `${placeValues.length} избрани места` : 'Избери място';
        summaryParties.textContent = partyValues.length ?
            `${partyValues.length} избрани партии` :
            'Избери партии';
    }

    partySelect.addEventListener('change', updateMenuSummary);
    placeSelect.addEventListener('change', updateMenuSummary);

    const viewToggleCheckbox = document.getElementById('viewToggleCheckbox');
    const viewToggleLabel = document.getElementById('viewToggleLabel');
    viewToggleCheckbox.addEventListener('change', () => {
        setMobileView(viewToggleCheckbox.checked);
    });
}

// Some views (SID list) render only a table, no chart.
// On mobile, default those to the table and hide the now-irrelevant switch.
function setMobileView(showTable, hideToggle=false) {
    if (!isMobile()) return;
    document.body.classList.toggle('mobile-show-table', showTable);
    document.body.classList.toggle('no-chart', hideToggle);
    const checkbox = document.getElementById('viewToggleCheckbox');
    const label = document.getElementById('viewToggleLabel');
    checkbox.checked = showTable;
    label.textContent = showTable ? 'Покажи графика' : 'Покажи таблица';
}

function showSidHistory(sid, party) {
    setMobileView(false);
    document.getElementById('chart').innerHTML = loadingMsg;
    getSidHist(sid, party).then(sidData => {
        updatePlot(sidData, party);
    });
}

function showPlaceHistory(ekatte, party) {
    setMobileView(false);
    document.getElementById('chart').innerHTML = loadingMsg;
    getPlaceHist(ekatte, party).then(placeData => {
        updatePlot(placeData, party, ekatte);
    });
}

function showSidDetails(el, sid) {
    setMobileView(false);
    document.getElementById('text').innerHTML = loadingMsg;
    document.getElementById('chart').innerHTML = loadingMsg;
    getSidResults(el, sid).then(sidData => {
        updateSingleElectionPlot(sidData, el, null, sid);
    });
}

function showPlaceDetails(el, ekatte) {
    setMobileView(false);
    document.getElementById('text').innerHTML = loadingMsg;
    document.getElementById('chart').innerHTML = loadingMsg;
    getPlaceResults(el, ekatte).then(placeData => {
        updateSingleElectionPlot(placeData, el, ekatte, null);
    });
}

function showElectionTotals(el) {
    setMobileView(false);
    document.getElementById('text').innerHTML = loadingMsg;
    document.getElementById('chart').innerHTML = loadingMsg;
    getElectionTotals(el).then(data => {
        updateSingleElectionTotalsPlot(data, el);
    });
}

function showSidsByDate(ekatte) {
    setMobileView(true, true);
    document.getElementById('text').innerHTML = loadingMsg;
    // TODO add place details: name, municipality, etc.
    getSidsByDate(ekatte).then(sidsByDate => {
        const resultHTML = generateHTML(sidsByDate);
        document.getElementById('text').innerHTML = resultHTML;
    });
}

/**
 * ekatte or SID time-series plot.
 */
function updatePlot(jsonData, parties, ekatte=null)  {

    parties = parties.split(';');
    const dates = Object.keys(jsonData.eligible_voters);
    
    let tableHTML = '';
    let title;
    let cols;
    let placeName;
    let munName;
    let regName;

    if (ekatte!==null) { // ekatte plot
        // TODO adapt for multiple ekatte
        cols = ['n_stations', 'eligible_voters', 'total'].concat(parties);
        placeName = jsonData['place'][dates[0]]; 
        munName = jsonData['municipality_name'][dates[dates.length-1]]; // TODO use NSI data instead of CEC data
        regName = jsonData['region_name'][dates[0]];
        tableHTML += `<h3>${placeName}, общ. ${munName}, ${regName}</h3>`; 
        title = `Резултати в ${placeName}`;
    } else if (sid!==null) { // sid plot
        cols = ['address', 'place', 'n_stations', 'eligible_voters', 'total'].concat(parties);
        tableHTML += `<h3>Данни за секция ${sid}</h3>`; 
        title = `Резултати секция ${sid}`;
    } else { // election totals plot
        cols = ['address', 'place', 'n_stations', 'eligible_voters', 'total'].concat(parties);
        tableHTML += `<h3>Обобщени данни (всички секции)</h3>`; 
        title = `Сумарни резултати (всички секции)`;
    }

    const traces = ['eligible_voters', 'total'].concat(parties);

    // metadata
    {
        const meta = document.getElementById('text');
        tableHTML += '<table><thead><tr>';
        tableHTML += '<th>Дата</th>';
        cols.forEach(col => {
            tableHTML += `<th>${(renameMap[col]||col)}</th>`;
        });
        tableHTML += '</tr></thead><tbody>';
        
        dates.forEach(key => {
            let dateCell = `<td>${key}</td>`;
            
            // Add link if conditions are met
            if (ekatte !== null) {
                // ekatte is present, create link with ekatte and el (date)
                dateCell = `<td><a href="hist?ekatte=${ekatte}&el=${key}">${key}</a></td>`;
            } else if (sid !== null) {
                // sid is present, check if it contains only one SID
                const sidArray = sid.split(';');
                if (sidArray.length === 1) {
                    // Only one SID, create link with sid and el (date)
                    dateCell = `<td><a href="hist?sid=${sid}&el=${key}">${key}</a></td>`;
                }
                // If multiple SIDs, dateCell remains plain text
            }
            
            tableHTML += `<tr>${dateCell}`;
            cols.forEach(col => {
                const value = jsonData[col][key];
                tableHTML += `<td>${value}</td>`;
            });
            tableHTML += `</tr>`;
        });
        tableHTML += '</tbody></table>';
        meta.innerHTML = tableHTML;
    }

    const colorMap = {
        'eligible_voters' : 'gray',
        'total' : 'black',
    }

    const data = traces.map(col => ({
        x: dates,
        y: Object.values(jsonData[col]),
        mode: 'lines+markers',
        type: (col in colorMap) ? 'scatter' : 'bar',
        marker: {
            size: 10,
            color: colorMap[col]||null,
        },
        name: (renameMap[col]||col),
        visible: (col in colorMap) ? 'legendonly' : true 
    }));
    
    const layout = {
        title: title,
        xaxis: {
            title: 'Дата'
        },
        yaxis: {
            title: 'Гласове'
        },
        showlegend: true,
        barmode: 'stack',
        responsive: true,
        autosize: true
    };

    if (isMobile()) {
        const isLandscape = window.innerWidth > window.innerHeight;
        Object.assign(layout, {
            width: window.innerWidth,
            height: window.innerHeight - 70, // account for collapsed menu; can we infer the size from the css?
            margin: isLandscape ? {
                l: 40,
                r: 110, // room for the vertical legend
                t: 70, // space for the title
                b: 40
            } : {
                l: 40,
                r: 20,
                t: 70, // space for the title
                b: 90 // room for the horizontal legend below the x-axis labels
            },
            legend: isLandscape ? {
                orientation: 'v',
                x: 1.02,
                xanchor: 'left',
                y: 0.5,
                yanchor: 'middle'
            } : {
                orientation: 'h',
                y: -0.35,
                x: 0.5,
                xanchor: 'center'
            }
        });
    } else {
        Object.assign(layout, {
            width: Math.min(800, window.innerWidth - 20),
            height: Math.min(600, Math.max(250, window.innerHeight * 0.8)), // 80% of viewport height but >250 and <800
        });
    }

    document.getElementById('chart').innerHTML = '';
    Plotly.newPlot('chart', data, layout);
}

// Columns in the single_election_data API response that aren't parties
// (shared by both the sid- and ekatte-keyed responses).
const nonPartyKeys = [
    'place', 'address', 'ekatte', 'municipality_name', 'municipality',
    'station_type', 'station', 'region_name', 'region', 'admin_reg', 'country_name',
    'n_stations', 'eligible_voters', 'total_valid', 'total'
];

// Vote categories always broken out as their own bar, even outside the top 5.
const fixedVoteCategories = ['invalid', 'npn'];

// keys is ignored when data[col] is already an aggregated scalar (national totals,
// aggregated server-side); otherwise it's a per-key dict (ekatte/sid queries) and we sum over keys.
function sumField(data, col, keys) {
    const value = data[col];
    if (typeof value !== 'object' || value === null) {
        return Number(value || 0);
    }
    return keys.reduce((sum, k) => sum + Number(value[k] || 0), 0);
}

function categoricalField(data, col, keys) {
    const values = [...new Set(keys.map(k => data[col][k]).filter(v => v !== undefined))];
    if (values.length === 0) return 'н.д.';
    if (values.length === 1) return values[0];
    return `${values.length} различни стойности`;
}

function getPartyVotes(data, keys) {
    const partyVotes = [];
    for (const col in data) {
        if (!nonPartyKeys.includes(col)) {
            if (!renameMap.hasOwnProperty(col)) renameMap[col] = col;
            partyVotes.push({ key: col, party: renameMap[col], votes: sumField(data, col, keys) });
        }
    }
    partyVotes.sort((a, b) => b.votes - a.votes);
    return partyVotes;
}

function buildElectionBars(partyVotes, totalValid) {
    const bars = partyVotes.slice(0, 5);
    fixedVoteCategories.forEach(catKey => {
        if (!bars.some(b => b.key === catKey)) {
            const entry = partyVotes.find(v => v.key === catKey);
            if (entry) bars.push(entry);
        }
    });
    const sumForOther = bars
        .filter(b => b.key !== 'invalid')
        .reduce((sum, b) => sum + Number(b.votes), 0);
    bars.push({ key: 'other', party: 'Други', votes: totalValid - sumForOther });
    return bars;
}

function renderVotesTable(partyVotes) {
    let html = '<h4>Резултати</h4>';
    html += '<table><thead><tr><th>Партия</th><th>Гласове</th></tr></thead><tbody>';
    partyVotes.forEach(item => {
        html += `<tr><td>${item.party}</td><td>${item.votes}</td></tr>`;
    });
    html += '</tbody></table>';
    return html;
}

function renderElectionBarChart(partyVotes, totalValid, title) {
    const bars = buildElectionBars(partyVotes, totalValid);

    const chartData = [{
        x: bars.map(b => b.party),
        y: bars.map(b => Number(b.votes)),
        type: 'bar',
        marker: { color: '#4a90d9' }
    }];

    const layout = {
        title,
        xaxis: {
            automargin: true
        },
        yaxis: {
            title: 'Гласове'
        },
        responsive: true,
        autosize: true
    };

    if (isMobile()) {
        Object.assign(layout, {
            width: window.innerWidth,
            height: window.innerHeight - 70, // account for collapsed menu
            margin: {
                l: 40,
                r: 20,
                t: 70, // space for the title
                b: 100 // room for rotated/wrapped party labels
            }
        });
    } else {
        Object.assign(layout, {
            width: Math.min(800, window.innerWidth - 20),
            height: Math.min(600, Math.max(250, window.innerHeight * 0.8)),
        });
    }

    document.getElementById('chart').innerHTML = '';
    Plotly.newPlot('chart', chartData, layout);
}

/**
 * Single election, ekatte(s) or SID(s): results table + bar chart.
 * ekatte/sid may be a single value or a ';'-joined list; numeric fields are
 * summed across all selected keys, non-numeric fields show the shared value
 * or "N different values" when they differ.
 */
function updateSingleElectionPlot(data, el, ekatte=null, sid=null) {
    const keys = ekatte !== null ? [...new Set(ekatte.split(';'))] : [...new Set(sid.split(';'))];

    let tableHTML;
    if (ekatte !== null) {
        tableHTML = `<h3>${el}</h3>`;
        tableHTML += '<table><thead><tr><th>Данни за населеното место</th><th></th></tr></thead><tbody>';

        // TODO: single_election_data doesn't return place/municipality/region name for
        // the ekatte case (unlike sid's address/place/etc.), so we look them up from the
        // placeCombobox instead. Update the API to include these fields directly,
        // then switch this to categoricalField() like the sid branch below.
        const placeMetaField = (attr) => {
            const values = [...new Set(keys.map(k => placeCombobox.getOption(k)?.[attr]).filter(Boolean))];
            if (values.length === 0) return null;
            return values.length === 1 ? values[0] : `${values.length} различни стойности`;
        };
        const placeName = placeMetaField('placeName');
        const municipalityName = placeMetaField('municipalityName');
        const regionName = placeMetaField('regionName');
        if (placeName !== null) tableHTML += `<tr><td>Място</td><td>${placeName}</td></tr>`;
        if (municipalityName !== null) tableHTML += `<tr><td>Община</td><td>${municipalityName}</td></tr>`;
        if (regionName !== null) tableHTML += `<tr><td>Област</td><td>${regionName}</td></tr>`;

        tableHTML += `<tr><td>ЕКАТТЕ</td><td>${ekatte}</td></tr>`;
        ['n_stations', 'eligible_voters', 'total_valid', 'total'].forEach(col => {
            if (!renameMap.hasOwnProperty(col)) renameMap[col] = col;
            tableHTML += `<tr><td>${renameMap[col]}</td><td>${sumField(data, col, keys)}</td></tr>`;
        });
        tableHTML += '</tbody></table>';
    } else {
        const skipKeys = ['region', 'station', 'admin_reg', 'municipality'];
        const numericCols = ['eligible_voters'];
        tableHTML = `<h3>${el} секция ${sid}</h3>`;
        tableHTML += '<table><thead><tr><th>Данни за секцията</th><th></th></tr></thead><tbody>';
        metadataKeys.forEach(col => {
            if (!renameMap.hasOwnProperty(col)) renameMap[col] = col;
            if (!skipKeys.includes(col)) {
                const value = numericCols.includes(col)
                    ? sumField(data, col, keys)
                    : categoricalField(data, col, keys);
                tableHTML += `<tr><td>${renameMap[col]}</td><td>${value}</td></tr>`;
            }
        });
        tableHTML += '</tbody></table>';
    }

    const partyVotes = getPartyVotes(data, keys);
    tableHTML += renderVotesTable(partyVotes);

    document.getElementById('text').innerHTML = tableHTML;

    const title = ekatte !== null ? 'Резултати' : `Резултати секция ${sid}`;
    renderElectionBarChart(partyVotes, sumField(data, 'total_valid', keys), title);
}

/**
 * Election totals across all sections: results table + bar chart.
 * The API returns already-aggregated scalars for this (no ekatte/sid filter),
 * so no keys/summing needed, and there's no per-place metadata to show.
 */
function updateSingleElectionTotalsPlot(data, el) {
    let tableHTML = `<h3>${el}</h3>`;
    tableHTML += '<h4>Обобщени данни (всички секции)</h4>';
    tableHTML += '<table><thead><tr><th>Обобщени данни</th><th></th></tr></thead><tbody>';
    ['n_stations', 'eligible_voters', 'total_valid', 'total'].forEach(col => {
        if (!renameMap.hasOwnProperty(col)) renameMap[col] = col;
        tableHTML += `<tr><td>${renameMap[col]}</td><td>${sumField(data, col, [])}</td></tr>`;
    });
    tableHTML += '</tbody></table>';

    const partyVotes = getPartyVotes(data, []);
    tableHTML += renderVotesTable(partyVotes);

    document.getElementById('text').innerHTML = tableHTML;

    renderElectionBarChart(partyVotes, sumField(data, 'total_valid', []), `Обобщени резултати (${el})`);
}

function generateHTML(sidsByDate) {
    const pageUrl = `${window.location.pathname}`
    let htmlOutput = '';

    for (const date in sidsByDate) {
        htmlOutput += `<strong>${date}</strong><br>`;
        const sids = sidsByDate[date];
        sids.forEach(sid => {
            htmlOutput += `<a href="${pageUrl}?el=${date}&sid=${sid}" onclick="showSidDetails('${date}', '${sid}')">${sid}</a> `;
            htmlOutput += `<a href="${pageUrl}?sid=${sid}&party=${defaultParties}">история</a><br>`;
        });
        htmlOutput += '<br>';
    }

    return htmlOutput;
}

async function loadPlaceOptions(csvFilePath) {
    const response = await fetch(csvFilePath);
    const csvText = await response.text();
    const rows = csvText.split("\n").map(row => row.trim());
    rows.shift(); // remove headers

    return rows
        .map(row => row.split(";"))
        .filter(([ind, ekatte, region_name, municipality_name, place]) => ekatte && place)
        .map(([ind, ekatte, region_name, municipality_name, place]) => ({
            value: ekatte.trim(),
            label: `${place.trim()} (${municipality_name.trim()})`,
            placeName: place.trim(),
            municipalityName: municipality_name.trim(),
            regionName: region_name.trim()
        }));
}

function updateSelection() {
    const partyValue = partySelect.value;
    const chart = document.getElementById('chart');

    console.log('el:', el, 'sid:', sid, 'ekatte:', ekatte, 'party:', partyValue);

    if (partyValue && ekatte) { // show place history plot
        showPlaceHistory(ekatte, partyValue);
        updateUrl(ekatte, null, partyValue);
    } else if (partyValue && sid) { // show sid history plot
        showSidHistory(sid, partyValue);
        updateUrl(null, sid, partyValue);
    } else if (el !== null && sid) { // single-election SID details (re-render on tag add/remove)
        showSidDetails(el, sid);
        updateUrl(null, sid, null, el);
    } else if (el !== null && ekatte) { // single-election EKATTE details
        showPlaceDetails(el, ekatte);
        updateUrl(ekatte, null, null, el);
    } else if (ekatte) { // show SIDs by date
        updateUrl(ekatte);
        showSidsByDate(ekatte);
        chart.innerHTML = '';
    // TODO el & party: sortable table (+backend paging)
    } else if (partyValue) { // national totals
        elCombobox.setOptions([], true);
        showPlaceHistory(ekatte, partyValue); // ekatte guaranteed null here by branch order above
        updateUrl(null, null, partyValue);
    } else if (el !== null) { // all selections cleared, still viewing a specific election -> show its totals
        showElectionTotals(el);
        updateUrl(null, null, null, el);
    }
}

function updateUrl (ekatte=null, sid=null, party=null, el=null) {
    const args = {ekatte, sid, party, el};
    let newUrl = `${window.location.pathname}?`;
    for (const [key, value] of Object.entries(args)) {
        if (value !== null) {
            newUrl += `${key}=${value}&`;
        }
    }
    newUrl = newUrl.endsWith('&') ? newUrl.slice(0, -1) : newUrl;
    window.history.replaceState(null, '', newUrl);
};

const metadataKeys = [
    "place", "address", "ekatte", "eligible_voters",
    "municipality_name", "station_type", "region_name", "country_name", "municipality", "station",
];

const loadingMsg = 'Зарежда се ...';
const defaultParties = 'ГЕРБ;ГЕРБ-СДС;ДПС;ДПС-Пеев;ДПС-Доган';

if (!window.location.search) {
    window.location.replace(`${window.location.pathname}?party=ГЕРБ;ГЕРБ-СДС;ДПС;ДПС-Доган;ДПС-Пеев;ПП/ДБ;ПП;ДБ;ПБ`);
}

const urlParams = new URLSearchParams(window.location.search);
let ekatte = urlParams.get('ekatte');
let el = urlParams.get('el');
let sid = urlParams.get('sid');
const party = urlParams.get('party');

const parties = await getParties();
const partyCombobox = new CSVCombobox(parties, {
    inputId: 'partyCombobox',
    listId: 'partyOptionsList',
    hiddenValueId: 'partySelectedValue',
    tagsContainerId: 'partySelectedTags',
    multiSelect: true
});
await partyCombobox.init(); // some overhead, as it's called in the constructor

const sids = await getAllSids();
const sidCombobox = new CSVCombobox(sids, {
    inputId: 'sidCombobox',
    listId: 'sidOptionsList',
    hiddenValueId: 'sidSelectedValue',
    tagsContainerId: 'sidSelectedTags',
    multiSelect: true,
    placeholder: 'избери секция'
});
await sidCombobox.init();

const placeOptions = await loadPlaceOptions(`assets/data/geo/place_data.csv`); //TODO get place data from API/repo
const placeCombobox = new CSVCombobox(placeOptions, {
    inputId: 'placeCombobox',
    listId: 'placeOptionsList',
    hiddenValueId: 'placeSelectedValue',
    tagsContainerId: 'placeSelectedTags',
    multiSelect: true,
    placeholder: 'избери място'
});
await placeCombobox.init();

const electionIds = await getElectionIds();
const elCombobox = new CSVCombobox(Object.keys(electionIds), {
    inputId: 'elCombobox',
    listId: 'elOptionsList',
    hiddenValueId: 'elSelectedValue',
    multiSelect: false,
    placeholder: 'избери дата'
});
await elCombobox.init();

window.addEventListener('resize', () => {
    const chart = document.getElementById('chart');
    if (chart.data) {
        // updatePlot(chart.data, party, ekatte); // good idea, but needs fixing
        updateSelection();
    }
});

const placeSelect = document.getElementById('placeSelectedValue');
const partySelect = document.getElementById('partySelectedValue');
const sidSelect = document.getElementById('sidSelectedValue');
const elSelect = document.getElementById('elSelectedValue');

partySelect.addEventListener('change', () => {
    console.log('pchange');
    updateSelection();
});
placeSelect.addEventListener('change', () => {
    ekatte = placeSelect.value || null;
    sid = null;
    sidCombobox.setOptions([], true);
    updateSelection();
});
sidSelect.addEventListener('change', () => {
    sid = sidSelect.value || null;
    ekatte = null;
    placeCombobox.setOptions([], true);
    updateSelection();
});
elSelect.addEventListener('change', () => {
    el = elSelect.value || null;
    partyCombobox.setOptions([], true);
    updateSelection();
});

console.log(el, sid, ekatte, party);
initializeMobileMenu();
if (ekatte!==null && party!==null) {
    placeCombobox.setOptions(ekatte.split(';'), true);
    partyCombobox.setOptions(party.split(';'));
} else if (ekatte!==null && el!==null) {
    placeCombobox.setOptions(ekatte.split(';'), true);
    elCombobox.setOptions([el], true);
    showPlaceDetails(el, ekatte);
} else if (el!==null && sid!==null) {
    sidCombobox.setOptions(sid.split(';'), true);
    elCombobox.setOptions([el], true);
    showSidDetails(el, sid);
} else if (sid!==null && party!==null) { // sid history
    sidCombobox.setOptions(sid.split(';'), true);
    partyCombobox.setOptions(party.split(';'));
} else if (party!==null) {
    console.log('startup');
    partyCombobox.setOptions(party.split(';'));
} else if (el!==null) { // election totals
    elCombobox.setOptions([el], true);
    showElectionTotals(el);
} else if (ekatte!==null) { // ekatte details page
    placeCombobox.setOptions(ekatte.split(';'), true);
    showSidsByDate(ekatte);
} else {
    document.getElementById('text').innerHTML = '';
}

