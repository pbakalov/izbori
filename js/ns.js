import { getColor, style, highlightFeature, createLegend, getFeatureColor, JsonToTable } from './maps_shared.js';
import { getPlaceHist, getDeltas, getMapData, getElectionIds, getParties,
         getGeojsonDescriptor } from './api_utils.js';
import { GHP_ROOT, isMobile, CSVCombobox, renameMap} from './shared.js';

let csvData;
let geojsonData;
let markerData;
let markerGroup;

let mapType = 'result';
let map;
let geojsonLayer;
var info = L.control();
var legend = createLegend(mapType);

let selectedParties = 'ГЕРБ-СДС;ГЕРБ'
let currentHighlight = null;
let partyCombobox = null;

let minDelta = 0;
let minDeltaVotes = 0;
let minSupport = 0;
let minSupportVotes = 0;

// Which way the change filters look. The sliders carry the magnitude, this
// carries the sign, so 'спад' with minDelta 0.1 means delta <= -0.1 rather
// than |delta| >= 0.1. Replaces the old two-sided test, which could not be
// expressed in the table's filter syntax and mixed gains with losses.
let deltaDirection = 'growth';

// Totals for the whole election, including stations abroad, so the figures
// match the official tally rather than only what the map can draw.
let electionTotals = null;

// The resolved boundary descriptor and the keys it covers, for the layer
// caption and for counting the rows it cannot draw.
let boundary = null;
let featureKeys = new Set();

// This map always draws the settlement layer, so its id is a safe fallback
// when the descriptor could not be fetched. Without one, an `{on_map}` filter
// names a column the table does not have, gets dropped by design, and the
// link quietly shows every row as though nothing were filtered.
const SETTLEMENT_LAYER = 'settlements_simplified1pct';
const SETTLEMENT_URL = '../assets/data/geo/settlements_simplified1pct.json';

// Settlement codes are five digits. Anything outside that is synthetic: the
// codes CIK assigns to polling places abroad, or -1 where an older file has
// none. Verified across all 13 loaded elections with no misclassification.
const isAbroad = (ekatte) => Number(ekatte) < 0 || Number(ekatte) > 99999;

/**
 * A settlement's key in the boundary file: its EKATTE, zero-padded to five.
 *
 * Returns null for a place abroad, which has no settlement code and so can
 * never match a polygon. That matters: the previous `('00000' + id).slice(-5)`
 * *truncated* longer codes, and once stations abroad were included that made
 * 35 of them collide with real villages -- ekatte 162503 became 62503, which
 * is с. Реселец. A polling place abroad could colour a village in Pleven.
 */
function settlementKey(ekatte) {
    if (isAbroad(ekatte)) return null;
    return String(ekatte).padStart(5, '0');
}

// How many settlements the sliders are currently letting through, or null
// when no slider is set and everything with data is drawn.
let filteredCount = null;

// The settlement codes the sliders are letting through, or null when nothing
// is filtered.
let filteredKeys = null;

// Ballot columns in the order the API returned them: descending by total
// votes over the election. Needed because the `totals` block arrives as a
// JSON object, and the serialiser alphabetises object keys -- so iterating
// it gives eligible_voters, invalid, npn, ... instead of the vote order the
// row arrays preserve.
let ballotOrder = [];

// On a phone the resting box would otherwise cover the map: a 27-row ballot
// table plus the breakdown and the counts. So it starts collapsed to its
// headline and expands on demand. Collapsing rather than closing means
// nothing becomes unreachable and no extra control is needed to get it back.
let detailsOpen = false;

// Mirrors UNSUMMABLE and AGGREGATE_COLUMNS in helper_funcs.py. Whatever is
// left over is a ballot line: a party, a candidate or npn.
const NOT_SUMMABLE = new Set([
    'id', 'station_type', 'country_name', 'region_name', 'ekatte', 'place',
    'address', 'municipality_name', 'kmetstvo', 'kmetstvo_name', 'nuts4',
]);
const AGGREGATE_COLUMNS = new Set([
    'total', 'total_valid', 'invalid', 'partyGroup', 'n_stations', 'on_map',
    'eligible_voters', 'eligible_voters_added', 'eligible_voters_total',
]);

/**
 * Totals over an arbitrary set of rows, in the same shape the API's `totals`
 * block uses, so the infobox can render either without caring which it got.
 *
 * This duplicates compute_totals() in helper_funcs.py, which is not ideal.
 * The API cannot do it: the sliders filter on `delta` and `delta_votes`,
 * which are not columns in the map payload, so there is no filter expression
 * that would reproduce the selection server-side. Once the delta columns land
 * in /table this function should go, and the map should ask for the filtered
 * totals the same way it asks for the unfiltered ones.
 */
