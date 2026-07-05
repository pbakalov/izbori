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
        document.body.classList.toggle('mobile-show-table', viewToggleCheckbox.checked);
        viewToggleLabel.textContent = viewToggleCheckbox.checked ? 'Покажи графика' : 'Покажи таблица';
    });
}

function showSidHistory(sid, party) {
    document.getElementById('chart').innerHTML = loadingMsg;
    getSidHist(sid, party).then(sidData => {
        updatePlot(sidData, party);
    });
}

function showPlaceHistory(ekatte, party) {
    document.getElementById('chart').innerHTML = loadingMsg;
    getPlaceHist(ekatte, party).then(placeData => {
        updatePlot(placeData, party, ekatte);
    });
}

function showSidDetails(el, sid) {
    document.getElementById('text').innerHTML = loadingMsg;
    getSidResults(el, sid).then(sidData => {
        const newContent = sidDetail(sidData, el, sid);
        // TODO plot
        document.getElementById('text').innerHTML = newContent;
    });
}

function showPlaceDetails(el, ekatte) {
    document.getElementById('text').innerHTML = loadingMsg;
    getPlaceResults(el, ekatte).then(placeData => {
        const newContent = placeDetail(placeData, el, ekatte);
        // TODO plot
        document.getElementById('text').innerHTML = newContent;
    });
}

function showSidsByDate(ekatte) {
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

function sidDetail(sidData, el, sid) {
    const skipKeys = ['region', 'station', 'admin_reg', 'municipality'];

    // metadata
    let tableHTML = `<h3>${el} секция ${sid}</h3>`; 
    tableHTML += '<table><thead><tr><th>Данни за секцията</th><th></th></tr></thead><tbody>';
    metadataKeys.forEach(key => {
        if (!renameMap.hasOwnProperty(key)) renameMap[key] = key;
        if (!skipKeys.includes(key)) {
            const value = sidData[key][sid] || 'н.д.'; 
            tableHTML += `<tr><td>${renameMap[key]}</td><td>${value}</td></tr>`;
        };
    });
    tableHTML += '</tbody></table>';

    // votes
    const partyVotes = [];

    for (const key in sidData) {
        if (!metadataKeys.includes(key)) {
            if (!renameMap.hasOwnProperty(key)) renameMap[key] = key;
            const votes = sidData[key][sid];
            partyVotes.push({ party: renameMap[key], votes: votes });
        }
    }

    partyVotes.sort((a, b) => b.votes - a.votes);

    let voteTableHTML = '<h4>Резултати</h4>'; 
    voteTableHTML += '<table><thead><tr><th>Партия</th><th>Гласове</th></tr></thead><tbody>';
    
    partyVotes.forEach(item => {
        voteTableHTML += `<tr><td>${item.party}</td><td>${item.votes}</td></tr>`;
    });
    
    voteTableHTML += '</tbody></table>';

    return tableHTML + voteTableHTML;
}

function placeDetail(placeData, el, ekatte) {
    const skipKeys = ['region', 'station', 'admin_reg', 'municipality', 'place', 'address', 'ekatte'];

    const _metadataKeys = [
        'n_stations', 
        'eligible_voters', 
        'total_valid', 
        'total'
    ];

    // metadata
    let tableHTML = `<h3>${el}</h3>`; 
    tableHTML += '<table><thead><tr><th>Данни за населеното место</th><th></th></tr></thead><tbody>';
    
    // Get place details from combobox options
    const placeOptions = document.getElementById('placeOptions');
    const matchingOption = Array.from(placeOptions.children).find(
        option => option.dataset.value === String(ekatte)
    );
    
    if (matchingOption) {
        const placeName = matchingOption.dataset.placeName;
        const municipalityName = matchingOption.dataset.municipalityName;
        const regionName = matchingOption.dataset.regionName;
        
        tableHTML += `<tr><td>Място</td><td>${placeName}</td></tr>`;
        tableHTML += `<tr><td>Община</td><td>${municipalityName}</td></tr>`;
        tableHTML += `<tr><td>Област</td><td>${regionName}</td></tr>`;
    }
    
    tableHTML += `<tr><td>ЕКАТТЕ</td><td>${ekatte}</td></tr>`;
    _metadataKeys.forEach(key => {
        if (!renameMap.hasOwnProperty(key)) renameMap[key] = key;
        if (!skipKeys.includes(key)) {
            const value = placeData[key][String(ekatte)] || 'н.д.'; 
            tableHTML += `<tr><td>${renameMap[key]}</td><td>${value}</td></tr>`;
        };
    });
    tableHTML += '</tbody></table>';

    // votes
    const partyVotes = [];

    for (const key in placeData) {
        if (!_metadataKeys.includes(key)) {
            if (!renameMap.hasOwnProperty(key)) renameMap[key] = key;
            const votes = placeData[key][String(ekatte)];
            partyVotes.push({ party: renameMap[key], votes: votes });
        }
    }

    partyVotes.sort((a, b) => b.votes - a.votes);

    let voteTableHTML = '<h4>Резултати</h4>'; 
    voteTableHTML += '<table><thead><tr><th>Партия</th><th>Гласове</th></tr></thead><tbody>';
    
    partyVotes.forEach(item => {
        voteTableHTML += `<tr><td>${item.party}</td><td>${item.votes}</td></tr>`;
    });
    
    voteTableHTML += '</tbody></table>';

    return tableHTML + voteTableHTML;
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
