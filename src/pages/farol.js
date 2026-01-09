import * as Efetividade from './efetividade.js';
import * as DadosOp from './dados-operacionais.js';
import {supabase} from '../supabaseClient.js';

let chartPreenchimento = null;
let chartDadosOp = null;
let chartEntrevistas = null;
let chartEntrevistasPerc = null;

const farolState = {
    filters: {
        matriz: '',
        gerencia: '',
        start: '',
        end: ''
    },
    allMatrizes: [],
    allGerentes: [],
    activeTab: 'preenchimento'
};

function _ymdLocal(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function initDefaultPeriod() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    farolState.filters.start = _ymdLocal(firstDay);
    farolState.filters.end = _ymdLocal(yesterday < firstDay ? today : yesterday);
}

function updateAllFilterElements() {
    const selectsMatriz = [
        document.getElementById('efet-matriz-filter'),
        document.getElementById('dados-op-matriz-filter'),
        document.getElementById('farol-filter-matriz'),
        document.getElementById('entrevista-filter-matriz')
    ];
    const selectsGerente = [
        document.getElementById('efet-gerente-filter'),
        document.getElementById('dados-op-gerente-filter'),
        document.getElementById('farol-filter-gerencia'),
        document.getElementById('entrevista-filter-gerencia')
    ];

    selectsMatriz.forEach(el => {
        if (el) el.value = farolState.filters.matriz;
    });

    selectsGerente.forEach(el => {
        if (el) el.value = farolState.filters.gerencia;
    });
}

function handleFilterChange(type, value) {
    if (type === 'matriz') farolState.filters.matriz = value;
    if (type === 'gerencia') farolState.filters.gerencia = value;

    updateAllFilterElements();
    refreshCurrentView();
}

function handlePeriodChange(start, end) {
    farolState.filters.start = start;
    farolState.filters.end = end;
    refreshCurrentView();
}

function clearAllFilters() {
    farolState.filters.matriz = '';
    farolState.filters.gerencia = '';
    updateAllFilterElements();
    refreshCurrentView();
}

function refreshCurrentView() {
    if (farolState.activeTab === 'farol') {
        renderFarolCharts();
    } else if (farolState.activeTab === 'entrevistas') {
        renderEntrevistaCharts();
    } else if (farolState.activeTab === 'preenchimento') {

        const matrizSelect = document.getElementById('efet-matriz-filter');
        if (matrizSelect) matrizSelect.dispatchEvent(new Event('change'));
    } else if (farolState.activeTab === 'dados-op') {

        const matrizSelect = document.getElementById('dados-op-matriz-filter');
        if (matrizSelect) matrizSelect.dispatchEvent(new Event('change'));
    }
}

async function fetchFiltersFarol() {
    if (farolState.allMatrizes.length > 0) return;
    try {
        const [colabReq, matrizReq] = await Promise.all([
            supabase.from('Colaboradores').select('MATRIZ'),
            supabase.from('Matrizes').select('MATRIZ, GERENCIA')
        ]);

        if (colabReq.error) throw colabReq.error;
        if (matrizReq.error) throw matrizReq.error;

        const matrizes = new Set();
        const gerentes = new Set();


        matrizReq.data.forEach(item => {
            if (item.MATRIZ) matrizes.add(item.MATRIZ);
            if (item.GERENCIA) gerentes.add(item.GERENCIA);
        });


        colabReq.data.forEach(c => {
            if (c.MATRIZ) matrizes.add(c.MATRIZ);
        });

        farolState.allMatrizes = [...matrizes].sort();
        farolState.allGerentes = [...gerentes].sort();

        const allMatrizSelects = document.querySelectorAll('#efet-matriz-filter, #dados-op-matriz-filter, #farol-filter-matriz, #entrevista-filter-matriz');
        const allGerenteSelects = document.querySelectorAll('#efet-gerente-filter, #dados-op-gerente-filter, #farol-filter-gerencia, #entrevista-filter-gerencia');

        allMatrizSelects.forEach(sel => {
            sel.innerHTML = '<option value="">Matriz</option>';
            farolState.allMatrizes.forEach(m => sel.insertAdjacentHTML('beforeend', `<option value="${m}">${m}</option>`));
            sel.value = farolState.filters.matriz;

            sel.onchange = (e) => {
                if (!e.isTrusted) return;
                handleFilterChange('matriz', e.target.value);
            };
        });

        allGerenteSelects.forEach(sel => {
            sel.innerHTML = '<option value="">Gerência</option>';
            farolState.allGerentes.forEach(g => sel.insertAdjacentHTML('beforeend', `<option value="${g}">${g}</option>`));
            sel.value = farolState.filters.gerencia;

            sel.onchange = (e) => {
                if (!e.isTrusted) return;
                handleFilterChange('gerencia', e.target.value);
            };
        });

    } catch (e) {
        console.error("Erro loading filters farol:", e);
    }
}