function sumRows(rows) {
    const columns = {};
    for (const row of rows) {
        for (const [key, value] of Object.entries(row)) {
            if (NOT_SUMMABLE.has(key)) continue;
            const number = Number(value);
            if (!Number.isFinite(number)) continue;
            columns[key] = (columns[key] || 0) + number;
        }
    }

    const npn = columns.npn || 0;
    const parties = Object.keys(columns)
        .filter(key => key !== 'npn' && !AGGREGATE_COLUMNS.has(key))
        .reduce((sum, key) => sum + columns[key], 0);
    const invalid = columns.invalid || 0;

    return {
        rows: rows.length,
        columns,
        ballot: {
            parties,
            npn,
            valid: parties + npn,
            invalid,
            cast: parties + npn + invalid,
            valid_from_rows: columns.total_valid,
            cast_from_rows: columns.total,
            agree: Math.abs(parties + npn - (columns.total_valid || 0)) < 0.5
                && Math.abs(parties + npn + invalid - (columns.total || 0)) < 0.5,
        },
    };
}

/** The rows the sliders are currently showing, or all of them. */
function shownRows() {
    if (filteredKeys === null) return csvData;
    return csvData.filter(row => filteredKeys.has(settlementKey(row.id)));
}

// Heroku's router rejects a request line over 4096 bytes, and the history
// page passes its ekatte list straight on to /data. Measured against
// production: 756 codes in a 4 093-character URL went through, 762 in 4 129
// did not.
const MAX_REQUEST_LINE = 4000;   // 4096 less room for "GET ... HTTP/1.1"

/**
 * How many characters of ekatte list will fit, given what else /data has to
 * carry. Computed rather than fixed, because a long party selection is
 * expensive: percent-encoded Cyrillic runs six characters per letter.
 */
function ekatteBudget() {
    const overhead = '/api/data?party=&ekatte='.length
        + encodeURIComponent(selectedParties).length;
    return MAX_REQUEST_LINE - overhead;
}

/**
 * The electoral history of the filtered settlements, summed. /data takes a
 * ';'-separated ekatte list and adds them up, so this is the history of
 * "the places that declined by half", which is the interesting question.
 *
 * Returns null when the list would not fit in a URL the API will accept.
 */
function historyLink() {
    if (filteredKeys === null) return null;

    // Leading zeros are redundant -- the API parses these with int() -- and
    // every character counts against the budget.
    const codes = [...filteredKeys]
        .map(key => String(Number(key)))
        .sort((a, b) => Number(a) - Number(b))
        .join(';');

    if (codes.length > ekatteBudget()) {
        return `<i>историята на тези ${nf(filteredKeys.size)} места не се`
            + ` побира в един адрес; стесни филтъра</i>`;
    }

    const url = `../hist.html?ekatte=${codes}`
        + `&party=${encodeURIComponent(selectedParties)}`;
    return `<a href="${url}" target="_blank"`
        + ` title="обобщена изборна история на филтрираните места">`
        + `виж историята на тези ${nf(filteredKeys.size)} места</a>`;
}

/** A one-line description of the active filters, for the totals box. */
function filterSummary() {
    const parts = [];
    const direction = deltaDirection === 'decline' ? 'спад' : 'ръст';
    if (minDelta > 0) parts.push(`${direction} ≥ ${(100 * minDelta).toFixed(0)}%`);
    if (minDeltaVotes > 0) parts.push(`${direction} ≥ ${nf(minDeltaVotes)} гласа`);
    if (minSupport > 0) parts.push(`подкрепа ≥ ${(100 * minSupport).toFixed(0)}%`);
    if (minSupportVotes > 0) parts.push(`подкрепа ≥ ${nf(minSupportVotes)} гласа`);
    return parts.join(', ');
}

document.getElementById("csvDropdown").addEventListener("change", function(event) {
    const electionId = event.target.value;
    loadCSV(electionId).then(() => updateElection());
});

document.getElementById("pinsDropdown").addEventListener("change", updatePins);
document.getElementById('hideInfo').addEventListener('click', closeInfoBox);
document.getElementById('minDelta').addEventListener('change', updateMinDelta);
document.getElementById('deltaDirection')
    .addEventListener('change', updateDeltaDirection);
document.getElementById('minDeltaVotes').addEventListener('change', updateMinDeltaVotes);
document.getElementById('minSupport').addEventListener('change', updateMinSupport);
document.getElementById('minSupportVotes').addEventListener('change', updateMinSupportVotes);

const radios = document.querySelectorAll('input[name="choice"]');

radios.forEach(radio => {
  radio.addEventListener('change', function(event) {
    if (event.target.checked) {
      updateMapType(event);
    }
  });
});

async function initializeCombobox() {
  const parties = await getParties();
  partyCombobox = new CSVCombobox(parties, {
      inputId: 'partyCombobox',
      listId: 'partyOptionsList',
      hiddenValueId: 'partySelectedValue',
      tagsContainerId: 'partySelectedTags',
      multiSelect: true
  });
  await partyCombobox.init();

  if (selectedParties) {
    partyCombobox.setOptions(selectedParties.split(';'));
  }

  document.getElementById('partySelectedValue').addEventListener('change', updatePartySelection);
}

loadGeoJSON().then(() => populateElectionDropdown()).then(initializeCombobox).then(initializeMap);

