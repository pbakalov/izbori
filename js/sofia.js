import { style, highlightFeature, createLegend, getFeatureColor } from './maps_shared.js';
import { getElectionIds, getParties, getMapData, getGeojsonDescriptor } from './api_utils.js';
import { isMobile, CSVCombobox, renameMap } from './shared.js';

// This map shows one municipality at polling-station resolution. Everything
// except the boundary polygons comes from the API, so adding an election needs
// no change here.
const MUNICIPALITY = 'Столична';
const LAYER = 'sid';

// The combobox uses an empty selection to mean "colour by turnout"; the API
// spells that 'total'.
const TURNOUT = 'total';

// Columns of a by-station response that are not ballot lines.
const NOT_BALLOT = new Set([
    'id', 'total', 'total_valid', 'eligible_voters', 'eligible_voters_added',
    'eligible_voters_total', 'n_stations', 'partyGroup',
]);

let map;
let geojsonData;
let geojsonLayer;
let currentHighlight = null;
let partyCombobox = null;

const info = L.control();
let legend = createLegend('result');

// Boundary files are ~5 MB, and several elections share one, so cache by the
// source date the API reports rather than by election.
const geojsonCache = new Map();
let joinMode = 'sid';
let boundaryId = null;

let selectedParties = '';
let rowsByKey = new Map();

/** The join key for a station id, per the descriptor's `join`. */
function keyOf(sid) {
    const text = String(sid);
    return joinMode === 'sid_tail' ? text.slice(-7) : text;
}

/** The API's split-orient payload as an array of row objects. */
function rowsFromResponse(response) {
    const { columns, index, data } = response;
    return data.map((values, row) => {
        const out = { id: index[row] };
        columns.forEach((column, i) => { out[column] = values[i]; });
        return out;
    });
}

// ---------------------------------------------------------------------------
// startup
// ---------------------------------------------------------------------------

async function populateElectionDropdown() {
    const elections = await getElectionIds({ elType: 'all', mun: MUNICIPALITY });
    const dropdown = document.getElementById('csvDropdown');
    dropdown.innerHTML = '';

    if (!elections) {
        dropdown.innerHTML = '<option value="">няма връзка със сървъра</option>';
        return null;
    }

    // Ids are date-prefixed, so sorting them sorts chronologically.
    for (const el of Object.keys(elections).sort()) {
        const option = document.createElement('option');
        option.value = el;
        option.textContent = elections[el];
        dropdown.appendChild(option);
    }

    const urlEl = new URLSearchParams(window.location.search).get('el');
    const available = Array.from(dropdown.options).map(o => o.value);
    dropdown.value = available.includes(urlEl)
        ? urlEl
        : available[available.length - 1]; // default to the most recent

    return dropdown.value;
}

/**
 * Rebuild the party menu for one election, keeping whatever the reader had
 * selected that still stands. An empty result means turnout.
 */
async function refreshPartyMenu(el, keepSelection = true) {
    const ballot = await getParties({ el, mun: MUNICIPALITY }) || [];
    const wanted = keepSelection
        ? selectedParties.split(';').filter(p => p && p !== TURNOUT)
        : [];

    if (partyCombobox === null) {
        partyCombobox = new CSVCombobox(ballot, {
            inputId: 'partyCombobox',
            listId: 'partyOptionsList',
            hiddenValueId: 'partySelectedValue',
            tagsContainerId: 'partySelectedTags',
            multiSelect: true,
        });
        await partyCombobox.init();
        document.getElementById('partySelectedValue')
            .addEventListener('change', onPartySelection);
    } else {
        partyCombobox.rawOptions = ballot;
        partyCombobox.transformOptions(ballot);
    }

    // setOptions validates against the new ballot, so anything that no longer
    // stands is dropped, and it refreshes the tags and the hidden input. The
    // silent flag stops it firing a change event: the caller reloads the data
    // itself, and we do not want two requests for one switch.
    partyCombobox.setOptions(wanted, true);
    selectedParties = partyCombobox.hiddenValueInput.value || TURNOUT;
}

/** Fetch the boundaries for an election, reusing the file when it is shared. */
async function loadGeoJSON(el) {
    const descriptor = await getGeojsonDescriptor({ el, layer: LAYER });
    if (!descriptor || !descriptor.url) {
        throw new Error(`no ${LAYER} boundaries for ${el}`);
    }

    joinMode = descriptor.join;
    boundaryId = descriptor.id;

    if (geojsonCache.has(descriptor.url)) {
        geojsonData = geojsonCache.get(descriptor.url);
        return descriptor;
    }

    const response = await fetch(descriptor.url);
    if (!response.ok) {
        throw new Error(`could not fetch ${descriptor.url}: ${response.statusText}`);
    }
    geojsonData = await response.json();
    geojsonCache.set(descriptor.url, geojsonData);
    return descriptor;
}

