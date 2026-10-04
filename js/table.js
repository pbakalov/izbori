import { getTable, getElectionIds, getMunicipalities, getGeojsonIndex } from './api_utils.js';
import { renameMap } from './shared.js';

// A standalone results table. Everything it shows comes from one /table call,
// which pages, sorts and filters server-side, so switching page or column
// fetches 50 rows rather than re-sorting 12 000 in the browser.
//
// Reads its whole state from the URL, so any view is linkable:
//   table.html?el=2023-10-29os&mun=Столична&groupby=sid&geojson=sofia_oct23r1
//
// `geojson` is optional. With it, each row says whether it is drawn on the
// map; without it there is no such column, which is the standalone case.

const DEFAULTS = { groupby: 'ekatte', page: '0', page_size: '50' };

// Which boundary layer each grouping is drawn on, for the `Слой` dropdown.
const LAYER_FOR = { sid: 'sid', ekatte: 'settlement' };

// The default view when the URL says nothing: the most recent national
// election, whole country, grouped into settlements.
const ALL_MUNICIPALITIES = '';

// Filters use Dash's expression syntax, which the API passes straight to the
// same helper its own pages use. `on_map` is 0/1 rather than a boolean so it
// compares like any other column.
const MISSING_FILTER = '{on_map} eq 0';

// Parties pre-selected when following a key through to the history page.
// NOTE there are two other copies of a "default parties" list, in sus.js and
// hist.js, and both are shorter: they omit ПП/ДБ, ПП, ДБ and ПБ. Worth
// converging on one, ideally by letting /hist pick its own default when a
// caller passes only an ekatte or a sid.
const HIST_PARTIES = 'ГЕРБ;ГЕРБ-СДС;ДПС;ДПС-Доган;ДПС-Пеев;ПП/ДБ;ПП;ДБ;ПБ';

/** The history page for one settlement or station. */
function historyUrl(key) {
    const name = param('groupby') === 'sid' ? 'sid' : 'ekatte';
    return `hist.html?${name}=${encodeURIComponent(key)}`
        + `&party=${encodeURIComponent(HIST_PARTIES)}`;
}

const state = new URLSearchParams(window.location.search);

function param(name) {
    return state.get(name) || DEFAULTS[name] || null;
}

function setParams(changes, { resetPage = false } = {}) {
    for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '') state.delete(key);
        else state.set(key, value);
    }
    if (resetPage) state.set('page', '0');
    window.history.replaceState(null, '', `${window.location.pathname}?${state}`);
}

function columnLabel(name) {
    return renameMap[name] || name;
}

/** The grouping key's own column header. */
function keyLabel() {
    return param('groupby') === 'sid' ? 'Секция' : 'ЕКАТТЕ';
}

function formatCell(name, value) {
    if (value === null || value === undefined) return '';
    if (name === 'on_map') return value ? '✓' : '✗';
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value : value.toFixed(2);
    }
    return value;
}

// ---------------------------------------------------------------------------

function renderHead(columns, sort) {
    const head = document.getElementById('head');
    head.innerHTML = '';
    const [sortColumn, sortDirection] = (sort || '').split(':');

    const makeHeader = (name, label) => {
        const th = document.createElement('th');
        th.textContent = label;
        if (name === sortColumn) {
            const arrow = document.createElement('span');
            arrow.className = 'arrow';
            arrow.textContent = sortDirection === 'desc' ? ' ▼' : ' ▲';
            th.appendChild(arrow);
        }
        th.addEventListener('click', () => {
            // Same column toggles direction; a new one starts descending,
            // since the interesting rows are usually the biggest.
            const next = (name === sortColumn && sortDirection === 'desc')
                ? `${name}:asc` : `${name}:desc`;
            setParams({ sort: next }, { resetPage: true });
            load();
        });
        return th;
    };

    head.appendChild(makeHeader(param('groupby'), keyLabel()));
    for (const name of columns) {
        head.appendChild(makeHeader(name, columnLabel(name)));
    }
}

