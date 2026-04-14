// NK167 Cases Table Generator
// Dynamically populates the table from JSON data

const pdf_base = "https://pbakalov.github.io/assets/dela_kupen_vot/";

/**
 * Fetch cases from JSON file
 */
async function fetchCases() {
    try {
        const response = await fetch('../assets/data/nk167/nk167_cases.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching cases:', error);
        return [];
    }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    if (text === null || text === undefined) {
        return "";
    }
    text = String(text);
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Format case number with link to PDF
 */
function formatCaseNumber(caseData) {
    const filePath = caseData.file_path;
    const caseNum = caseData.case_number.number;
    const caseType = caseData.case_number.type;
    const year = caseData.case_number.year;

    let caseDisplay;
    if (year) {
        caseDisplay = `${caseType} ${caseNum}/${year}`;
    } else {
        caseDisplay = `${caseType} №${caseNum}`;
    }

    return `<a href="${pdf_base}${filePath}" target="_blank">${caseDisplay}</a>`;
}

/**
 * Format election info
 */
function formatElection(caseData) {
    const election = caseData.election;
    const electionType = election.type;
    const year = election.year;
    return `${electionType} ${year}`;
}

/**
 * Format accused information
 */
function formatAccused(caseData) {
    const count = caseData.accused.count;
    const detailsList = caseData.accused.details || [];

    let acc = 'обвиняем';
    if (count > 1) {
        acc += 'и';
    }

    let result = `${count} ${acc}`;

    for (const details of detailsList) {
        const name = details.name || 'н.д.';
        const education = details.education || 'н.д.';
        const occupation = details.occupation || 'н.д.';
        result += `<br><small>${escapeHtml(name)}, ${escapeHtml(education)}, ${escapeHtml(occupation)}</small>`;
    }

    return result;
}

/**
 * Format vote incentive information
 */
function formatVoteIncentive(caseData) {
    const incentive = caseData.vote_incentive;
    const price = incentive.price_per_vote;
    const description = incentive.description || '';

    if (price === "в натура") {
        return `<strong>В натура</strong><br><small>${escapeHtml(description)}</small>`;
    } else {
        const currency = incentive.currency || 'BGN';
        let result = `<strong>${escapeHtml(price)} ${escapeHtml(currency)}</strong>`;
        if (description) {
            result += `<br><small>${escapeHtml(description)}</small>`;
        }
        return result;
    }
}

/**
 * Format beneficiary information
 */
function formatBeneficiary(caseData) {
    const beneficiary = caseData.beneficiary;
    const party = beneficiary.party || 'н.д.';
    const candidate = beneficiary.candidate || 'н.д.';
    const position = beneficiary.position || 'н.д.';

    if (candidate !== "н.д." && candidate) {
        return `<strong>${escapeHtml(party)}</strong><br><small>${escapeHtml(candidate)}<br>${escapeHtml(position)}</small>`;
    } else {
        return `<strong>${escapeHtml(party)}</strong>`;
    }
}

/**
 * Format location
 */
function formatLocation(caseData) {
    const location = caseData.location;
    if (location === "н.д.") {
        return location;
    }
    return escapeHtml(location);
}

/**
 * Format crime date
 */
function formatCrimeDate(caseData) {
    const crimeDate = caseData.crime_date || 'н.д.';
    return escapeHtml(String(crimeDate));
}

/**
 * Format penal code article
 */
function formatPenalCode(caseData) {
    const article = caseData.penal_code_article || 'н.д.';
    return escapeHtml(String(article));
}

/**
 * Format verdict and punishment
 */
function formatVerdict(caseData) {
    const verdict = caseData.verdict;
    const punishment = caseData.punishment;
    return `<strong>${escapeHtml(verdict)}</strong><br><small>${escapeHtml(punishment)}</small>`;
}

/**
 * Format verdict type
 */
function formatVerdictType(caseData) {
    const verdictType = caseData.verdict_type || 'н.д.';
    const escaped = escapeHtml(verdictType);
    if (escaped === 'споразумение') {
        return escaped;
    }
    return 'решение';
}

/**
 * Create a table row from case data
 */
function createTableRow(caseData) {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${formatCaseNumber(caseData)}</td>
        <td><small>${formatCrimeDate(caseData)}</small></td>
        <td>${escapeHtml(caseData.judgment_date)}</td>
        <td><small>${escapeHtml(caseData.case_number.court)}</small></td>
        <td><small>${formatPenalCode(caseData)}</small></td>
        <td>${formatVerdict(caseData)}</td>
        <td><small>${formatVerdictType(caseData)}</small></td>
        <td>${formatElection(caseData)}</td>
        <td>${formatAccused(caseData)}</td>
        <td>${formatVoteIncentive(caseData)}</td>
        <td>${formatBeneficiary(caseData)}</td>
        <td>${formatLocation(caseData)}</td>
        <td><small>${escapeHtml(String(caseData.vote_sellers_mentioned.count))}</small></td>
    `;
    return row;
}

/**
 * Populate the table with cases
 */
function populateTable(cases) {
    const tbody = document.querySelector('table tbody');
    if (!tbody) {
        console.error('Table tbody not found');
        return;
    }

    cases.forEach(caseData => {
        const row = createTableRow(caseData);
        tbody.appendChild(row);
    });
}

/**
 * Update the case count
 */
function updateCaseCount(count) {
    const countElement = document.querySelector('#case-count');
    if (countElement) {
        countElement.textContent = count;
    }
}

/**
 * Initialize the page
 */
async function initializePage() {
    const cases = await fetchCases();
    if (cases.length === 0) {
        console.error('No cases loaded');
        return;
    }
    populateTable(cases);
    updateCaseCount(cases.length);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializePage);
