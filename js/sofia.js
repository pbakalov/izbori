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
let boundary = null;   // the whole /geojson descriptor, for the layer caption

let selectedParties = '';
let rowsByKey = new Map();

// Ballot columns in the order the API returned them: descending by total
// votes over the current scope, so it follows the район selection.
let ballotOrder = [];

// The scope the figures cover. `selectedRayon` is null for the whole
// municipality and will be set by the район dropdown; everything that reads
// the scope goes through scopeLabel() and the loader passes it to the API, so
// adding the dropdown is a matter of setting this.
let selectedRayon = null;
let scopeTotals = null;
let municipalityTotals = null;

// {municipality: {code: name}} for the three municipalities that have райони,
// generated from the CIK district-mayor dump by scripts/build_rayoni.py.
let rayonNames = {};

// Code '00' means no single район: municipalities without districts, and the
// mobile stations that serve several of them. Варна has 13 such stations.
const NO_RAYON = '00';

// Keys present in the loaded boundary file, to count the rows it cannot draw.
let featureKeys = new Set();

/** What the current figures describe. */
function scopeLabel() {
    if (!selectedRayon) return `Община: ${MUNICIPALITY}`;
    return `Община: ${MUNICIPALITY}, ${rayonLabel(selectedRayon)}`;
}

function rayonLabel(code) {
    if (code === NO_RAYON) return 'без район';
    const name = (rayonNames[MUNICIPALITY] || {})[code];
    return name ? `район ${name}` : `район ${code}`;
}

/**
 * How many административни райони the loaded rows span.
 *
 * Digits 5-6 of a station id are the район, verified equal to the dump's
 * `admin_reg` for every station, and '00' in the municipalities that have
 * none. So this needs no request and no new column: Столична comes out at 24
 * in every election, national or local.
 *
 * The same cannot be done for кметства. Their code is a metadata column
 * rather than part of the sid, the national files do not carry it at all, and
 * in the local files it is present but empty, because only the council and
 * mayoral races were converted and the code only exists in the кметство race.
 */
function rayonCount() {
    const codes = new Set();
    for (const key of rowsByKey.keys()) {
        const code = rayonOf(key);
        if (code && code !== NO_RAYON) codes.add(code);
    }
    return codes.size;
}

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

/**
 * Fill the район dropdown from the stations actually present, so it reflects
 * the election rather than a fixed list, and stays correct for any
 * municipality. Hidden where there are no райони at all.
 */
function populateRayonDropdown() {
    const dropdown = document.getElementById('rayonDropdown');
    const codes = new Set();
    let hasNoRayon = false;
    for (const key of rowsByKey.keys()) {
        const code = String(key).slice(-5, -3);
        if (code === NO_RAYON) hasNoRayon = true;
        else if (code) codes.add(code);
    }

    dropdown.hidden = codes.size === 0;
    if (dropdown.hidden) {
        selectedRayon = null;
        return;
    }

    dropdown.innerHTML = '';
    const add = (value, label) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        dropdown.appendChild(option);
    };
    add('', `всички райони (${codes.size})`);
    for (const code of [...codes].sort()) add(code, rayonLabel(code));
    if (hasNoRayon) add(NO_RAYON, rayonLabel(NO_RAYON));

    // Keep the selection across an election change when it still exists.
    const available = Array.from(dropdown.options).map(o => o.value);
    dropdown.value = available.includes(selectedRayon || '') ? (selectedRayon || '') : '';
    selectedRayon = dropdown.value || null;
}

/** Fetch the boundaries for an election, reusing the file when it is shared. */
async function loadGeoJSON(el) {
    const descriptor = await getGeojsonDescriptor({ el, layer: LAYER });
    if (!descriptor || !descriptor.url) {
        throw new Error(`no ${LAYER} boundaries for ${el}`);
    }

    joinMode = descriptor.join;
    boundaryId = descriptor.id;
    boundary = descriptor;
    renderLayerInfo();

    if (geojsonCache.has(descriptor.url)) {
        geojsonData = geojsonCache.get(descriptor.url);
        rememberFeatureKeys();
        return descriptor;
    }

    const response = await fetch(descriptor.url);
    if (!response.ok) {
        throw new Error(`could not fetch ${descriptor.url}: ${response.statusText}`);
    }
    geojsonData = await response.json();
    geojsonCache.set(descriptor.url, geojsonData);
    rememberFeatureKeys();
    return descriptor;
}

/**
 * Name the boundary file under the controls, and say when it is not this
 * election's own. Elections without their own file fall back to an adjacent
 * one, which means station boundaries that have since moved, so it is worth
 * seeing rather than inferring from oddly placed polygons.
 */
