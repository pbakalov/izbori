import { isMobile } from './shared.js';

const tmDir = 'assets/data/tm';

const csvFilenames = [
    'votes_tm_2024_2026.csv',
    'votes_tm_2024_2026_qp.csv',
    'votes_tm_2024_2026_ei.csv',
];

// Categories that aren't parties - shown in grayscale and translated to Bulgarian
const structuralCategories = {
    'npn': 'Не подкрепям никого',
    'invalid': 'Невалидни',
    'other': 'Други',
    'abstention': 'Не гласували',
    'new_voters': 'Нови избиратели',
    'removed_voters': 'Отписани от списъците',
};

const methodNames = { '': 'lphom', 'qp': 'QP', 'ei' : 'EI' };

// Links below this many votes are dropped as noise (e.g. -0.0 / 0.0 entries)
const minLinkValue = 1;

// Module-level state used by hover event handlers, updated on each render
let currentLinkSource = [];
let currentLinkTarget = [];
let currentBaseLinkColor = [];
let currentDimLinkColor = [];
let currentHighlightLinkColor = [];
let listenersAttached = false;

function parseFilename(filename) {
    const m = filename.match(/^votes_tm_(\d{4})_(\d{4})(?:_(.+))?\.csv$/);
    if (!m) return null;
    const suffix = m[3] || '';
    const method = methodNames[suffix] ?? suffix.toUpperCase();
    return {
        filename,
        path: `${tmDir}/${filename}`,
        year1: m[1],
        year2: m[2],
        period: `${m[1]} → ${m[2]}`,
        method,
        key: method.toLowerCase(),
    };
}

function listCsvFiles() {
    return csvFilenames.map(parseFilename).filter(Boolean);
}

function parseCsv(text) {
    const rows = text.trim().split('\n').map(row => row.split(','));
    const header = rows[0].slice(1);
    const data = rows.slice(1).map(row => ({
        name: row[0],
        values: row.slice(1).map(Number),
    }));
    return { header, data };
}

function label(name) {
    return structuralCategories[name] || name;
}

function color(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) % 360;
    }
    return name in structuralCategories
        ? `hsl(${hash}, 10%, 60%)`
        : `hsl(${hash}, 65%, 50%)`;
}

function hslToRgba(hslColor, alpha) {
    return hslColor.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
}

function formatVotes(value) {
    return Math.round(value).toLocaleString('bg-BG');
}

function topFlowsCustomData(nodeLabels, linkSource, linkTarget, linkValue, topN = 5) {
    const incoming = nodeLabels.map(() => []);
    const outgoing = nodeLabels.map(() => []);

    linkSource.forEach((srcIdx, i) => {
        const tgtIdx = linkTarget[i];
        const value = linkValue[i];
        outgoing[srcIdx].push({ label: nodeLabels[tgtIdx], value });
        incoming[tgtIdx].push({ label: nodeLabels[srcIdx], value });
    });

    const formatList = (flows, prefix, suffixArrow = false) => flows
        .sort((a, b) => b.value - a.value)
        .slice(0, topN)
        .map(f => suffixArrow ? `${f.label} →: ${formatVotes(f.value)}` : `${prefix} ${f.label}: ${formatVotes(f.value)}`)
        .join('<br>');

    const sum = flows => flows.reduce((acc, f) => acc + f.value, 0);

    return nodeLabels.map((_, i) => {
        const total = sum(outgoing[i]) + sum(incoming[i]);
        const parts = [`Общо: ${formatVotes(total)}`];
        if (outgoing[i].length) parts.push(formatList(outgoing[i], '→'));
        if (incoming[i].length) parts.push(formatList(incoming[i], null, true));
        return parts.join('<br>');
    });
}