const nf = new Intl.NumberFormat('bg-BG');

// ---------------------------------------------------------------------------
// the filter row
//
// Each input holds what the reader typed for one column. Bare text means
// "contains"; a leading operator means that comparison. The inputs compose
// into the expression the API takes, which is Dash's own syntax, so there is
// one representation and the URL stays shareable.
// ---------------------------------------------------------------------------

// Word operators, as `backend_paging` spells them, mapped to what a reader
// types. Order matters: the word forms must be tried before the symbols, or
// `ge` would never match.
const OPERATOR_WORDS = { ge: '>=', le: '<=', gt: '>', lt: '<', ne: '!=', eq: '=' };

const CLAUSE_RE = new RegExp(
    '^\\s*\\{(.+?)\\}\\s*(?:i|s)?'
    + '(contains|ge|le|gt|lt|ne|eq|>=|<=|!=|>|<|=)'
    + '\\s*(.*)$');

const TYPED_RE = /^\s*(>=|<=|!=|>|<|=)\s*(.*)$/;

/** Strips the quotes Dash's parser would strip. */
function unquote(value) {
    const text = value.trim();
    const first = text[0];
    if (text.length > 1 && first === text[text.length - 1]
        && ['"', "'", '`'].includes(first)) {
        return text.slice(1, -1);
    }
    return text;
}

