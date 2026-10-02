// const ApiBaseUrl = 'https://bg-izbori.herokuapp.com/api/';
const ApiBaseUrl = 'http://127.0.0.1:8050/api/'; // for local dev 

export async function getSidsByDate(ekatte) {
    const url=`${ApiBaseUrl}/sids?ekatte=${ekatte}`;

    const data = await fetchData(url);
    return data;
}

export async function getSidResults(el, sid) {
    const url=`${ApiBaseUrl}/single_election_data?el=${el}&sid=${sid}`;

    const data = await fetchData(url);
    return data;
}

export async function getPlaceResults(el, ekatte) {
    const url=`${ApiBaseUrl}/single_election_data?el=${el}&ekatte=${ekatte}`;

    const data = await fetchData(url);
    return data;
}

export async function getElectionTotals(el) {
    const url=`${ApiBaseUrl}/single_election_data?el=${el}`;

    const data = await fetchData(url);
    return data;
}

export async function getSidHist(sid, party) {
    const url=`${ApiBaseUrl}/data?sid=${sid}&party=${party}`;

    const data = await fetchData(url);
    return data;
}

export async function getPlaceHist(ekatte, party) {
    const url=`${ApiBaseUrl}/data?ekatte=${ekatte}&party=${party}`;

    const data = await fetchData(url);
    return data;
}

export async function getDeltas(party, el) {
    const url=`${ApiBaseUrl}/delta?party=${party}&el=${el}`;

    const data = await fetchData(url);
    return data;
}

export async function getGroupedData(el, party = null) {
    let url = `${ApiBaseUrl}/grouped_data?el=${el}`;
    if (party) {
        url += `&party=${party}`;
    }

    const data = await fetchData(url);
    return data;
}

/**
 * Election ids and their labels.
 * Called with no arguments it returns what it always did: the loaded national
 * assembly and European Parliament elections.
 * @param {string} [elType] - 'all', a family ('ns', 'ep', 'mes') or an exact
 *   type ('os', 'ko'), semicolon-separated for several.
 * @param {string} [mun] - keep only elections with data for this municipality.
 */
export async function getElectionIds({ elType = null, mun = null } = {}) {
    const url = withParams(`${ApiBaseUrl}election_ids`, { el_type: elType, mun });

    const data = await fetchData(url);
    return data;
}

/** Municipalities with data in a given election. */
export async function getMunicipalities(el) {
    const url = withParams(`${ApiBaseUrl}municipalities`, { el });

    const data = await fetchData(url);
    return data ? data.municipalities : null;
}

/** The separate ballots inside one municipality (rayon/kmetstvo contests). */
export async function getUnits(el, mun) {
    const url = withParams(`${ApiBaseUrl}units`, { el, mun });

    return await fetchData(url);
}

/**
 * Results in map shape, at settlement or polling-station resolution.
 * @param {string} groupby - 'ekatte' or 'sid'.
 */
export async function getMapData({ el, party = null, groupby = 'ekatte',
                                   mun = null, rayon = null,
                                   kmetstvo = null } = {}) {
    const url = withParams(`${ApiBaseUrl}data_for_maps`,
                           { el, party, groupby, mun, rayon, kmetstvo });

    return await fetchData(url);
}

/**
 * One page of results as a table, filtered and sorted server-side.
 * @param {string} [sort] - 'column:asc|desc', comma-separated.
 * @param {string} [filter] - clauses using >=, <=, >, <, !=, = or ~.
 * @param {string} [geojson] - boundary file id; adds an `on_map` column.
 */
export async function getTable({ el, mun = null, groupby = 'ekatte',
                                 party = null, rayon = null, kmetstvo = null,
                                 page = 0, pageSize = 50, sort = null,
                                 filter = null, geojson = null,
                                 abroad = null } = {}) {
    const url = withParams(`${ApiBaseUrl}table`, {
        el, mun, groupby, party, rayon, kmetstvo,
        page, page_size: pageSize, sort, filter, geojson, abroad,
    });

    return await fetchData(url);
}

/** Every boundary file for one layer, with its id and url. */
export async function getGeojsonIndex(layer = 'sid') {
    const url = withParams(`${ApiBaseUrl}geojson_index`, { layer });

    return await fetchData(url);
}

/**
 * Where to fetch the boundaries for an election, and how to join them.
 * Returns a descriptor with url, join, source_date and exact -- not polygons.
 */
export async function getGeojsonDescriptor({ el, layer = 'sid' } = {}) {
    const url = withParams(`${ApiBaseUrl}geojson`, { el, layer });

    return await fetchData(url);
}

/**
 * The ballot. With no arguments, every party that ever stood nationally, as
 * before. With `el`, only that election's ballot; local elections need `mun`
 * too, and `rayon`/`kmetstvo` for district- and village-mayor races.
 */
export async function getParties({ el = null, mun = null, rayon = null,
                                   kmetstvo = null } = {}) {
    const url = withParams(`${ApiBaseUrl}parties`, { el, mun, rayon, kmetstvo });

    const data = await fetchData(url);
    return data ? data.parties : null;
}

export async function getAllSids() {
    const url=`${ApiBaseUrl}all_sids`;

    const data = await fetchData(url);
    return data.sids;
}

export async function getSidsData(sids) {
    const sidArray = Array.isArray(sids) ? sids : [sids];
    const batchSize = 400;
    const allData = {};
    
    try {
        // Process SIDs in batches
        for (let i = 0; i < sidArray.length; i += batchSize) {
            const batch = sidArray.slice(i, i + batchSize);
            const sidList = batch.join(';');
            const url = `${ApiBaseUrl}/sid_data?sid=${sidList}`;
            
            const response = await fetchData(url);
            
            if (response && response.data) {
                // Merge batch results into allData
                Object.assign(allData, response.data);
            }
        }
        
        return { data: allData };
    } catch (error) {
        console.error('Error fetching SIDs data in batches:', error);
        return { data: {} };
    }
}

/** Appends the given query parameters, skipping null and undefined ones. */
function withParams(url, params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== undefined && value !== '') {
            search.append(key, value);
        }
    }
    const query = search.toString();
    return query ? `${url}?${query}` : url;
}

async function fetchData(url) {
    try {
        console.log(url);
        const response = await fetch(url);
        const data = await response.json();
        return data; 
    } catch (error) {
        console.error('Error:', error);
        return null;
    }
}

