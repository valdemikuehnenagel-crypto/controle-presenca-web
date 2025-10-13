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
        charts: {idade: null, genero: null, dsr: null, contrato: null, contratoSvc: null, cargoSvc: null},
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

    function mapContratoAgg(raw) {
        return norm(raw).includes('KN') ? 'Efetivo' : 'Temporário';
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
        return [css(r, '--hcidx-p-1', '#02B1EE'), css(r, '--hcidx-p-2', '#003369'), css(r, '--hcidx-p-3', '#69D4FF'), css(r, '--hcidx-p-4', '#2677C7'), css(r, '--hcidx-p-5', '#A9E7FF'), css(r, '--hcidx-p-6', '#225B9E'), css(r, '--hcidx-p-7', '#7FB8EB'), css(r, '--hcidx-p-8', '#99CCFF'),];
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
                    <div class="hcidx-card"><h3 class="hcidx-card-title">Idade — % por turno</h3><canvas id="ind-idade-bar"></canvas></div>
                    <div class="hcidx-card"><h3 class="hcidx-card-title">Gênero — % por turno</h3><canvas id="ind-genero-bar"></canvas></div>
                    <div class="hcidx-card"><h3 class="hcidx-card-title">DSR — distribuição %</h3><canvas id="ind-dsr-pie"></canvas></div>
                    
                    <div class="hcidx-card hcidx-card--full"><h3 class="hcidx-card-title">Contrato — % por turno</h3><canvas id="ind-contrato-bar"></canvas></div>
                    <div class="hcidx-card hcidx-card--full"><h3 class="hcidx-card-title">Contrato — % por SVC</h3><canvas id="ind-contrato-svc-bar"></canvas></div>
                    <div class="hcidx-card hcidx-card--full"><h3 class="hcidx-card-title">Cargo — % por SVC</h3><canvas id="ind-cargo-svc-bar"></canvas></div>
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
            max: 100,
        };
        const categoryScale = {
            stacked: true,
            grid: {display: false},
            ticks: {maxRotation: 0, font: {size: baseSize}}
        };

        return {
            indexAxis: axis,
            layout: {padding: {top: 10, left: 8, right: 16, bottom: 8}},
            interaction: {
                mode: 'nearest',
                axis: isHorizontal ? 'y' : 'x',
                intersect: true,
            },
            animation: {duration: 800, easing: 'easeOutQuart'},
            onClick: (e, elements, chart) => {
                if (elements.length > 0 && onClick) onClick(chart, elements[0]);
            },
            plugins: {
                legend: baseLegendConfig('bottom', true),
                datalabels: {
                    display: (ctx) => {
                        const value = ctx.dataset.data[ctx.dataIndex] || 0;
                        return isHorizontal ? value > 5 : value > 10;
                    },
                    clamp: true,
                    font: {size: baseSize, weight: 'bold'},
                    color: (ctx) => {
                        const bg = Array.isArray(ctx.dataset.backgroundColor) ? ctx.dataset.backgroundColor[ctx.dataIndex % ctx.dataset.backgroundColor.length] : ctx.dataset.backgroundColor;
                        return bestLabel(bg);
                    },
                    formatter: (value, ctx) => {
                        const percentage = Math.round(value);
                        if (percentage <= 1) return '';
                        const rawCount = ctx.dataset._rawCounts[ctx.dataIndex];
                        return `${percentage}% (${rawCount})`;
                    },
                    anchor: 'center',
                    align: 'center'
                },
                tooltip: {
                    displayColors: false,
                    filter: (item) => (item.parsed?.y ?? item.parsed?.x) > 0,
                    callbacks: {
                        title: (items) => items?.[0]?.label ?? '',
                        label: (ctx) => {
                            const val = isHorizontal ? ctx.parsed?.x : ctx.parsed?.y;
                            const pct = Math.round(val ?? 0);
                            const cnt = (ctx.dataset._rawCounts?.[ctx.dataIndex] ?? 0);
                            const ds = ctx.dataset?.label ? `${ctx.dataset.label}: ` : '';
                            return `${ds}${pct}% (${cnt})`
                        }
                    }
                }
            },
            scales: {
                x: isHorizontal ? valueScale : categoryScale,
                y: isHorizontal ? categoryScale : valueScale,
            },
            elements: {bar: {borderSkipped: false, borderRadius: 4}}
        };
    }

    function ensureChartsCreated() {
        if (state.charts.idade) return;
        const createStacked = (id, onClick, axis = 'x') => {
            const canvas = document.getElementById(id);
            const options = baseOpts(canvas, onClick, axis);
            options.plugins.legend.onClick = (e, legendItem) => {
                if (onClick) onClick(null, {datasetIndex: legendItem.datasetIndex});
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
                        color: (ctx) => {
                            const bg = Array.isArray(ctx.dataset.backgroundColor) ? ctx.dataset.backgroundColor[ctx.dataIndex % ctx.dataset.backgroundColor.length] : ctx.dataset.backgroundColor;
                            return bestLabel(bg);
                        },
                        font: {size: baseSize, weight: 'bold'},
                        anchor: 'center',
                        align: 'center',
                        clamp: true
                    },
                    tooltip: {
                        displayColors: false,
                        callbacks: {
                            label: (ctx) => {
                                const pct = Math.round(ctx.parsed ?? 0);
                                const raw = (ctx.dataset._rawCounts || [])[ctx.dataIndex] ?? 0;
                                return `${ctx.label || ''}: ${pct}% (${raw})`
                            }
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
        };

        state.charts.idade = createStacked('ind-idade-bar', (chart, element) => toggleFilter('idade', chart, element));

        if (state.charts.idade) {
            const datalabelsOptions = state.charts.idade.options.plugins.datalabels;

            datalabelsOptions.display = (ctx) => {
                const value = ctx.dataset.data[ctx.dataIndex] || 0;
                return value >= 5;
            };

            datalabelsOptions.formatter = (value, ctx) => {
                const percentage = Math.round(value);
                const rawCount = ctx.dataset._rawCounts[ctx.dataIndex];

                if (percentage >= 20) {
                    return `${percentage}% (${rawCount})`;
                }
                return `${percentage}%`;
            };
        }

        state.charts.genero = createStacked('ind-genero-bar', (chart, element) => toggleFilter('genero', chart, element));
        state.charts.contrato = createStacked('ind-contrato-bar', (chart, element) => toggleFilter('contrato', chart, element), 'y');
        state.charts.contratoSvc = createStacked('ind-contrato-svc-bar', (chart, element) => toggleFilter('contratoSvc', chart, element), 'y');
        state.charts.cargoSvc = createStacked('ind-cargo-svc-bar', (chart, element) => toggleFilter('cargoSvc', chart, element), 'y');
        state.charts.dsr = createDSRPie('ind-dsr-pie', (chart, element) => toggleFilter('dsr', null, element));
    }

    function toggleFilter(type, chart, element) {
        const set = state.interactive[type];
        if (!set) return;
        let label;
        if (type === 'dsr') {
            label = state.charts.dsr.data.labels[element.index];
        } else {
            label = chart.data.datasets[element.datasetIndex].label;
        }
        if (set.has(label)) set.delete(label);
        else set.add(label);
        updateChartsNow();
    }

    function applyInteractiveFilter(colabs) {
        let out = [...colabs];
        if (state.interactive.idade.size > 0) out = out.filter(c => state.interactive.idade.has(ageBucket(calcAgeFromStr(getNascimento(c)))));
        if (state.interactive.genero.size > 0) out = out.filter(c => state.interactive.genero.has(mapGeneroLabel(c.Genero)));
        if (state.interactive.dsr.size > 0) out = out.filter(c => state.interactive.dsr.has(mapDSR(c.DSR)));
        if (state.interactive.contrato.size > 0) out = out.filter(c => state.interactive.contrato.has(mapContratoAgg(c.Contrato)));
        if (state.interactive.contratoSvc.size > 0) {
            const temp = [...out];
            const hasEfetivo = state.interactive.contratoSvc.has('Efetivo');
            const hasTemporario = state.interactive.contratoSvc.has('Temporário');
            if (hasEfetivo || hasTemporario) {
                out = temp.filter(c => {
                    const tipo = mapContratoAgg(c.Contrato);
                    if (hasEfetivo && tipo === 'Efetivo') return true;
                    if (hasTemporario && tipo === 'Temporário') return true;
                    return false;
                });
            }
        }
        if (state.interactive.cargoSvc.size > 0) {
            out = out.filter(c => state.interactive.cargoSvc.has(mapCargoLabel(c.Cargo)));
        }
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

        {
            const {labels, groups} = splitByTurno(baseColabs);
            {
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
                    const data = raw.map((v, x) => (v * 100) / totals[x]);
                    const sel = state.interactive.idade;
                    const bg = sel.size === 0 || sel.has(b) ? pal[i % pal.length] : createOpacity(pal[i % pal.length], 0.2);
                    return {label: b, data, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
                });
                const ch = state.charts.idade;
                ch.data.labels = labels;
                ch.data.datasets = datasets;
                ch.update('none');
            }
            {
                const cats = [...new Set(state.colabs.map(c => mapGeneroLabel(c?.Genero)))].sort((a, b) => {
                    const p = s => {
                        const n = norm(s);
                        if (n.startsWith('MASC')) return 0;
                        if (n.startsWith('FEM')) return 1;
                        if (n === 'N/D') return 3;
                        return 2;
                    };
                    return p(a) - p(b) || String(a).localeCompare(String(b));
                });
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
                    const data = raw.map((v, x) => (v * 100) / totals[x]);
                    let color = pal[i % pal.length];
                    const n = norm(cat);
                    if (n.startsWith('MASC')) color = css(root(), '--hcidx-gender-male', '#02B1EE');
                    if (n.startsWith('FEM')) color = css(root(), '--hcidx-gender-female', '#FF5C8A');
                    const sel = state.interactive.genero;
                    const bg = sel.size === 0 || sel.has(cat) ? color : createOpacity(color, 0.2);
                    return {label: cat, data, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
                });
                const ch = state.charts.genero;
                ch.data.labels = labels;
                ch.data.datasets = datasets;
                ch.update('none');
            }
        }
        {
            const m = new Map(DOW_LABELS.map(d => [d, 0]));
            baseColabs.forEach(c => {
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
            ch.data.datasets[0].backgroundColor = lbls.map((lbl, i) => {
                const b = pal[i % pal.length];
                return (sel.size === 0 || sel.has(lbl)) ? b : createOpacity(b, 0.2);
            });
            ch.update('none');
        }
        {
            // *** ALTERAÇÃO AQUI ***
            // 1. Filtra a lista de colaboradores para incluir apenas 'AUXILIAR'
            const colabsAuxiliares = baseColabs.filter(c => norm(c?.Cargo) === 'AUXILIAR');

            // 2. Usa a lista filtrada ('colabsAuxiliares') para dividir por turno
            const {labels, groups} = splitByTurno(colabsAuxiliares);

            const cats = ['Efetivo', 'Temporário'];
            const counts = groups.map(g => {
                const m = new Map(cats.map(k => [k, 0]));
                g.forEach(c => {
                    const k = mapContratoAgg(c?.Contrato);
                    m.set(k, (m.get(k) || 0) + 1);
                });
                return m;
            });
            const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
            const colors = [css(root(), '--hcidx-p-2', '#003369'), css(root(), '--hcidx-p-3', '#69D4FF')];
            const datasets = cats.map((cat, i) => {
                const raw = counts.map(m => m.get(cat) || 0);
                const data = raw.map((v, x) => (v * 100) / totals[x]);
                const sel = state.interactive.contrato;
                const bg = sel.size === 0 || sel.has(cat) ? colors[i] : createOpacity(colors[i], 0.2);
                return {label: cat, data, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
            });
            const ch = state.charts.contrato;
            setDynamicChartHeight(ch, labels);
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update();
        }
        {
            const bySvc = new Map();
            baseColabs.forEach(c => {
                const k = String(c?.SVC || 'N/D');
                if (!bySvc.has(k)) bySvc.set(k, []);
                bySvc.get(k).push(c);
            });
            const rows = [...bySvc.entries()].map(([svc, arr]) => {
                const total = arr.length || 1;
                let efet = 0;
                arr.forEach(c => (mapContratoAgg(c?.Contrato) === 'Efetivo') ? efet++ : 0);
                return {
                    svc,
                    pctEfetivo: (efet * 100) / total,
                    pctTemporario: ((total - efet) * 100) / total,
                    rawEfetivo: efet,
                    rawTemporario: total - efet,
                    total
                };
            });
            rows.sort((a, b) => b.total - a.total || a.svc.localeCompare(b.svc));
            const totalG = baseColabs.length || 1;
            const efetG = baseColabs.reduce((acc, c) => acc + (mapContratoAgg(c?.Contrato) === 'Efetivo' ? 1 : 0), 0);
            const lbls = rows.map(r => r.svc);
            const dsE = rows.map(r => r.pctEfetivo);
            const dsT = rows.map(r => r.pctTemporario);
            const rawE = rows.map(r => r.rawEfetivo);
            const rawT = rows.map(r => r.rawTemporario);
            lbls.push('GERAL');
            dsE.push((efetG * 100) / totalG);
            dsT.push(((totalG - efetG) * 100) / totalG);
            rawE.push(efetG);
            rawT.push(totalG - efetG);
            const colors = [css(root(), '--hcidx-p-2', '#003369'), css(root(), '--hcidx-p-3', '#69D4FF')];
            const sel = state.interactive.contratoSvc;
            const ch = state.charts.contratoSvc;

            setDynamicChartHeight(ch, lbls);

            ch.data.labels = lbls;
            ch.data.datasets = [{
                label: 'Efetivo',
                data: dsE,
                backgroundColor: sel.size === 0 || sel.has('Efetivo') ? colors[0] : createOpacity(colors[0], 0.2),
                _rawCounts: rawE,
                borderWidth: 0
            }, {
                label: 'Temporário',
                data: dsT,
                backgroundColor: sel.size === 0 || sel.has('Temporário') ? colors[1] : createOpacity(colors[1], 0.2),
                _rawCounts: rawT,
                borderWidth: 0
            }];
            ch.update();
        }
        {
            const bySvc = new Map();
            const relevantColabs = baseColabs.filter(c => ['AUXILIAR', 'CONFERENTE'].includes(norm(c?.Cargo)));

            relevantColabs.forEach(c => {
                const k = String(c?.SVC || 'N/D');
                if (!bySvc.has(k)) bySvc.set(k, []);
                bySvc.get(k).push(c);
            });

            const rows = [...bySvc.entries()].map(([svc, arr]) => {
                const total = arr.length || 1;
                let auxCount = 0;
                arr.forEach(c => (norm(c?.Cargo) === 'AUXILIAR') ? auxCount++ : 0);
                const confCount = total - auxCount;
                return {
                    svc,
                    pctAux: (auxCount * 100) / total,
                    pctConf: (confCount * 100) / total,
                    rawAux: auxCount,
                    rawConf: confCount,
                    total
                };
            });
            rows.sort((a, b) => b.total - a.total || a.svc.localeCompare(b.svc));

            const totalG = relevantColabs.length || 1;
            const auxG = relevantColabs.reduce((acc, c) => acc + (norm(c?.Cargo) === 'AUXILIAR' ? 1 : 0), 0);
            const confG = totalG - auxG;

            const lbls = rows.map(r => r.svc);
            const dsAux = rows.map(r => r.pctAux);
            const dsConf = rows.map(r => r.pctConf);
            const rawAux = rows.map(r => r.rawAux);
            const rawConf = rows.map(r => r.rawConf);

            lbls.push('GERAL');
            dsAux.push((auxG * 100) / totalG);
            dsConf.push((confG * 100) / totalG);
            rawAux.push(auxG);
            rawConf.push(confG);

            const colors = [css(root(), '--hcidx-p-2', '#003369'), css(root(), '--hcidx-p-3', '#69D4FF')];
            const sel = state.interactive.cargoSvc;
            const ch = state.charts.cargoSvc;

            setDynamicChartHeight(ch, lbls);

            ch.data.labels = lbls;
            ch.data.datasets = [{
                label: 'Auxiliar',
                data: dsAux,
                backgroundColor: sel.size === 0 || sel.has('Auxiliar') ? colors[0] : createOpacity(colors[0], 0.2),
                _rawCounts: rawAux,
                borderWidth: 0
            }, {
                label: 'Conferente',
                data: dsConf,
                backgroundColor: sel.size === 0 || sel.has('Conferente') ? colors[1] : createOpacity(colors[1], 0.2),
                _rawCounts: rawConf,
                borderWidth: 0
            }];
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

            state.mounted = false;
            state.charts = {idade: null, genero: null, dsr: null, contrato: null, contratoSvc: null, cargoSvc: null};
        }
    };
})();