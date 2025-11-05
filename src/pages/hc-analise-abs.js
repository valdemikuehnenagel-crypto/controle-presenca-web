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
            turno: null,
            faixaEtaria: null,
            top5: null
        },
        matriz: '',
        svc: '',
        regiao: '', // NOVO
        gerencia: '', // NOVO
        inicioISO: null,
        fimISO: null,
        absenteeismData: [],
        interactiveFilters: {week: null, gender: null, contract: null, dow: null, age: null, turno: null}
    };

    // =========================
    // Consts & helpers
    // =========================
    const norm = (v) => String(v ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const root = () => document.documentElement;
    const css = (el, name, fb) => (getComputedStyle(el).getPropertyValue(name).trim() || fb);

    const AGE_BUCKETS = ['<20', '20-29', '30-39', '40-49', '50-59', '60+', 'N/D'];
    const DOW_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
    const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    let _colabCache = null;

    // NOVO: Helper para buscar o mapeamento de Matrizes
    async function loadMatrizesMapping() {
        const matrizesPermitidas = getMatrizesPermitidas();
        let query = supabase.from('Matrizes').select('MATRIZ, GERENCIA, REGIAO');

        if (matrizesPermitidas !== null && matrizesPermitidas.length > 0) {
            query = query.in('MATRIZ', matrizesPermitidas);
        }
        // Não filtramos por matriz/svc globais aqui, pois queremos o mapa completo para o 'join'

        const {data, error} = await query;
        if (error) {
            console.error("AnaliseABS: Erro ao buscar 'Matrizes'", error);
            throw error;
        }

        const map = new Map();
        (data || []).forEach(item => {
            const matrizNorm = norm(item.MATRIZ);
            if (matrizNorm) {
                map.set(matrizNorm, {
                    gerencia: item.GERENCIA || '',
                    regiao: item.REGIAO || ''
                });
            }
        });
        return map;
    }

    function parseDateMaybe(s) {
        if (!s) return null;
        // Pega SÓ a parte YYYY-MM-DD da data
        const str = String(s).trim().substring(0, 10);
        const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(str);
        if (m) {
            // Cria a data como "meio-dia" local, que é seguro contra fuso horário
            return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
        }
        // Se não for formato YYYY-MM-DD, não tenta adivinhar
        return null;
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

    function mapTurnoLabel(raw) {
        const n = norm(raw);
        if (n === 'T1') return 'T1';
        if (n === 'T2') return 'T2';
        if (n === 'T3') return 'T3';
        return 'Outros';
    }

    function getWeekOfYear(d) {
        d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return `W${String(weekNo).padStart(2, '0')}`;
    }

    // MODIFICADO: Esta é a principal alteração.
    async function getColaboradoresCache() {
        if (_colabCache) return _colabCache;

        // NOVO: Carrega o mapa de matrizes primeiro
        const matrizesMap = await loadMatrizesMapping();

        const matrizesPermitidas = getMatrizesPermitidas();
        let q = supabase
            .from('Colaboradores')
            .select('Nome, Genero, Contrato, "Data de nascimento", "Escala", MATRIZ, SVC, Ativo')
            .eq('Ativo', 'SIM');

        if (matrizesPermitidas && matrizesPermitidas.length) q = q.in('MATRIZ', matrizesPermitidas);

        // Filtra no DB apenas o que é garantido
        if (state.matriz) q = q.eq('MATRIZ', state.matriz);
        if (state.svc) q = q.eq('SVC', state.svc);

        const colabsRaw = await fetchAllWithPagination(q);

        // NOVO: Enriquecer e filtrar em memória
        const colabsEnriched = (colabsRaw || []).map(c => {
            const mapping = matrizesMap.get(norm(c.MATRIZ));
            return {
                ...c,
                REGIAO: mapping?.regiao || '',
                GERENCIA: mapping?.gerencia || ''
            };
        });

        const colabsFiltered = colabsEnriched.filter(c => {
            if (state.regiao && norm(c.REGIAO) !== norm(state.regiao)) return false;
            if (state.gerencia && norm(c.GERENCIA) !== norm(state.gerencia)) return false;
            return true;
        });

        // NOVO: Cria o mapa a partir dos dados filtrados
        const map = new Map();
        colabsFiltered.forEach(c => map.set(norm(c.Nome), c));

        _colabCache = {list: colabsFiltered, map};
        return _colabCache;
    }

    function palette() {
        return ['#02B1EE', '#003369', '#69D4FF', '#2677C7', '#A9E7FF', '#225B9E', '#7FB8EB', '#99CCFF'];
    }

    function scheduleRefresh(invalidateCache = false) {
        if (invalidateCache) _colabCache = null;
        if (state.mounted) refresh();
    }

    function handleChartClick(chart, clickedIndex, filterType) {
        const clickedLabel = chart.data.labels[clickedIndex];
        let filterValue = clickedLabel;
        if (filterType === 'dow') filterValue = DOW_LABELS.indexOf(clickedLabel);
        state.interactiveFilters[filterType] =
            state.interactiveFilters[filterType] === filterValue ? null : filterValue;
        applyFiltersAndUpdate();
    }

    function applyFiltersAndUpdate() {
        const filteredData = state.absenteeismData.filter(d => {
            const date = parseDateMaybe(d.Data);
            if (!date) return false;
            if (state.interactiveFilters.week && getWeekOfYear(date) !== state.interactiveFilters.week) return false;
            if (state.interactiveFilters.gender && mapGeneroLabel(d.colaborador.Genero) !== state.interactiveFilters.gender) return false;
            if (state.interactiveFilters.contract && mapContratoAgg(d.colaborador.Contrato) !== state.interactiveFilters.contract) return false;
            if (state.interactiveFilters.turno && mapTurnoLabel(d.colaborador.Escala) !== state.interactiveFilters.turno) return false;
            if (state.interactiveFilters.age && ageBucket(calcAgeFromStr(getNascimento(d.colaborador))) !== state.interactiveFilters.age) return false;
            if (state.interactiveFilters.dow != null && date.getDay() !== state.interactiveFilters.dow) return false;
            return true;
        });
        updateChartsNow(filteredData);
    }

    // =========================
    // Período (mesmo padrão das outras abas)
    // =========================
    function clampEndToToday(startISO, endISO) {
        if (!startISO || !endISO) return [startISO, endISO];
        const today = new Date();
        const pad2 = (n) => String(n).padStart(2, '0');
        const todayISO = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
        return [startISO, endISO > todayISO ? todayISO : endISO];
    }

    function setupPeriodFilter(host) {
        const toolbar = host.querySelector('.abs-toolbar');
        if (!toolbar || toolbar.querySelector('#abs-period-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'abs-period-btn';
        btn.textContent = 'Selecionar Período';
        toolbar.appendChild(btn);

        btn.onclick = () => {
            const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const today = new Date();

            const curStart = state.inicioISO || toISO(new Date(today.getFullYear(), today.getMonth() - 2, 1));
            const curEnd = state.fimISO || toISO(today);

            const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
            const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const prevEnd = new Date(today.getFullYear(), today.getMonth(), 0);

            const overlay = document.createElement('div');
            overlay.id = 'cd-period-overlay';
            overlay.innerHTML = `
                  <div class="cdp-card">
                    <h3>Selecionar Período</h3>

                    <div class="cdp-shortcuts">
                      <button id="cdp-today"   class="btn-salvar">Hoje</button>
                      <button id="cdp-yday"    class="btn-salvar">Ontem</button>
                      <button id="cdp-prevmo"  class="btn-salvar">Mês anterior</button>
                    </div>

                    <div class="dates-grid">
                      <div><label>Início</label><input id="cdp-period-start" type="date" value="${curStart}"></div>
                      <div><label>Fim</label><input id="cdp-period-end"    type="date" value="${curEnd}"></div>
                    </div>

                    <div class="form-actions">
                      <button id="cdp-cancel" class="btn">Cancelar</button>
                      <button id="cdp-apply"  class="btn-add">Aplicar</button>
                    </div>
                  </div>`;

            // CSS compartilhado (instala uma vez)
            const cssId = 'cdp-style';
            if (!document.getElementById(cssId)) {
                const st = document.createElement('style');
                st.id = cssId;
                st.textContent = `
                  #cd-period-overlay, #cd-period-overlay * { box-sizing: border-box; }
                  #cd-period-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 9999; }
                  #cd-period-overlay .cdp-card { background: #fff; border-radius: 12px; padding: 16px; min-width: 480px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
                  #cd-period-overlay h3 { margin: 0 0 12px; text-align: center; color: #003369; }
                  #cd-period-overlay .cdp-shortcuts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 12px; }
                  #cd-period-overlay .dates-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
                  #cd-period-overlay .form-actions { display: flex; justify-content: flex-end; gap: 8px; }
                `;
                document.head.appendChild(st);
            }

            document.body.appendChild(overlay);

            const elStart = overlay.querySelector('#cdp-period-start');
            const elEnd = overlay.querySelector('#cdp-period-end');
            const btnCancel = overlay.querySelector('#cdp-cancel');
            const btnApply = overlay.querySelector('#cdp-apply');
            const close = () => overlay.remove();

            overlay.addEventListener('click', (ev) => {
                if (ev.target === overlay) close();
            });
            btnCancel.onclick = close;

            // atalhos
            overlay.querySelector('#cdp-today').onclick = () => {
                const iso = toISO(today);
                [state.inicioISO, state.fimISO] = [iso, iso];
                close();
                refresh();
            };
            overlay.querySelector('#cdp-yday').onclick = () => {
                const iso = toISO(yesterday);
                [state.inicioISO, state.fimISO] = [iso, iso];
                close();
                refresh();
            };
            overlay.querySelector('#cdp-prevmo').onclick = () => {
                const s = toISO(prevStart);
                const e = toISO(prevEnd);
                const [cs, ce] = clampEndToToday(s, e);
                state.inicioISO = cs;
                state.fimISO = ce;
                close();
                refresh();
            };

            // aplicar manual
            btnApply.onclick = () => {
                let sVal = (elStart?.value || '').slice(0, 10);
                let eVal = (elEnd?.value || '').slice(0, 10);
                if (!sVal || !eVal) {
                    alert('Selecione as duas datas.');
                    return;
                }
                [sVal, eVal] = clampEndToToday(sVal, eVal);
                state.inicioISO = sVal;
                state.fimISO = eVal;
                close();
                refresh();
            };
        };
    }

    // =========================
    // Mount / assets / events
    // =========================
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
                              <div class="hcabs-bar-item"><h3>Dia da Semana</h3><canvas id="abs-dow-doughnut"></canvas></div>
                              <div class="hcabs-doughnut-item"><h3>Gênero (%)</h3><canvas id="abs-genero-doughnut"></canvas></div>
                              <div class="hcabs-doughnut-item"><h3>Contrato (%)</h3><canvas id="abs-contrato-doughnut"></canvas></div>
                              <div class="hcabs-doughnut-item"><h3>Turno (%)</h3><canvas id="abs-turno-doughnut"></canvas></div>
                          </div>
                      </div>
                      <div class="hcabs-card"><h3>Faixa Etária</h3><canvas id="abs-idade-bar"></canvas></div>
                      <div class="hcabs-card">
                          <h3>Top 5 Ofensores</h3>
                          <canvas id="abs-top5-bar"></canvas>
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
        const nodes = document.querySelectorAll('#hc-analise-abs .hcabs-card, #hc-analise-abs .hcabs-doughnut-item, #hc-analise-abs .hcabs-bar-item');
        nodes.forEach(el => {
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
        } catch {
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

    // MODIFICADO: Ouve os 4 filtros
    window.addEventListener('hc-filters-changed', (ev) => {
        const f = ev?.detail || {};
        const mudouMatriz = (typeof f.matriz === 'string' && state.matriz !== f.matriz);
        const mudouSvc = (typeof f.svc === 'string' && state.svc !== f.svc);
        const mudouRegiao = (typeof f.regiao === 'string' && state.regiao !== f.regiao); // NOVO
        const mudouGerencia = (typeof f.gerencia === 'string' && state.gerencia !== f.gerencia); // NOVO

        if (mudouMatriz) state.matriz = f.matriz;
        if (mudouSvc) state.svc = f.svc;
        if (mudouRegiao) state.regiao = f.regiao; // NOVO
        if (mudouGerencia) state.gerencia = f.gerencia; // NOVO

        // NOVO: Checa os 4 filtros
        if (mudouMatriz || mudouSvc || mudouRegiao || mudouGerencia) {
            scheduleRefresh(true); // Invalida o _colabCache
        }
    });

    ['controle-diario-saved', 'cd-saved', 'cd-bulk-saved', 'hc-refresh'].forEach(evt =>
        window.addEventListener(evt, () => scheduleRefresh(false))
    );
    ['colaborador-added'].forEach(evt =>
        window.addEventListener(evt, () => scheduleRefresh(true))
    );

    function showBusy(f) {
        const el = document.getElementById('hcabs-busy');
        if (el) el.style.display = f ? 'flex' : 'none';
    }

    async function fetchAllWithPagination(queryBuilder) {
        let all = [], page = 0;
        const pageSize = 1000;
        while (true) {
            const {data, error} = await queryBuilder.range(page * pageSize, (page + 1) * pageSize - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            all = all.concat(data);
            page++;
        }
        return all;
    }

    async function refresh() {
        if (state.loading) return;
        state.loading = true;
        showBusy(true);
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

            // MODIFICADO: getColaboradoresCache() agora retorna a lista E o mapa
            // já filtrados por MATRIZ, SVC, REGIAO, e GERENCIA.
            const cache = await getColaboradoresCache();
            const colabs = cache.list;
            const colabMap = cache.map;

            if (!colabs || colabs.length === 0) {
                state.absenteeismData = [];
                ensureChartsCreated();
                applyFiltersAndUpdate();
                return;
            }

            // O RPC agora recebe uma lista de nomes JÁ FILTRADA.
            const allColabNames = colabs.map(c => c.Nome);
            let allDiarioData = [];
            const CHUNK_SIZE = 500; // Um tamanho seguro para a lista de nomes

            for (let i = 0; i < allColabNames.length; i += CHUNK_SIZE) {
                const nameChunk = allColabNames.slice(i, i + CHUNK_SIZE);

                const {data: diarioChunk, error: diarioError} = await supabase
                    .rpc('get_abs_para_analise', {
                        nomes: nameChunk, // Envia apenas um pedaço dos nomes
                        data_inicio: startDate,
                        data_fim: endDate
                    });

                if (diarioError) {
                    // Se um pedaço falhar, joga o erro
                    throw diarioError;
                }

                if (diarioChunk && diarioChunk.length > 0) {
                    allDiarioData = allDiarioData.concat(diarioChunk);
                }
            }

            const diario = allDiarioData;

            // O 'colabMap' que usamos aqui também já veio filtrado do cache,
            // então o 'join' (mapped) funciona perfeitamente.
            const mapped = (diario || []).map(record => ({
                ...record,
                colaborador: colabMap.get(norm(record.Nome)) || {}
            })).filter(d => d.colaborador && d.colaborador.Nome);

            const startDt = parseDateMaybe(startDate);
            const endDt = parseDateMaybe(endDate);

            if (!startDt || !endDt) {
                console.error("Datas de filtro inválidas", startDate, endDate);
                throw new Error("Datas de filtro inválidas.");
            }

            startDt.setHours(0, 0, 0, 0);
            endDt.setHours(23, 59, 59, 999);

            const inRange = (d) => {
                const dt = parseDateMaybe(d.Data); // Usa a nova parseDateMaybe
                return dt && dt >= startDt && dt <= endDt;
            };

            state.absenteeismData = mapped.filter(inRange);

            ensureChartsCreated();
            state.interactiveFilters = {week: null, gender: null, contract: null, dow: null, age: null, turno: null};
            applyFiltersAndUpdate();
        } catch (e) {
            console.error('Análise ABS erro', e);
            alert('Falha ao carregar Análise de Absenteísmo. Veja o console.');
        } finally {
            state.loading = false;
            showBusy(false);
        }
    }

    // =========================
    // Charts
    // =========================
    const animationConfig = {duration: 800, easing: 'easeOutQuart', delay: (ctx) => ctx.dataIndex * 25};

    const baseChartOpts = (onClick) => ({
        animation: animationConfig,
        onClick: (evt, elements, chart) => {
            if (elements.length > 0 && onClick) onClick(chart, elements[0].index);
        },
        onHover: (evt, elements) => {
            evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        },
    });

    const barLineOpts = (onClick) => ({
        ...baseChartOpts(onClick),
        layout: {padding: {top: 25, left: 8, right: 8, bottom: 8}},
        plugins: {
            legend: {display: false},
            datalabels: {
                clamp: false,
                display: 'auto',
                anchor: 'end',
                align: 'end',
                font: {weight: 'bold', size: 18},
                color: css(root(), '--hcidx-primary', '#003369'),
                formatter: v => Math.round(v)
            },
            tooltip: {displayColors: false, callbacks: {label: (ctx) => `Total: ${ctx.parsed.y || ctx.parsed.x}`}}
        },
        scales: {
            x: {grid: {display: false}},
            y: {beginAtZero: true, grid: {display: false}}
        }
    });

    const doughnutOpts = (onClick) => ({
        ...baseChartOpts(onClick),
        layout: {padding: 8},
        plugins: {
            legend: {display: true, position: 'bottom', labels: {boxWidth: 12, padding: 15}},
            datalabels: {
                display: (ctx) => (ctx.dataset.data[ctx.dataIndex] || 0) > 5,
                font: {weight: 'bold', size: 19},
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

    const top5BarOpts = () => {
        const opts = barLineOpts(() => {
        });
        opts.scales.x.ticks = {
            callback: function (value /*, index, ticks */) {
                const label = this.getLabelForValue(value);
                return label.length > 10 ? label.substring(0, 10) + '...' : label;
            }
        };
        opts.plugins.datalabels.align = 'end';
        opts.plugins.datalabels.anchor = 'end';
        opts.plugins.datalabels.formatter = v => v;
        return opts;
    };

    const dowHorizontalBarOpts = (onClick) => {
        const opts = baseChartOpts(onClick);
        opts.indexAxis = 'y';
        opts.layout = {padding: {top: 8, left: 8, right: 40, bottom: 8}};
        opts.plugins = {
            legend: {display: false},
            datalabels: {
                clamp: false,
                display: 'auto',
                anchor: 'end',
                align: 'end',
                font: {weight: 'bold', size: 16},
                color: css(root(), '--hcidx-primary', '#003369'),
                formatter: (value, context) => {
                    const rawCounts = context.chart.data.datasets[0]._rawCounts || [];
                    const total = rawCounts.reduce((a, b) => a + b, 0);
                    const percentage = total > 0 ? (value / total) * 100 : 0;
                    if (value === 0) return null;
                    return `${Math.round(percentage)}% (${value})`;
                }
            },
            tooltip: {
                displayColors: false,
                callbacks: {
                    label: (ctx) => {
                        const rawCounts = ctx.chart.data.datasets[0]._rawCounts || [];
                        const total = rawCounts.reduce((a, b) => a + b, 0);
                        const percentage = total > 0 ? (ctx.parsed.x / total) * 100 : 0;
                        return `${ctx.label}: ${ctx.parsed.x} ocorrências (${Math.round(percentage)}%)`;
                    }
                }
            }
        };
        opts.scales = {
            x: {beginAtZero: true, grid: {display: false}},
            y: {grid: {display: false}}
        };
        return opts;
    };

    // chave mensal robusta
    function monthKeyFromDate(dt) {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    }

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
            type: 'bar',
            options: dowHorizontalBarOpts((c, i) => handleChartClick(c, i, 'dow'))
        });

        state.charts.genero = new Chart(document.getElementById('abs-genero-doughnut').getContext('2d'), {
            type: 'doughnut',
            options: doughnutOpts((c, i) => handleChartClick(c, i, 'gender'))
        });

        state.charts.contrato = new Chart(document.getElementById('abs-contrato-doughnut').getContext('2d'), {
            type: 'doughnut',
            options: doughnutOpts((c, i) => handleChartClick(c, i, 'contract'))
        });

        state.charts.turno = new Chart(document.getElementById('abs-turno-doughnut').getContext('2d'), {
            type: 'doughnut',
            options: doughnutOpts((c, i) => handleChartClick(c, i, 'turno'))
        });

        state.charts.faixaEtaria = new Chart(document.getElementById('abs-idade-bar').getContext('2d'), {
            type: 'bar',
            options: barLineOpts((c, i) => handleChartClick(c, i, 'age'))
        });

        state.charts.top5 = new Chart(document.getElementById('abs-top5-bar').getContext('2d'), {
            type: 'bar',
            options: top5BarOpts()
        });
    }

    function updateChartsNow(dataToRender) {
        const pal = palette();
        const totalAbs = dataToRender.length || 1;
        const createOpacity = (color, opacity) => color + Math.round(opacity * 255).toString(16).padStart(2, '0');

        const getSafeMax = (dataValues, multiplier = 1.15) => {
            if (!dataValues || dataValues.length === 0) return 10;
            const maxData = Math.max(...dataValues);
            if (maxData === 0) return 10;
            return maxData * multiplier;
        };

        // Visão mensal
        {
            const counts = new Map();
            dataToRender.forEach(d => {
                const dt = parseDateMaybe(d.Data);
                if (!dt) return;
                const key = monthKeyFromDate(dt); // YYYY-MM
                counts.set(key, (counts.get(key) || 0) + 1);
            });
            const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            const dataValues = sorted.map(e => e[1]);
            const ch = state.charts.totalPorMes;
            const ctx = ch.ctx;
            const gradient = ctx.createLinearGradient(0, 0, 0, ch.height);
            gradient.addColorStop(0, createOpacity(pal[1], 0.4));
            gradient.addColorStop(1, createOpacity(pal[1], 0));
            ch.data = {
                labels: sorted.map(e => {
                    const [y, m] = String(e[0]).split('-');
                    return `${MONTH_LABELS[parseInt(m, 10) - 1]}/${y.slice(-2)}`;
                }),
                datasets: [{
                    data: dataValues,
                    fill: true,
                    borderColor: pal[1],
                    backgroundColor: gradient,
                    pointBackgroundColor: pal[1],
                    borderWidth: 2.5
                }]
            };
            ch.options.scales.y.max = getSafeMax(dataValues);
            ch.update();
        }

        // Visão semanal
        {
            const counts = new Map();
            dataToRender.forEach(d => {
                const dt = parseDateMaybe(d.Data);
                if (!dt) return;
                const key = getWeekOfYear(dt);
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
            ch.options.scales.y.max = getSafeMax(weekData);
            ch.update();
        }

        // Dia da semana (barra horizontal)
        {
            const counts = Array(7).fill(0);
            dataToRender.forEach(d => {
                const dt = parseDateMaybe(d.Data);
                if (!dt) return;
                counts[dt.getDay()]++;
            });
            const ch = state.charts.diaDaSemana;
            ch.data.labels = DOW_LABELS;
            ch.data.datasets = [{
                data: counts,
                backgroundColor: DOW_LABELS.map((l, i) => state.interactiveFilters.dow === i ? pal[0] : pal[1]),
                _rawCounts: counts
            }];
            ch.options.scales.x.max = getSafeMax(counts, 1.20);
            ch.update();
        }

        // Gênero (%)
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

        // Contrato (%)
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

        // Turno (%)
        {
            const counts = new Map();
            dataToRender.forEach(d => {
                const key = mapTurnoLabel(d.colaborador.Escala);
                counts.set(key, (counts.get(key) || 0) + 1);
            });
            const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
            const labels = sorted.map(e => e[0]);
            const rawCounts = sorted.map(e => e[1]);
            const colors = palette();
            const ch = state.charts.turno;
            ch.data.labels = labels;
            ch.data.datasets = [{
                data: rawCounts.map(c => (c * 100) / totalAbs),
                backgroundColor: labels.map((l, i) => state.interactiveFilters.turno === l ? pal[0] : colors[i % colors.length]),
                _rawCounts: rawCounts
            }];
            ch.update();
        }

        // Faixa etária
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
            ch.options.scales.y.max = getSafeMax(ageData);
            ch.update();
        }

        // Top 5 ofensores
        {
            const counts = new Map();
            dataToRender.forEach(d => {
                const nome = d.colaborador.Nome;
                counts.set(nome, (counts.get(nome) || 0) + 1);
            });
            const top5 = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
            const dataValues = top5.map(item => item[1]);
            const ch = state.charts.top5;
            ch.data.labels = top5.map(item => item[0]);
            ch.data.datasets = [{data: dataValues, backgroundColor: pal[1]}];
            ch.options.scales.y.max = getSafeMax(dataValues);
            ch.update();
        }
    }

    // =========================
    // Reset / API
    // =========================
    function resetState() {
        state.mounted = false;
        Object.keys(state.charts).forEach(k => {
            if (state.charts[k]) {
                state.charts[k].destroy();
                state.charts[k] = null;
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

    window.destroyHCAnaliseABS = function () {
        if (state.mounted) {
            try {
                console.log('Destruindo estado da Análise ABS.');
            } catch {
            }
            Object.values(state.charts).forEach(chart => {
                if (chart) chart.destroy();
            });
            state.mounted = false;
            state.charts = {
                totalPorWeek: null,
                totalPorMes: null,
                diaDaSemana: null,
                genero: null,
                contrato: null,
                turno: null,
                faixaEtaria: null,
                top5: null
            };
        }
    };
})();