/** Quotes a value only when it would otherwise be misread. */
function quote(value) {
    return /[\s"'`]|&&/.test(value) ? `"${value.replace(/"/g, '')}"` : value;
}

/** Expression -> {column: what the reader typed}. */
function parseFilter(expression) {
    const typed = {};
    for (const clause of (expression || '').split(' && ')) {
        const match = clause.match(CLAUSE_RE);
        if (!match) continue;
        const [, column, operator, value] = match;
        const symbol = OPERATOR_WORDS[operator]
            || (operator === 'contains' ? '' : operator);
        typed[column] = symbol
            ? `${symbol} ${unquote(value)}`.trim()
            : unquote(value);
    }
    return typed;
}

/** {column: typed text} -> expression, skipping the empty boxes. */
function buildFilter(typed) {
    const clauses = [];
    for (const [column, raw] of Object.entries(typed)) {
        const text = (raw || '').trim();
        if (!text) continue;
        const match = text.match(TYPED_RE);
        clauses.push(match
            ? `{${column}} ${match[1]} ${quote(match[2].trim())}`
            : `{${column}} contains ${quote(text)}`);
    }
    return clauses.join(' && ');
}

function renderFilters(columns) {
    const row = document.getElementById('filterRow');
    const typed = parseFilter(param('filter'));
    row.innerHTML = '';

    const apply = () => {
        const next = {};
        for (const input of row.querySelectorAll('input')) {
            next[input.dataset.column] = input.value;
        }
        setParams({ filter: buildFilter(next) || null }, { resetPage: true });
        load();
    };

    // The key column is filterable too, so a reader can look up one station.
    const names = [param('groupby'), ...columns];
    for (const name of names) {
        const th = document.createElement('th');
        const input = document.createElement('input');
        input.type = 'text';
        input.dataset.column = name;
        input.value = typed[name] || '';
        input.placeholder = '';
        input.title = `филтър по „${columnLabel(name)}“: текст за съвпадение, `
            + 'или > 500, >= 500, = 0';
        if (input.value) input.classList.add('active');
        // On Enter or when leaving the box, not per keystroke: each change is
        // a request.
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
        input.addEventListener('blur', () => {
            if ((typed[name] || '') !== input.value) apply();
        });
        th.appendChild(input);
        row.appendChild(th);
    }

    const clear = document.getElementById('clearFilters');
    clear.hidden = !param('filter');
}


function renderTotals(payload) {
    const row = document.getElementById('totalsRow');
    row.innerHTML = '';
    const totals = payload.totals ? payload.totals.columns : {};

    const cell = (text) => {
        const th = document.createElement('th');
        th.textContent = text;
        return th;
    };

    row.appendChild(cell('Общо'));
    for (const name of payload.columns) {
        // Columns the API could not sum -- place, address, an EKATTE code --
        // are left blank rather than filled with something meaningless.
        const value = totals[name];
        row.appendChild(cell(value === undefined ? '' : nf.format(value)));
    }
}

function figure(value, caption) {
    return `<div class="figure"><b>${value}</b><span>${caption}</span></div>`;
}

function renderSummary(payload) {
    const box = document.getElementById('summary');
    const totals = payload.totals;
    if (!totals) {
        box.hidden = true;
        return;
    }
    box.hidden = false;

    const b = totals.ballot;
    const electorate = totals.columns.eligible_voters;
    const turnout = (electorate && b.cast)
        ? `${(100 * b.cast / electorate).toFixed(1)}%` : '—';

    // Read left to right the figures decompose: parties + НПН make up the
    // valid votes, and those plus the invalid ones make up everything cast.
    const parts = [
        figure(nf.format(totals.rows),
               param('groupby') === 'sid' ? 'секции' : 'населени места'),
        figure(electorate === undefined ? '—' : nf.format(electorate),
               'избиратели по списък'),
        figure(nf.format(b.parties), 'за партии и кандидати'),
        figure(nf.format(b.npn), 'не подкрепям никого'),
        figure(nf.format(b.valid), 'действителни (партии + НПН)'),
        figure(nf.format(b.invalid), 'невалидни'),
        figure(nf.format(b.cast), `общо гласували (${turnout})`),
    ];

    // Each figure is derived twice, across the ballot columns and down the
    // per-row aggregates, so a mismatch means our data disagrees with itself
    // rather than merely with the official tally.
    if (!b.agree) {
        parts.push('<div class="figure warn">⚠ сумите по колони '
            + `(${nf.format(b.valid)} действителни, ${nf.format(b.cast)} общо) `
            + 'не съвпадат с данните по редове '
            + `(${nf.format(b.valid_from_rows)}, ${nf.format(b.cast_from_rows)})</div>`);
    }

    // Totals cover the filtered rows, so say when that is not everything.
    if (param('filter')) {
        parts.push(`<div class="figure scope">сумите са само за `
            + `${nf.format(totals.rows)} филтрирани реда</div>`);
    }

    box.innerHTML = parts.join('');
}

function renderBody(payload) {
    const body = document.getElementById('body');
    body.innerHTML = '';
    const onMapAt = payload.columns.indexOf('on_map');

    payload.data.forEach((values, rowIndex) => {
        const tr = document.createElement('tr');
        if (onMapAt !== -1 && !values[onMapAt]) {
            tr.classList.add('missing');
        }

        const value = payload.index[rowIndex];
        const key = document.createElement('td');
        const link = document.createElement('a');
        link.href = historyUrl(value);
        link.textContent = value;
        link.target = '_blank';
        link.title = param('groupby') === 'sid'
            ? `история на секция ${value}`
            : `история на населеното място (ЕКАТТЕ ${value})`;
        key.appendChild(link);
        tr.appendChild(key);

        payload.columns.forEach((name, i) => {
            const td = document.createElement('td');
            td.textContent = formatCell(name, values[i]);
            if (typeof values[i] === 'string') td.classList.add('text');
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });
}

function renderPager(payload) {
    const pager = document.getElementById('pager');
    const { page, total_pages: pages } = payload;
    pager.hidden = pages <= 1;
    document.getElementById('pageInfo').textContent =
        `страница ${page + 1} от ${pages}`;

    const go = (target) => {
        setParams({ page: String(Math.max(0, Math.min(target, pages - 1))) });
        load();
    };
    const buttons = {
        first: 0, prev: page - 1, next: page + 1, last: pages - 1,
    };
    for (const [id, target] of Object.entries(buttons)) {
        const button = document.getElementById(id);
        button.disabled = target === page || target < 0 || target >= pages;
        button.onclick = () => go(target);
    }
}

function renderCoverage(payload) {
    const box = document.getElementById('coverageBox');
    const stats = payload.geojson;
    if (!stats) {
        box.hidden = true;
        return;
    }
    box.hidden = false;
    document.getElementById('coverage').textContent =
        `покажи само ${stats.rows_without_polygon} реда без полигон `
        + `(от ${stats.rows_on_map + stats.rows_without_polygon}; `
        + `слой ${stats.id})`;
}

// ---------------------------------------------------------------------------

async function load() {
    const el = param('el');
    const status = document.getElementById('status');

    if (!el) {
        status.textContent = 'Липсва параметър „el“. Пример: '
            + 'table.html?el=2024-06-09ns&groupby=ekatte';
        return;
    }

    status.textContent = 'Зарежда се…';
    const payload = await getTable({
        el,
        mun: param('mun'),
        groupby: param('groupby'),
        party: param('party'),
        rayon: param('rayon'),
        kmetstvo: param('kmetstvo'),
        page: param('page'),
        pageSize: param('page_size'),
        sort: param('sort'),
        filter: param('filter'),
        geojson: param('geojson'),
        abroad: param('abroad'),
    });

    if (!payload || payload.status === 'error') {
        status.textContent = payload
            ? `Грешка: ${payload.message}`
            : 'Няма връзка със сървъра.';
        return;
    }

    // A sort column this election does not have is dropped server-side; keep
    // the URL honest so the header arrow does not point at a missing column.
    if (payload.sort_ignored) {
        setParams({ sort: payload.sort || null });
    }
    if (payload.filter_ignored) {
        setParams({ filter: payload.filter || null });
    }

    status.textContent = `${payload.total_rows} реда`;
    renderHead(payload.columns, payload.sort);
    renderFilters(payload.columns);
    renderTotals(payload);
    renderSummary(payload);
    renderBody(payload);
    renderPager(payload);
    renderCoverage(payload);
}

// ---------------------------------------------------------------------------
// dropdowns
// ---------------------------------------------------------------------------

function fillSelect(select, entries, selected, placeholder) {
    select.innerHTML = '';
    if (placeholder !== undefined) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = placeholder;
        select.appendChild(option);
    }
    for (const [value, label] of entries) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    }
    select.value = selected || '';
    // A value the list does not contain leaves the select blank; fall back to
    // the first real entry so the page always shows something.
    if (select.selectedIndex === -1) select.selectedIndex = 0;
    return select.value;
}

/** Elections, narrowed to the chosen municipality when there is one. */
async function fillElections() {
    const mun = param('mun');
    const elections = await getElectionIds({ elType: 'all', mun }) || {};
    const entries = Object.keys(elections).sort().map(el => [el, elections[el]]);
    // With nothing in the URL, land on the most recent election. Ids are
    // date-prefixed, so the last sorted entry is the newest.
    const fallback = entries.length ? entries[entries.length - 1][0] : null;
    const chosen = fillSelect(
        document.getElementById('elSelect'), entries, param('el') || fallback);
    if (chosen !== param('el')) setParams({ el: chosen }, { resetPage: true });
    return elections;
}

/** Municipalities covered by the chosen election, plus an "all" option. */
async function fillMunicipalities() {
    const select = document.getElementById('munSelect');
    const names = await getMunicipalities(param('el')) || [];
    const chosen = fillSelect(select, names.map(n => [n, n]), param('mun'),
                              'всички');

    // Local elections have no countrywide ballot, so one has to be picked.
    if (chosen === ALL_MUNICIPALITIES && names.length === 1) {
        select.value = names[0];
    }
    if (select.value !== (param('mun') || '')) {
        setParams({ mun: select.value || null }, { resetPage: true });
    }
}

/** Boundary files for the layer the current grouping is drawn on. */
async function fillGeojson() {
    const select = document.getElementById('geojsonSelect');
    const layer = LAYER_FOR[param('groupby')];
    const index = await getGeojsonIndex(layer);
    const files = index ? index.files : {};

    // Several dates can share one file, so list each file once.
    const seen = new Map();
    for (const entry of Object.values(files)) {
        if (!seen.has(entry.id)) seen.set(entry.id, entry.id);
    }
    const chosen = fillSelect(select, [...seen], param('geojson'), 'без');
    if (chosen !== (param('geojson') || '')) {
        setParams({ geojson: select.value || null });
    }
}

async function refreshControls() {
    document.getElementById('groupbySelect').value = param('groupby');
    document.getElementById('abroad').checked =
        (param('abroad') || 'true') !== 'false';
    await fillElections();
    await Promise.all([fillMunicipalities(), fillGeojson()]);
}

function setTitle() {
    const el = param('el');
    const mun = param('mun');
    const select = document.getElementById('elSelect');
    const chosen = select.options[select.selectedIndex];
    const label = chosen ? chosen.textContent : el;

    document.getElementById('title').textContent =
        `Изборни резултати: ${label}`;
    const grouping = param('groupby') === 'sid' ? 'по секции' : 'по населени места';
    document.getElementById('subtitle').textContent =
        mun ? `${grouping}, община ${mun}` : grouping;

    // Only offer the way back when we know which map to return to.
    if (mun === 'Столична' && param('groupby') === 'sid') {
        const back = document.getElementById('backToMap');
        back.href = `maps/sofia.html?el=${encodeURIComponent(el)}`;
        back.hidden = false;
    }
}

/** Re-read the controls that depend on the current selection, then reload. */
async function refreshAndLoad({ controls = [] } = {}) {
    for (const fill of controls) await fill();
    setTitle();
    await load();
}

function start() {
    document.getElementById('elSelect').addEventListener('change', (e) => {
        setParams({ el: e.target.value }, { resetPage: true });
        refreshAndLoad({ controls: [fillMunicipalities] });
    });

    document.getElementById('groupbySelect').addEventListener('change', (e) => {
        // The boundary layer follows the grouping, so the old file no longer
        // applies; clear it and repopulate.
        setParams({ groupby: e.target.value, geojson: null }, { resetPage: true });
        refreshAndLoad({ controls: [fillGeojson] });
    });

    document.getElementById('munSelect').addEventListener('change', (e) => {
        setParams({ mun: e.target.value || null }, { resetPage: true });
        refreshAndLoad({ controls: [fillElections] });
    });

    document.getElementById('geojsonSelect').addEventListener('change', (e) => {
        setParams({ geojson: e.target.value || null }, { resetPage: true });
        refreshAndLoad();
    });

    const abroad = document.getElementById('abroad');
    abroad.addEventListener('change', () => {
        setParams({ abroad: abroad.checked ? null : 'false' }, { resetPage: true });
        refreshAndLoad();
    });

    const pageSize = document.getElementById('pageSize');
    pageSize.value = param('page_size');
    pageSize.addEventListener('change', () => {
        setParams({ page_size: pageSize.value }, { resetPage: true });
        load();
    });

    document.getElementById('clearFilters').addEventListener('click', () => {
        setParams({ filter: null }, { resetPage: true });
        load();
    });

    const onlyMissing = document.getElementById('onlyMissing');
    onlyMissing.checked = (param('filter') || '').includes(MISSING_FILTER);
    onlyMissing.addEventListener('change', () => {
        setParams({ filter: onlyMissing.checked ? MISSING_FILTER : null },
                  { resetPage: true });
        load();
    });

    refreshControls().then(() => {
        setTitle();
        load();
    });
}

start();