function renderLayerInfo() {
    const box = document.getElementById('layerInfo');
    if (!box) return;
    if (!boundary) {
        box.innerHTML = '';
        return;
    }

    const file = boundary.url.split('/').pop();
    let html = `Слой: <a href="${boundary.url}" target="_blank" `
        + `title="виж GeoJSON файла">${file}</a>`;
    if (!boundary.exact) {
        html += `<br><span class="inherited">няма собствен слой; `
            + `границите са от ${boundary.source_date}</span>`;
    }
    box.innerHTML = html;
}

/** The район name lookup, generated by scripts/build_rayoni.py. */
async function loadRayonNames() {
    try {
        const response = await fetch('../assets/data/rayoni.json');
        if (!response.ok) throw new Error(response.statusText);
        return await response.json();
    } catch (error) {
        // Codes instead of names is a smaller loss than no map.
        console.warn('Не можах да заредя имената на районите:', error);
        return {};
    }
}

function rememberFeatureKeys() {
    featureKeys = new Set(
        geojsonData.features.map(f => keyOf(f.properties.sid)));
}

/** Fetch one election's results and attach them to the loaded features. */
/**
 * The whole municipality's rows, always. The район selection narrows what is
 * drawn and what the totals cover, but the rows stay complete so the dropdown
 * can be built from them and switching район needs no refetch of the rows.
 */
async function loadResults(el) {
    const party = selectedParties === TURNOUT ? null : selectedParties;
    const response = await getMapData({
        el, party, groupby: 'sid', mun: MUNICIPALITY, totals: true,
    });

    rowsByKey = new Map();
    municipalityTotals = response ? response.totals : null;
    ballotOrder = response ? response.columns : [];
    if (response && response.index) {
        for (const row of rowsFromResponse(response)) {
            rowsByKey.set(keyOf(row.id), row);
        }
    }
    populateRayonDropdown();
    await loadScopeTotals(el);
    matchData();
}

/**
 * Totals for the current scope. The municipality's come with the rows; a
 * район's are fetched, rather than summed here, so the map and the table can
 * never disagree about a tally someone is checking against the official one.
 */
async function loadScopeTotals(el) {
    if (!selectedRayon) {
        scopeTotals = municipalityTotals;
        return;
    }
    const party = selectedParties === TURNOUT ? null : selectedParties;
    const response = await getMapData({
        el, party, groupby: 'sid', mun: MUNICIPALITY,
        rayon: selectedRayon, totals: true,
    });
    scopeTotals = response ? response.totals : null;
    if (response && response.columns) ballotOrder = response.columns;
}

/**
 * The boundary layer, drawing only the selected район. The viewport is left
 * alone: refitting on every change is jarring when panning around, and the
 * reader can zoom themselves.
 */
function buildLayer() {
    return L.geoJson(geojsonData, {
        style: (feature) => style(feature, 'result'),
        onEachFeature,
        filter: inScope,
    }).addTo(map);
}

/** Redraw after the scope changes. */
function rebuildLayer() {
    if (geojsonLayer) map.removeLayer(geojsonLayer);
    currentHighlight = null;
    geojsonLayer = buildLayer();
    repaint();
}

/** The район a station belongs to, from digits 5-6 of its id. */
function rayonOf(key) {
    return String(key).slice(-5, -3);
}

/** Whether a feature belongs to the selected район. */
function inScope(feature) {
    if (!selectedRayon) return true;
    return rayonOf(feature.properties.sid) === selectedRayon;
}

/** Rows the loaded boundary file has no polygon for, and their turnout. */
function rowsWithoutPolygon() {
    const missing = [];
    for (const [key, row] of rowsByKey) {
        if (selectedRayon && rayonOf(key) !== selectedRayon) continue;
        if (!featureKeys.has(key)) missing.push(row);
    }
    return {
        count: missing.length,
        votes: missing.reduce((sum, row) => sum + (row.total || 0), 0),
    };
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
    geojsonLayer = buildLayer();

    await loadResults(el);
    repaint();
}

async function onRayonChange() {
    selectedRayon = document.getElementById('rayonDropdown').value || null;
    await loadScopeTotals(document.getElementById('csvDropdown').value);
    rebuildLayer();
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
    if (selectedRayon) params.set('rayon', selectedRayon);
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
}

// ---------------------------------------------------------------------------
// info box
// ---------------------------------------------------------------------------

const numberFormat = new Intl.NumberFormat('bg-BG');

function nf(value) {
    return (value === null || value === undefined || isNaN(value))
        ? 'н.д.' : numberFormat.format(Math.round(value));
}

function pct(part, whole) {
    return whole ? `${(100 * part / whole).toFixed(1)}%` : 'н.д.';
}