function loadCSV(electionId) {
    return new Promise(async (resolve, reject) => {
        try {
            // /data_for_maps returns the same payload /grouped_data did, plus
            // `totals` and `abroad`. Abroad is on so the tally is the national
            // one; those settlements simply have no polygon to draw.
            const apiResponse = await getMapData({
                el: electionId,
                party: selectedParties === 'total' ? null : selectedParties,
                groupby: 'ekatte',
                abroad: true,
                totals: true,
            });
            electionTotals = apiResponse ? apiResponse.totals : null;
            ballotOrder = apiResponse ? apiResponse.columns : [];
           
            // some massage to get back the papaParse structure; saves us some refactoring
            const transformedData = transformApiResponseToArray(apiResponse);
            
            const result = {
                data: transformedData,
                errors: [],
                meta: {}
            };
            
            csvData = result.data;
            resolve(result);
        } catch (error) {
            reject(error);
        }
    });
}

function transformApiResponseToArray(apiResponse) {
    // apiResponse format: df.to_dict(orient='split')
    // {
    //   "columns": ["id", "eligible_voters", "total", "party1", "party2", ...],
    //   "index": [14, 28, 31, ...],
    //   "data": [[14, 2316, 1131, 124, 20, ...], [28, 93, 56, 16, 7, ...], ...]
    // }
    // converting to: [ { id: 14, eligible_voters: 2316, total: 1131, party1: 124, ... }, ... ]
    
    const { columns, index, data } = apiResponse;
    
    const rows = data.map((rowValues, rowIndex) => {
        const row = { id: index[rowIndex] };
        
        columns.forEach((columnName, columnIndex) => {
            row[columnName] = rowValues[columnIndex];
        });
        
        return row;
    });
    
    return rows 
}

/**
 * The settlement boundaries, resolved through the API rather than hardcoded,
 * so the caption can name the file and a second layer can be added without
 * touching this.
 */
