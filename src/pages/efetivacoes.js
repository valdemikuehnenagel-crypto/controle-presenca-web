import {supabase} from '../supabaseClient.js';

const _cache = new Map();
const _inflight = new Map();
const CACHE_TTL_MS = 10 * 60_000;
const MIN_LABEL_FONT_PX = 12;
const MIN_SEGMENT_PERCENT = 9;

function cacheKeyForColabs() {
    return `colabs:ALL`;
}

async function fetchOnce(key, loaderFn, ttlMs = CACHE_TTL_MS) {
    const now = Date.now();
    const hit = _cache.get(key);
    if (hit && (now - hit.ts) < hit.ttl) return hit.value;
    if (_inflight.has(key)) return _inflight.get(key);
    const p = (async () => {
        try {
            const val = await loaderFn();
            _cache.set(key, {ts: Date.now(), ttl: ttlMs, value: val});
            return val;
        } finally {
            _inflight.delete(key);
        }
    })();
    _inflight.set(key, p);
    return p;
}

function invalidateCache(keys = []) {
    if (!keys.length) {
        _cache.clear();
        return;
    }
    keys.forEach(k => _cache.delete(k));
}

async function fetchAllWithPagination(queryBuilder) {
    let allData = [];
    let page = 0;
    const pageSize = 1000;
    let moreData = true;
    while (moreData) {
        const {data, error} = await queryBuilder.range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (data && data.length > 0) {
            allData = allData.concat(data);
            page++;
        } else {
            moreData = false;
        }
    }
    return allData;
}

const HOST_SEL = '#hc-indice';
const state = {
    mounted: false,
    loading: false,
    charts: {
        idade: null,
        genero: null,
        dsr: null,
        contrato: null,
        contratoSvc: null, auxPrazoSvc: null,
        idadeRegiao: null,
        generoRegiao: null,
        contratoRegiao: null,
        auxPrazoRegiao: null, spamHcEvolucaoSvc: null,
        spamHcEvolucaoRegiao: null,
        spamHcGerente: null,
        spamHcVsAux: null,
    },
    matriz: '',
    gerencia: '',
    regiao: '',
    colabs: [],
    interactive: {
        genero: new Set(),
        dsr: new Set(),
        idade: new Set(),
        contrato: new Set(),
        contratoSvc: new Set(), auxPrazoSvc: new Set(),
    }
};
const norm = (v) => String(v ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const root = () => document.documentElement;
const css = (el, name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;

function parseRGB(str) {
    if (!str) return {r: 0, g: 0, b: 0};
    const s = String(str).trim();
    if (s.startsWith('#')) {
        const hex = s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
        return {
            r: parseInt(hex.slice(1, 3), 16),
            g: parseInt(hex.slice(3, 5), 16),
            b: parseInt(hex.slice(5, 7), 16)
        };
    }
    const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
    return m ? {r: +m[1], g: +m[2], b: +m[3]} : {r: 30, g: 64, b: 124};
}

const lum = ({r, g, b}) => 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
const bestLabel = (bg) => lum(parseRGB(bg)) < 0.45 ? '#fff' : css(root(), '--hcidx-primary', '#003369');
const AGE_BUCKETS = ['<20', '20-29', '30-39', '40-49', '50-59', '60+', 'N/D'];
const DOW_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'N/D'];
const MONTH_ORDER = {
    'JANEIRO': 1, 'FEVEREIRO': 2, 'MARÇO': 3, 'ABRIL': 4, 'MAIO': 5, 'JUNHO': 6,
    'JULHO': 7, 'AGOSTO': 8, 'SETEMBRO': 9, 'OUTUBRO': 10, 'NOVEMBRO': 11, 'DEZEMBRO': 12
};
const sortMesAno = (a, b) => (a.ANO * 100 + a.mesOrder) - (b.ANO * 100 + b.mesOrder);
const getMesOrder = (mesStr) => MONTH_ORDER[norm(mesStr)] || 0;

function parseDateMaybe(s) {
    const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(String(s || '').trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateLocal(iso) {
    if (!iso) return '';
    const datePart = iso.split('T')[0];
    const [y, m, d] = datePart.split('-');
    if (!y || !m || !d) return '';
    return `${d}/${m}/${y}`;
}

function daysBetween(d1, d2) {
    const ms = 24 * 60 * 60 * 1000;
    const a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()).getTime();
    const b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate()).getTime();
    return Math.floor((b - a) / ms);
}

function daysSinceAdmission(c) {
    const raw = c?.['Data de admissão'] ?? c?.['Data de admissao'] ?? c?.Admissao ?? c?.['Data Admissão'] ?? c?.['Data Admissao'] ?? '';
    const d = parseDateMaybe(raw);
    if (!d) return null;
    return daysBetween(d, new Date());
}

function calcAgeFromStr(s) {
    const d = parseDateMaybe(s);
    if (!d) return null;
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    const dm = now.getMonth() - d.getMonth();
    if (dm < 0 || (dm === 0 && now.getDate() < d.getDate())) a--;
    return a;
}

function ageBucket(a) {
    if (a == null) return 'N/D';
    if (a < 20) return '<20';
    if (a < 30) return '20-29';
    if (a < 40) return '30-39';
    if (a < 50) return '40-49';
    if (a < 60) return '50-59';
    return '60+';
}

function getNascimento(c) {
    return c?.['Data de Nascimento'] || c?.['Data de nascimento'] || c?.Nascimento || c?.['Nascimento'] || '';
}

function mapGeneroLabel(raw) {
    const n = norm(raw);
    if (n.startsWith('MASC')) return 'Masculino';
    if (n.startsWith('FEM')) return 'Feminino';
    return n ? 'Outros' : 'N/D';
}

function mapCargoLabel(raw) {
    const n = norm(raw);
    if (n === 'AUXILIAR') return 'Auxiliar';
    if (n === 'CONFERENTE') return 'Conferente';
    return 'Outros';
}

function mapSvcLabel(rawSvc) {
    const svc = String(rawSvc || 'N/D').toUpperCase();
    if (svc === 'SBA2' || svc === 'SBA4') {
        return 'SBA2/4';
    }
    if (svc === 'SBA3' || svc === 'SBA7') {
        return 'SBA3/7';
    }
    return svc;
}

function mapDSR(raw) {
    const n = norm(raw);
    if (!n) return ['N/D'];
    const days = n.split(',').map(d => d.trim());
    const mapped = days.map(day => {
        if (day.includes('SEG')) return 'SEG';
        if (day.includes('TER')) return 'TER';
        if (day.includes('QUA')) return 'QUA';
        if (day.includes('QUI')) return 'QUI';
        if (day.includes('SEX')) return 'SEX';
        if (day.includes('SAB')) return 'SAB';
        if (day.includes('DOM')) return 'DOM';
        return null;
    }).filter(Boolean);
    return mapped.length > 0 ? mapped : ['N/D'];
}

function palette() {
    const r = root();
    return [
        css(r, '--hcidx-p-1', '#02B1EE'),
        css(r, '--hcidx-p-2', '#003369'),
        css(r, '--hcidx-p-3', '#69D4FF'),
        css(r, '--hcidx-p-4', '#2677C7'),
        css(r, '--hcidx-p-5', '#A9E7FF'),
        css(r, '--hcidx-p-6', '#225B9E'),
        css(r, '--hcidx-p-7', '#7FB8EB'),
        css(r, '--hcidx-p-8', '#99CCFF')
    ];
}

let _resizeObs = null;

function setResponsiveHeights() {
    if (window.Chart) {
        Chart.defaults.devicePixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
        Object.values(state.charts).forEach(ch => {
            if (!ch) return;
            forceLegendBottom(ch);
            ch.resize();
        });
    }
}

function wireResizeObserver() {
    if (_resizeObs) return;
    const rootEl = document.querySelector('#hc-indice .hcidx-root');
    if (!rootEl) return;
    _resizeObs = new ResizeObserver(() => setResponsiveHeights());
    _resizeObs.observe(rootEl);
    window.addEventListener('resize', setResponsiveHeights);
}

function ensureMounted() {
    const host = document.querySelector(HOST_SEL);
    if (!host || state.mounted) return;
    ['hc-refresh', 'colaborador-added', 'colaborador-updated', 'colaborador-removed']
        .forEach(evt => window.addEventListener(evt, () => {
            invalidateCache([cacheKeyForColabs(), 'spamData', 'matrizesData']);
            if (state.mounted && !state.loading) refresh();
        }));
    document.getElementById('hc-idx-clear-filters')?.addEventListener('click', clearAllFilters);
    const selMatriz = document.getElementById('efet-filter-matriz');
    const selGerencia = document.getElementById('efet-filter-gerencia');
    const selReg = document.getElementById('efet-filter-regiao');
    if (selMatriz) {
        selMatriz.addEventListener('change', (e) => {
            state.matriz = e.target.value;
            refresh();
        });
    }
    if (selGerencia) {
        selGerencia.addEventListener('change', (e) => {
            state.gerencia = e.target.value;
            refresh();
        });
    }
    if (selReg) {
        selReg.addEventListener('change', (e) => {
            state.regiao = e.target.value;
            refresh();
        });
    }
    state.mounted = true;
    setResponsiveHeights();
    wireResizeObserver();
}

async function ensureChartLib() {
    if (!window.Chart) await loadJs('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js');
    if (!window.ChartDataLabels) await loadJs('https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js');
    try {
        if (window.Chart && window.ChartDataLabels && !Chart.registry?.plugins?.get?.('datalabels')) Chart.register(window.ChartDataLabels);
    } catch (_) {
    }
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.devicePixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.6);
}

