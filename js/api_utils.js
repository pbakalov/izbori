const ApiBaseUrl = 'https://bg-izbori.herokuapp.com/api/';
// const ApiBaseUrl = 'http://127.0.0.1:8050/api/'; // for local dev 

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

export async function getGroupedData(el) {
    const url=`${ApiBaseUrl}/grouped_data?el=${el}`;

    const data = await fetchData(url);
    return data;
}

export async function getElectionIds() {
    const url=`${ApiBaseUrl}/election_ids`;

    const data = await fetchData(url);
    return data;
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

async function fetchData(url) {
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data; 
    } catch (error) {
        console.error('Error:', error);
        return null;
    }
}

