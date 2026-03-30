import { getColor, style, highlightFeature, createLegend, getFeatureColor, JsonToTable } from './maps_shared.js';
import { getPlaceHist, getDeltas, getGroupedData, getElectionIds, getParties } from './api_utils.js';
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

document.getElementById("csvDropdown").addEventListener("change", function(event) {
    const electionId = event.target.value;
    loadCSV(electionId).then(() => updateElection());
});

document.getElementById("pinsDropdown").addEventListener("change", updatePins);
document.getElementById('hideInfo').addEventListener('click', closeInfoBox);
document.getElementById('minDelta').addEventListener('change', updateMinDelta);
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
            const apiResponse = await getGroupedData(electionId, selectedParties);
           
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

function loadGeoJSON() {
  return new Promise((resolve, reject) => {
    fetch("../assets/data/geo/settlements_simplified1pct.json")
      .then((response) => response.json())
      .then((data) => {
        geojsonData = data;
        resolve();
      })
      .catch((error) => {
        reject(error);
      });
  });
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

    const match = csvData.find((row) => ('00000' + row.id).slice(-5) === feature.properties.ncode); 
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
    var closeButton;
    if (props && isMobile()) {
        closeButton = L.DomUtil.create('button', 'close-btn', this._div);
        closeButton.innerHTML = 'x';
        closeButton.style.float = 'right';
    };

    let contentDiv = L.DomUtil.create("div", "info-content", this._div);
    contentDiv.innerHTML = textbox;

    if (props && isMobile()) {
        L.DomEvent.on(closeButton, 'click', () => {
            this.close();
        });
    };
  };

  info.close = function() {
      info.update(undefined, selectedParties);
      // TODO reset the style of the clicked feature 
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
        const targetRow  = csvData.find((row) => ('00000' + row.id).slice(-5) === props.ncode); 

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
        }
        textbox += table + '<br>'
        textbox += 'Общо гласували (вкл. невалидни): ' +  props['total']  + '<br>'
        textbox += 'Избиратели по списък: ' +  props['eligible_voters'] + '<br>'
        textbox += `Гласували/избиратели по списък: ${isNaN(props['total']) ? 'н.д.' : (props['total']/props['eligible_voters']).toFixed(2)}<br>`
        textbox += `Брой секции: ${targetRow ? targetRow['n_stations'] : 0}<br>`
    } else {
        textbox += 'Посочете населено место.'
    };
    
    return textbox;
}

function generateTableHtmlForRowById(targetId) {
    
    const targetRow  = csvData.find((row) => ('00000' + row.id).slice(-5) === targetId); 

    if (!targetRow) return '';

    let html = '<table>';

    html += '<thead><tr>';
    html += '<th>Партия</th>';
    html += '<th>Гласове</th>';
    html += '<th>Пропорция</th>';
    html += '</tr></thead>';

    html += '<tbody><tr>';
    const selectedPartiesArray = selectedParties.split(';');
    for (let key in targetRow) {
        if (![
                "total",
                "total_valid",
                "id",
                "eligible_voters",
                "activity",
                'region',
                'region_name',
                'nuts4',
                'municipality_name',
                'n_stations',
                'partyGroup',
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
        geojsonData.features.forEach((feature) => {
            if (
              (Math.abs(feature.properties['delta']) >= (minDelta)) && 
              (Math.abs(feature.properties['delta_votes'])>=minDeltaVotes) &&
              (Math.abs(feature.properties['value_prop'])>=minSupport) &&
              (Math.abs(feature.properties['value'])>=minSupportVotes)
            ) {
              selectedEkatte.push(feature.properties.ncode);
            }
        })
    } else {
        selectedEkatte = null; // show all
    }

    map.removeLayer(geojsonLayer);

    geojsonLayer = createGeoJsonLayer(geojsonData, selectedEkatte)
    geojsonLayer.addTo(map);
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