async function loadGeoJSON(el) {
  const descriptor = await getGeojsonDescriptor({
      el: el || null, layer: 'settlement' });
  // Always end up with a usable descriptor, so the caption and the table
  // links do not depend on the endpoint being reachable.
  boundary = descriptor && descriptor.url ? descriptor : {
      id: SETTLEMENT_LAYER,
      url: SETTLEMENT_URL,
      layer: 'settlement',
      join: 'ncode',
      exact: true,
  };
  const url = boundary.url;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.statusText}`);
  geojsonData = await response.json();
  featureKeys = new Set(
      geojsonData.features.map(f => String(f.properties.ncode)));
  renderLayerInfo();
}

function populateElectionDropdown() {
    return new Promise(async (resolve, reject) => {
        try {
            const electionData = await getElectionIds();
            const dropdown = document.getElementById('csvDropdown');
            
            dropdown.innerHTML = '';
            
            // options from API
            for (const [electionId, label] of Object.entries(electionData)) {
                const option = document.createElement('option');
                option.value = electionId;
                option.textContent = label;
                dropdown.appendChild(option);
            }
            
            // default to most recent
            const options = dropdown.querySelectorAll('option');
            if (options.length > 0) {
                dropdown.value = options[options.length - 1].value;
            }
            
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}

function loadMarkerData(file) {
    return fetch(file)
    .then(response => {
        if (!response.ok) {
            throw new Error('Грешка.' + response.statusText);
        }
        return response.json();
    })
    .catch(error => console.error('Error fetching marker data:', error));
}

async function matchData(parties, el) { 
  const deltas = await getDeltas(parties, el);
  geojsonData.features.forEach((feature) => {

    const match = csvData.find((row) => settlementKey(row.id) === feature.properties.ncode);
    if (match) {
      feature.properties['delta'] = deltas['delta'][feature.properties.ncode.replace(/^0+/, '')];
      feature.properties['delta_votes'] = deltas['delta_votes'][feature.properties.ncode.replace(/^0+/, '')];
      feature.properties['el_ref'] = deltas['meta']['el_ref'];
      feature.properties['el'] = deltas['meta']['el'];
      if (parties !=='total') {
        feature.properties['value_prop'] = match['partyGroup']/match['total'];
        feature.properties['value'] = match['partyGroup'];
      } else {
        feature.properties['value_prop'] = match['total']/match['eligible_voters'];
        feature.properties['value'] = match['total'];
      };
      feature.properties['total'] = match['total']; 
      feature.properties['eligible_voters'] = match['eligible_voters']; 
      feature.properties['активност'] = match['total']/match['eligible_voters']; 
    } else {
      feature.properties['value'] = NaN;
      feature.properties['value_prop'] = NaN;
      feature.properties['delta'] = NaN;
      feature.properties['delta_votes'] = NaN;
      feature.properties['total'] = NaN; 
      feature.properties['eligible_voters'] = NaN; 
      feature.properties['активност'] = NaN; 
    }
  });
}

function onEachFeature(feature, layer) {
    const defaultPopup = `<h3>${feature.properties.name}, общ.${feature.properties.obsht_name}, обл.${feature.properties.oblast_name}</h3>`;
   
    if (!isMobile()) { 
        layer.bindPopup(
            `${defaultPopup}Зарежда се... (ако виждаш това, вероятно сървърът се буди)`,
            {maxWidth: 600}
        );
    }

    layer.on({
        mouseover: function(e) {
            if (currentHighlight != null) {
                geojsonLayer.resetStyle(currentHighlight);
            }
            currentHighlight = e.target;
            highlightFeature(e);
            info.update(layer.feature.properties, selectedParties);
        },
        mouseout: function(e) {
	        geojsonLayer.resetStyle(e.target);
	        info.update(undefined, selectedParties);
            currentHighlight = null;
        },
        click: function(e) {
            map.fitBounds(e.target.getBounds()); // zoom to feature
            if (!isMobile()) {
                getPlaceHist(feature.properties.ncode, selectedParties).then(
                    tsData => {
                    const popupContent = JsonToTable(tsData); // TODO show figure instead of table
                    const cleanEkatte = feature.properties.ncode.replace(/^0+/, '');
                    const sids = `<br><a href="../hist.html?ekatte=${cleanEkatte}">виж секции</a>`;
                    const placeHist = `|<a href="../hist.html?ekatte=${cleanEkatte}&party=${selectedParties}">виж история</a>`;
                    layer.setPopupContent(
                        `${defaultPopup}${popupContent}${sids}${placeHist}`
                    );
                })
                .catch(error => {
                    console.error('Error fetching data:', error);
                    layer.setPopupContent('Грешка.');
                });
            } else {
                highlightFeature(e);
                info.update(layer.feature.properties, selectedParties);
            }
        },
	});
}

function initializeMap() {
  map = L.map('map').setView([42.934, 25.938], 8);

  var tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  	maxZoom: 19,
  	attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>|<a href="https://twitter.com/petar_baka">petar_baka</a>'
  }).addTo(map);

  geojsonLayer = L.geoJson(geojsonData, {
    style: (feature) => style(feature, mapType),
  	onEachFeature: onEachFeature
  }).addTo(map);


  info.onAdd = function (map) {
  	this._div = L.DomUtil.create('div', 'info');
  	this.update();
  	return this._div;
  };

  info.update = function (props, parties) {
  	var textbox = generateTextbox(props, parties);

    this._div.innerHTML = '';

    let contentDiv = L.DomUtil.create("div", "info-content", this._div);
    contentDiv.innerHTML = textbox;

    // A sibling of the scrollable content rather than part of it, so it stays
    // pinned to the bottom of the box instead of needing to be scrolled to.
    // The same control serves the hovered box, which used to have a close
    // button of its own: collapsing it leaves the headline on screen, which
    // closing did not, so there is no reason to keep two layouts.
    if (isMobile() && (props || electionTotals)) {
        const toggle = L.DomUtil.create('button', 'details-toggle', this._div);
        toggle.type = 'button';
        toggle.textContent = detailsOpen
            ? 'скрий подробностите ▴'
            : 'подробности ▾';
        L.DomEvent.on(toggle, 'click', (event) => {
            L.DomEvent.stopPropagation(event);
            detailsOpen = !detailsOpen;
            info.update(props, parties);
        });
    }
  };

  info.addTo(map);

  legend.addTo(map);

  L.Control.InfoButton = L.Control.extend({ // TODO simpler with <button>
      onAdd: function(map) {
          var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
  
          container.style.backgroundColor = 'white';     
          container.style.width = '30px';
          container.style.height = '30px';
          container.innerHTML = 'i'; 
          container.style.fontSize = '18px';
          container.style.textAlign = 'center';
          container.style.lineHeight = '30px';
          container.style.cursor = 'pointer';
  
          container.onclick = function(){
              openInfoBox();
          }
  
          return container;
      }
  });
  
  var infoButton = new L.Control.InfoButton({ position: 'topleft' });
  infoButton.addTo(map);

  markerGroup = L.layerGroup().addTo(map);

  const urlParams = new URLSearchParams(window.location.search); // TODO separate setState() func
  const lat = parseFloat(urlParams.get('lat'));
  const lng = parseFloat(urlParams.get('lng'));
  const zoom = parseInt(urlParams.get('zoom'), 10);
  setMapType(urlParams.get('type'));

  if (lat && lng && zoom) {
      map.setView([lat, lng], zoom);
  }

  const party = urlParams.get('party');
  const el = urlParams.get('el');

  set_el_and_party(el, party);
  
  minDelta =  parseFloat(urlParams.get('minDelta') || 0.);
  minSupport =  parseFloat(urlParams.get('minSupport') || 0.);
  minDeltaVotes =  parseInt(urlParams.get('minDeltaVotes') || 0);
  minSupportVotes =  parseInt(urlParams.get('minSupportVotes') || 0);

  if (urlParams.get('deltaDir') === 'decline') {
      deltaDirection = 'decline';
      const radio = document.querySelector(
          '#deltaDirection input[value="decline"]');
      if (radio) radio.checked = true;
  }

  setSlider(urlParams, 'minDelta');
  setSlider(urlParams, 'minDeltaVotes');
  setSlider(urlParams, 'minSupport');
  setSlider(urlParams, 'minSupportVotes');

  applyFilter(minDelta, minDeltaVotes, minSupport, minSupportVotes);

  map.on('moveend zoomend', updateUrlWithMapState);
}

function set_el_and_party(el, party) {
    const csvDropdown = document.getElementById('csvDropdown');
    const options = Array.from(csvDropdown.options).map(option => option.value);

    if (el && options.includes(el)) { // el specified in url is a valid option
        csvDropdown.value = el; //does not trigger event listeners
        if (party) {
            selectedParties = party;
            partyCombobox.setOptions(party.split(';'));
        }
        loadCSV(el).then(() => {
            updateElection();
        });
    } else { // fall back to default 
        loadCSV(csvDropdown.value).then(() => updateElection());
    }
}

const updateUrlWithMapState = () => {
    const center = map.getCenter();
    const zoom = map.getZoom();

    const el = document.getElementById('csvDropdown').value;
    const party = selectedParties;

    let newUrl = `${window.location.pathname}?lat=${center.lat}&lng=${center.lng}&zoom=${zoom}&el=${el}&party=${party}&type=${mapType}`;
    newUrl += `&minDelta=${minDelta}`;
    newUrl += `&minDeltaVotes=${minDeltaVotes}`;
    newUrl += `&minSupport=${minSupport}`;
    newUrl += `&minSupportVotes=${minSupportVotes}`;
    newUrl += `&deltaDir=${deltaDirection}`;

    window.history.replaceState(null, '', newUrl);
};

function updateElection() {
  
  const el = document.getElementById('csvDropdown').value;

  matchData(selectedParties, el).then(() => {
    geojsonLayer.setStyle(feature => {
      return getFeatureColor(feature, mapType);
    });
    applyFilter(minDelta, minDeltaVotes, minSupport, minSupportVotes)
  })

  info.update(undefined, selectedParties);
  updateUrlWithMapState();
}

function updatePartySelection(event) {
  selectedParties = this.value;
  if (selectedParties === "") {
    selectedParties = 'total'; // TODO might need some extra work
  }
  const el = document.getElementById('csvDropdown').value;
  loadCSV(el).then(() => {
    matchData(selectedParties, el).then(() => {
      geojsonLayer.setStyle(feature => {
        return getFeatureColor(feature, mapType);
      });
      applyFilter(minDelta, minDeltaVotes, minSupport, minSupportVotes)
    })
    info.update(undefined, selectedParties);
    updateUrlWithMapState();
  });
}

function updateMapType(event) {
    mapType = event.target.value;

    // update colors
    geojsonLayer.setStyle(feature => {
      return getFeatureColor(feature, mapType);
    });

    // update legend
    map.removeControl(legend);
    legend = createLegend(mapType);
    legend.addTo(map);

    // update url
    updateUrlWithMapState();
}

/**
 * Name the boundary file under the controls. The settlement layer has one
 * file today, so this is mostly anticipation: once there is more than one,
 * the caption says which is in use without reading the network tab.
 */
function renderLayerInfo() {
    const box = document.getElementById('layerInfo');
    if (!box) return;
    if (!boundary || !boundary.url) {
        box.innerHTML = '';
        return;
    }
    const file = boundary.url.split('/').pop();
    let html = `Слой: <a href="${boundary.url}" target="_blank" `
        + `title="виж GeoJSON файла">${file}</a>`;
    if (boundary.exact === false) {
        html += `<br><span class="inherited">няма собствен слой; `
            + `границите са от ${boundary.source_date}</span>`;
    }
    box.innerHTML = html;
}

const numberFormat = new Intl.NumberFormat('bg-BG');
const nf = (v) => (v === null || v === undefined || isNaN(v))
    ? 'н.д.' : numberFormat.format(Math.round(v));
const pctOf = (part, whole) => whole ? `${(100 * part / whole).toFixed(1)}%` : 'н.д.';

/**
 * A count linking to that subset of rows in the table page.
 *
 * `abroad` has to be set per link, not once for the map: the domestic
 * no-polygon count is 16, but `{on_map} eq 0` with abroad included matches
 * 409, since no place abroad has a polygon either. Excluding them at the
 * source is what makes the link agree with the number next to it.
 */
function tableLink(count, filter, description, { abroad = true } = {}) {
    const params = new URLSearchParams({
        el: document.getElementById('csvDropdown').value,
        groupby: 'ekatte',
        abroad: abroad ? 'true' : 'false',
    });
    const layer = (boundary && boundary.id) || SETTLEMENT_LAYER;
    params.set('geojson', layer);
    if (filter) params.set('filter', filter);
    return `<a href="../table.html?${params}" target="_blank"`
        + ` title="виж ${description} в таблица">${nf(count)}</a>`;
}

/** Rows the boundary file cannot draw, split into domestic and abroad. */
function rowsWithoutPolygon() {
    const home = { count: 0, votes: 0 };
    const away = { count: 0, votes: 0 };
    for (const row of csvData) {
        const key = settlementKey(row.id);
        if (key !== null && featureKeys.has(key)) continue;
        const bucket = isAbroad(row.id) ? away : home;
        bucket.count += 1;
        bucket.votes += row.total || 0;
    }
    return { home, away };
}

/**
 * The whole election's figures, shown when nothing is hovered. The headline
 * tally is the national one, abroad included, so it can be checked against
 * the official result; what the map cannot draw is named separately below.
 */
function electionTextbox() {
    if (!electionTotals) return 'Посочете населено место.';

    // With the sliders set, the figures describe what is on the map, not the
    // whole election, and the box says so. Without them the API's own totals
    // are used, so nothing is recomputed in the common case.
    const filtered = filteredKeys !== null;
    const scope = filtered ? sumRows(shownRows()) : electionTotals;
    const columns = scope.columns;
    const ballot = scope.ballot;
    const turnout = selectedParties === 'total';

    let textbox = '';
    if (filtered) {
        textbox += `<i>Филтър: ${filterSummary()}</i><br>`;
        textbox += `<b>${nf(scope.rows)}</b> от ${nf(electionTotals.rows)} `
            + `населени места<br>`;
        const history = historyLink();
        if (history) textbox += `${history}<br>`;
    }
    if (turnout) {
        // The counts themselves are in the breakdown below, so only the rate
        // belongs up here.
        textbox += `Активност: ${pctOf(ballot.cast, columns.eligible_voters)}<br>`;
    } else {
        const votes = columns.partyGroup;
        textbox += `${selectedParties.split(';').map(p => renameMap[p] || p).join(';')}`;
        textbox += `<br>гласове: ${nf(votes)} `;
        textbox += `(${pctOf(votes, ballot.valid)} от действителните)<br>`;
    }

    if (isMobile() && !detailsOpen) return textbox;

    textbox += generateTableHtmlForRowById(null, columns);
    textbox += `За партии и кандидати: ${nf(ballot.parties)}<br>`;
    textbox += `Не подкрепям никого: ${nf(ballot.npn)}<br>`;
    textbox += `Действителни (партии + НПН): ${nf(ballot.valid)}<br>`;
    textbox += `Невалидни: ${nf(ballot.invalid)}<br>`;
    textbox += `Общо гласували: ${nf(ballot.cast)}<br>`;
    textbox += `Избиратели по списък: ${nf(columns.eligible_voters)}<br>`;

    // What the map is not drawing, and why, in two separate categories: the
    // abroad one will shrink if polygons for those are ever added.
    const missing = rowsWithoutPolygon();
    const drawn = electionTotals.rows - missing.home.count - missing.away.count;

    textbox += '<br>';
    textbox += `Общо: ${tableLink(electionTotals.rows, null, 'всички населени места')} населени места<br>`;
    textbox += `На картата: ${tableLink(drawn, '{on_map} eq 1', 'тези с полигон')}`;
    // Only when a slider is narrowing it further. Counting the drawn layers
    // would be wrong here: the boundary file holds 5 255 polygons, including
    // ~1 091 settlements with no polling station in this election, so that
    // number is not comparable with the others.
    if (filteredCount !== null) {
        textbox += `, показани сега ${nf(filteredCount)}`;
    }
    textbox += '<br>';
    if (missing.home.count) {
        textbox += `Без полигон в страната: `
            + `${tableLink(missing.home.count, '{on_map} eq 0',
                           'тези без полигон в страната', { abroad: false })}`
            + ` (${nf(missing.home.votes)} гласували)<br>`;
    }
    if (missing.away.count) {
        textbox += `В чужбина: ${nf(missing.away.count)} места `
            + `(${nf(missing.away.votes)} гласували)`;
    }
    return textbox;
}

function generateTextbox(props, parties) {

    var textbox = '';
    var selectedYear = document.getElementById('csvDropdown');
    var selectedYearText = selectedYear.options[selectedYear.selectedIndex].textContent;

    if (parties) {
        parties = parties.split(';').map(party => renameMap[party] || party).join(';');
    }
    
    if (parties!=='total') {
        textbox += '<h4>Резултати (' + selectedYearText + ')</h4>';
    } else {
        textbox += '<h4>Активност (' + selectedYearText + ')</h4>';
    }

    if (props) {
        const targetRow  = csvData.find((row) => settlementKey(row.id) === props.ncode);

        var table = generateTableHtmlForRowById(props.ncode);

        textbox += `<b>${props.name}, общ. ${props.obsht_name} (${props.ncode})</b><br>`;

        if (parties !== 'total') {
            textbox += `${parties} <br>гласове: ${props['value']} (`
            textbox += `${isNaN(props['value']) ? 'н.д.' : (100*props['value']/props['total']).toFixed(1)}%)<br>`
            // TODO: add previous and last total 
        } else {
            // TODO: breakdown initial voter list, added to voter list, total 
            textbox += 'Общо гласували: ' +  props['total'] + '<br>' 
            textbox += 'Невалидни: ' +  targetRow['невалидни'] + '<br>' 
            textbox += 'Не подкрепям никого: ' +  targetRow['не подкрепям никого'] + '<br>' 
            textbox += 'Избиратели по списък: ' +  props['eligible_voters'] + '<br>'
            textbox += `Активност (%): ${isNaN(props['total']) ? 'н.д.' : (100*props['total']/props['eligible_voters']).toFixed(1)}<br>`
        }
        textbox += `<b>Промяна</b> спрямо ${props['el_ref']}:<br>`
        textbox += `${isNaN(props['delta']) ? 'н.д.' : (100*props['delta']).toFixed(1)}% `
        textbox += `(${isNaN(props['delta_votes']) ? 'н.д.' : props['delta_votes']} гласа)<br>`
        if (isMobile()) {
            const cleanEkatte = props.ncode.replace(/^0+/, '');
            textbox += `<a href="../hist.html?ekatte=${cleanEkatte}&party=${selectedParties}" target="_blank">виж история</a>`;
            if (!detailsOpen) return textbox;
            textbox += '<br>';
        }
        textbox += table + '<br>'
        textbox += 'Общо гласували (вкл. невалидни): ' +  props['total']  + '<br>'
        textbox += 'Избиратели по списък: ' +  props['eligible_voters'] + '<br>'
        textbox += `Гласували/избиратели по списък: ${isNaN(props['total']) ? 'н.д.' : (props['total']/props['eligible_voters']).toFixed(2)}<br>`
        textbox += `Брой секции: ${targetRow ? targetRow['n_stations'] : 0}<br>`
    } else {
        textbox += electionTextbox();
    };
    
    return textbox;
}

/**
 * The ballot as a table. Either for one settlement, by its code, or for an
 * explicit row -- which is how the election totals reuse it, since the totals
 * block is itself a column-to-value object.
 */
function generateTableHtmlForRowById(targetId, explicitRow) {

    const targetRow = explicitRow
        || csvData.find((row) => settlementKey(row.id) === targetId);

    if (!targetRow) return '';

    let html = '<table>';

    html += '<thead><tr>';
    html += '<th>Партия</th>';
    html += '<th>Гласове</th>';
    html += '<th>Дял</th>';
    html += '</tr></thead>';

    html += '<tbody><tr>';
    const selectedPartiesArray = selectedParties.split(';');
    // Follow the API's column order rather than the row's own keys, so the
    // totals table is sorted like every other one.
    const keys = ballotOrder.length
        ? ballotOrder.filter(key => key in targetRow)
        : Object.keys(targetRow);
    for (const key of keys) {
        if (![
                "total",
                "total_valid",
                "id",
                "eligible_voters",
                "eligible_voters_added",
                "eligible_voters_total",
                "activity",
                'region',
                'region_name',
                'nuts4',
                'municipality_name',
                'n_stations',
                'partyGroup',
                'on_map',
            ].includes(key)) {
            const partyName = renameMap[key] || key; // invalid, npn
            const nVotes = targetRow[key];
            const proportion = nVotes / targetRow.total;
            const isSelected = selectedPartiesArray.includes(key);
            const boldTag = isSelected ? '<b>' : '';
            const boldTagClose = isSelected ? '</b>' : '';

            html += `<tr>`;
            html += `<td>${boldTag}${partyName}${boldTagClose}</td>`;
            html += `<td>${boldTag}${nVotes}${boldTagClose}</td>`;
            html += `<td>${boldTag}${isNaN(proportion) ? 'н.д.' : proportion.toFixed(2)}${boldTagClose}</td>`;
            html += `</tr>`;
        }
    }
    html += '</tr></tbody>';

    html += '</table>';
    return html;
}

function openInfoBox() {
    document.getElementById('infoBox').style.display = 'block';
}

function closeInfoBox() {
    document.getElementById('infoBox').style.display = 'none';
}

function updatePins (event) {
  const selectedSus = event.target.value;
  var markerData;
  markerGroup.clearLayers();
  if (selectedSus!=='') {
    loadMarkerData(selectedSus).then(data =>{
        markerData = data;
        updateSusLayer(markerData, markerGroup);
    });
  };
};

function updateSusLayer(markerData, markerGroup) {
  geojsonData.features.forEach(feature => {
      var id = feature.properties.ncode;
      if (id in markerData) {

        const point = markerData[id];
        id = id.replace(/^0+/, "");

        var popupContent = `${feature.properties.name}, общ. ${feature.properties.obsht_name} (${id})</b><br>`;
        popupContent += `<img src="${GHP_ROOT}/assets/2021/spadove/${id}.png" style="width:500px; height:auto;" />`;
        popupContent += `<br><a href="${GHP_ROOT}/assets/2021/spadove/${id}.html" target="_blank">Виж секции</a>`;
        popupContent += ' <a href="../analizi/2021/top.html" target="_blank">Защо има карфица тук?</a>';
        
        L.marker([point[1], point[0]])
            .addTo(markerGroup)
            .bindPopup(
                popupContent,
                {
                    maxWidth: 600,
                    minWidth: 300
                }
            );
      }
  });
};

function setMapType(value) {
  const radioToCheck = Array.from(radios).find(radio => radio.value === value);
  if (radioToCheck) {
    radioToCheck.checked = true;

    const event = new Event('change', { bubbles: true });
    radioToCheck.dispatchEvent(event);
  }
}

function setSlider(urlParams, id) {
  let factor;
  let value;
  if (id.includes('Votes')) {
    factor = 1;
    value =  parseInt(urlParams.get(id) || 0);
  } else {
    factor = 100;
    value =  parseFloat(urlParams.get(id) || 0.);
  }
  const slider = document.getElementById(id);
  slider.value = value;
  document.getElementById(`${id}Display`).textContent = value*factor;
}

function createGeoJsonLayer(geoData, selectedEkatte=null) {
  let geoLayer = L.geoJson(geoData, {
    style: (feature) => style(feature, mapType),
  	onEachFeature: onEachFeature,
    filter: function(feature) {
      if (selectedEkatte == null) {
        return true;
      } else {
        return selectedEkatte.includes(feature.properties.ncode);
      }
    },
  })

  return geoLayer;
}

function updateDeltaDirection(event) {
    deltaDirection = event.target.value;
    applyFilter(minDelta, minDeltaVotes, minSupport, minSupportVotes);
}

function updateMinDelta(event) {
    let display = document.getElementById("minDeltaDisplay");
    minDelta = event.target.value;
    applyFilter(minDelta, minDeltaVotes, minSupport, minSupportVotes);
    display.innerHTML =  100*minDelta;
}

function updateMinDeltaVotes(event) {
    let display = document.getElementById("minDeltaVotesDisplay");
    minDeltaVotes = event.target.value;
    applyFilter(minDelta, minDeltaVotes, minSupport, minSupportVotes)
    display.innerHTML =  minDeltaVotes;
}

function updateMinSupport(event) {
    let display = document.getElementById("minSupportDisplay");
    minSupport = event.target.value;
    applyFilter(minDelta, minDeltaVotes, minSupport, minSupportVotes);
    display.innerHTML =  100*minSupport;
}

function updateMinSupportVotes(event) {
    let display = document.getElementById("minSupportVotesDisplay");
    minSupportVotes = event.target.value;
    applyFilter(minDelta, minDeltaVotes, minSupport, minSupportVotes);
    display.innerHTML =  minSupportVotes;
}

function applyFilter(minDelta, minDeltaVotes, minSupport, minSupportVotes) {
    let selectedEkatte = [];

    if ((minDelta>0) || (minDeltaVotes>0) || (minSupport>0) || (minSupportVotes>0)) {
        // Support is a magnitude and never negative, so it stays a plain
        // comparison; only the change filters take a direction.
        const growth = deltaDirection !== 'decline';
        // A slider at zero means no constraint, so moving only a *support*
        // slider does not silently also demand a direction of change. The
        // old two-sided test had the same property for a different reason:
        // |x| >= 0 is true for anything finite.
        const passesChange = (value, threshold) => threshold <= 0
            ? true
            : (growth ? value >= threshold : value <= -threshold);

        geojsonData.features.forEach((feature) => {
            if (
              passesChange(feature.properties['delta'], minDelta) &&
              passesChange(feature.properties['delta_votes'], minDeltaVotes) &&
              (feature.properties['value_prop']>=minSupport) &&
              (feature.properties['value']>=minSupportVotes)
            ) {
              selectedEkatte.push(feature.properties.ncode);
            }
        })
    } else {
        selectedEkatte = null; // show all
    }

    // For the totals box: how many settlements the sliders are showing. null
    // when nothing is filtered, so the box can stay quiet about it.
    filteredCount = selectedEkatte === null ? null : selectedEkatte.length;
    filteredKeys = selectedEkatte === null ? null : new Set(selectedEkatte);

    map.removeLayer(geojsonLayer);

    geojsonLayer = createGeoJsonLayer(geojsonData, selectedEkatte)
    geojsonLayer.addTo(map);

    // The resting infobox reports the filtered totals, so it has to be
    // redrawn when the filter moves. Guarded because applyFilter runs once
    // during startup, before initializeMap has defined update().
    if (typeof info.update === 'function') {
        info.update(undefined, selectedParties);
    }

    updateUrlWithMapState();
}

// Mobile menu toggle functionality
document.addEventListener('DOMContentLoaded', function() {
    const menuToggle = document.getElementById('menuToggle');
    const menuContent = document.querySelector('.menu-content');

    if (menuToggle && menuContent) {
        menuToggle.addEventListener('click', function() {
            menuContent.classList.toggle('show');
            // Update button text based on state
            const menuText = menuToggle.querySelector('.menu-text');
            const menuIcon = menuToggle.querySelector('.menu-icon');
            if (menuContent.classList.contains('show')) {
                menuText.textContent = 'Затвори';
                menuIcon.textContent = '×';
            } else {
                menuText.textContent = 'Меню';
                menuIcon.textContent = '☰';
            }
        });
    }
});