function loadJs(src) {
    return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
    });
}

function showBusy(f) {
    const el = document.getElementById('hcidx-busy');
    if (el) el.style.display = f ? 'flex' : 'none';
}

const uniqueNonEmptySorted = (v) =>
    Array.from(new Set((v || []).map(x => String(x ?? '')).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'pt-BR', {sensitivity: 'base'}));
const escapeHtml = s => String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
let _filtersPopulated = false;

function populateFilters(allColabs, matrizesMap) {
    if (_filtersPopulated) return;
    const selM = document.getElementById('efet-filter-matriz');
    const selG = document.getElementById('efet-filter-gerencia');
    const selR = document.getElementById('efet-filter-regiao');
    if (selM) {
        const matrizes = uniqueNonEmptySorted(allColabs.map(c => c.MATRIZ));
        selM.innerHTML = `<option value="">Matriz</option>` + matrizes.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
        if (state.matriz) selM.value = state.matriz;
    }
    if (selG && matrizesMap) {
        const gerentes = uniqueNonEmptySorted(Array.from(matrizesMap.values()).map(m => m.GERENCIA));
        selG.innerHTML = `<option value="">Gerência</option>` + gerentes.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
        if (state.gerencia) selG.value = state.gerencia;
    }
    if (selR) {
        const regs = uniqueNonEmptySorted(allColabs.map(c => c.REGIAO || 'N/D'));
        selR.innerHTML = `<option value="">Região</option>` + regs.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
        if (state.regiao) selR.value = state.regiao;
    }
    _filtersPopulated = true;
}

async function loadColabsCached() {
    const key = cacheKeyForColabs();
    return fetchOnce(key, async () => {
        let query = supabase.from('Colaboradores').select('*');
        const data = await fetchAllWithPagination(query);
        const rows = Array.isArray(data) ? data.slice() : [];
        rows.sort((a, b) => String(a?.Nome || '').localeCompare(String(b?.Nome || ''), 'pt-BR'));
        return rows;
    });
}

async function loadSpamData() {
    return fetchOnce('spamData', async () => {
        const {data, error} = await supabase.from('Spam').select('"HC Fixo", "HC PT", SVC, REGIAO, MÊS, ANO');
        if (error) throw error;
        return (data || []).map(r => ({
            ...r,
            HC_Fixo: Number(r['HC Fixo']) || 0,
            HC_PT: Number(r['HC PT']) || 0,
            HC_Total: (Number(r['HC Fixo']) || 0) + (Number(r['HC PT']) || 0),
            SVC: norm(r.SVC).replace(/\s+/g, ''),
            REGIAO: norm(r.REGIAO),
            MÊS: norm(r.MÊS),
            ANO: Number(r.ANO) || 2025,
            mesOrder: getMesOrder(r.MÊS)
        }));
    });
}

async function loadMatrizesData() {
    return fetchOnce('matrizesData', async () => {
        const {data, error} = await supabase.from('Matrizes').select('SERVICE, MATRIZ, GERENCIA, REGIAO');
        if (error) throw error;
        const map = new Map();
        (data || []).forEach(r => {
            const svc = norm(r.SERVICE).replace(/\s+/g, '');
            if (svc) {
                map.set(svc, {
                    GERENCIA: String(r.GERENCIA || 'N/D').trim(),
                    REGIAO: norm(r.REGIAO || 'N/D')
                });
            }
        });
        return map;
    });
}

function enforceMinSegmentPct(percs, minPct) {
    const arr = percs.map(v => Math.max(0, +v || 0));
    const nonZeroIdx = arr.map((v, i) => v > 0 ? i : -1).filter(i => i >= 0);
    const k = nonZeroIdx.length;
    if (k === 0) return arr.map(() => 0);
    const effMin = Math.min(minPct, 100 / k - 1e-9);
    const sumOriginal = nonZeroIdx.reduce((s, i) => s + arr[i], 0) || 1;
    const floorsSum = effMin * k;
    let available = Math.max(0, 100 - floorsSum);
    const out = arr.slice();
    nonZeroIdx.forEach(i => {
        const share = available * (arr[i] / sumOriginal);
        out[i] = effMin + share;
    });
    const total = out.reduce((a, b) => a + b, 0);
    const diff = 100 - total;
    if (Math.abs(diff) > 1e-6) {
        let maxIdx = nonZeroIdx[0];
        nonZeroIdx.forEach(i => {
            if (out[i] > out[maxIdx]) maxIdx = i;
        });
        out[maxIdx] += diff;
    }
    return out;
}

function applyMinWidthToStack(datasets, minPct) {
    if (!datasets || datasets.length === 0) return;
    const n = Math.max(...datasets.map(ds => ds.data?.length || 0));
    for (let j = 0; j < n; j++) {
        const real = datasets.map(ds => +((ds.data?.[j]) || 0));
        const rendered = enforceMinSegmentPct(real, minPct);
        datasets.forEach((ds, idx) => {
            if (!ds._realPct) ds._realPct = [];
            if (!ds._renderData) ds._renderData = [];
            ds._realPct[j] = real[idx];
            ds._renderData[j] = rendered[idx];
        });
    }
    datasets.forEach(ds => {
        ds.data = ds._renderData;
    });
}

async function refresh() {
    if (!state.mounted || state.loading) {
        if (state.loading) console.warn("Refresh chamado enquanto já estava carregando.");
        return;
    }
    state.loading = true;
    showBusy(true);
    try {
        await ensureChartLib();
        const [allRows, matrizesMap] = await Promise.all([
            loadColabsCached(),
            loadMatrizesData()
        ]);
        populateFilters(allRows, matrizesMap);
        let svcsDoGerente = null;
        if (state.gerencia && matrizesMap) {
            svcsDoGerente = new Set();
            for (const [svc, data] of matrizesMap.entries()) {
                if (data.GERENCIA === state.gerencia) {
                    svcsDoGerente.add(svc);
                }
            }
        }
        state.colabs = allRows.filter(c => {
            if (norm(c?.Ativo || 'SIM') !== 'SIM') return false;
            if (state.matriz && c?.MATRIZ !== state.matriz) return false;
            if (svcsDoGerente) {
                const colabSvcNorm = norm(c.SVC).replace(/\s+/g, '');
                if (!svcsDoGerente.has(colabSvcNorm)) {
                    return false;
                }
            }
            if (state.regiao && (String(c?.REGIAO || 'N/D') !== state.regiao)) return false;
            return true;
        });
        const visaoServiceAtiva = document.querySelector('#efet-visao-service.active');
        const visaoRegionalAtiva = document.querySelector('#efet-visao-regional.active');
        const visaoEmEfetivacaoAtiva = document.querySelector('#efet-em-efetivacao.active');
        const visaoSpamHcAtiva = document.querySelector('#spam-hc-view.active');
        if (visaoServiceAtiva) {
            ensureChartsCreatedService();
            updateChartsNow();
        } else if (visaoRegionalAtiva) {
            ensureChartsCreatedRegional();
            updateRegionalChartsNow();
        } else if (visaoEmEfetivacaoAtiva) {
            updateEmEfetivacaoTable();
        } else if (visaoSpamHcAtiva) {
            await updateSpamCharts(matrizesMap, svcsDoGerente);
        } else {
            console.log("Gráficos não atualizados: nenhuma sub-aba ativa.");
        }
    } catch (e) {
        console.error('Efetivações (Índice) erro', e);
        alert('Falha ao carregar Efetivações. Veja o console.');
    } finally {
        state.loading = false;
        showBusy(false);
    }
}