/** Fetch one election's results and attach them to the loaded features. */
async function loadResults(el) {
    const party = selectedParties === TURNOUT ? null : selectedParties;
    const response = await getMapData({
        el, party, groupby: 'sid', mun: MUNICIPALITY,
    });

    rowsByKey = new Map();
    if (response && response.index) {
        for (const row of rowsFromResponse(response)) {
            rowsByKey.set(keyOf(row.id), row);
        }
    }
    matchData();
}

function matchData() {
    geojsonData.features.forEach((feature) => {
        const row = rowsByKey.get(keyOf(feature.properties.sid));
        const props = feature.properties;

        if (!row) {
            props.row = null;
            props.value = NaN;
            props.value_prop = NaN;
            props.total = NaN;
            props.eligible_voters = NaN;
            return;
        }

        props.row = row;
        props.total = row.total;
        props.eligible_voters = row.eligible_voters;

        if (selectedParties === TURNOUT) {
            props.value = row.total;
            props.value_prop = row.total / row.eligible_voters;
        } else {
            props.value = row.partyGroup;
            props.value_prop = row.partyGroup / row.total;
        }
    });
}

// ---------------------------------------------------------------------------
// interaction
// ---------------------------------------------------------------------------

function onEachFeature(feature, layer) {
    layer.on({
        mouseover: (e) => {
            if (currentHighlight !== null) {
                geojsonLayer.resetStyle(currentHighlight);
            }
            currentHighlight = e.target;
            highlightFeature(e);
            info.update(layer.feature.properties);
        },
        mouseout: (e) => {
            geojsonLayer.resetStyle(e.target);
            info.update(undefined);
            currentHighlight = null;
        },
        click: (e) => {
            map.fitBounds(e.target.getBounds());
            highlightFeature(e);
            info.update(layer.feature.properties);
        },
    });
}

function repaint() {
    geojsonLayer.setStyle(feature => getFeatureColor(feature, 'result'));
    info.update(undefined);
    updateUrl();
}

async function onElectionChange() {
    const el = document.getElementById('csvDropdown').value;
    await refreshPartyMenu(el);
    await loadGeoJSON(el);

    map.removeLayer(geojsonLayer);
    geojsonLayer = L.geoJson(geojsonData, {
        style: (feature) => style(feature, 'result'),
        onEachFeature,
    }).addTo(map);

    await loadResults(el);
    repaint();
}

async function onPartySelection() {
    selectedParties = this.value === '' ? TURNOUT : this.value;
    await loadResults(document.getElementById('csvDropdown').value);
    repaint();
}

function updateUrl() {
    const center = map.getCenter();
    const el = document.getElementById('csvDropdown').value;
    const params = new URLSearchParams({
        lat: center.lat,
        lng: center.lng,
        zoom: map.getZoom(),
        el,
        party: selectedParties,
    });
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
}

// ---------------------------------------------------------------------------
// info box
// ---------------------------------------------------------------------------

function partyLabel(parties) {
    return parties.split(';').map(p => renameMap[p] || p).join(';');
}

function ballotTable(row) {
    if (!row) return '';
    const lines = Object.keys(row)
        .filter(key => !NOT_BALLOT.has(key))
        .sort((a, b) => row[b] - row[a]);
    const selected = new Set(selectedParties.split(';'));

    let html = '<table><thead><tr>';
    html += '<th>Партия/Кандидат</th><th>Гласове</th><th>Дял</th>';
    html += '</tr></thead><tbody>';
    for (const key of lines) {
        const votes = row[key];
        const share = votes / row.total;
        const bold = selected.has(key);
        const open = bold ? '<b>' : '';
        const close = bold ? '</b>' : '';
        html += `<tr><td>${open}${renameMap[key] || key}${close}</td>`;
        html += `<td>${open}${votes}${close}</td>`;
        html += `<td>${open}${isNaN(share) ? 'н.д.' : share.toFixed(2)}${close}</td></tr>`;
    }
    return `${html}</tbody></table>`;
}

