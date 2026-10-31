import { isMobile } from './shared.js';

const tmDir = 'assets/data/tm';

const csvFilenames = [
    'votes_tm_2026-04-19ns_to_2026-10-25pr.csv',
    'votes_tm_2026-04-19ns_to_2026-10-25pr_ei.csv',
    'votes_tm_2026-04-19ns_to_2026-10-25pr_qp.csv',
    'votes_tm_2024-10-27ns_to_2026-04-19ns.csv',
    'votes_tm_2024-10-27ns_to_2026-04-19ns_qp.csv',
    'votes_tm_2024-10-27ns_to_2026-04-19ns_ei.csv',
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

// Election type codes used in filenames (e.g. 2026-10-25pr)
const electionTypes = { 'ns': 'НС', 'pr': 'ПР', 'pr2': 'ПР II тур' };

// Footer note per election pair; falls back to defaultNote
const pairNotes = {
    '2024-10-27ns_to_2026-04-19ns': 'И трите анализа са на ниво община и не включват секциите в чужбина. QP анализ: Ивайло Парчев.',
    '2026-04-19ns_to_2026-10-25pr': 'И трите анализа са на ниво община и не включват секциите в чужбина. QP анализ: Ивайло Парчев.',
};
const defaultNote = 'Анализът е на ниво община и не включва секциите в чужбина.';

// Links below this many votes are dropped as noise (e.g. -0.0 / 0.0 entries)
const minLinkValue = 1;

// Module-level state used by hover event handlers, updated on each render
let currentLinkSource = [];
let currentLinkTarget = [];
let currentBaseLinkColor = [];
let currentDimLinkColor = [];
let currentHighlightLinkColor = [];
let listenersAttached = false;

function electionLabel(date, type) {
    return `${date.replaceAll('-', '.')} ${electionTypes[type] ?? type.toUpperCase()}`;
}

// votes_tm_<date><type>_to_<date><type>[_<method>].csv
function parseFilename(filename) {
    const m = filename.match(/^votes_tm_(\d{4}-\d{2}-\d{2})([a-z0-9]+)_to_(\d{4}-\d{2}-\d{2})([a-z0-9]+)(?:_(.+))?\.csv$/);
    if (!m) return null;
    const suffix = m[5] || '';
    const method = methodNames[suffix] ?? suffix.toUpperCase();
    const from = electionLabel(m[1], m[2]);
    const to = electionLabel(m[3], m[4]);
    return {
        filename,
        path: `${tmDir}/${filename}`,
        pair: `${m[1]}${m[2]}_to_${m[3]}${m[4]}`,
        from,
        to,
        period: `${from} → ${to}`,
        method,
        key: method.toLowerCase(),
    };
}

// Group files by election pair, newest pair first (order of first appearance in csvFilenames)
function listPairs() {
    const pairs = new Map();
    csvFilenames.map(parseFilename).filter(Boolean).forEach(file => {
        if (!pairs.has(file.pair)) pairs.set(file.pair, { key: file.pair, period: file.period, files: [] });
        pairs.get(file.pair).files.push(file);
    });
    return [...pairs.values()];
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
    console.log(file.pair);
    document.getElementById('loadingMsg').style.display = '';
    document.getElementById('note').textContent = pairNotes[file.pair] ?? defaultNote;

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
            { text: file.from, xanchor: 'left', x: 0, y: 1.05, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 14 } },
            { text: file.to, xanchor: 'right', x: 1, y: 1.05, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 14 } },
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
    const pairs = listPairs();
    const pairSelect = document.getElementById('pairSelect');
    const picker = document.getElementById('tmSelect');
    const methodControls = document.getElementById('methodControls');

    const params = new URLSearchParams(window.location.search);
    const pairParam = params.get('pair');
    const modelParam = params.get('model')?.toLowerCase();

    // Pick the pair from ?pair=; otherwise the newest pair that has the requested model
    // (keeps old ?model=qp links working); otherwise the newest pair.
    let pair = pairs.find(p => p.key === pairParam)
        ?? (modelParam && pairs.find(p => p.files.some(f => f.key === modelParam)))
        ?? pairs[0];

    let file = pair.files.find(f => f.key === modelParam) ?? pair.files[0];

    function updateUrl() {
        const q = new URLSearchParams({ pair: pair.key });
        if (pair.files.length > 1) q.set('model', file.key);
        history.replaceState(null, '', `?${q}`);
    }

    function buildMethodPicker() {
        picker.innerHTML = '';
        methodControls.style.display = pair.files.length > 1 ? '' : 'none';
        pair.files.forEach(f => {
            const btn = document.createElement('button');
            btn.textContent = f.method;
            btn.className = 'model-btn' + (f === file ? ' active' : '');
            btn.addEventListener('click', () => {
                picker.querySelectorAll('.model-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                file = f;
                updateUrl();
                renderChart(file);
            });
            picker.appendChild(btn);
        });
    }

    pairs.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.key;
        opt.textContent = p.period;
        pairSelect.appendChild(opt);
    });
    pairSelect.value = pair.key;
    pairSelect.addEventListener('change', () => {
        pair = pairs.find(p => p.key === pairSelect.value);
        // Keep the same method if the new pair has it
        file = pair.files.find(f => f.key === file.key) ?? pair.files[0];
        buildMethodPicker();
        updateUrl();
        renderChart(file);
    });

    buildMethodPicker();

    // Re-render on orientation change / resize so layout dimensions are recalculated
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (currentFile) renderChart(currentFile); }, 200);
    });

    await renderChart(file);
}

initPage();