function wireSubtabs() {
    const host = document.querySelector(HOST_SEL);
    if (!host) return;
    const subButtons = host.querySelectorAll('.efet-subtab-btn');
    if (subButtons.length > 0 && subButtons[0].dataset.wired === '1') {
        return;
    }
    const scrollContainer = document.querySelector('.container');
    subButtons.forEach(btn => {
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => {
            const currentView = host.querySelector('.efet-view.active');
            const viewName = btn.dataset.view;
            const nextView = host.querySelector(`#${viewName}`);
            if (currentView === nextView) return;
            subButtons.forEach(b => b.classList.remove('active'));
            host.querySelectorAll('.efet-view').forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            if (nextView) {
                nextView.classList.add('active');
            }
            if (scrollContainer) {
                if (viewName === 'efet-em-efetivacao') {
                    scrollContainer.classList.add('travar-scroll-pagina');
                } else {
                    scrollContainer.classList.remove('travar-scroll-pagina');
                }
            }
            if (viewName === 'efet-visao-service' || viewName === 'efet-visao-regional' || viewName === 'efet-em-efetivacao' || viewName === 'spam-hc-view') {
                refresh();
            }
            setResponsiveHeights();
        });
    });
}

function setDynamicChartHeight(chart, labels) {
    if (!chart || !chart.canvas || chart.options.indexAxis !== 'y') return;
    const pixelsPerBar = 32;
    const headerAndLegendHeight = 96;
    const minHeight = 300;
    const calculatedHeight = (labels.length * pixelsPerBar) + headerAndLegendHeight;
    const finalHeight = Math.max(minHeight, calculatedHeight);
    const wrapper = chart.canvas.parentElement;
    if (wrapper && wrapper.style.height !== `${finalHeight}px`) {
        wrapper.style.height = `${finalHeight}px`;
        if (typeof chart.resize === 'function') {
            setTimeout(() => chart.resize(), 50);
        }
    }
}

function baseLegendConfig(pos, show) {
    return {
        display: show,
        position: pos,
        fullSize: true,
        align: 'center',
        labels: {boxWidth: 10, boxHeight: 10, padding: 10, usePointStyle: true}
    };
}

function forceLegendBottom(chart) {
    if (!chart?.options) return;
    const leg = chart.options.plugins.legend || (chart.options.plugins.legend = {});
    const lbls = leg.labels || (leg.labels = {});
    leg.display = leg.display !== false;
    leg.position = 'bottom';
    leg.fullSize = true;
    leg.align = 'center';
    lbls.usePointStyle = true;
    lbls.boxWidth = 12;
    lbls.boxHeight = 12;
    lbls.padding = 12;
    const w = chart.canvas?.parentElement?.clientWidth || 800;
    const size = Math.max(13, Math.min(16, Math.round(w / 48)));
    lbls.font = {size};
}

function baseOptsPercent(canvas, onClick, axis = 'x') {
    const w = canvas?.parentElement?.clientWidth || 800;
    const baseSize = Math.max(13, Math.min(16, Math.round(w / 48)));
    const isHorizontal = axis === 'y';
    const valueScale = {
        stacked: true,
        grid: {display: false},
        ticks: {callback: v => `${v}%`, font: {size: baseSize + 1}},
        min: 0,
        max: 100
    };
    const categoryScale = {
        stacked: true,
        grid: {display: false},
        ticks: {maxRotation: 0, font: {size: baseSize + 1}}
    };
    return {
        indexAxis: axis,
        layout: {
            padding: {top: 16, left: 10, right: 18, bottom: 10}
        },
        interaction: {mode: 'nearest', axis: isHorizontal ? 'y' : 'x', intersect: true},
        animation: {duration: 800, easing: 'easeOutQuart'},
        onClick: (e, elements, chart) => {
            if (elements.length > 0 && onClick) onClick(chart, elements[0]);
        },
        plugins: {
            title: {display: false},
            legend: baseLegendConfig('bottom', true),
            datalabels: {
                clip: false,
                clamp: false,
                display: (ctx) => {
                    const real = ctx.dataset._realPct?.[ctx.dataIndex];
                    const v = (real != null) ? real : (+ctx.dataset.data[ctx.dataIndex] || 0);
                    return v > 0;
                },
                font: () => ({size: Math.max(MIN_LABEL_FONT_PX, baseSize + 1), weight: 'bold'}),
                color: (ctx) => {
                    const bg = Array.isArray(ctx.dataset.backgroundColor)
                        ? ctx.dataset.backgroundColor[ctx.dataIndex]
                        : ctx.dataset.backgroundColor;
                    return bestLabel(bg);
                },
                anchor: 'center',
                align: 'center',
                offset: 0,
                formatter: (value, ctx) => {
                    const real = ctx.dataset._realPct?.[ctx.dataIndex];
                    const use = (real != null) ? real : (+value || 0);
                    if (use <= 0) return '';
                    const pct = use < 1 ? 1 : Math.round(use);
                    const count = ctx.dataset._rawCounts?.[ctx.dataIndex];
                    return count != null ? `${pct}% (${count})` : `${pct}%`;
                }
            },
            tooltip: {
                displayColors: false,
                filter: (item) => (item.parsed?.y ?? item.parsed?.x) > 0,
                callbacks: {
                    title: (items) => items?.[0]?.label ?? '',
                    label: (ctx) => {
                        const real = ctx.dataset._realPct?.[ctx.dataIndex];
                        const pct = Math.round(real != null ? real : ((ctx.chart?.options?.indexAxis === 'y') ? ctx.parsed?.x : ctx.parsed?.y) || 0);
                        return `${ctx.dataset?.label ? `${ctx.dataset.label}: ` : ''}${pct}% (${ctx.dataset._rawCounts?.[ctx.dataIndex] ?? 0})`;
                    }
                }
            }
        },
        scales: {x: isHorizontal ? valueScale : categoryScale, y: isHorizontal ? categoryScale : valueScale},
        elements: {bar: {borderSkipped: false, borderRadius: 4}}
    };
}

function baseOptsNumber(canvas, onClick, axis = 'x') {
    const w = canvas?.parentElement?.clientWidth || 800;
    const baseSize = Math.max(12, Math.min(14, Math.round(w / 55)));
    const isHorizontal = axis === 'y';
    const valueScale = {
        grid: {display: false},
        ticks: {font: {size: baseSize}},
        min: 0,
    };
    const categoryScale = {
        grid: {display: false},
        ticks: {
            maxRotation: 45,
            minRotation: 0,
            font: {size: baseSize}
        }
    };
    return {
        indexAxis: axis,
        layout: {padding: {top: 24, left: 10, right: 18, bottom: 10}},
        interaction: {mode: 'nearest', axis: isHorizontal ? 'y' : 'x', intersect: true},
        animation: {duration: 800, easing: 'easeOutQuart'},
        onClick: (e, elements, chart) => {
            if (elements.length > 0 && onClick) onClick(chart, elements[0]);
        },
        plugins: {
            title: {
                display: false,
                position: 'top',
                text: '',
                font: {size: baseSize + 4, weight: 'bold'},
                padding: {top: 0, bottom: 12},
                color: '#003369',
                align: 'start'
            },
            legend: {
                display: true,
                position: 'top',
                align: 'end',
                labels: {
                    boxWidth: 10,
                    boxHeight: 10,
                    padding: 10,
                    usePointStyle: true,
                    font: {size: baseSize}
                }
            },
            tooltip: {
                displayColors: false,
                filter: (item) => (item.parsed?.y ?? item.parsed?.x) > 0,
                callbacks: {
                    title: (items) => items?.[0]?.label ?? '',
                    label: (ctx) => {
                        const val = Math.round(isHorizontal ? ctx.parsed?.x : ctx.parsed?.y ?? 0);
                        const label = `${ctx.dataset?.label ? `${ctx.dataset.label}: ` : ''}`;
                        return `${label}${val}`;
                    }
                }
            }
        },
        scales: {x: isHorizontal ? valueScale : categoryScale, y: isHorizontal ? categoryScale : valueScale},
        elements: {bar: {borderSkipped: false, borderRadius: 4}}
    };
}

function createStackedBar(canvasId, onClick, axis = 'x') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const options = baseOptsPercent(canvas, onClick, axis);
    options.plugins.legend.onClick = (e, legendItem, legend) => {
        if (onClick) onClick(legend.chart, {datasetIndex: legendItem.datasetIndex});
    };
    const chart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {labels: [], datasets: []},
        options,
        plugins: [ChartDataLabels]
    });
    forceLegendBottom(chart);
    return chart;
}

function createBar(canvasId, onClick, axis = 'x') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const options = baseOptsNumber(canvas, onClick, axis);
    const chart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {labels: [], datasets: []},
        options,
        plugins: [ChartDataLabels]
    });
    forceLegendBottom(chart);
    return chart;
}