function generateTextbox(props) {
    const dropdown = document.getElementById('csvDropdown');
    const electionLabel = dropdown.options[dropdown.selectedIndex]
        ? dropdown.options[dropdown.selectedIndex].textContent
        : '';

    const turnout = selectedParties === TURNOUT;
    let textbox = turnout
        ? `<h4>Активност (${electionLabel})</h4>`
        : `<h4>Резултати ${partyLabel(selectedParties)} (${electionLabel})</h4>`;

    if (!props) {
        return `${textbox}Посочете секция.`;
    }

    const row = props.row;
    textbox += `<b>Секция ${props.sid}</b><br>`;

    if (!row) {
        return `${textbox}Няма данни за тази секция в избраните избори.`;
    }

    if (turnout) {
        textbox += `Общо гласували: ${row.total}<br>`;
        textbox += `Избиратели по списък: ${row.eligible_voters}<br>`;
        const pct = 100 * row.total / row.eligible_voters;
        textbox += `Активност: ${isNaN(pct) ? 'н.д.' : pct.toFixed(1)}%<br>`;
    } else {
        const pct = 100 * row.partyGroup / row.total;
        textbox += `${partyLabel(selectedParties)}<br>гласове: ${row.partyGroup} `;
        textbox += `(${isNaN(pct) ? 'н.д.' : pct.toFixed(1)}%)<br>`;
    }

    const el = document.getElementById('csvDropdown').value;
    const geojsonId = boundaryId || '';
    textbox += `<a href="../hist.html?sid=${props.sid}&party=${encodeURIComponent(selectedParties)}" target="_blank">виж история</a>`;
    textbox += ` | <a href="../table.html?el=${encodeURIComponent(el)}&mun=${encodeURIComponent(MUNICIPALITY)}&groupby=sid&geojson=${encodeURIComponent(geojsonId)}" target="_blank">данните в табличен вид</a><br>`;
    textbox += ballotTable(row);
    textbox += `Общо гласували (вкл. невалидни): ${row.total}<br>`;
    textbox += `Валидни (вкл. НПН): ${row.total_valid}<br>`;
    textbox += `Избиратели по списък: ${row.eligible_voters}<br>`;
    if (row.eligible_voters_added) {
        textbox += `Дописани в изборния ден: ${row.eligible_voters_added}<br>`;
    }
    return textbox;
}

// ---------------------------------------------------------------------------
// map
// ---------------------------------------------------------------------------

function initializeMap() {
    map = L.map('map').setView([42.691, 23.333], 12);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>|<a href="https://twitter.com/petar_baka">petar_baka</a>|<a href="https://data-for-good.bg/">Данни за добро</a>',
    }).addTo(map);

    geojsonLayer = L.geoJson(geojsonData, {
        style: (feature) => style(feature, 'result'),
        onEachFeature,
    }).addTo(map);

    info.onAdd = function () {
        this._div = L.DomUtil.create('div', 'info');
        this.update();
        return this._div;
    };

    info.update = function (props) {
        this._div.innerHTML = '';
        let closeButton;
        if (props && isMobile()) {
            closeButton = L.DomUtil.create('button', 'close-btn', this._div);
            closeButton.innerHTML = 'x';
            closeButton.style.float = 'right';
        }
        const content = L.DomUtil.create('div', 'info-content', this._div);
        content.innerHTML = generateTextbox(props);
        if (closeButton) {
            L.DomEvent.on(closeButton, 'click', () => info.update(undefined));
        }
    };

    info.addTo(map);
    legend.addTo(map);

    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get('lat'));
    const lng = parseFloat(params.get('lng'));
    const zoom = parseInt(params.get('zoom'), 10);
    if (lat && lng && zoom) {
        map.setView([lat, lng], zoom);
    }

    map.on('moveend zoomend', updateUrl);
}

function showInfoBox() {
    const box = document.getElementById('infoBox');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function initializeMobileMenu() {
    const toggle = document.getElementById('menuToggle');
    const content = document.querySelector('.menu-content');
    if (!toggle || !content) return;

    toggle.addEventListener('click', () => {
        content.classList.toggle('show');
        const open = content.classList.contains('show');
        toggle.querySelector('.menu-text').textContent = open ? 'Затвори' : 'Меню';
        toggle.querySelector('.menu-icon').textContent = open ? '×' : '☰';
    });
}

// ---------------------------------------------------------------------------

async function start() {
    document.getElementById('showInfo').addEventListener('click', showInfoBox);
    document.getElementById('hideInfo').addEventListener('click', showInfoBox);
    document.getElementById('csvDropdown')
        .addEventListener('change', () => { onElectionChange(); });
    initializeMobileMenu();

    const el = await populateElectionDropdown();
    if (el === null) return;

    const urlParty = new URLSearchParams(window.location.search).get('party');
    if (urlParty) {
        selectedParties = urlParty;
    }

    await refreshPartyMenu(el);
    await loadGeoJSON(el);
    await loadResults(el);
    initializeMap();
    repaint();
}

start().catch(error => console.error('Грешка при зареждане на картата:', error));