async function renderChart(file) {
    currentFile = file;
    document.getElementById('loadingMsg').style.display = '';
    document.getElementById('periodLabel').textContent = file.period;

    const response = await fetch(file.path);
    const csvText = await response.text();
    const { header: targets, data } = parseCsv(csvText);
    const sources = data.map(row => row.name);

    const nodeLabels = [...sources.map(label), ...targets.map(label)];
    const nodeColors = [...sources.map(color), ...targets.map(color)];

    const linkSource = [];
    const linkTarget = [];
    const linkValue = [];
    const baseLinkColor = [];

    data.forEach((row, srcIdx) => {
        row.values.forEach((value, tgtIdx) => {
            if (value >= minLinkValue) {
                linkSource.push(srcIdx);
                linkTarget.push(sources.length + tgtIdx);
                linkValue.push(value);
                baseLinkColor.push(hslToRgba(color(sources[srcIdx]), 0.4));
            }
        });
    });

    currentLinkSource = linkSource;
    currentLinkTarget = linkTarget;
    currentBaseLinkColor = baseLinkColor;
    currentDimLinkColor = baseLinkColor.map(c => c.replace(/, [\d.]+\)$/, ', 0.03)'));
    currentHighlightLinkColor = baseLinkColor.map(c => c.replace(/, [\d.]+\)$/, ', 0.8)'));

    const nodeCustomData = topFlowsCustomData(nodeLabels, linkSource, linkTarget, linkValue);

    const chartData = [{
        type: 'sankey',
        orientation: 'h',
        node: {
            pad: 12,
            thickness: 16,
            line: { color: 'black', width: 0.5 },
            label: nodeLabels,
            color: nodeColors,
            customdata: nodeCustomData,
            hovertemplate: '<b>%{label}</b><br>%{customdata}<extra></extra>',
        },
        link: {
            source: linkSource,
            target: linkTarget,
            value: linkValue,
            color: baseLinkColor,
            hovertemplate: '%{source.label} → %{target.label}: %{value:,.0f}<extra></extra>',
        },
    }];

    const layout = {
        font: { size: 12 },
        annotations: [
            { text: file.year1, x: 0, y: 1.05, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 14 } },
            { text: file.year2, x: 1, y: 1.05, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 14 } },
        ],
    };

    if (isMobile()) {
        Object.assign(layout, {
            width: window.innerWidth - 40,
            height: window.innerHeight,
            margin: { l: 10, r: 10, t: 40, b: 10 },
        });
    } else {
        Object.assign(layout, {
            width: Math.min(1100, window.innerWidth - 80),
            height: Math.min(800, Math.max(400, window.innerHeight * 0.85)),
        });
    }

    const config = {
        displayModeBar: false,
        responsive: false, // we handle sizing ourselves
    };

    const chart = document.getElementById('chart');
    await Plotly.react(chart, chartData, layout, config);
    document.getElementById('loadingMsg').style.display = 'none';

    if (!listenersAttached) {
        chart.on('plotly_hover', (evt) => {
            const point = evt.points[0];
            if (point.source !== undefined) return;
            const nodeIdx = point.pointNumber;
            const colors = currentLinkSource.map((srcIdx, i) =>
                (srcIdx === nodeIdx || currentLinkTarget[i] === nodeIdx)
                    ? currentHighlightLinkColor[i]
                    : currentDimLinkColor[i]
            );
            Plotly.restyle(chart, { 'link.color': [colors] });
        });

        chart.on('plotly_unhover', () => {
            Plotly.restyle(chart, { 'link.color': [currentBaseLinkColor] });
        });

        listenersAttached = true;
    }
}

let currentFile = null;

async function initPage() {
    const files = listCsvFiles();
    const picker = document.getElementById('tmSelect');

    const params = new URLSearchParams(window.location.search);
    const modelParam = params.get('model')?.toLowerCase();
    const initialIdx = Math.max(0, files.findIndex(f => f.key === (modelParam ?? '')));

    files.forEach((file, i) => {
        const btn = document.createElement('button');
        btn.textContent = file.method;
        btn.className = 'model-btn' + (i === initialIdx ? ' active' : '');
        btn.addEventListener('click', () => {
            picker.querySelectorAll('.model-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            history.replaceState(null, '', `?model=${file.key}`);
            renderChart(file);
        });
        picker.appendChild(btn);
    });

    // Re-render on orientation change / resize so layout dimensions are recalculated
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (currentFile) renderChart(currentFile); }, 200);
    });

    await renderChart(files[initialIdx]);
}

initPage();
