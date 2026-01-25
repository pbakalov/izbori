// const ApiBaseUrl = 'https://bg-izbori.herokuapp.com/api/';
const ApiBaseUrl = 'http://127.0.0.1:8050/api/'; // API endpoint for local dev 

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

export async function getSidDetails(el, sid) {
    const url=`${ApiBaseUrl}/single_election_data?el=${el}&sid=${sid}`;

    const data = await fetchData(url);
    return data;
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

