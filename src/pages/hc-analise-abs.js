import {getMatrizesPermitidas} from '../session.js';
import {supabase} from '../supabaseClient.js';

(function () {
    const HOST_SEL = '#hc-analise-abs';

    const state = {
        mounted: false,
        loading: false,
        charts: {
            totalPorWeek: null,
            totalPorMes: null,
            diaDaSemana: null,
            genero: null,
            contrato: null,
            faixaEtaria: null
        },
        matriz: '',
        svc: '',
        inicioISO: null,
        fimISO: null,
        absenteeismData: [],
        interactiveFilters: {week: null, gender: null, contract: null, dow: null, age: null}
    };

    const norm = (v) => String(v ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const root = () => document.documentElement;
    const css = (el, name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;

    const AGE_BUCKETS = ['<20', '20-29', '30-39', '40-49', '50-59', '60+', 'N/D'];
    const DOW_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    function parseDateMaybe(s) {
        if (!s) return null;
        const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(String(s).trim());
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function calcAgeFromStr(s) {
        const d = parseDateMaybe(s);
        if (!d) return null;
        let a = new Date().getFullYear() - d.getFullYear();
        const m = new Date().getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && new Date().getDate() < d.getDate())) a--;
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
        return c?.['Data de Nascimento'] || c?.['Data de nascimento'] || c?.Nascimento || '';
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

    function getWeekOfYear(d) {
        d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return `W${String(weekNo).padStart(2, '0')}`;
    }

    function palette() {
        return ['#02B1EE', '#003369', '#69D4FF', '#2677C7', '#A9E7FF', '#225B9E', '#7FB8EB', '#99CCFF'];
    }

    function handleChartClick(chart, clickedIndex, filterType) {
        const clickedLabel = chart.data.labels[clickedIndex];
        let filterValue = clickedLabel;
        if (filterType === 'dow') filterValue = DOW_LABELS.indexOf(clickedLabel);
        state.interactiveFilters[filterType] = state.interactiveFilters[filterType] === filterValue ? null : filterValue;
        applyFiltersAndUpdate();
    }

    function applyFiltersAndUpdate() {
        const filteredData = state.absenteeismData.filter(d => {
            const date = parseDateMaybe(d.Data);
            if (!date) return false;
            if (state.interactiveFilters.week && getWeekOfYear(date) !== state.interactiveFilters.week) return false;
            if (state.interactiveFilters.gender && mapGeneroLabel(d.colaborador.Genero) !== state.interactiveFilters.gender) return false;
            if (state.interactiveFilters.contract && mapContratoAgg(d.colaborador.Contrato) !== state.interactiveFilters.contract) return false;
            if (state.interactiveFilters.age && ageBucket(calcAgeFromStr(getNascimento(d.colaborador))) !== state.interactiveFilters.age) return false;
            if (state.interactiveFilters.dow != null && date.getDay() !== state.interactiveFilters.dow) return false;
            return true;
        });
        updateChartsNow(filteredData);
    }

    /** NOVO Seletor de Período, adaptado do seu código */
    function setupPeriodFilter(host) {
        const toolbar = host.querySelector('.abs-toolbar');
        if (!toolbar || toolbar.querySelector('#abs-period-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'abs-period-btn';
        btn.textContent = 'Selecionar Período';
        toolbar.appendChild(btn);

        btn.onclick = () => {
            const toISO = d => d.toISOString().split('T')[0];
            const endDefault = new Date();
            const startDefault = new Date(endDefault.getFullYear(), endDefault.getMonth() - 2, 1);

            const curStart = state.inicioISO || toISO(startDefault);
            const curEnd = state.fimISO || toISO(endDefault);

            const overlay = document.createElement('div');
            overlay.id = 'abs-period-overlay';
            overlay.innerHTML = `<div>
                <h3>Selecionar Período</h3>
                <div class="dates-grid">
                  <div><label>Início</label><input id="abs-period-start" type="date" value="${curStart}"></div>
                  <div><label>Fim</label><input id="abs-period-end" type="date" value="${curEnd}"></div>
                </div>
                <div class="form-actions">
                  <button id="abs-period-cancel" class="btn">Cancelar</button>
                  <button id="abs-period-apply" class="btn-add">Aplicar</button>
                </div>
            </div>`;
            document.body.appendChild(overlay);

            const close = () => overlay.remove();
            overlay.addEventListener('click', e => {
                if (e.target === overlay) close();
            });
            overlay.querySelector('#abs-period-cancel').onclick = close;
            overlay.querySelector('#abs-period-apply').onclick = () => {
                const startVal = overlay.querySelector('#abs-period-start').value;
                const endVal = overlay.querySelector('#abs-period-end').value;
                if (!startVal || !endVal) return alert('Selecione as duas datas.');

                state.inicioISO = startVal;
                state.fimISO = endVal;
                refresh();
                close();
            };
        };
    }

    function ensureMounted() {
        if (state.mounted) return;
        const host = document.querySelector(HOST_SEL);
        if (!host.querySelector('.hcabs-root')) {
            host.innerHTML = `<div class="hcabs-root">
          <div class="abs-toolbar"></div>
          <div class="hcabs-grid">
            
            <div class="hcabs-card"><h3>Visão Mensal</h3><canvas id="abs-mes-line"></canvas></div>
            <div class="hcabs-card"><h3>Visão Semanal</h3><canvas id="abs-week-bar"></canvas></div>
            
            <div class="hcabs-card hcabs-card--full">
              <div class="hcabs-doughnut-container">
                <div class="hcabs-doughnut-item"><h3>Dia da Semana (%)</h3><canvas id="abs-dow-doughnut"></canvas></div>
                <div class="hcabs-doughnut-item"><h3>Gênero (%)</h3><canvas id="abs-genero-doughnut"></canvas></div>
                <div class="hcabs-doughnut-item"><h3>Contrato (%)</h3><canvas id="abs-contrato-doughnut"></canvas></div>
              </div>
            </div>
            <div class="hcabs-card"><h3>Faixa Etária</h3><canvas id="abs-idade-bar"></canvas></div>
            <div class="hcabs-card">
              <div class="hcabs-placeholder">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"></path></svg>
                <span>Em Construção</span>
              </div>
            </div>
          </div>
          <div id="hcabs-busy" class="hcabs-loading" style="display:none;">Carregando…</div>
        </div>`;
        }
        ensureCanvasWrappers();
        setupPeriodFilter(host);
        state.mounted = true;
    }

    function ensureCanvasWrappers() {
        const elementsWithCanvas = document.querySelectorAll('#hc-analise-abs .hcabs-card, #hc-analise-abs .hcabs-doughnut-item');
        elementsWithCanvas.forEach(el => {
            const canvas = el.querySelector('canvas');
            if (!canvas || (canvas.parentElement && canvas.parentElement.classList.contains('hcabs-canvas-wrap'))) return;
            const wrap = document.createElement('div');
            wrap.className = 'hcabs-canvas-wrap';
            canvas.parentNode.insertBefore(wrap, canvas);
            wrap.appendChild(canvas);
        });
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
        const el = document.getElementById('hcabs-busy');
        if (el) el.style.display = f ? 'flex' : 'none';
    }

    async function refresh() {
        if (state.loading) return;
        state.loading = true;
        showBusy(true);
        const fetchAllPaginated = async (queryBuilder) => {
            let all = [];
            let page = 0;
            const pageSize = 1000;
            let keep = true;
            while (keep) {
                const {data, error} = await queryBuilder.range(page * pageSize, (page + 1) * pageSize - 1);
                if (error) throw error;
                if (data) all = all.concat(data);
                if (!data || data.length < pageSize) keep = false;
                page++;
            }
            return all;
        };
        try {
            ensureMounted();
            await ensureChartLib();
            const toISO = d => d.toISOString().split('T')[0];
            let startDate, endDate;
            if (state.inicioISO && state.fimISO) {
                startDate = state.inicioISO;
                endDate = state.fimISO;
            } else {
                const end = new Date();
                const start = new Date(end.getFullYear(), end.getMonth() - 2, 1);
                startDate = toISO(start);
                endDate = toISO(end);
                state.inicioISO = startDate;
                state.fimISO = endDate;
            }
            const matrizesPermitidas = getMatrizesPermitidas();
            let colabQuery = supabase.from('Colaboradores').select('Nome, Genero, Contrato, "Data de nascimento"').eq('Ativo', 'SIM');
            if (matrizesPermitidas) colabQuery = colabQuery.in('MATRIZ', matrizesPermitidas);
            if (state.matriz) colabQuery = colabQuery.eq('MATRIZ', state.matriz);
            if (state.svc) colabQuery = colabQuery.eq('SVC', state.svc);
            const colabs = await fetchAllPaginated(colabQuery);
            if (!colabs || colabs.length === 0) {
                state.absenteeismData = [];
                ensureChartsCreated();
                applyFiltersAndUpdate();
                return;
            }
            const colabMap = new Map();
            colabs.forEach(c => colabMap.set(norm(c.Nome), c));
            let diarioQuery = supabase.from('ControleDiario').select('Nome, Data').in('Nome', colabs.map(c => c.Nome)).or('Falta.eq.1,Atestado.eq.1').gte('Data', startDate).lte('Data', endDate);
            const diario = await fetchAllPaginated(diarioQuery);
            state.absenteeismData = diario.map(record => ({
                ...record,
                colaborador: colabMap.get(norm(record.Nome)) || {}
            })).filter(d => d.colaborador && d.colaborador.Nome);
            ensureChartsCreated();
            state.interactiveFilters = {week: null, gender: null, contract: null, dow: null, age: null};
            applyFiltersAndUpdate();
        } catch (e) {
            console.error('Análise ABS erro', e);
            alert('Falha ao carregar Análise de Absenteísmo. Veja o console.');
        } finally {
            state.loading = false;
            showBusy(false);
        }
    }

    const animationConfig = {duration: 800, easing: 'easeOutQuart', delay: (ctx) => ctx.dataIndex * 25};
    const baseChartOpts = (onClick) => ({
        animation: animationConfig, onClick: (evt, elements, chart) => {
            if (elements.length > 0) onClick(chart, elements[0].index);
        }, onHover: (evt, elements) => {
            evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        },
    });
    const barLineOpts = (onClick) => ({
        ...baseChartOpts(onClick),
        layout: {padding: {top: 25, left: 8, right: 8, bottom: 8}},
        plugins: {
            legend: {display: false},
            datalabels: {
                clamp: true,
                display: 'auto',
                anchor: 'end',
                align: 'end',
                font: {weight: 'bold'},
                color: css(root(), '--hcidx-primary', '#003369'),
                formatter: v => Math.round(v)
            },
            tooltip: {displayColors: false, callbacks: {label: (ctx) => `Total: ${ctx.parsed.y}`}}
        },
        scales: {x: {grid: {display: false}}, y: {beginAtZero: true, grid: {display: false}}}
    });
    const doughnutOpts = (onClick) => ({
        ...baseChartOpts(onClick),
        layout: {padding: 8},
        plugins: {
            legend: {display: true, position: 'bottom', labels: {boxWidth: 12, padding: 15}},
            datalabels: {
                display: (ctx) => (ctx.dataset.data[ctx.dataIndex] || 0) > 5,
                font: {weight: 'bold'},
                color: '#fff',
                formatter: (v) => `${Math.round(v)}%`
            },
            tooltip: {
                displayColors: false,
                callbacks: {label: (ctx) => `${ctx.label}: ${Math.round(ctx.parsed)}% (${ctx.dataset._rawCounts[ctx.dataIndex]} ocorrências)`}
            }
        },
        cutout: '40%'
    });

    function ensureChartsCreated() {
        if (state.charts.totalPorMes) return;
        state.charts.totalPorMes = new Chart(document.getElementById('abs-mes-line').getContext('2d'), {
            type: 'line',
            options: {
                ...barLineOpts(() => {
                }), elements: {line: {tension: 0.2}}
            }
        });
        state.charts.totalPorWeek = new Chart(document.getElementById('abs-week-bar').getContext('2d'), {
            type: 'bar',
            options: barLineOpts((c, i) => handleChartClick(c, i, 'week'))
        });
        state.charts.diaDaSemana = new Chart(document.getElementById('abs-dow-doughnut').getContext('2d'), {
            type: 'doughnut',
            options: doughnutOpts((c, i) => handleChartClick(c, i, 'dow'))
        });
        state.charts.genero = new Chart(document.getElementById('abs-genero-doughnut').getContext('2d'), {
            type: 'doughnut',
            options: doughnutOpts((c, i) => handleChartClick(c, i, 'gender'))
        });
        state.charts.contrato = new Chart(document.getElementById('abs-contrato-doughnut').getContext('2d'), {
            type: 'doughnut',
            options: doughnutOpts((c, i) => handleChartClick(c, i, 'contract'))
        });
        state.charts.faixaEtaria = new Chart(document.getElementById('abs-idade-bar').getContext('2d'), {
            type: 'bar',
            options: barLineOpts((c, i) => handleChartClick(c, i, 'age'))
        });
    }

    function updateChartsNow(dataToRender) {
        const pal = palette();
        const totalAbs = dataToRender.length || 1;
        const createOpacity = (color, opacity) => color + Math.round(opacity * 255).toString(16).padStart(2, '0');

        {
            const counts = new Map();
            dataToRender.forEach(d => {
                const key = d.Data.substring(0, 7);
                counts.set(key, (counts.get(key) || 0) + 1);
            });
            const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            const ch = state.charts.totalPorMes;
            const ctx = ch.ctx;
            const gradient = ctx.createLinearGradient(0, 0, 0, ch.height);
            gradient.addColorStop(0, createOpacity(pal[1], 0.4));
            gradient.addColorStop(1, createOpacity(pal[1], 0));
            ch.data = {
                labels: sorted.map(e => {
                    const [y, m] = e[0].split('-');
                    return `${MONTH_LABELS[parseInt(m, 10) - 1]}/${y.slice(-2)}`;
                }),
                datasets: [{
                    data: sorted.map(e => e[1]),
                    fill: true,
                    borderColor: pal[1],
                    backgroundColor: gradient,
                    pointBackgroundColor: pal[1],
                    borderWidth: 2.5
                }]
            };
            ch.update();
        }
        {
            const counts = new Map();
            dataToRender.forEach(d => {
                const key = getWeekOfYear(parseDateMaybe(d.Data));
                counts.set(key, (counts.get(key) || 0) + 1);
            });
            const weekLabels = [...new Set(state.absenteeismData.map(d => getWeekOfYear(parseDateMaybe(d.Data))))].sort();
            const weekData = weekLabels.map(w => counts.get(w) || 0);
            const ch = state.charts.totalPorWeek;
            ch.data.labels = weekLabels;
            ch.data.datasets = [{
                data: weekData,
                backgroundColor: weekLabels.map(l => state.interactiveFilters.week === l ? pal[0] : pal[1])
            }];
            ch.update();
        }
        {
            const counts = Array(7).fill(0);
            dataToRender.forEach(d => counts[parseDateMaybe(d.Data).getDay()]++);
            const ch = state.charts.diaDaSemana;
            ch.data.labels = DOW_LABELS;
            ch.data.datasets = [{
                data: counts.map(c => (c * 100) / totalAbs),
                backgroundColor: DOW_LABELS.map((l, i) => state.interactiveFilters.dow === i ? pal[0] : pal[i % pal.length]),
                _rawCounts: counts
            }];
            ch.update();
        }
        {
            const counts = new Map();
            dataToRender.forEach(d => {
                const key = mapGeneroLabel(d.colaborador.Genero);
                counts.set(key, (counts.get(key) || 0) + 1);
            });
            const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
            const labels = sorted.map(e => e[0]);
            const rawCounts = sorted.map(e => e[1]);
            const colors = labels.map(l => {
                if (state.interactiveFilters.gender && state.interactiveFilters.gender !== l) return '#D3D3D3';
                if (l === 'Masculino') return '#02B1EE';
                if (l === 'Feminino') return '#FF5C8A';
                return '#BDBDBD';
            });
            const ch = state.charts.genero;
            ch.data.labels = labels;
            ch.data.datasets = [{
                data: rawCounts.map(c => (c * 100) / totalAbs),
                backgroundColor: colors,
                _rawCounts: rawCounts
            }];
            ch.update();
        }
        {
            const counts = new Map();
            dataToRender.forEach(d => {
                const key = mapContratoAgg(d.colaborador.Contrato);
                counts.set(key, (counts.get(key) || 0) + 1);
            });
            const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
            const labels = sorted.map(e => e[0]);
            const rawCounts = sorted.map(e => e[1]);
            const colors = [css(root(), '--hcidx-p-2', '#003369'), css(root(), '--hcidx-p-3', '#69D4FF')];
            const ch = state.charts.contrato;
            ch.data.labels = labels;
            ch.data.datasets = [{
                data: rawCounts.map(c => (c * 100) / totalAbs),
                backgroundColor: labels.map((l, i) => state.interactiveFilters.contract === l ? pal[0] : colors[i % colors.length]),
                _rawCounts: rawCounts
            }];
            ch.update();
        }
        {
            const counts = new Map(AGE_BUCKETS.map(k => [k, 0]));
            dataToRender.forEach(d => {
                const key = ageBucket(calcAgeFromStr(getNascimento(d.colaborador)));
                counts.set(key, (counts.get(key) || 0) + 1);
            });
            const labels = AGE_BUCKETS;
            const ageData = labels.map(age => counts.get(age) || 0);
            const ch = state.charts.faixaEtaria;
            ch.data.labels = labels;
            ch.data.datasets = [{
                data: ageData,
                backgroundColor: labels.map(l => state.interactiveFilters.age === l ? pal[0] : pal[5])
            }];
            ch.update();
        }
    }

    function resetState() {
        state.mounted = false;
        Object.keys(state.charts).forEach(key => {
            if (state.charts[key]) {
                state.charts[key].destroy();
                state.charts[key] = null;
            }
        });
    }

    window.buildHCAnaliseABS = function () {
        const host = document.querySelector(HOST_SEL);
        if (!host) return;
        if (!state.mounted) ensureMounted();
        refresh();
    };
    window.buildHCAnaliseABS.resetState = resetState;

    window.destroyHCAnaliseABS = function() {
        if (state.mounted) {
            console.log('Destruindo estado da Análise ABS.');
            Object.values(state.charts).forEach(chart => chart?.destroy());

            state.mounted = false;
            state.charts = {totalPorWeek: null, totalPorMes: null, diaDaSemana: null, genero: null, contrato: null, faixaEtaria: null};
        }
    };
})();