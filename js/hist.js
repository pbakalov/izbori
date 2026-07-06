import { getSidsByDate, getSidResults, getPlaceResults, getSidHist, getPlaceHist, getParties } from './api_utils.js'
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
        const placeValue = document.getElementById('placeCombobox').value;
        const partyValues = Array.from(partyCombobox.selectedValues);
        
        summaryPlace.textContent = placeValue || 'Избери място';
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

// Some views (election/SID details, SID list) render only a table, no chart.
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

function getPartyVotes(data, key) {
    const partyVotes = [];
    for (const col in data) {
        if (!nonPartyKeys.includes(col)) {
            if (!renameMap.hasOwnProperty(col)) renameMap[col] = col;
            partyVotes.push({ key: col, party: renameMap[col], votes: data[col][key] });
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

/**
 * Single election, ekatte or SID: results table + bar chart.
 */
function updateSingleElectionPlot(data, el, ekatte=null, sid=null) {
    const key = ekatte !== null ? String(ekatte) : sid;

    let tableHTML;
    if (ekatte !== null) {
        tableHTML = `<h3>${el}</h3>`;
        tableHTML += '<table><thead><tr><th>Данни за населеното место</th><th></th></tr></thead><tbody>';

        const placeOptions = document.getElementById('placeOptions');
        const matchingOption = Array.from(placeOptions.children).find(
            option => option.dataset.value === String(ekatte)
        );
        if (matchingOption) {
            tableHTML += `<tr><td>Място</td><td>${matchingOption.dataset.placeName}</td></tr>`;
            tableHTML += `<tr><td>Община</td><td>${matchingOption.dataset.municipalityName}</td></tr>`;
            tableHTML += `<tr><td>Област</td><td>${matchingOption.dataset.regionName}</td></tr>`;
        }
        tableHTML += `<tr><td>ЕКАТТЕ</td><td>${ekatte}</td></tr>`;
        ['n_stations', 'eligible_voters', 'total_valid', 'total'].forEach(col => {
            if (!renameMap.hasOwnProperty(col)) renameMap[col] = col;
            const value = data[col][key] || 'н.д.';
            tableHTML += `<tr><td>${renameMap[col]}</td><td>${value}</td></tr>`;
        });
        tableHTML += '</tbody></table>';
    } else {
        const skipKeys = ['region', 'station', 'admin_reg', 'municipality'];
        tableHTML = `<h3>${el} секция ${sid}</h3>`;
        tableHTML += '<table><thead><tr><th>Данни за секцията</th><th></th></tr></thead><tbody>';
        metadataKeys.forEach(col => {
            if (!renameMap.hasOwnProperty(col)) renameMap[col] = col;
            if (!skipKeys.includes(col)) {
                const value = data[col][key] || 'н.д.';
                tableHTML += `<tr><td>${renameMap[col]}</td><td>${value}</td></tr>`;
            }
        });
        tableHTML += '</tbody></table>';
    }

    const partyVotes = getPartyVotes(data, key);

    tableHTML += '<h4>Резултати</h4>';
    tableHTML += '<table><thead><tr><th>Партия</th><th>Гласове</th></tr></thead><tbody>';
    partyVotes.forEach(item => {
        tableHTML += `<tr><td>${item.party}</td><td>${item.votes}</td></tr>`;
    });
    tableHTML += '</tbody></table>';

    document.getElementById('text').innerHTML = tableHTML;

    const bars = buildElectionBars(partyVotes, Number(data['total_valid'][key]));

    const chartData = [{
        x: bars.map(b => b.party),
        y: bars.map(b => Number(b.votes)),
        type: 'bar',
        marker: { color: '#4a90d9' }
    }];

    const layout = {
        title: ekatte !== null ? 'Резултати' : `Резултати секция ${sid}`,
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

async function populateComboBox(csvFilePath, inputId, datalistId) { //provides some customizations that are missing in CSVCombobox
    const response = await fetch(csvFilePath);
    const csvText = await response.text();
    const rows = csvText.split("\n").map(row => row.trim());
    rows.shift(); // remove headers

    const inputElement = document.getElementById(inputId);
    const dataList = document.getElementById(datalistId);

    dataList.innerHTML = ""; 

    rows.forEach(row => {
        const [ind, ekatte, region_name, municipality_name, place, notes, nuts4] = row.split(";");
        if (ekatte && place) {
            const option = document.createElement("option");
            option.value = `${place.trim()} (${municipality_name.trim()})`;
            option.dataset.value = ekatte.trim();
            option.dataset.placeName = place.trim();
            option.dataset.municipalityName = municipality_name.trim();
            option.dataset.regionName = region_name.trim();
            dataList.appendChild(option);
        }
    });

    inputElement.addEventListener("change", () => {
        const selectedText = inputElement.value;
        const selectedOption = Array.from(dataList.children).find(
            option => option.value === selectedText
        );

        if (selectedOption) {
            //console.log("Display:", selectedOption.value); // Visible text
            //console.log("Value:", selectedOption.dataset.value); // Hidden value
            //window.location.href = `${window.location.href}?ekatte=${selectedOption.dataset.value}`;
        } else {
            console.log("Custom input:", selectedText);
        }
    });
}

function updateSelection() {
    const partyValue = partySelect.value;
    const placeValue = placeSelect.value; // place (municipality)
    const placeOptions = document.getElementById('placeOptions'); // ekatte matching placeValue
    const chart = document.getElementById('chart'); 

    if (partyValue && placeValue) { // show place history plot
        const ekatte = Array.from(placeOptions.children).find(
            option => option.value === placeValue
        ).dataset.value;
        showPlaceHistory(ekatte, partyValue);
        updateUrl(ekatte, null, partyValue);
    } else if (partyValue && sid) { // show sid history plot
        showSidHistory(sid, partyValue);
        updateUrl(null, sid, partyValue);
    } else if (placeValue) { // show SIDs by date
        const ekatte = Array.from(placeOptions.children).find(
            option => option.value === placeValue
        ).dataset.value;
        updateUrl(ekatte);
        showSidsByDate(ekatte);
        chart.innerHTML = '';
    } else if (partyValue) { // national totals
        showPlaceHistory(ekatte, partyValue);
        updateUrl(null, null, partyValue);
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

function updatePlaceInput(ekatte) { // TODO adjust for multiple ekatte
    const inputElement = document.getElementById('placeCombobox');
    const placeOptions = document.getElementById('placeOptions'); 
    const placeName = Array.from(placeOptions.children).find(
        option => option.dataset.value === String(ekatte)
    ).value;
    inputElement.value = placeName;
}

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
const ekatte = urlParams.get('ekatte');
const el = urlParams.get('el');
const sid = urlParams.get('sid');
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

window.addEventListener('resize', () => {
    const chart = document.getElementById('chart');
    if (chart.data) {
        // updatePlot(chart.data, party, ekatte); // good idea, but needs fixing
        updateSelection();
    }
});

populateComboBox(
    `assets/data/geo/place_data.csv`, //TODO get place data from API/repo
    "placeCombobox", 
    "placeOptions"
).then(() => {
    initializeMobileMenu();
    if (ekatte!==null && party!==null) {
        updatePlaceInput(ekatte);
        partyCombobox.setOptions(party.split(';'));
    } else if (ekatte!==null && el!==null) {
         showPlaceDetails(el, ekatte);
        updatePlaceInput(ekatte);
    } else if (ekatte!==null) {
        showSidsByDate(ekatte);
        updatePlaceInput(ekatte);
    } else if (el!==null && sid!==null) {
        showSidDetails(el, sid);
    } else if (sid!==null && party!==null) {
        partyCombobox.setOptions(party.split(';'));
    } else if (party!==null) {
        partyCombobox.setOptions(party.split(';'));
    } else {
        document.getElementById('text').innerHTML = '';
    }
});

const placeSelect = document.getElementById('placeCombobox');
const partySelect = document.getElementById('partySelectedValue');

partySelect.addEventListener('change', updateSelection);
placeSelect.addEventListener('change', updateSelection);