function partyLabel(parties) {
    return parties.split(';').map(p => renameMap[p] || p).join(';');
}

function ballotTable(row) {
    if (!row) return '';
    // The API already returns its columns ordered by total votes over the
    // requested scope, descending, so the order is the same for every station
    // and matches the scope totals. Re-sorting per row would give each station
    // its own ranking, which makes the table hard to read across stations.
    const lines = (ballotOrder.length ? ballotOrder : Object.keys(row))
        .filter(key => !NOT_BALLOT.has(key) && key in row);
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
        html += `<td>${open}${nf(votes)}${close}</td>`;
        html += `<td>${open}${isNaN(share) ? 'н.д.' : share.toFixed(2)}${close}</td></tr>`;
    }
    return `${html}</tbody></table>`;
}

/** A count linking to that subset of rows in the table page. */
function tableLink(count, filter, description) {
    const params = new URLSearchParams({
        el: document.getElementById('csvDropdown').value,
        mun: MUNICIPALITY,
        groupby: 'sid',
    });
    if (boundaryId) params.set('geojson', boundaryId);
    if (selectedRayon) params.set('rayon', selectedRayon);
    if (filter) params.set('filter', filter);
    return `<a href="../table.html?${params}" target="_blank"`
        + ` title="виж ${description} в таблица">${nf(count)}</a>`;
}

/**
 * The same figures as a hovered station, summed over the whole scope. Shown
 * when nothing is hovered, which on desktop is most of the time.
 */
function scopeTextbox() {
    if (!scopeTotals) return 'Посочете секция.';

    const columns = scopeTotals.columns;
    const ballot = scopeTotals.ballot;
    const turnout = selectedParties === TURNOUT;
    const electorate = columns.eligible_voters;

    let textbox = `<b>${scopeLabel()}</b><br>`;

    if (turnout) {
        textbox += `Общо гласували: ${nf(ballot.cast)}<br>`;
        textbox += `Избиратели по списък: ${nf(electorate)}<br>`;
        textbox += `Активност: ${pct(ballot.cast, electorate)}<br>`;
    } else {
        const votes = columns.partyGroup;
        textbox += `${partyLabel(selectedParties)}<br>гласове: ${nf(votes)} `;
        textbox += `(${pct(votes, ballot.valid)} от действителните)<br>`;
    }

    textbox += ballotTable(columns);
    textbox += `Общо гласували (вкл. невалидни): ${nf(ballot.cast)}<br>`;
    textbox += `Валидни (вкл. НПН): ${nf(ballot.valid)}<br>`;
    textbox += `Невалидни: ${nf(ballot.invalid)}<br>`;
    textbox += `Избиратели по списък: ${nf(electorate)}<br>`;
    if (columns.eligible_voters_added) {
        textbox += `Дописани в изборния ден: ${nf(columns.eligible_voters_added)}<br>`;
    }

    // How many stations the figures cover, and how many of them the map can
    // actually draw. Mobile and special stations have no boundary, so the
    // polygons never add up to the tally above. Each count links to that
    // subset in the table; the links work here because this box persists,
    // unlike the hover one.
    const missing = rowsWithoutPolygon();
    const drawn = scopeTotals.rows - missing.count;
    textbox += '<br>';
    const rayons = selectedRayon ? 0 : rayonCount();
    textbox += `Общо: ${tableLink(scopeTotals.rows, null, 'всички секции')} секции`;
    textbox += rayons ? ` в ${rayons} района<br>` : '<br>';
    textbox += `На картата: ${tableLink(drawn, '{on_map} eq 1', 'секциите с полигон')}<br>`;
    textbox += `Без полигон: ${tableLink(missing.count, '{on_map} eq 0', 'секциите без полигон')}`;
    if (missing.count) {
        textbox += ` (${nf(missing.votes)} гласували)`;
    }
    return textbox;
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
        return textbox + scopeTextbox();
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

    geojsonLayer = buildLayer();

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
    document.getElementById('rayonDropdown')
        .addEventListener('change', () => { onRayonChange(); });
    initializeMobileMenu();

    const el = await populateElectionDropdown();
    if (el === null) return;

    const urlParams = new URLSearchParams(window.location.search);
    const urlParty = urlParams.get('party');
    if (urlParty) {
        selectedParties = urlParty;
    }
    selectedRayon = urlParams.get('rayon') || null;

    rayonNames = await loadRayonNames();

    await refreshPartyMenu(el);
    await loadGeoJSON(el);
    await loadResults(el);
    initializeMap();
    repaint();
}

start().catch(error => console.error('Грешка при зареждане на картата:', error));