function splitByTurno(colabs) {
    const t1 = colabs.filter(c => c.Escala === 'T1');
    const t2 = colabs.filter(c => c.Escala === 'T2');
    const t3 = colabs.filter(c => c.Escala === 'T3');
    return {labels: ['T1', 'T2', 'T3', 'GERAL'], groups: [t1, t2, t3, colabs]};
}

function splitByRegiao(colabs) {
    const map = new Map();
    colabs.forEach(c => {
        const r = String(c?.REGIAO || 'N/D');
        if (!map.has(r)) map.set(r, []);
        map.get(r).push(c);
    });
    const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', {sensitivity: 'base'}));
    const labels = entries.map(([k]) => k);
    const groups = entries.map(([, arr]) => arr);
    labels.push('GERAL');
    groups.push(colabs.slice());
    return {labels, groups};
}

function ensureChartsCreatedService() {
    if (!state.charts.idade) {
        state.charts.idade = createStackedBar('ind-idade-bar', (chart, element) => toggleFilter('idade', chart, element), 'x');
    }
    if (!state.charts.genero) {
        state.charts.genero = createStackedBar('ind-genero-bar', (chart, element) => toggleFilter('genero', chart, element), 'x');
        if (state.charts.genero && state.charts.genero.options.elements.bar) {
            state.charts.genero.options.elements.bar.barPercentage = 0.9;
            state.charts.genero.options.elements.bar.categoryPercentage = 0.9;
        }
    }
    if (!state.charts.dsr) {
        const canvas = document.getElementById('ind-dsr-pie');
        if (canvas) {
            const baseSize = Math.max(13, Math.min(15, Math.round((canvas?.parentElement?.clientWidth || 600) / 45)));
            const options = {
                layout: {padding: 6},
                animation: {duration: 800, easing: 'easeOutQuart'},
                onClick: (e, elements) => {
                    if (elements.length > 0) toggleFilter('dsr', null, elements[0]);
                },
                plugins: {
                    legend: baseLegendConfig('bottom', true),
                    datalabels: {
                        display: true,
                        formatter: (v) => `${Math.round(+v)}%`,
                        color: (ctx) => bestLabel(Array.isArray(ctx.dataset.backgroundColor) ? ctx.dataset.backgroundColor[ctx.dataIndex] : ctx.dataset.backgroundColor),
                        font: {size: Math.max(MIN_LABEL_FONT_PX, baseSize), weight: 'bold'},
                        anchor: 'center',
                        align: 'center',
                        clamp: true
                    },
                    tooltip: {
                        displayColors: false,
                        callbacks: {
                            label: (ctx) => `${ctx.label || ''}: ${Math.round(ctx.parsed ?? 0)}% (${(ctx.dataset._rawCounts || [])[ctx.dataIndex] ?? 0})`
                        }
                    }
                },
                cutout: '40%'
            };
            const chart = new Chart(canvas.getContext('2d'), {
                type: 'doughnut',
                data: {labels: [], datasets: [{data: [], backgroundColor: palette()}]},
                options,
                plugins: [ChartDataLabels]
            });
            forceLegendBottom(chart);
            state.charts.dsr = chart;
        }
    }
    if (!state.charts.contrato) state.charts.contrato = createStackedBar('ind-contrato-bar', (chart, element) => toggleFilter('contrato', chart, element), 'y');
    if (!state.charts.contratoSvc) state.charts.contratoSvc = createStackedBar('ind-contrato-svc-bar', (chart, element) => toggleFilter('contratoSvc', chart, element), 'y');
    if (!state.charts.auxPrazoSvc) {
        const auxPrazoSvcId = document.getElementById('ind-aux-30-60-90-svc-bar') ? 'ind-aux-30-60-90-svc-bar' : 'ind-contrato-90d-svc-bar';
        state.charts.auxPrazoSvc = createStackedBar(auxPrazoSvcId, (chart, element) => toggleFilter('auxPrazoSvc', chart, element), 'y');
    }
}

function ensureChartsCreatedRegional() {
    if (!state.charts.idadeRegiao) {
        const id = document.getElementById('reg-idade-bar') ? 'reg-idade-bar' : 'ind-idade-regiao-bar';
        state.charts.idadeRegiao = createStackedBar(id, null, 'x');
    }
    if (!state.charts.generoRegiao) {
        const id = document.getElementById('reg-genero-bar') ? 'reg-genero-bar' : 'ind-genero-regiao-bar';
        state.charts.generoRegiao = createStackedBar(id, null, 'x');
    }
    if (!state.charts.contratoRegiao) {
        const id = document.getElementById('reg-contrato-bar') ? 'reg-contrato-bar' : 'ind-contrato-regiao-bar';
        state.charts.contratoRegiao = createStackedBar(id, null, 'x');
    }
    if (!state.charts.auxPrazoRegiao) {
        const id = document.getElementById('reg-aux-30-60-90-bar') ? 'reg-aux-30-60-90-bar' : 'ind-contrato-90d-regiao-bar';
        state.charts.auxPrazoRegiao = createStackedBar(id, null, 'x');
    }
}

function toggleFilter(type, chart, element) {
    const set = state.interactive[type];
    if (!set) return;
    let label = (type === 'dsr')
        ? state.charts.dsr.data.labels[element.index]
        : chart.data.datasets[element.datasetIndex].label;
    if (set.has(label)) set.delete(label);
    else set.add(label);
    const visaoServiceAtiva = document.querySelector('#efet-visao-service.active');
    const visaoRegionalAtiva = document.querySelector('#efet-visao-regional.active');
    if (visaoServiceAtiva) updateChartsNow();
    if (visaoRegionalAtiva) updateRegionalChartsNow();
}

function applyInteractiveFilter(colabs) {
    let out = [...colabs];
    if (state.interactive.idade.size > 0) out = out.filter(c => state.interactive.idade.has(ageBucket(calcAgeFromStr(getNascimento(c)))));
    if (state.interactive.genero.size > 0) out = out.filter(c => state.interactive.genero.has(mapGeneroLabel(c.Genero)));
    if (state.interactive.dsr.size > 0) {
        out = out.filter(c => {
            const dsrDays = mapDSR(c.DSR);
            return dsrDays.some(day => state.interactive.dsr.has(day));
        });
    }
    return out;
}

function clearAllFilters() {
    Object.values(state.interactive).forEach(set => set.clear());
    const visaoServiceAtiva = document.querySelector('#efet-visao-service.active');
    const visaoRegionalAtiva = document.querySelector('#efet-visao-regional.active');
    if (visaoServiceAtiva) updateChartsNow();
    if (visaoRegionalAtiva) updateRegionalChartsNow();
}

