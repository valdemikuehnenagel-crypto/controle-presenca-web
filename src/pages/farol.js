import * as Efetividade from './efetividade.js';
import * as DadosOp from './dados-operacionais.js';
import {supabase} from '../supabaseClient.js';

let chartPreenchimento = null;
let chartDadosOp = null;
let chartEntrevistas = null; // Instância do gráfico de entrevistas

const farolState = {
    filters: {
        matriz: '',
        gerencia: '',
        start: '',
        end: ''
    },
    allMatrizes: [],
    allGerentes: []
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

async function fetchFiltersFarol() {
    try {
        const {data, error} = await supabase.from('Matrizes').select('MATRIZ, GERENCIA').order('MATRIZ');
        if (error) throw error;
        const matrizes = new Set();
        const gerentes = new Set();
        data.forEach(item => {
            if (item.MATRIZ) matrizes.add(item.MATRIZ);
            if (item.GERENCIA) gerentes.add(item.GERENCIA);
        });
        farolState.allMatrizes = [...matrizes].sort();
        farolState.allGerentes = [...gerentes].sort();

        // Popula filtros do Farol
        const selMatriz = document.getElementById('farol-filter-matriz');
        const selGerencia = document.getElementById('farol-filter-gerencia');

        if (selMatriz) {
            selMatriz.innerHTML = '<option value="">Matriz</option>';
            farolState.allMatrizes.forEach(m => selMatriz.insertAdjacentHTML('beforeend', `<option value="${m}">${m}</option>`));
            selMatriz.value = farolState.filters.matriz;
        }
        if (selGerencia) {
            selGerencia.innerHTML = '<option value="">Gerência</option>';
            farolState.allGerentes.forEach(g => selGerencia.insertAdjacentHTML('beforeend', `<option value="${g}">${g}</option>`));
            selGerencia.value = farolState.filters.gerencia;
        }

        // Popula filtros da Entrevista (usa os mesmos dados)
        const selMatrizEnt = document.getElementById('entrevista-filter-matriz');
        const selGerenciaEnt = document.getElementById('entrevista-filter-gerencia');

        if (selMatrizEnt) {
            selMatrizEnt.innerHTML = '<option value="">Matriz</option>';
            farolState.allMatrizes.forEach(m => selMatrizEnt.insertAdjacentHTML('beforeend', `<option value="${m}">${m}</option>`));
            selMatrizEnt.value = farolState.filters.matriz;
        }
        if (selGerenciaEnt) {
            selGerenciaEnt.innerHTML = '<option value="">Gerência</option>';
            farolState.allGerentes.forEach(g => selGerenciaEnt.insertAdjacentHTML('beforeend', `<option value="${g}">${g}</option>`));
            selGerenciaEnt.value = farolState.filters.gerencia;
        }

    } catch (e) {
        console.error("Erro loading filters farol:", e);
    }
}

function openFarolPeriodModal(renderCallback) {
    const startVal = farolState.filters.start;
    const endVal = farolState.filters.end;
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[999]';
    overlay.innerHTML = `
    <div class="container !h-auto !w-auto max-w-md" style="background:#fff;border-radius:12px;padding:16px 18px 18px;box-shadow:0 12px 28px rgba(0,0,0,.18);">
      <h3 style="font-weight:800;color:#003369;margin:0 0 10px;">Selecionar Período</h3>
      <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
        <button type="button" data-action="ontem" style="padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#f9f9f9; font-size:13px; cursor:pointer;">Ontem</button>
        <button type="button" data-action="mes_atual" style="padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#f9f9f9; font-size:13px; cursor:pointer;">Mês Atual</button>
        <button type="button" data-action="mes_anterior" style="padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#f9f9f9; font-size:13px; cursor:pointer;">Mês Anterior</button>
      </div>
      <div class="grid grid-cols-2 gap-4 my-4">
        <div>
          <label class="block text-xs font-bold text-gray-600 mb-1">Início</label>
          <input type="date" id="farol-start" class="w-full border rounded p-2 text-sm" value="${startVal}">
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-600 mb-1">Fim</label>
          <input type="date" id="farol-end" class="w-full border rounded p-2 text-sm" value="${endVal}">
        </div>
      </div>
      <div class="flex justify-end gap-2" style="margin-top:10px;">
        <button id="btn-cancel" class="px-4 py-2 rounded bg-gray-100 text-gray-700 font-bold text-xs hover:bg-gray-200">Cancelar</button>
        <button id="btn-apply" class="px-4 py-2 rounded bg-[#003369] text-white font-bold text-xs hover:bg-[#02B1EE]">Aplicar</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const startInput = overlay.querySelector('#farol-start');
    const endInput = overlay.querySelector('#farol-end');

    // Callback padrão se não for passado
    const onRender = typeof renderCallback === 'function' ? renderCallback : renderFarolCharts;

    overlay.onclick = (e) => {
        const action = e.target.getAttribute('data-action');
        const id = e.target.id;
        if (e.target === overlay || id === 'btn-cancel') {
            overlay.remove();
        } else if (id === 'btn-apply') {
            if (startInput.value && endInput.value) {
                farolState.filters.start = startInput.value;
                farolState.filters.end = endInput.value;
                onRender();
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
    const btnEntrevistas = document.getElementById('nav-btn-entrevistas'); // Botão novo

    const viewPreenchimento = document.getElementById('view-preenchimento');
    const viewDadosOp = document.getElementById('view-dados-op');
    const viewFarol = document.getElementById('view-farol');
    const viewEntrevistas = document.getElementById('view-entrevistas'); // View nova

    // Filtros Farol
    const selMatriz = document.getElementById('farol-filter-matriz');
    const selGerencia = document.getElementById('farol-filter-gerencia');
    const btnPeriodo = document.getElementById('farol-period-btn');

    // Filtros Entrevista
    const selMatrizEnt = document.getElementById('entrevista-filter-matriz');
    const selGerenciaEnt = document.getElementById('entrevista-filter-gerencia');
    const btnPeriodoEnt = document.getElementById('entrevista-period-btn');

    if (selMatriz) selMatriz.onchange = (e) => {
        farolState.filters.matriz = e.target.value;
        renderFarolCharts();
    };
    if (selGerencia) selGerencia.onchange = (e) => {
        farolState.filters.gerencia = e.target.value;
        renderFarolCharts();
    };
    if (btnPeriodo) btnPeriodo.onclick = () => openFarolPeriodModal(renderFarolCharts);

    // Configuração Filtros Entrevista
    if (selMatrizEnt) selMatrizEnt.onchange = (e) => {
        farolState.filters.matriz = e.target.value;
        renderEntrevistaCharts();
    };
    if (selGerenciaEnt) selGerenciaEnt.onchange = (e) => {
        farolState.filters.gerencia = e.target.value;
        renderEntrevistaCharts();
    };
    if (btnPeriodoEnt) btnPeriodoEnt.onclick = () => openFarolPeriodModal(renderEntrevistaCharts);

    fetchFiltersFarol();

    function switchTab(tab) {
        [btnPreenchimento, btnDadosOp, btnFarol, btnEntrevistas].forEach(b => b?.classList.remove('active'));
        [viewPreenchimento, viewDadosOp, viewFarol, viewEntrevistas].forEach(v => v?.classList.remove('active'));

        if (tab === 'preenchimento') {
            btnPreenchimento.classList.add('active');
            viewPreenchimento.classList.add('active');
        } else if (tab === 'dados-op') {
            btnDadosOp.classList.add('active');
            viewDadosOp.classList.add('active');
            requestAnimationFrame(async () => {
                window.dispatchEvent(new Event('resize'));
                if (DadosOp && typeof DadosOp.init === 'function') {
                    try {
                        const res = DadosOp.init();
                        if (res instanceof Promise) await res;
                    } catch (err) {
                        console.warn("Erro ao iniciar DadosOp:", err);
                    }
                }
            });
        } else if (tab === 'farol') {
            btnFarol.classList.add('active');
            viewFarol.classList.add('active');
            renderFarolCharts();
        } else if (tab === 'entrevistas') {
            btnEntrevistas.classList.add('active');
            viewEntrevistas.classList.add('active');
            renderEntrevistaCharts();
        }
    }

    if (btnPreenchimento) btnPreenchimento.onclick = () => switchTab('preenchimento');
    if (btnDadosOp) btnDadosOp.onclick = () => switchTab('dados-op');
    if (btnFarol) btnFarol.onclick = () => switchTab('farol');
    if (btnEntrevistas) btnEntrevistas.onclick = () => switchTab('entrevistas'); // Evento novo

    try {
        if (Efetividade && typeof Efetividade.init === 'function') await Efetividade.init();
        setTimeout(() => {
            if (DadosOp && typeof DadosOp.init === 'function') {
                try {
                    const res = DadosOp.init();
                    if (res instanceof Promise) res.catch((e) => console.warn(e));
                } catch (e) {
                    console.warn(e)
                }
            }
        }, 500);
    } catch (e) {
        console.error("Erro init Farol:", e);
    }
}

const barOptions = () => ({
    indexAxis: 'y',
    layout: {padding: {top: 20, left: 10, right: 30, bottom: 10}},
    animation: {duration: 800, easing: 'easeOutQuart'},
    plugins: {
        legend: {display: false},
        datalabels: {
            anchor: 'end', align: 'end', offset: 4,
            color: '#003369', font: {weight: 'bold', size: 13}, formatter: (v) => {
                if (typeof v === 'number') {
                    return v.toFixed(2).replace('.', ',') + '%';
                }
                return v + '%';
            }
        },
        tooltip: {
            backgroundColor: 'rgba(0, 51, 105, 0.9)', titleFont: {size: 13}, bodyFont: {size: 13}, padding: 10,
            callbacks: {
                label: (ctx) => {
                    let val = ctx.raw;
                    if (typeof val === 'number') val = val.toFixed(2).replace('.', ',');
                    return `${ctx.label}: ${val}%`;
                }
            }
        }
    },
    scales: {
        x: {
            min: 0, max: 105, grid: {display: false}, ticks: {display: false}
        },
        y: {
            grid: {display: false},
            ticks: {font: {size: 12, weight: '600', family: "'Poppins', sans-serif"}, color: '#333', autoSkip: false}
        }
    },
    elements: {bar: {borderRadius: 6, borderSkipped: false}}
});

function renderBarChart(canvasId, data, chartInstance, setChartInstance) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    const backgroundColors = data.values.map(v => {
        if (v === 100) return '#22B14C';
        if (v >= 90) return '#f0ad4e';
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
                barPercentage: 0.7,
                categoryPercentage: 0.8
            }]
        },
        options: barOptions(),
        plugins: [ChartDataLabels]
    });
    setChartInstance(newChart);
}

// Renderiza os gráficos do Farol (Preenchimento e Qualidade)
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

// --- FUNÇÃO PARA RENDERIZAR GRÁFICO DE ENTREVISTAS ---
async function renderEntrevistaCharts() {
    const loader = document.getElementById('entrevista-loader');
    if (loader) loader.style.display = 'flex';

    await ensureChartLib();
    const filters = farolState.filters;

    try {
        // Busca dados do módulo de Efetividade (Função getInterviewData deve existir lá)
        const data = await Efetividade.getInterviewData(filters);

        const ctx = document.getElementById('chart-entrevista-detalhado')?.getContext('2d');
        if (!ctx) return;

        if (chartEntrevistas) {
            chartEntrevistas.destroy();
        }

        chartEntrevistas = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [
                    {
                        label: 'Total ABS',
                        data: data.totalAbs,
                        backgroundColor: '#003369', // Azul Escuro
                        barPercentage: 0.6,
                        categoryPercentage: 0.8
                    },
                    {
                        label: 'Entrevistas Pendentes',
                        data: data.pendentes,
                        backgroundColor: '#02B1EE', // Azul Claro (Cyan)
                        barPercentage: 0.6,
                        categoryPercentage: 0.8
                    }
                ]
            },
            options: {
                indexAxis: 'x', // Barras verticais
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {font: {family: "'Poppins', sans-serif"}}
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        color: '#444',
                        font: {weight: 'bold'},
                        formatter: v => v > 0 ? v : ''
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    x: {
                        grid: {display: false},
                        ticks: {autoSkip: false, maxRotation: 90, minRotation: 0}
                    },
                    y: {
                        beginAtZero: true,
                        grid: {color: '#f0f0f0'}
                    }
                }
            },
            plugins: [ChartDataLabels]
        });

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
    try {
        if (Efetividade && typeof Efetividade.destroy === 'function') Efetividade.destroy();
        if (DadosOp && typeof DadosOp.destroy === 'function') DadosOp.destroy();
    } catch (e) {
    }
}