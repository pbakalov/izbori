import { isMobile } from './shared.js';

const dataDir = '../assets/data/pnv';

// Both CSVs come straight from population_and_voters_viz.ipynb (pandas to_csv),
// so columns are read by header name for the population file and by position
// for the eligible voters series (its header is ",0").
async function loadCsv(path) {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`${path}: ${resp.status}`);
    const lines = (await resp.text()).trim().split(/\r?\n/);
    const header = lines[0].split(',');
    const rows = lines.slice(1).map(l => l.split(','));
    return { header, rows };
}

function column(csv, name) {
    const i = csv.header.indexOf(name);
    return csv.rows.map(r => Number(r[i]));
}

const series = [
    { col: 'population_total', name: 'Население на България (НСИ)', symbol: 'circle' },
    { col: 'bulgarians_in_bulgaria', name: 'Български граждани в България (НСИ)', symbol: 'square' },
    { col: 'bg_18_and_above_in_bg', name: 'Български граждани на 18 и повече години в България<br>(приблизително, изведено от данни на НСИ)', symbol: 'diamond' },
];

async function main() {
    const [pop, ev] = await Promise.all([
        loadCsv(`${dataDir}/pop_and_voters_in_bg_2012-2025.csv`),
        loadCsv(`${dataDir}/eligible_voters2013-2026.csv`),
    ]);

    const mobile = isMobile();
    const popDates = pop.rows.map(r => r[0]);
    const hover = '%{x|%d.%m.%Y}: %{y:,.0f}<extra></extra>';

    const traces = series.map(s => ({
        type: 'scatter',
        mode: 'lines+markers',
        x: popDates,
        y: column(pop, s.col),
        name: s.name,
        marker: { symbol: s.symbol, size: mobile ? 8 : 11 },
        hovertemplate: hover,
    }));

    traces.push({
        type: 'scatter',
        mode: 'lines+markers',
        x: ev.rows.map(r => r[0]),
        y: ev.rows.map(r => Number(r[1])),
        name: 'Брой избиратели в избирателните списъци (ЦИК)',
        marker: { symbol: 'x', size: mobile ? 8 : 11 },
        hovertemplate: hover,
    });

    const grid = { showgrid: true, gridwidth: 1, gridcolor: 'lightgray' };
    const layout = {
        plot_bgcolor: 'white',
        height: mobile ? 600 : 700,
        font: { size: mobile ? 12 : 15 },
        margin: { l: 70, r: 20, t: 20, b: 40 },
        separators: ', ',
        hovermode: 'closest',
        legend: { orientation: 'h', x: 0, y: -0.12, yanchor: 'top' },
        xaxis: { ...grid },
        yaxis: { ...grid, tickformat: ',.0f' },
    };

    document.getElementById('loadingMsg').style.display = 'none';
    Plotly.newPlot('chart', traces, layout, { responsive: true, displaylogo: false });
}

main().catch(err => {
    document.getElementById('loadingMsg').textContent = 'Грешка при зареждане на данните.';
    console.error(err);
});