function updateChartsNow() {
    if (!state.charts.idade) {
        console.warn("Tentando atualizar gráficos Service, mas eles não estão inicializados.");
        return;
    }
    const baseColabs = applyInteractiveFilter(state.colabs);
    const pal = palette();
    const createOpacity = (color, opacity) => color + Math.round(opacity * 255).toString(16).padStart(2, '0');
    const colabsAuxiliares = baseColabs.filter(c => norm(c?.Cargo) === 'AUXILIAR');
    {
        const {labels, groups} = splitByTurno(colabsAuxiliares);
        const counts = groups.map(g => {
            const m = new Map(AGE_BUCKETS.map(k => [k, 0]));
            g.forEach(c => {
                const b = ageBucket(calcAgeFromStr(getNascimento(c)));
                m.set(b, (m.get(b) || 0) + 1);
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = AGE_BUCKETS.map((b, i) => {
            const raw = counts.map(m => m.get(b) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            const sel = state.interactive.idade;
            const base = pal[i % pal.length];
            const bg = sel.size === 0 || sel.has(b) ? base : createOpacity(base, 0.2);
            return {label: b, data: pctReal, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        if (state.charts.idade) {
            state.charts.idade.data.labels = labels;
            state.charts.idade.data.datasets = datasets;
            state.charts.idade.update('none');
        }
    }
    {
        const {labels, groups} = splitByTurno(colabsAuxiliares);
        const cats = ['Masculino', 'Feminino', 'Outros', 'N/D'];
        const counts = groups.map(g => {
            const m = new Map(cats.map(k => [k, 0]));
            g.forEach(c => {
                const k = mapGeneroLabel(c?.Genero);
                m.set(k, (m.get(k) || 0) + 1);
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = cats.map((cat, i) => {
            const raw = counts.map(m => m.get(cat) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            let color = pal[i % pal.length];
            if (cat === 'Masculino') color = css(root(), '--hcidx-gender-male', '#02B1EE');
            if (cat === 'Feminino') color = css(root(), '--hcidx-gender-female', '#FF5C8A');
            const sel = state.interactive.genero;
            const bg = sel.size === 0 || sel.has(cat) ? color : createOpacity(color, 0.2);
            return {label: cat, data: pctReal, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        if (state.charts.genero) {
            state.charts.genero.data.labels = labels;
            state.charts.genero.data.datasets = datasets;
            state.charts.genero.update('none');
        }
    }
    {
        const labels = DOW_LABELS.slice();
        const counts = new Map(labels.map(k => [k, 0]));
        colabsAuxiliares.forEach(c => {
            const dsrDays = mapDSR(c.DSR);
            dsrDays.forEach(d => counts.set(d, (counts.get(d) || 0) + 1));
        });
        const rawArr = labels.map(l => counts.get(l) || 0);
        const totalMarks = rawArr.reduce((a, b) => a + b, 0) || 1;
        const pctArr = rawArr.map(v => (v * 100) / totalMarks);
        if (state.charts.dsr) {
            state.charts.dsr.data.labels = labels;
            state.charts.dsr.data.datasets = [{
                data: pctArr,
                backgroundColor: palette().slice(0, labels.length),
                _rawCounts: rawArr
            }];
            state.charts.dsr.update();
        }
    }
    {
        const {labels, groups} = splitByTurno(colabsAuxiliares);
        const cats = ['Efetivo', 'Em efetivação', 'Potencial (>90d)', 'Temporário (≤90d)'];
        const colors = [
            css(root(), '--hcidx-p-2', '#003369'),
            '#FCB803',
            css(root(), '--hcidx-p-success', '#28a745'),
            css(root(), '--hcidx-p-3', '#69D4FF')
        ];
        const counts = groups.map(g => {
            const m = new Map(cats.map(k => [k, 0]));
            g.forEach(c => {
                if (norm(c.Contrato).includes('KN')) {
                    m.set('Efetivo', m.get('Efetivo') + 1);
                } else if (norm(c.Efetivacao) === 'ABERTO') {
                    m.set('Em efetivação', m.get('Em efetivação') + 1);
                } else {
                    const dias = daysSinceAdmission(c);
                    if (dias != null && dias > 90) {
                        m.set('Potencial (>90d)', m.get('Potencial (>90d)') + 1);
                    } else {
                        m.set('Temporário (≤90d)', m.get('Temporário (≤90d)') + 1);
                    }
                }
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = cats.map((cat, i) => {
            const raw = counts.map(m => m.get(cat) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            const sel = state.interactive.contrato;
            const base = colors[i];
            const bg = sel.size === 0 || sel.has(cat) ? base : (base + '33');
            return {label: cat, data: pctReal, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        const ch = state.charts.contrato;
        if (ch) {
            setDynamicChartHeight(ch, labels);
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update();
        }
    }
    {
        const bySvc = new Map();
        colabsAuxiliares.forEach(c => {
            const k = mapSvcLabel(c?.SVC);
            if (!bySvc.has(k)) bySvc.set(k, []);
            bySvc.get(k).push(c);
        });
        const rows = [...bySvc.entries()].map(([svc, arr]) => {
            const counts = {efetivo: 0, emEfetivacao: 0, temp90: 0, potencial: 0};
            arr.forEach(c => {
                if (norm(c.Contrato).includes('KN')) {
                    counts.efetivo++;
                } else if (norm(c.Efetivacao) === 'ABERTO') {
                    counts.emEfetivacao++;
                } else {
                    (daysSinceAdmission(c) > 90) ? counts.potencial++ : counts.temp90++;
                }
            });
            const total = arr.length || 1;
            const allMatrices = new Set(arr.map(c => c.MATRIZ).filter(Boolean));
            const matriz = allMatrices.size === 1 ? ` (${arr[0].MATRIZ})` : '';
            const combinedLabel = `${svc}${matriz}`;
            return {
                svc: combinedLabel,
                pctEfetivo: (counts.efetivo * 100) / total,
                pctEmEfetivacao: (counts.emEfetivacao * 100) / total,
                pctTemp90: (counts.temp90 * 100) / total,
                pctPotencial: (counts.potencial * 100) / total,
                rawEfetivo: counts.efetivo,
                rawEmEfetivacao: counts.emEfetivacao,
                rawTemp90: counts.temp90,
                rawPotencial: counts.potencial,
                total
            };
        });
        rows.sort((a, b) => b.pctEfetivo - a.pctEfetivo || b.rawEfetivo - a.rawEfetivo || a.svc.localeCompare(b.svc));
        const totalG = colabsAuxiliares.length || 1;
        const countsG = colabsAuxiliares.reduce((acc, c) => {
            if (norm(c.Contrato).includes('KN')) acc.efetivo++;
            else if (norm(c.Efetivacao) === 'ABERTO') acc.emEfetivacao++;
            else (daysSinceAdmission(c) > 90) ? acc.potencial++ : acc.temp90++;
            return acc;
        }, {efetivo: 0, emEfetivacao: 0, temp90: 0, potencial: 0});
        const lbls = rows.map(r => r.svc);
        const dsData = {
            efetivo: {pct: rows.map(r => r.pctEfetivo), raw: rows.map(r => r.rawEfetivo)},
            emEfetivacao: {pct: rows.map(r => r.pctEmEfetivacao), raw: rows.map(r => r.rawEmEfetivacao)},
            temp90: {pct: rows.map(r => r.pctTemp90), raw: rows.map(r => r.rawTemp90)},
            potencial: {pct: rows.map(r => r.pctPotencial), raw: rows.map(r => r.rawPotencial)}
        };
        lbls.push('GERAL');
        dsData.efetivo.pct.push((countsG.efetivo * 100) / totalG);
        dsData.efetivo.raw.push(countsG.efetivo);
        dsData.emEfetivacao.pct.push((countsG.emEfetivacao * 100) / totalG);
        dsData.emEfetivacao.raw.push(countsG.emEfetivacao);
        dsData.temp90.pct.push((countsG.temp90 * 100) / totalG);
        dsData.temp90.raw.push(countsG.temp90);
        dsData.potencial.pct.push((countsG.potencial * 100) / totalG);
        dsData.potencial.raw.push(countsG.potencial);
        const colors = [
            css(root(), '--hcidx-p-2', '#003369'),
            '#FCB803',
            css(root(), '--hcidx-p-success', '#28a745'),
            css(root(), '--hcidx-p-3', '#69D4FF')
        ];
        const ch = state.charts.contratoSvc;
        if (ch) {
            setDynamicChartHeight(ch, lbls);
            const datasets = [
                {
                    label: 'Efetivo',
                    data: dsData.efetivo.pct,
                    backgroundColor: colors[0],
                    _rawCounts: dsData.efetivo.raw,
                    borderWidth: 0
                },
                {
                    label: 'Em efetivação',
                    data: dsData.emEfetivacao.pct,
                    backgroundColor: colors[1],
                    _rawCounts: dsData.emEfetivacao.raw,
                    borderWidth: 0
                },
                {
                    label: 'Potencial (>90d)',
                    data: dsData.potencial.pct,
                    backgroundColor: colors[2],
                    _rawCounts: dsData.potencial.raw,
                    borderWidth: 0
                },
                {
                    label: 'Temporário (≤90d)',
                    data: dsData.temp90.pct,
                    backgroundColor: colors[3],
                    _rawCounts: dsData.temp90.raw,
                    borderWidth: 0
                }
            ];
            applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
            ch.data.labels = lbls;
            ch.data.datasets = datasets;
            ch.update();
        }
    }
    {
        const colabsAuxNaoKN = colabsAuxiliares.filter(c => !norm(c?.Contrato).includes('KN'));
        const bySvc = new Map();
        colabsAuxNaoKN.forEach(c => {
            const k = mapSvcLabel(c?.SVC);
            if (!bySvc.has(k)) bySvc.set(k, []);
            bySvc.get(k).push(c);
        });
        const rows = [...bySvc.entries()].map(([svc, arr]) => {
            const counts = {b30: 0, b60: 0, b90: 0, bMais90: 0};
            arr.forEach(c => {
                const d = daysSinceAdmission(c);
                if (d == null) return;
                if (d <= 30) counts.b30++;
                else if (d <= 60) counts.b60++;
                else if (d <= 90) counts.b90++;
                else counts.bMais90++;
            });
            const total = arr.length || 1;
            const allMatrices = new Set(arr.map(c => c.MATRIZ).filter(Boolean));
            const matriz = allMatrices.size === 1 ? ` (${arr[0].MATRIZ})` : '';
            const combinedLabel = `${svc}${matriz}`;
            return {
                svc: combinedLabel,
                pct30: (counts.b30 * 100) / total,
                pct60: (counts.b60 * 100) / total,
                pct90: (counts.b90 * 100) / total,
                pctMais90: (counts.bMais90 * 100) / total,
                raw30: counts.b30,
                raw60: counts.b60,
                raw90: counts.b90,
                rawMais90: counts.bMais90,
                total
            };
        });
        rows.sort((a, b) => a.rawMais90 - b.rawMais90 || a.svc.localeCompare(b.svc));
        const countsG = colabsAuxNaoKN.reduce((acc, c) => {
            const d = daysSinceAdmission(c);
            if (d != null) {
                if (d <= 30) acc.g30++;
                else if (d <= 60) acc.g60++;
                else if (d <= 90) acc.g90++;
                else acc.gMais90++;
            }
            return acc;
        }, {g30: 0, g60: 0, g90: 0, gMais90: 0});
        const totalG = colabsAuxNaoKN.length || 1;
        const lbls = rows.map(r => r.svc);
        const dsMap = {
            '≤30d': {pct: rows.map(r => r.pct30), raw: rows.map(r => r.raw30)},
            '31–60d': {pct: rows.map(r => r.pct60), raw: rows.map(r => r.raw60)},
            '61–90d': {pct: rows.map(r => r.pct90), raw: rows.map(r => r.raw90)},
            '>90d': {pct: rows.map(r => r.pctMais90), raw: rows.map(r => r.rawMais90)}
        };
        lbls.push('GERAL');
        dsMap['≤30d'].pct.push((countsG.g30 * 100) / totalG);
        dsMap['≤30d'].raw.push(countsG.g30);
        dsMap['31–60d'].pct.push((countsG.g60 * 100) / totalG);
        dsMap['31–60d'].raw.push(countsG.g60);
        dsMap['61–90d'].pct.push((countsG.g90 * 100) / totalG);
        dsMap['61–90d'].raw.push(countsG.g90);
        dsMap['>90d'].pct.push((countsG.gMais90 * 100) / totalG);
        dsMap['>90d'].raw.push(countsG.gMais90);
        const colors = [
            css(root(), '--hcidx-p-2', '#003369'),
            css(root(), '--hcidx-p-3', '#69D4FF'),
            '#0CC494',
            '#C00000'
        ];
        const ch = state.charts.auxPrazoSvc;
        if (ch) {
            setDynamicChartHeight(ch, lbls);
            const datasets = Object.keys(dsMap).map((key, i) => ({
                label: key,
                data: dsMap[key].pct,
                backgroundColor: colors[i],
                _rawCounts: dsMap[key].raw,
                borderWidth: 0
            }));
            applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
            ch.data.labels = lbls;
            ch.data.datasets = datasets;
            ch.update();
        }
    }
}

function updateRegionalChartsNow() {
    if (!state.charts.idadeRegiao) {
        console.warn("Tentando atualizar gráficos Regionais, mas eles não estão inicializados.");
        return;
    }
    const baseColabs = applyInteractiveFilter(state.colabs);
    const pal = palette();
    const colabsAuxiliares = baseColabs.filter(c => norm(c?.Cargo) === 'AUXILIAR');
    {
        const {labels, groups} = splitByRegiao(colabsAuxiliares);
        const counts = groups.map(g => {
            const m = new Map(AGE_BUCKETS.map(k => [k, 0]));
            g.forEach(c => {
                const b = ageBucket(calcAgeFromStr(getNascimento(c)));
                m.set(b, (m.get(b) || 0) + 1);
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = AGE_BUCKETS.map((b, i) => {
            const raw = counts.map(m => m.get(b) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            return {label: b, data: pctReal, backgroundColor: pal[i % pal.length], _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        const ch = state.charts.idadeRegiao;
        if (ch) {
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update('none');
        }
    }
    {
        const {labels, groups} = splitByRegiao(colabsAuxiliares);
        const cats = ['Masculino', 'Feminino', 'Outros', 'N/D'];
        const counts = groups.map(g => {
            const m = new Map(cats.map(k => [k, 0]));
            g.forEach(c => {
                const k = mapGeneroLabel(c?.Genero);
                m.set(k, (m.get(k) || 0) + 1);
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = cats.map((cat, i) => {
            const raw = counts.map(m => m.get(cat) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            let color = pal[i % pal.length];
            if (cat === 'Masculino') color = css(root(), '--hcidx-gender-male', '#02B1EE');
            if (cat === 'Feminino') color = css(root(), '--hcidx-gender-female', '#FF5C8A');
            return {label: cat, data: pctReal, backgroundColor: color, _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        const ch = state.charts.generoRegiao;
        if (ch) {
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update('none');
        }
    }
    {
        const {labels, groups} = splitByRegiao(colabsAuxiliares);
        const cats = ['Efetivo', 'Em efetivação', 'Potencial (>90d)', 'Temporário (≤90d)'];
        const colors = [
            css(root(), '--hcidx-p-2', '#003369'),
            '#FCB803',
            css(root(), '--hcidx-p-success', '#28a745'),
            css(root(), '--hcidx-p-3', '#69D4FF')
        ];
        const counts = groups.map(g => {
            const m = new Map(cats.map(k => [k, 0]));
            g.forEach(c => {
                if (norm(c.Contrato).includes('KN')) m.set('Efetivo', m.get('Efetivo') + 1);
                else if (norm(c.Efetivacao) === 'ABERTO') m.set('Em efetivação', m.get('Em efetivação') + 1);
                else (daysSinceAdmission(c) > 90) ? m.set('Potencial (>90d)', m.get('Potencial (>90d)') + 1) : m.set('Temporário (≤90d)', m.get('Temporário (≤90d)') + 1);
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = cats.map((cat, i) => {
            const raw = counts.map(m => m.get(cat) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            return {label: cat, data: pctReal, backgroundColor: colors[i], _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        const ch = state.charts.contratoRegiao;
        if (ch) {
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update();
        }
    }
    {
        const colabsAuxNaoKN = colabsAuxiliares.filter(c => !norm(c?.Contrato).includes('KN'));
        const {labels, groups} = splitByRegiao(colabsAuxNaoKN);
        const rows = groups.map(arr => {
            const counts = {b30: 0, b60: 0, b90: 0, bMais90: 0};
            arr.forEach(c => {
                const d = daysSinceAdmission(c);
                if (d == null) return;
                if (d <= 30) counts.b30++;
                else if (d <= 60) counts.b60++;
                else if (d <= 90) counts.b90++;
                else counts.bMais90++;
            });
            const total = arr.length || 1;
            return {
                pct30: (counts.b30 * 100) / total,
                pct60: (counts.b60 * 100) / total,
                pct90: (counts.b90 * 100) / total,
                pctMais90: (counts.bMais90 * 100) / total,
                raw30: counts.b30, raw60: counts.b60, raw90: counts.b90, rawMais90: counts.bMais90
            };
        });
        const ds = {
            '≤30d': {pct: rows.map(r => r.pct30), raw: rows.map(r => r.raw30)},
            '31–60d': {pct: rows.map(r => r.pct60), raw: rows.map(r => r.raw60)},
            '61–90d': {pct: rows.map(r => r.pct90), raw: rows.map(r => r.raw90)},
            '>90d': {pct: rows.map(r => r.pctMais90), raw: rows.map(r => r.rawMais90)}
        };
        const colors = [
            css(root(), '--hcidx-p-2', '#003369'),
            css(root(), '--hcidx-p-3', '#69D4FF'),
            '#0CC494',
            '#C00000'
        ];
        const ch = state.charts.auxPrazoRegiao;
        if (ch) {
            const datasets = Object.keys(ds).map((key, i) => ({
                label: key,
                data: ds[key].pct,
                backgroundColor: colors[i],
                _rawCounts: ds[key].raw,
                borderWidth: 0
            }));
            applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update();
        }
    }
}

function updateEmEfetivacaoTable() {
    const tbody = document.getElementById('efet-table-tbody');
    if (!tbody) {
        console.warn("Elemento #efet-table-tbody não encontrado. A tabela 'Em Efetivação' não pode ser populada.");
        return;
    }
    const colabsEmEfetivacao = state.colabs.filter(c => norm(c.Efetivacao) === 'ABERTO');
    colabsEmEfetivacao.sort((a, b) => {
        const dateA = a['Data Fluxo'] ? new Date(a['Data Fluxo']) : new Date('2999-12-31');
        const dateB = b['Data Fluxo'] ? new Date(b['Data Fluxo']) : new Date('2999-12-31');
        return dateA - dateB;
    });
    tbody.innerHTML = '';
    if (colabsEmEfetivacao.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center p-4">Nenhum colaborador com fluxo "Aberto" encontrado.</td></tr>';
        return;
    }
    colabsEmEfetivacao.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${c.Fluxo || ''}</td>
            <td>${c.Efetivacao || ''}</td>
            <td>${c.Nome || ''}</td>
            <td>${formatDateLocal(c['Data Fluxo'])}</td>
            <td>${c['Observacao Fluxo'] || ''}</td>
            <td>${c.SVC || ''}</td>
            <td>${c.REGIAO || ''}</td>
        `;
        tbody.appendChild(tr);
    });
}

function ensureChartsCreatedSpam() {
    const pal = palette();
    if (!state.charts.spamHcEvolucaoSvc) {
        const chart = createBar('spam-chart-evolucao-svc', null, 'x');
        if (chart) {
            chart.options.plugins.datalabels = {
                clamp: false,
                labels: {
                    value: {
                        display: (ctx) => (ctx.dataset.label === ctx.chart.data._mesAtualLabel && ctx.dataset.data[ctx.dataIndex] > 0),
                        formatter: (v) => v.toFixed(0),
                        font: {weight: 'bold', size: 14},
                        anchor: 'end',
                        align: 'end',
                        offset: 8,
                        color: '#333'
                    }, previousValue: {
                        display: (ctx) => (ctx.dataset.label === ctx.chart.data._mesAnteriorLabel && ctx.dataset.data[ctx.dataIndex] > 0),
                        formatter: (v) => v.toFixed(0),
                        font: {weight: 'bold', size: 14},
                        anchor: 'end',
                        align: 'end',
                        offset: 8,
                        color: '#333'
                    }, delta: {
                        display: (ctx) => {
                            const deltas = ctx.dataset._deltas;
                            if (!deltas) return false;
                            const isMesAtual = ctx.dataset.label === ctx.chart.data._mesAtualLabel;
                            const delta = deltas[ctx.dataIndex] ?? 0;
                            return isMesAtual && delta !== 0;
                        },
                        formatter: (v, ctx) => {
                            const delta = ctx.dataset._deltas[ctx.dataIndex];
                            const abs = Math.abs(delta).toFixed(0);
                            return delta > 0 ? `+${abs}\n▲` : `-${abs}\n▼`;
                        },
                        color: (ctx) => (ctx.dataset._deltas[ctx.dataIndex] > 0 ? '#28a745' : '#dc3545'),
                        textAlign: 'center',
                        font: {weight: '800', size: 16, lineHeight: 1.15},
                        anchor: 'end',
                        align: 'end',
                        offset: 35
                    }
                }
            };
            state.charts.spamHcEvolucaoSvc = chart;
        }
    }
    if (!state.charts.spamHcEvolucaoRegiao) {
        const chart = createBar('spam-chart-evolucao-regiao', null, 'x');
        if (chart) {
            chart.options.plugins.datalabels = {
                clamp: false,
                display: true,
                align: 'center',
                anchor: 'center',
                color: (ctx) => bestLabel(ctx.dataset.backgroundColor),
                font: {weight: 'bold', size: 14},
                formatter: (v) => v > 0 ? v.toFixed(0) : ''
            };
            state.charts.spamHcEvolucaoRegiao = chart;
        }
    }
    if (!state.charts.spamHcGerente) {
        const chart = createBar('spam-chart-gerente-mes', null, 'y');
        if (chart) {
            chart.options.plugins.datalabels = {
                clamp: false,
                display: true,
                anchor: 'end',
                align: 'right',
                color: '#333',
                font: {size: 14, weight: 'bold'},
                formatter: (v) => v.toFixed(0),
                offset: 4
            };
            state.charts.spamHcGerente = chart;
        }
    }
    if (!state.charts.spamHcVsAux) {
        const chart = createBar('spam-chart-hc-vs-aux', null, 'x');
        if (chart) {
            chart.options.scales.x.stacked = false;
            chart.options.scales.y.stacked = false;
            chart.options.plugins.datalabels = {
                clamp: false,
                labels: {
                    value: {
                        display: (ctx) => (ctx.dataset.data[ctx.dataIndex] || 0) > 0,
                        formatter: (v) => v.toFixed(0),
                        font: {size: 14, weight: 'bold'},
                        anchor: 'end',
                        align: 'end',
                        offset: 8,
                        color: '#333'
                    }, delta: {
                        display: (ctx) => {
                            if (ctx.datasetIndex !== 1) return false;
                            const deltas = ctx.dataset._deltas;
                            return Array.isArray(deltas) && (deltas[ctx.dataIndex] ?? 0) !== 0;
                        },
                        formatter: (v, ctx) => {
                            const d = ctx.dataset._deltas[ctx.dataIndex];
                            return d > 0 ? `+${d.toFixed(0)}\n▲` : `${d.toFixed(0)}\n▼`;
                        },
                        color: (ctx) => (ctx.dataset._deltas[ctx.dataIndex] > 0 ? '#28a745' : '#dc3545'),
                        textAlign: 'center',
                        font: {weight: '800', size: 16, lineHeight: 1.15},
                        anchor: 'end',
                        align: 'end',
                        offset: 35
                    }
                }
            };
            state.charts.spamHcVsAux = chart;
        }
    }
}

async function updateSpamCharts(matrizesMap, svcsDoGerente) {
    if (!state.mounted) return;
    ensureChartsCreatedSpam();
    const [allSpamData] = await Promise.all([loadSpamData()]);
    const colabsAtivos = state.colabs;
    const spamData = allSpamData.filter(r => {
        if (state.regiao && r.REGIAO !== state.regiao) return false;
        if (svcsDoGerente) if (!svcsDoGerente.has(r.SVC)) return false;
        return true;
    });
    const pal = palette();
    const allMonths = [...spamData].sort(sortMesAno);
    const latestMonth = allMonths.pop();
    if (!latestMonth) {
        console.warn("SPAM: Nenhum dado encontrado (com os filtros aplicados).");
        Object.values(state.charts).forEach(chart => {
            if (chart && chart.canvas.id.startsWith('spam-')) {
                chart.data.labels = [];
                chart.data.datasets = [];
                chart.update();
            }
        });
        return;
    }
    const {MÊS: mesAtual, ANO: anoAtual} = latestMonth;
    const mesAtualLabel = `${mesAtual.slice(0, 3)}/${anoAtual}`;
    const previousMonth = allMonths.filter(m => m.ANO < anoAtual || (m.ANO === anoAtual && m.mesOrder < latestMonth.mesOrder)).pop();
    const mesAnteriorLabel = previousMonth ? `${previousMonth.MÊS.slice(0, 3)}/${previousMonth.ANO}` : null;
    if (state.charts.spamHcEvolucaoSvc) {
        const dadosPorSvcMes = new Map();
        const mesesSet = new Set();
        const svcsSet = new Set();
        spamData.forEach(r => {
            const mesLabel = `${r.MÊS.slice(0, 3)}/${r.ANO}`;
            const svcAgrupado = mapSvcLabel(r.SVC);
            const key = `${svcAgrupado}__${mesLabel}`;
            const totalAnterior = dadosPorSvcMes.get(key) || 0;
            dadosPorSvcMes.set(key, totalAnterior + r.HC_Total);
            mesesSet.add(mesLabel);
            svcsSet.add(svcAgrupado);
        });
        const labels = [...svcsSet].sort();
        const meses = [...mesesSet].sort((a, b) => {
            const [m1, y1] = a.split('/');
            const [m2, y2] = b.split('/');
            return (y1 - y2) || (getMesOrder(m1.toUpperCase()) - getMesOrder(m2.toUpperCase()));
        });
        const datasets = meses.map((mesLabel, i) => {
            const data = labels.map(svc => dadosPorSvcMes.get(`${svc}__${mesLabel}`) || 0);
            return {label: mesLabel, data, backgroundColor: pal[i % pal.length]};
        });
        let maxHcParaEscala = 0;
        datasets.forEach(ds => {
            const max = ds.data.length > 0 ? Math.max(...ds.data) : 0;
            if (max > maxHcParaEscala) maxHcParaEscala = max;
        });
        const chart = state.charts.spamHcEvolucaoSvc;
        if (chart.options.scales.y) {
            chart.options.scales.y.max = maxHcParaEscala + 100;
            if (chart.options.scales.y.max < 10) chart.options.scales.y.max = 10;
        }
        const datasetAtual = datasets.find(d => d.label === mesAtualLabel);
        if (datasetAtual && mesAnteriorLabel) {
            const datasetAnterior = datasets.find(d => d.label === mesAnteriorLabel);
            if (datasetAnterior) {
                datasetAtual._deltas = labels.map((svc, idx) => {
                    const atual = datasetAtual.data[idx] || 0;
                    const anterior = datasetAnterior.data[idx] || 0;
                    return atual - anterior;
                });
                const totalAnterior = datasetAnterior.data.reduce((a, b) => a + b, 0);
                const totalAtual = datasetAtual.data.reduce((a, b) => a + b, 0);
                const deltaGeral = totalAtual - totalAnterior;
                labels.push('GERAL');
                datasets.forEach(ds => {
                    const total = ds.data.reduce((a, b) => a + b, 0);
                    ds.data.push(total);
                });
                datasetAtual._deltas.push(deltaGeral);
            } else {
                datasetAtual._deltas = labels.map(() => 0);
            }
        } else if (datasetAtual) {
            datasetAtual._deltas = labels.map(() => 0);
        }
        chart.data._mesAtualLabel = mesAtualLabel;
        chart.data._mesAnteriorLabel = mesAnteriorLabel;
        chart.data.labels = labels;
        chart.data.datasets = datasets;
        chart.update();
    }
    if (state.charts.spamHcEvolucaoRegiao) {
        const dadosPorRegiaoMes = new Map();
        const mesesSet = new Set();
        const regioesSet = new Set();
        spamData.forEach(r => {
            const regiao = r.REGIAO || 'N/D';
            const mesLabel = `${r.MÊS.slice(0, 3)}/${r.ANO}`;
            const key = `${regiao}__${mesLabel}`;
            mesesSet.add(mesLabel);
            regioesSet.add(regiao);
            const totalAnterior = dadosPorRegiaoMes.get(key) || 0;
            dadosPorRegiaoMes.set(key, totalAnterior + r.HC_Total);
        });
        const labels = [...regioesSet].sort();
        const meses = [...mesesSet].sort((a, b) => {
            const [m1, y1] = a.split('/');
            const [m2, y2] = b.split('/');
            return (y1 - y2) || (getMesOrder(m1.toUpperCase()) - getMesOrder(m2.toUpperCase()));
        });
        const datasets = meses.map((mesLabel, i) => {
            const data = labels.map(regiao => dadosPorRegiaoMes.get(`${regiao}__${mesLabel}`) || 0);
            const totalMes = data.reduce((a, b) => a + b, 0);
            data.push(totalMes);
            return {label: mesLabel, data, backgroundColor: pal[i % pal.length]};
        });
        labels.push('GERAL');
        const chart = state.charts.spamHcEvolucaoRegiao;
        chart.data.labels = labels;
        chart.data.datasets = datasets;
        chart.update();
    }
    if (state.charts.spamHcGerente) {
        const spamMesAtual = spamData.filter(r => r.MÊS === mesAtual && r.ANO === anoAtual);
        const hcPorGerente = new Map();
        spamMesAtual.forEach(r => {
            const svc = r.SVC;
            const gerente = matrizesMap.get(svc)?.GERENCIA || 'SEM GERENTE';
            const totalAnterior = hcPorGerente.get(gerente) || 0;
            hcPorGerente.set(gerente, totalAnterior + r.HC_Total);
        });
        const dataSorted = [...hcPorGerente.entries()].sort((a, b) => a[1] - b[1]);
        const dataValues = dataSorted.map(d => d[1]);
        const maxHc = dataValues.length > 0 ? Math.max(...dataValues) : 1;
        const chart = state.charts.spamHcGerente;
        if (chart.options.scales.x) chart.options.scales.x.max = maxHc * 1.25;
        chart.data.labels = dataSorted.map(d => d[0]);
        chart.data.datasets = [{label: `HC Total (${mesAtualLabel})`, data: dataValues, backgroundColor: pal[1]}];
        setDynamicChartHeight(chart, dataSorted.map(d => d[0]));
        chart.update();
    }
    if (state.charts.spamHcVsAux) {
        const auxPorSvc = new Map();
        colabsAtivos.forEach(c => {
            if (norm(c.Cargo) === 'AUXILIAR') {
                const svc = norm(c.SVC);
                const svcAgrupado = mapSvcLabel(svc);
                auxPorSvc.set(svcAgrupado, (auxPorSvc.get(svcAgrupado) || 0) + 1);
            }
        });
        const hcPorSvc = new Map();
        spamData.filter(r => r.MÊS === mesAtual && r.ANO === anoAtual).forEach(r => {
            const svcAgrupado = mapSvcLabel(r.SVC);
            const totalAnterior = hcPorSvc.get(svcAgrupado) || 0;
            hcPorSvc.set(svcAgrupado, totalAnterior + r.HC_Total);
        });
        const allSvcs = new Set([...auxPorSvc.keys(), ...hcPorSvc.keys()]);
        const labels = [...allSvcs].sort();
        const dataHcTotalSpam = labels.map(svc => hcPorSvc.get(svc) || 0);
        const dataAuxAtivoReal = labels.map(svc => auxPorSvc.get(svc) || 0);
        const totalSpam = dataHcTotalSpam.reduce((a, b) => a + b, 0);
        const totalReal = dataAuxAtivoReal.reduce((a, b) => a + b, 0);
        dataHcTotalSpam.push(totalSpam);
        dataAuxAtivoReal.push(totalReal);
        labels.push('GERAL');
        const maxSpamSemGeral = dataHcTotalSpam.length > 1 ? Math.max(...dataHcTotalSpam.slice(0, -1)) : (dataHcTotalSpam[0] || 0);
        const maxRealSemGeral = dataAuxAtivoReal.length > 1 ? Math.max(...dataAuxAtivoReal.slice(0, -1)) : (dataAuxAtivoReal[0] || 0);
        const maxHcParaEscala = Math.max(maxSpamSemGeral, maxRealSemGeral);
        const chart = state.charts.spamHcVsAux;
        if (chart.options.scales.y) {
            chart.options.scales.y.max = maxHcParaEscala + 100;
            if (chart.options.scales.y.max < 10) chart.options.scales.y.max = 10;
        }
        const deltas = dataAuxAtivoReal.map((real, i) => real - dataHcTotalSpam[i]);
        chart.data.labels = labels;
        chart.data.datasets = [
            {label: `HC Total (SPAM)`, data: dataHcTotalSpam, backgroundColor: pal[1], _deltas: deltas.map(d => 0)},
            {label: 'HC Real (Auxiliares Ativos)', data: dataAuxAtivoReal, backgroundColor: pal[0], _deltas: deltas}
        ];
        chart.update();
    }
}

export async function init() {
    const host = document.querySelector(HOST_SEL);
    if (!host) {
        console.warn('Host #hc-indice não encontrado.');
        return;
    }
    if (!state.mounted) {
        ensureMounted();
        wireSubtabs();
    }
    const activeSubtabBtn = host.querySelector('.efet-subtab-btn.active') || host.querySelector('.efet-subtab-btn');
    if (activeSubtabBtn) {
        const viewName = activeSubtabBtn.dataset.view;
        const view = host.querySelector(`#${viewName}`);
        host.querySelectorAll('.efet-view').forEach(v => v.classList.remove('active'));
        if (view) view.classList.add('active');
        activeSubtabBtn.classList.add('active');
        const scrollContainer = document.querySelector('.container');
        if (scrollContainer) {
            if (viewName === 'efet-em-efetivacao') scrollContainer.classList.add('travar-scroll-pagina');
            else scrollContainer.classList.remove('travar-scroll-pagina');
        }
        await refresh();
    } else {
        await refresh();
    }
}

export function destroy() {
    if (state.mounted) {
        console.log('Destruindo estado de Efetivações.');
        Object.values(state.charts).forEach(chart => chart?.destroy());
        if (_resizeObs) {
            _resizeObs.disconnect();
            _resizeObs = null;
        }
        window.removeEventListener('resize', setResponsiveHeights);
        state.charts = {
            idade: null, genero: null, dsr: null, contrato: null, contratoSvc: null,
            auxPrazoSvc: null, idadeRegiao: null, generoRegiao: null, contratoRegiao: null,
            auxPrazoRegiao: null, spamHcEvolucaoSvc: null, spamHcEvolucaoRegiao: null,
            spamHcGerente: null, spamHcVsAux: null
        };
        _filtersPopulated = false;
        state.matriz = '';
        state.gerencia = '';
        state.regiao = '';
        state.colabs = [];
        Object.values(state.interactive).forEach(set => set.clear());
        state.mounted = false;
        state.loading = false;
        document.querySelector('.container')?.classList.remove('travar-scroll-pagina');
    }
}