function openFarolPeriodModal() {
    const startVal = farolState.filters.start;
    const endVal = farolState.filters.end;
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[999]';

    overlay.innerHTML = `
    <div style="background:#fff; border-radius:12px; padding:20px; box-shadow:0 12px 28px rgba(0,0,0,0.25); width:100%; max-width:400px; display:flex; flex-direction:column;">
      <h3 style="font-weight:800;color:#003369;margin:0 0 15px; font-size: 1.1rem;">Selecionar Período</h3>
      
      <div style="display:flex; gap:8px; margin-bottom:15px; flex-wrap:wrap;">
        <button type="button" data-action="ontem" style="padding:6px 12px; border-radius:6px; border:1px solid #ddd; background:#f9f9f9; font-size:12px; font-weight:600; cursor:pointer; color:#555;">Ontem</button>
        <button type="button" data-action="mes_atual" style="padding:6px 12px; border-radius:6px; border:1px solid #ddd; background:#f9f9f9; font-size:12px; font-weight:600; cursor:pointer; color:#555;">Mês Atual</button>
        <button type="button" data-action="mes_anterior" style="padding:6px 12px; border-radius:6px; border:1px solid #ddd; background:#f9f9f9; font-size:12px; font-weight:600; cursor:pointer; color:#555;">Mês Anterior</button>
      </div>

      <div class="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label class="block text-xs font-bold text-gray-600 mb-1">Início</label>
          <input type="date" id="farol-start" class="w-full border rounded p-2 text-sm" value="${startVal}">
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-600 mb-1">Fim</label>
          <input type="date" id="farol-end" class="w-full border rounded p-2 text-sm" value="${endVal}">
        </div>
      </div>

      <div class="flex justify-end gap-2" style="margin-top:auto; padding-top:10px; border-top:1px solid #eee;">
        <button id="btn-cancel" class="px-4 py-2 rounded bg-gray-100 text-gray-700 font-bold text-xs hover:bg-gray-200 transition-colors">Cancelar</button>
        <button id="btn-apply" class="px-4 py-2 rounded bg-[#003369] text-white font-bold text-xs hover:bg-[#02B1EE] transition-colors">Aplicar</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    const startInput = overlay.querySelector('#farol-start');
    const endInput = overlay.querySelector('#farol-end');

    overlay.onclick = (e) => {
        const action = e.target.getAttribute('data-action');
        const id = e.target.id;

        if (e.target === overlay || id === 'btn-cancel') {
            overlay.remove();
        } else if (id === 'btn-apply') {
            if (startInput.value && endInput.value) {
                handlePeriodChange(startInput.value, endInput.value);
                overlay.remove();
            } else {
                alert("Selecione ambas as datas.");
            }
        } else if (action === 'ontem') {
            const today = new Date();
            const ontem = new Date(today);
            ontem.setDate(today.getDate() - 1);
            startInput.value = _ymdLocal(ontem);
            endInput.value = _ymdLocal(ontem);
        } else if (action === 'mes_atual') {
            const today = new Date();
            const first = new Date(today.getFullYear(), today.getMonth(), 1);
            startInput.value = _ymdLocal(first);
            endInput.value = _ymdLocal(today);
        } else if (action === 'mes_anterior') {
            const today = new Date();
            const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const last = new Date(today.getFullYear(), today.getMonth(), 0);
            startInput.value = _ymdLocal(first);
            endInput.value = _ymdLocal(last);
        }
    };
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
    Chart.defaults.font.family = "'Poppins', sans-serif";
}

function loadJs(src) {
    return new Promise((res, rej) => {
        if (document.querySelector(`script[src="${src}"]`)) return res();
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
    });
}

export async function init() {
    console.log("Inicializando Farol Unificado...");
    initDefaultPeriod();

    const btnPreenchimento = document.getElementById('nav-btn-preenchimento');
    const btnDadosOp = document.getElementById('nav-btn-dados-op');
    const btnFarol = document.getElementById('nav-btn-farol');
    const btnEntrevistas = document.getElementById('nav-btn-entrevistas');

    const viewPreenchimento = document.getElementById('view-preenchimento');
    const viewDadosOp = document.getElementById('view-dados-op');
    const viewFarol = document.getElementById('view-farol');
    const viewEntrevistas = document.getElementById('view-entrevistas');


    const periodBtns = document.querySelectorAll('#dados-op-period-btn, #farol-period-btn, #entrevista-period-btn');
    periodBtns.forEach(btn => btn.onclick = () => openFarolPeriodModal());


    const clearBtn = document.getElementById('dados-op-clear-filters');
    if (clearBtn) clearBtn.onclick = clearAllFilters;

    const efetClearBtn = document.getElementById('efet-clear-filters');
    if (efetClearBtn) {
        const newBtn = efetClearBtn.cloneNode(true);
        efetClearBtn.parentNode.replaceChild(newBtn, efetClearBtn);

        newBtn.addEventListener('click', () => {
            farolState.filters.matriz = '';
            farolState.filters.gerencia = '';
            updateAllFilterElements();
        });




        newBtn.addEventListener('click', () => {
            const matrizSelect = document.getElementById('efet-matriz-filter');
            if (matrizSelect) {
                matrizSelect.value = '';
                matrizSelect.dispatchEvent(new Event('change'));
            }
            const gerenteSelect = document.getElementById('efet-gerente-filter');
            if (gerenteSelect) {
                gerenteSelect.value = '';
                gerenteSelect.dispatchEvent(new Event('change'));
            }
        });
    }

    await fetchFiltersFarol();

    function switchTab(tab) {
        farolState.activeTab = tab;
        [btnPreenchimento, btnDadosOp, btnFarol, btnEntrevistas].forEach(b => b?.classList.remove('active'));
        [viewPreenchimento, viewDadosOp, viewFarol, viewEntrevistas].forEach(v => v?.classList.remove('active'));

        if (tab === 'preenchimento') {
            if (btnPreenchimento) btnPreenchimento.classList.add('active');
            if (viewPreenchimento) viewPreenchimento.classList.add('active');
            refreshCurrentView();
        } else if (tab === 'dados-op') {
            if (btnDadosOp) btnDadosOp.classList.add('active');
            if (viewDadosOp) viewDadosOp.classList.add('active');
            requestAnimationFrame(async () => {
                window.dispatchEvent(new Event('resize'));
                if (DadosOp && typeof DadosOp.init === 'function') {
                    try {
                        const res = DadosOp.init();
                        if (res instanceof Promise) await res;
                    } catch (err) {
                        console.warn(err);
                    }
                }
            });
        } else if (tab === 'farol') {
            if (btnFarol) btnFarol.classList.add('active');
            if (viewFarol) viewFarol.classList.add('active');
            renderFarolCharts();
        } else if (tab === 'entrevistas') {
            if (btnEntrevistas) btnEntrevistas.classList.add('active');
            if (viewEntrevistas) viewEntrevistas.classList.add('active');
            renderEntrevistaCharts();
        }
    }

    if (btnPreenchimento) btnPreenchimento.onclick = () => switchTab('preenchimento');
    if (btnDadosOp) btnDadosOp.onclick = () => switchTab('dados-op');
    if (btnFarol) btnFarol.onclick = () => switchTab('farol');
    if (btnEntrevistas) btnEntrevistas.onclick = () => switchTab('entrevistas');

    try {
        if (Efetividade && typeof Efetividade.init === 'function') await Efetividade.init();
    } catch (e) {
        console.error("Erro init Farol:", e);
    }
}


const barOptions = () => ({
    indexAxis: 'y',
    layout: {
        padding: {top: 20, left: 10, right: 50, bottom: 10}
    },
    animation: {duration: 800, easing: 'easeOutQuart'},
    plugins: {
        legend: {display: false},
        datalabels: {
            anchor: 'end', align: 'end', offset: 4,
            color: '#003369',
            font: {weight: 'bold', size: 12},
            formatter: (v) => {
                if (typeof v === 'number') {
                    return v.toFixed(2).replace('.', ',') + '%';
                }
                return v + '%';
            }
        },
        tooltip: {
            backgroundColor: 'rgba(0, 51, 105, 0.9)', titleFont: {size: 13}, bodyFont: {size: 13}, padding: 10,
            callbacks: {
                label: (ctx) => `${ctx.label}: ${ctx.raw.toFixed(2).replace('.', ',')}%`
            }
        }
    },
    scales: {
        x: {
            min: 0, max: 105, grid: {display: false}, ticks: {display: false}
        },
        y: {
            grid: {display: false},
            ticks: {font: {size: 11, weight: '600', family: "'Poppins', sans-serif"}, color: '#333', autoSkip: false}
        }
    }, elements: {bar: {borderRadius: 4, borderSkipped: false}}
});

function renderBarChart(canvasId, data, chartInstance, setChartInstance) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    const backgroundColors = data.values.map(v => {
        if (v >= 99.99) return '#22B14C';
        if (v >= 80) return '#003369';
        return '#e55353';
    });
    if (chartInstance) {
        chartInstance.data.labels = data.labels;
        chartInstance.data.datasets[0].data = data.values;
        chartInstance.data.datasets[0].backgroundColor = backgroundColors;
        chartInstance.update('none');
        return;
    }
    const newChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [{
                data: data.values,
                backgroundColor: backgroundColors,
                barPercentage: 0.8,
                categoryPercentage: 0.8
            }]
        },
        options: barOptions(),
        plugins: [ChartDataLabels]
    });
    setChartInstance(newChart);
}

async function renderFarolCharts() {
    await ensureChartLib();
    const filters = farolState.filters;
    try {
        const data1 = await Efetividade.getRankingData(filters);
        renderBarChart('chart-preenchimento', data1, chartPreenchimento, (c) => chartPreenchimento = c);
    } catch (e) {
        console.error("Erro ranking preenchimento:", e);
    }
    try {
        if (DadosOp && typeof DadosOp.getRankingData === 'function') {
            const filtersQualidade = {
                matriz: filters.matriz,
                gerencia: filters.gerencia,
                start: null,
                end: null
            };
            const data2 = await DadosOp.getRankingData(filtersQualidade);
            renderBarChart('chart-dados-op', data2, chartDadosOp, (c) => chartDadosOp = c);
        }
    } catch (e) {
        console.warn("Erro ranking dados op:", e);
    }
}

async function renderEntrevistaCharts() {
    const loader = document.getElementById('entrevista-loader');
    if (loader) loader.style.display = 'flex';
    await ensureChartLib();
    const filters = farolState.filters;
    const chartIds = ['chart-entrevista-detalhado', 'chart-entrevista-percentual'];

    chartIds.forEach(id => {
        const canvas = document.getElementById(id);
        if (canvas) {
            const wrapper = canvas.closest('.table-container-wrapper');
            if (wrapper) {
                wrapper.style.background = 'transparent';
                wrapper.style.boxShadow = 'none';
                wrapper.style.border = 'none';
            }
            const card = canvas.closest('.hcidx-card');
            if (card) {
                card.style.background = '#fff';
            }
        }
    });

    try {
        const dataList = await Efetividade.getInterviewData(filters);


        const ctxPendentes = document.getElementById('chart-entrevista-detalhado')?.getContext('2d');
        if (ctxPendentes) {
            const sortedByPending = dataList
                .filter(d => d.pending > 0)
                .sort((a, b) => b.pending - a.pending);
            const labelsP = sortedByPending.map(d => d.label);
            const dataP = sortedByPending.map(d => d.pending);

            if (chartEntrevistas) chartEntrevistas.destroy();

            chartEntrevistas = new Chart(ctxPendentes, {
                type: 'bar',
                data: {
                    labels: labelsP,
                    datasets: [{
                        label: 'Entrevistas Pendentes',
                        data: dataP,
                        backgroundColor: '#003369',
                        barPercentage: 0.8,
                        borderRadius: 4,
                        clip: false
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,

                    layout: {
                        padding: {right: 50, left: 10, top: 10, bottom: 10}
                    },
                    plugins: {
                        legend: {display: false},
                        datalabels: {
                            anchor: 'end', align: 'end',
                            color: '#003369', font: {weight: 'bold', size: 12},
                            formatter: (v) => v > 0 ? v : '',
                            clip: false
                        }
                    },
                    scales: {
                        x: {display: false, beginAtZero: true},
                        y: {grid: {display: false}, ticks: {font: {size: 11, weight: '600'}, color: '#333'}}
                    }
                },
                plugins: [ChartDataLabels]
            });
        }


        const ctxPercent = document.getElementById('chart-entrevista-percentual')?.getContext('2d');
        if (ctxPercent) {
            const sortedByPercent = [...dataList]
                .sort((a, b) => b.percent - a.percent);
            const labelsPer = sortedByPercent.map(d => d.label);
            const dataPer = sortedByPercent.map(d => d.percent);

            if (chartEntrevistasPerc) chartEntrevistasPerc.destroy();

            chartEntrevistasPerc = new Chart(ctxPercent, {
                type: 'bar',
                data: {
                    labels: labelsPer,
                    datasets: [{
                        label: '% Realizado',
                        data: dataPer,
                        backgroundColor: dataPer.map(v => v >= 99.99 ? '#22B14C' : (v >= 80 ? '#003369' : '#e55353')),
                        barPercentage: 0.8,
                        borderRadius: 4,
                        clip: false
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,

                    layout: {
                        padding: {right: 50, left: 10, top: 10, bottom: 10}
                    },
                    plugins: {
                        legend: {display: false},
                        datalabels: {
                            anchor: 'end', align: 'end',
                            color: '#003369', font: {weight: 'bold', size: 12},
                            formatter: (v) => v > 0 ? v.toFixed(0) + '%' : '',
                            clip: false
                        },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `${ctx.raw.toFixed(1)}% Realizado`
                            }
                        }
                    },
                    scales: {
                        x: {display: false, beginAtZero: true, max: 105},
                        y: {grid: {display: false}, ticks: {font: {size: 11, weight: '600'}, color: '#333'}}
                    }
                },
                plugins: [ChartDataLabels]
            });
        }
    } catch (e) {
        console.error("Erro renderEntrevistaCharts:", e);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

export function destroy() {
    if (chartPreenchimento) chartPreenchimento.destroy();
    if (chartDadosOp) chartDadosOp.destroy();
    if (chartEntrevistas) chartEntrevistas.destroy();
    if (chartEntrevistasPerc) chartEntrevistasPerc.destroy();
    try {
        if (Efetividade && typeof Efetividade.destroy === 'function') Efetividade.destroy();
        if (DadosOp && typeof DadosOp.destroy === 'function') DadosOp.destroy();
    } catch (e) {
    }
}