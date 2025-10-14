import {getMatrizesPermitidas} from '../session.js';
import {supabase} from '../supabaseClient.js';

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

(function () {
    const HOST_SEL = '#hc-indice';

    const state = {
        mounted: false,
        loading: false,
        charts: {
            idade: null,
            genero: null,
            dsr: null,
            contrato: null,
            contratoSvc: null,
            cargoSvc: null,
            auxPrazoSvc: null
        },
        matriz: '',
        svc: '',
        colabs: [],
        interactive: {
            genero: new Set(),
            dsr: new Set(),
            idade: new Set(),
            contrato: new Set(),
            contratoSvc: new Set(),
            cargoSvc: new Set(),
            auxPrazoSvc: new Set(),
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
    const DOW_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

    function parseDateMaybe(s) {
        const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(String(s || '').trim());
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
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

    function mapDSR(raw) {
        const n = norm(raw);
        if (n.includes('SEG')) return 'SEG';
        if (n.includes('TER')) return 'TER';
        if (n.includes('QUA')) return 'QUA';
        if (n.includes('QUI')) return 'QUI';
        if (n.includes('SEX')) return 'SEX';
        if (n.includes('SAB')) return 'SAB';
        if (n.includes('DOM')) return 'DOM';
        return 'N/D';
    }

    function palette() {
        const r = root();
        return [css(r, '--hcidx-p-1', '#02B1EE'), css(r, '--hcidx-p-2', '#003369'), css(r, '--hcidx-p-3', '#69D4FF'), css(r, '--hcidx-p-4', '#2677C7'), css(r, '--hcidx-p-5', '#A9E7FF'), css(r, '--hcidx-p-6', '#225B9E'), css(r, '--hcidx-p-7', '#7FB8EB'), css(r, '--hcidx-p-8', '#99CCFF')];
    }

    let _resizeObs = null;

    function setResponsiveHeights() {
        if (window.Chart) {
            Chart.defaults.devicePixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.6);
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
        if (!host.querySelector('.hcidx-root')) {
            host.innerHTML = `
            <div class="hcidx-root">
              <div class="hcidx-toolbar">
                <button id="hc-idx-clear-filters" class="btn-add">Limpar Filtros</button>
              </div>
              <div class="hcidx-grid">
                <div class="hcidx-card"><h3 class="hcidx-card-title">Idade (Auxiliar) — % por Turno</h3><canvas id="ind-idade-bar"></canvas></div>
                <div class="hcidx-card"><h3 class="hcidx-card-title">Gênero (Auxiliar) — % por Turno</h3><canvas id="ind-genero-bar"></canvas></div>
                <div class="hcidx-card"><h3 class="hcidx-card-title">DSR (Auxiliar) — % por Dia</h3><canvas id="ind-dsr-pie"></canvas></div>
                
                <div class="hcidx-card hcidx-card--full"><h3 class="hcidx-card-title">Contrato (Auxiliar) — % por Turno</h3><canvas id="ind-contrato-bar"></canvas></div>
                <div class="hcidx-card hcidx-card--full"><h3 class="hcidx-card-title">Contrato (Auxiliar) — % por SVC</h3><canvas id="ind-contrato-svc-bar"></canvas></div>
                <div class="hcidx-card hcidx-card--full"><h3 class="hcidx-card-title">Auxiliar Temporário — Tempo de Casa</h3><canvas id="ind-aux-30-60-90-svc-bar"></canvas></div>
                <div class="hcidx-card hcidx-card--full"><h3 class="hcidx-card-title">Cargos (Auxiliar vs Conferente) — % por SVC</h3><canvas id="ind-cargo-svc-bar"></canvas></div>
              </div>
              <div id="hcidx-busy" class="hcidx-loading" style="display:none;">Carregando…</div>
            </div>`;
        }
        ensureCanvasWrappers();
        document.getElementById('hc-idx-clear-filters').addEventListener('click', clearAllFilters);
        state.mounted = true;
        setResponsiveHeights();
        wireResizeObserver();
    }

    function ensureCanvasWrappers() {
        document.querySelectorAll('#hc-indice .hcidx-card').forEach(card => {
            const canvas = card.querySelector('canvas');
            if (!canvas) return;
            if (canvas.parentElement?.classList.contains('hcidx-canvas-wrap')) return;
            const wrap = document.createElement('div');
            wrap.className = 'hcidx-canvas-wrap';
            canvas.parentNode.insertBefore(wrap, canvas);
            wrap.appendChild(canvas);
        });
    }

    function resetState() {
        state.mounted = false;
        Object.keys(state.charts).forEach(key => {
            if (state.charts[key]) {
                state.charts[key].destroy();
                state.charts[key] = null;
            }
        });
        if (_resizeObs) {
            _resizeObs.disconnect();
            _resizeObs = null;
        }
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

    window.addEventListener('hc-filters-changed', (ev) => {
        const f = ev?.detail || {};
        if (typeof f.matriz === 'string') state.matriz = f.matriz;
        if (typeof f.svc === 'string') state.svc = f.svc;
        if (state.mounted) refresh();
    });

    function showBusy(f) {
        const el = document.getElementById('hcidx-busy');
        if (el) el.style.display = f ? 'flex' : 'none';
    }

    async function refresh() {
        if (!state.mounted || state.loading) return;
        state.loading = true;
        showBusy(true);
        try {
            await ensureChartLib();
            const matrizesPermitidas = getMatrizesPermitidas();
            let query = supabase.from('Colaboradores').select('*');
            if (matrizesPermitidas !== null) {
                query = query.in('MATRIZ', matrizesPermitidas);
            }
            const data = await fetchAllWithPagination(query);
            const rows = Array.isArray(data) ? data.slice() : [];
            rows.sort((a, b) => String(a?.Nome || '').localeCompare(String(b?.Nome || ''), 'pt-BR'));
            state.colabs = rows.filter(c => {
                if (norm(c?.Ativo || 'SIM') !== 'SIM') return false;
                if (state.matriz && c?.MATRIZ !== state.matriz) return false;
                if (state.svc && c?.SVC !== state.svc) return false;
                return true;
            });
            ensureChartsCreated();
            updateChartsNow();
        } catch (e) {
            console.error('Índice erro', e);
            alert('Falha ao carregar Índice. Veja o console.');
        } finally {
            state.loading = false;
            showBusy(false);
        }
    }

    function splitByTurno(colabs) {
        const t1 = colabs.filter(c => c.Escala === 'T1'),
            t2 = colabs.filter(c => c.Escala === 'T2'),
            t3 = colabs.filter(c => c.Escala === 'T3');
        return {labels: ['T1', 'T2', 'T3', 'GERAL'], groups: [t1, t2, t3, [...t1, ...t2, ...t3]]};
    }

    function setDynamicChartHeight(chart, labels) {
        if (!chart || !chart.canvas || chart.options.indexAxis !== 'y') return;
        const pixelsPerBar = 28;
        const headerAndLegendHeight = 80;
        const minHeight = 250;
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
        lbls.boxWidth = 10;
        lbls.boxHeight = 10;
        lbls.padding = 10;
        const size = Math.max(11, Math.min(13, Math.round((chart.canvas?.parentElement?.clientWidth || 600) / 72)));
        if (!lbls.font || typeof lbls.font !== 'object') {
            lbls.font = {size};
        } else {
            lbls.font.size = size;
        }
    }

    function baseOpts(canvas, onClick, axis = 'x') {
        const baseSize = Math.max(11, Math.min(14, Math.round((canvas?.parentElement?.clientWidth || 600) / 60)));
        const isHorizontal = axis === 'y';
        const valueScale = {
            stacked: true,
            grid: {display: false},
            ticks: {callback: v => `${v}%`, font: {size: baseSize}},
            min: 0,
            max: 100
        };
        const categoryScale = {stacked: true, grid: {display: false}, ticks: {maxRotation: 0, font: {size: baseSize}}};
        return {
            indexAxis: axis,
            layout: {padding: {top: 10, left: 8, right: 16, bottom: 8}},
            interaction: {mode: 'nearest', axis: isHorizontal ? 'y' : 'x', intersect: true},
            animation: {duration: 800, easing: 'easeOutQuart'},
            onClick: (e, elements, chart) => {
                if (elements.length > 0 && onClick) onClick(chart, elements[0]);
            },
            plugins: {
                legend: baseLegendConfig('bottom', true),
                datalabels: {
                    display: (ctx) => (ctx.dataset.data[ctx.dataIndex] || 0) > (isHorizontal ? 5 : 10),
                    clamp: true,
                    font: {size: baseSize, weight: 'bold'},
                    color: (ctx) => bestLabel(Array.isArray(ctx.dataset.backgroundColor) ? ctx.dataset.backgroundColor[ctx.dataIndex] : ctx.dataset.backgroundColor),
                    formatter: (value, ctx) => {
                        const percentage = Math.round(value);
                        if (percentage <= 1) return '';
                        return `${percentage}% (${ctx.dataset._rawCounts[ctx.dataIndex]})`;
                    },
                    anchor: 'center',
                    align: 'center'
                },
                tooltip: {
                    displayColors: false,
                    filter: (item) => (item.parsed?.y ?? item.parsed?.x) > 0,
                    callbacks: {
                        title: (items) => items?.[0]?.label ?? '',
                        label: (ctx) => `${ctx.dataset?.label ? `${ctx.dataset.label}: ` : ''}${Math.round(isHorizontal ? ctx.parsed?.x : ctx.parsed?.y ?? 0)}% (${ctx.dataset._rawCounts?.[ctx.dataIndex] ?? 0})`
                    }
                }
            },
            scales: {x: isHorizontal ? valueScale : categoryScale, y: isHorizontal ? categoryScale : valueScale},
            elements: {bar: {borderSkipped: false, borderRadius: 4}}
        };
    }

    function ensureChartsCreated() {
        if (state.charts.idade) return;
        const createStacked = (id, onClick, axis = 'x') => {
            const canvas = document.getElementById(id);
            const options = baseOpts(canvas, onClick, axis);
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
        };
        const createDSRPie = (id, onClick) => {
            const canvas = document.getElementById(id);
            const baseSize = Math.max(11, Math.min(14, Math.round((canvas?.parentElement?.clientWidth || 600) / 50)));
            const options = {
                layout: {padding: 6},
                animation: {duration: 800, easing: 'easeOutQuart'},
                onClick: (e, elements) => {
                    if (elements.length > 0) onClick(null, elements[0]);
                },
                plugins: {
                    legend: baseLegendConfig('bottom', true),
                    datalabels: {
                        display: true,
                        formatter: (v) => `${Math.round(+v)}%`,
                        color: (ctx) => bestLabel(Array.isArray(ctx.dataset.backgroundColor) ? ctx.dataset.backgroundColor[ctx.dataIndex] : ctx.dataset.backgroundColor),
                        font: {size: baseSize, weight: 'bold'},
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
            return chart;
        }

        state.charts.idade = createStacked('ind-idade-bar', (chart, element) => toggleFilter('idade', chart, element), 'y');

        if (state.charts.idade) {
            state.charts.idade.options.plugins.datalabels.formatter = (value, ctx) => {
                const percentage = Math.round(value);
                return percentage > 1 ? `${percentage}%` : '';
            };
        }

        state.charts.genero = createStacked('ind-genero-bar', (chart, element) => toggleFilter('genero', chart, element), 'x');
        state.charts.dsr = createDSRPie('ind-dsr-pie', (chart, element) => toggleFilter('dsr', null, element));
        state.charts.contrato = createStacked('ind-contrato-bar', (chart, element) => toggleFilter('contrato', chart, element), 'y');
        state.charts.contratoSvc = createStacked('ind-contrato-svc-bar', (chart, element) => toggleFilter('contratoSvc', chart, element), 'y');
        state.charts.cargoSvc = createStacked('ind-cargo-svc-bar', (chart, element) => toggleFilter('cargoSvc', chart, element), 'y');
        state.charts.auxPrazoSvc = createStacked('ind-aux-30-60-90-svc-bar', (chart, element) => toggleFilter('auxPrazoSvc', chart, element), 'y');
    }

    function toggleFilter(type, chart, element) {
        const set = state.interactive[type];
        if (!set) return;
        let label = (type === 'dsr') ? state.charts.dsr.data.labels[element.index] : chart.data.datasets[element.datasetIndex].label;
        if (set.has(label)) set.delete(label);
        else set.add(label);
        updateChartsNow();
    }

    function applyInteractiveFilter(colabs) {
        let out = [...colabs];
        if (state.interactive.idade.size > 0) out = out.filter(c => state.interactive.idade.has(ageBucket(calcAgeFromStr(getNascimento(c)))));
        if (state.interactive.genero.size > 0) out = out.filter(c => state.interactive.genero.has(mapGeneroLabel(c.Genero)));
        if (state.interactive.dsr.size > 0) out = out.filter(c => state.interactive.dsr.has(mapDSR(c.DSR)));
        if (state.interactive.cargoSvc.size > 0) out = out.filter(c => state.interactive.cargoSvc.has(mapCargoLabel(c.Cargo)));
        return out;
    }

    function clearAllFilters() {
        Object.values(state.interactive).forEach(set => set.clear());
        updateChartsNow();
    }

    function updateChartsNow() {
        const baseColabs = applyInteractiveFilter(state.colabs);
        const pal = palette();
        const createOpacity = (color, opacity) => color + Math.round(opacity * 255).toString(16).padStart(2, '0');

        const colabsAuxiliares = baseColabs.filter(c => norm(c?.Cargo) === 'AUXILIAR');

        {
            const {labels, groups} = splitByTurno(colabsAuxiliares);

            {
                const counts = groups.map(g => {
                    const m = new Map(AGE_BUCKETS.map(k => [k, 0]));
                    g.forEach(c => m.set(ageBucket(calcAgeFromStr(getNascimento(c))), (m.get(ageBucket(calcAgeFromStr(getNascimento(c)))) || 0) + 1));
                    return m;
                });
                const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
                const datasets = AGE_BUCKETS.map((b, i) => {
                    const raw = counts.map(m => m.get(b) || 0);
                    const data = raw.map((v, x) => (v * 100) / totals[x]);
                    const sel = state.interactive.idade;
                    const bg = sel.size === 0 || sel.has(b) ? pal[i % pal.length] : createOpacity(pal[i % pal.length], 0.2);
                    return {label: b, data, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
                });
                state.charts.idade.data.labels = labels;
                state.charts.idade.data.datasets = datasets;
                state.charts.idade.update('none');
            }
            {
                const cats = ['Masculino', 'Feminino', 'Outros', 'N/D'];
                const counts = groups.map(g => {
                    const m = new Map(cats.map(k => [k, 0]));
                    g.forEach(c => m.set(mapGeneroLabel(c?.Genero), (m.get(mapGeneroLabel(c?.Genero)) || 0) + 1));
                    return m;
                });
                const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
                const datasets = cats.map((cat, i) => {
                    const raw = counts.map(m => m.get(cat) || 0);
                    const data = raw.map((v, x) => (v * 100) / totals[x]);
                    let color = pal[i % pal.length];
                    if (cat === 'Masculino') color = css(root(), '--hcidx-gender-male', '#02B1EE');
                    if (cat === 'Feminino') color = css(root(), '--hcidx-gender-female', '#FF5C8A');
                    const sel = state.interactive.genero;
                    const bg = sel.size === 0 || sel.has(cat) ? color : createOpacity(color, 0.2);
                    return {label: cat, data, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
                });
                state.charts.genero.data.labels = labels;
                state.charts.genero.data.datasets = datasets;
                state.charts.genero.update('none');
            }
            {
                const m = new Map(DOW_LABELS.map(d => [d, 0]));
                colabsAuxiliares.forEach(c => {
                    const k = mapDSR(c?.DSR);
                    if (m.has(k)) m.set(k, (m.get(k) || 0) + 1);
                });
                const pairs = [...m.entries()];
                const total = pairs.reduce((a, [, v]) => a + v, 0) || 1;
                const lbls = pairs.map(p => p[0]);
                const counts = pairs.map(p => p[1]);
                const pct = counts.map(v => (v * 100) / total);
                const ch = state.charts.dsr;
                ch.data.labels = lbls;
                ch.data.datasets[0].data = pct;
                ch.data.datasets[0]._rawCounts = counts;
                const sel = state.interactive.dsr;
                ch.data.datasets[0].backgroundColor = lbls.map((lbl, i) => (sel.size === 0 || sel.has(lbl)) ? pal[i % pal.length] : createOpacity(pal[i % pal.length], 0.2));
                ch.update('none');
            }
        }
        {
            const {labels, groups} = splitByTurno(colabsAuxiliares);
            const cats = ['Efetivo', 'Potencial (>90d)', 'Temporário (≤90d)'];
            const colors = [css(root(), '--hcidx-p-2', '#003369'), css(root(), '--hcidx-p-success', '#28a745'), css(root(), '--hcidx-p-3', '#69D4FF')];

            const counts = groups.map(g => {
                const m = new Map(cats.map(k => [k, 0]));
                g.forEach(c => {
                    if (norm(c.Contrato).includes('KN')) {
                        m.set('Efetivo', m.get('Efetivo') + 1);
                    } else {
                        const dias = daysSinceAdmission(c);
                        if (dias != null && dias > 90) m.set('Potencial (>90d)', m.get('Potencial (>90d)') + 1);
                        else m.set('Temporário (≤90d)', m.get('Temporário (≤90d)') + 1);
                    }
                });
                return m;
            });
            const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
            const datasets = cats.map((cat, i) => ({
                label: cat,
                data: counts.map(m => (m.get(cat) * 100) / totals[counts.indexOf(m)]),
                backgroundColor: colors[i],
                _rawCounts: counts.map(m => m.get(cat)),
                borderWidth: 0
            }));
            const ch = state.charts.contrato;
            setDynamicChartHeight(ch, labels);
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update();
        }
        {
            const bySvc = new Map();
            colabsAuxiliares.forEach(c => {
                const k = String(c?.SVC || 'N/D');
                if (!bySvc.has(k)) bySvc.set(k, []);
                bySvc.get(k).push(c);
            });
            const rows = [...bySvc.entries()].map(([svc, arr]) => {
                const counts = {efetivo: 0, temp90: 0, potencial: 0};
                arr.forEach(c => {
                    if (norm(c.Contrato).includes('KN')) counts.efetivo++;
                    else {
                        (daysSinceAdmission(c) > 90) ? counts.potencial++ : counts.temp90++;
                    }
                });
                const total = arr.length || 1;
                return {
                    svc,
                    pctEfetivo: (counts.efetivo * 100) / total,
                    pctTemp90: (counts.temp90 * 100) / total,
                    pctPotencial: (counts.potencial * 100) / total,
                    rawEfetivo: counts.efetivo,
                    rawTemp90: counts.temp90,
                    rawPotencial: counts.potencial,
                    total
                };
            });

            rows.sort((a, b) => b.pctEfetivo - a.pctEfetivo || a.svc.localeCompare(b.svc));

            const totalG = colabsAuxiliares.length || 1;
            const countsG = colabsAuxiliares.reduce((acc, c) => {
                if (norm(c.Contrato).includes('KN')) acc.efetivo++;
                else (daysSinceAdmission(c) > 90) ? acc.potencial++ : acc.temp90++;
                return acc;
            }, {efetivo: 0, temp90: 0, potencial: 0});
            const lbls = rows.map(r => r.svc);
            const dsData = {
                efetivo: {pct: rows.map(r => r.pctEfetivo), raw: rows.map(r => r.rawEfetivo)},
                temp90: {pct: rows.map(r => r.pctTemp90), raw: rows.map(r => r.rawTemp90)},
                potencial: {pct: rows.map(r => r.pctPotencial), raw: rows.map(r => r.rawPotencial)}
            };
            lbls.push('GERAL');
            dsData.efetivo.pct.push((countsG.efetivo * 100) / totalG);
            dsData.efetivo.raw.push(countsG.efetivo);
            dsData.temp90.pct.push((countsG.temp90 * 100) / totalG);
            dsData.temp90.raw.push(countsG.temp90);
            dsData.potencial.pct.push((countsG.potencial * 100) / totalG);
            dsData.potencial.raw.push(countsG.potencial);

            const colors = [css(root(), '--hcidx-p-2', '#003369'), css(root(), '--hcidx-p-success', '#28a745'), css(root(), '--hcidx-p-3', '#69D4FF')];
            const ch = state.charts.contratoSvc;
            setDynamicChartHeight(ch, lbls);
            ch.data.labels = lbls;
            ch.data.datasets = [
                {
                    label: 'Efetivo',
                    data: dsData.efetivo.pct,
                    backgroundColor: colors[0],
                    _rawCounts: dsData.efetivo.raw,
                    borderWidth: 0
                },
                {
                    label: 'Potencial (>90d)',
                    data: dsData.potencial.pct,
                    backgroundColor: colors[1],
                    _rawCounts: dsData.potencial.raw,
                    borderWidth: 0
                },
                {
                    label: 'Temporário (≤90d)',
                    data: dsData.temp90.pct,
                    backgroundColor: colors[2],
                    _rawCounts: dsData.temp90.raw,
                    borderWidth: 0
                }
            ];
            ch.update();
        }
        {
            const relevantColabs = baseColabs.filter(c => ['AUXILIAR', 'CONFERENTE'].includes(norm(c?.Cargo)));
            const bySvc = new Map();
            relevantColabs.forEach(c => {
                const k = String(c?.SVC || 'N/D');
                if (!bySvc.has(k)) bySvc.set(k, []);
                bySvc.get(k).push(c);
            });
            const rows = [...bySvc.entries()].map(([svc, arr]) => {
                const total = arr.length || 1;
                const auxCount = arr.filter(c => norm(c?.Cargo) === 'AUXILIAR').length;
                return {
                    svc,
                    pctAux: (auxCount * 100) / total,
                    pctConf: ((total - auxCount) * 100) / total,
                    rawAux: auxCount,
                    rawConf: total - auxCount,
                    total
                };
            });
            rows.sort((a, b) => b.rawAux - a.rawAux || a.svc.localeCompare(b.svc));

            const totalG = relevantColabs.length || 1;
            const auxG = relevantColabs.filter(c => norm(c?.Cargo) === 'AUXILIAR').length;
            const lbls = rows.map(r => r.svc);
            const dsAux = {pct: rows.map(r => r.pctAux), raw: rows.map(r => r.rawAux)};
            const dsConf = {pct: rows.map(r => r.pctConf), raw: rows.map(r => r.rawConf)};
            lbls.push('GERAL');
            dsAux.pct.push((auxG * 100) / totalG);
            dsAux.raw.push(auxG);
            dsConf.pct.push(((totalG - auxG) * 100) / totalG);
            dsConf.raw.push(totalG - auxG);
            const sel = state.interactive.cargoSvc;
            const colors = [css(root(), '--hcidx-p-2', '#003369'), css(root(), '--hcidx-p-3', '#69D4FF')];
            const ch = state.charts.cargoSvc;
            setDynamicChartHeight(ch, lbls);
            ch.data.labels = lbls;
            ch.data.datasets = [
                {
                    label: 'Auxiliar',
                    data: dsAux.pct,
                    backgroundColor: sel.size === 0 || sel.has('Auxiliar') ? colors[0] : createOpacity(colors[0], 0.2),
                    _rawCounts: dsAux.raw,
                    borderWidth: 0
                },
                {
                    label: 'Conferente',
                    data: dsConf.pct,
                    backgroundColor: sel.size === 0 || sel.has('Conferente') ? colors[1] : createOpacity(colors[1], 0.2),
                    _rawCounts: dsConf.raw,
                    borderWidth: 0
                }
            ];
            ch.update();
        }
        {
            const colabsAuxNaoKN = baseColabs.filter(c => norm(c?.Cargo) === 'AUXILIAR' && !norm(c?.Contrato).includes('KN'));
            const bySvc = new Map();
            colabsAuxNaoKN.forEach(c => {
                const k = String(c?.SVC || 'N/D');
                if (!bySvc.has(k)) bySvc.set(k, []);
                bySvc.get(k).push(c);
            });
            const rows = [...bySvc.entries()].map(([svc, arr]) => {
                const counts = {b30: 0, b60: 0, b90: 0, bMais90: 0};
                arr.forEach(c => {
                    const d = daysSinceAdmission(c);
                    if (d == null) return;
                    if (d <= 30) counts.b30++; else if (d <= 60) counts.b60++; else if (d <= 90) counts.b90++; else counts.bMais90++;
                });
                const total = arr.length || 1;
                return {
                    svc,
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
            rows.sort((a, b) => b.total - a.total || a.svc.localeCompare(b.svc));
            const countsG = colabsAuxNaoKN.reduce((acc, c) => {
                const d = daysSinceAdmission(c);
                if (d != null) {
                    if (d <= 30) acc.g30++; else if (d <= 60) acc.g60++; else if (d <= 90) acc.g90++; else acc.gMais90++;
                }
                return acc;
            }, {g30: 0, g60: 0, g90: 0, gMais90: 0});
            const totalG = colabsAuxNaoKN.length || 1;
            const lbls = rows.map(r => r.svc);
            const ds = {
                '≤30d': {pct: rows.map(r => r.pct30), raw: rows.map(r => r.raw30)},
                '31–60d': {pct: rows.map(r => r.pct60), raw: rows.map(r => r.raw60)},
                '61–90d': {pct: rows.map(r => r.pct90), raw: rows.map(r => r.raw90)},
                '>90d': {pct: rows.map(r => r.pctMais90), raw: rows.map(r => r.rawMais90)}
            };
            lbls.push('GERAL');
            ds['≤30d'].pct.push((countsG.g30 * 100) / totalG);
            ds['≤30d'].raw.push(countsG.g30);
            ds['31–60d'].pct.push((countsG.g60 * 100) / totalG);
            ds['31–60d'].raw.push(countsG.g60);
            ds['61–90d'].pct.push((countsG.g90 * 100) / totalG);
            ds['61–90d'].raw.push(countsG.g90);
            ds['>90d'].pct.push((countsG.gMais90 * 100) / totalG);
            ds['>90d'].raw.push(countsG.gMais90);
            const colors = [css(root(), '--hcidx-p-2', '#003369'), css(root(), '--hcidx-p-3', '#69D4FF'), css(root(), '--hcidx-p-4', '#2677C7'), css(root(), '--hcidx-p-5', '#A9E7FF')];
            const ch = state.charts.auxPrazoSvc;
            setDynamicChartHeight(ch, lbls);
            ch.data.labels = lbls;
            ch.data.datasets = Object.keys(ds).map((key, i) => ({
                label: key,
                data: ds[key].pct,
                backgroundColor: colors[i],
                _rawCounts: ds[key].raw,
                borderWidth: 0
            }));
            ch.update();
        }
    }

    window.buildHCIndice = function () {
        const host = document.querySelector(HOST_SEL);
        if (!host) {
            console.warn('Host #hc-indice não encontrado.');
            return;
        }
        if (!state.mounted) {
            ensureMounted();
        }
        refresh();
    };
    window.buildHCIndice.resetState = resetState;

    window.destroyHCIndice = function () {
        if (state.mounted) {
            console.log('Destruindo estado do Índice.');
            Object.values(state.charts).forEach(chart => chart?.destroy());
            if (_resizeObs) {
                _resizeObs.disconnect();
                _resizeObs = null;
            }
            window.removeEventListener('resize', setResponsiveHeights);

            // CORREÇÃO: Limpa as referências aos gráficos destruídos
            state.charts = {
                idade: null,
                genero: null,
                dsr: null,
                contrato: null,
                contratoSvc: null,
                cargoSvc: null,
                auxPrazoSvc: null
            };

            state.mounted = false;
        }
    };
})();