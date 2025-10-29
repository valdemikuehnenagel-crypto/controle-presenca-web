

function simplifyKpiName(kpiName) {
    const lowerKpi = (kpiName || '').toLowerCase();
    if (lowerKpi.includes('fechamento automático de gaiolas')) return 'Fechamento de Gaiola';
    if (lowerKpi.includes('produtividade ggp')) return 'PHH';
    if (lowerKpi.includes('tmc (%cumprimento tempo)')) return 'TMC';
    if (lowerKpi.includes('acuracidade de inventário')) return 'Inventário';
    if (lowerKpi.includes('oot svc')) return 'OOT SVC';
    if (lowerKpi.includes('opsclock')) return 'OOT SVC';
    if (lowerKpi.includes('volume forecast')) return 'Volume Forecast';
    if (lowerKpi.includes('volume delivered')) return 'Volume Delivered';
    if (lowerKpi.includes('t & a')) return 'T & A';
    return kpiName;
}

function formatValue(value, kpiName) {
    if (value === null || value === undefined || value === '-' || isNaN(Number(value))) {
        if (typeof value === 'string' && value.includes('%')) return value;
        return '-';
    }
    const numberValue = Number(value);
    const simplifiedKpi = simplifyKpiName(kpiName).toLowerCase();
    const percentageKPIs = [
        '%cia', '%coa', '%utilização lms', 'absenteísmo fatura', 'delay',
        'fechamento de gaiola', 'tmc', 'acuracidade de inventário', 'inventário',
        'oot svc', 'opsclock',
        't & a'
    ];
    const isPercentage = percentageKPIs.some(pkpi => simplifiedKpi.includes(pkpi));

    if (isPercentage) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'percent',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(numberValue);
    }

    const isVolume = simplifiedKpi.includes('volume delivered') || simplifiedKpi.includes('volume forecast');
    if (isVolume) {
        return new Intl.NumberFormat('pt-BR', {
            maximumFractionDigits: 0
        }).format(numberValue);
    }


    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(numberValue);
}

function getDeltaClass(deltaMom, kpiName) {
    if (deltaMom === null || isNaN(deltaMom) || Math.abs(deltaMom) < 0.0001) return 'delta-neutral';
    const simplifiedKpi = simplifyKpiName(kpiName).toLowerCase();
    const increaseIsBadMap = {
        '%cia': true, '%coa': true, 'absenteísmo fatura': true, 'dit svc': true, 'delay': true,
        '%utilização lms': false, 'fechamento de gaiola': false, 'phh': false, 'tmc': false,
        'inventário': false, 'acuracidade de inventário': false,
        'oot svc': false, 'opsclock': false,
        't & a': false,
    };

    if (Object.prototype.hasOwnProperty.call(increaseIsBadMap, simplifiedKpi)) {
        const isBadIncrease = increaseIsBadMap[simplifiedKpi];
        return deltaMom > 0 ? (isBadIncrease ? 'delta-negative' : 'delta-positive')
            : (isBadIncrease ? 'delta-positive' : 'delta-negative');
    }

    return deltaMom > 0 ? 'delta-positive' : 'delta-negative';
}

function getResultadoClass(kpiName, value) {
    if (value === null || isNaN(Number(value))) return '';
    const numberValue = Number(value);
    const simplifiedKpi = simplifyKpiName(kpiName).toLowerCase();


    switch (simplifiedKpi) {

        case '%cia':
        case '%coa':
        case 'absenteísmo fatura':
            return numberValue > 0.05 ? 'text-red' : '';
        case 'dit svc':
            return numberValue > 100 ? 'text-red' : '';
        case 'delay':
            return numberValue > 0.0395 ? 'text-red' : '';

        case '%utilização lms':
            return numberValue < 0.80 ? 'text-red' : '';
        case 'inventário':
        case 'acuracidade de inventário':
            return numberValue < 0.88 ? 'text-red' : '';
        case 'fechamento de gaiola':
            return numberValue < 0.70 ? 'text-red' : '';
        case 'oot svc':
        case 'opsclock':
            return numberValue < 0.85 ? 'text-red' : '';
        case 'tmc':
            return numberValue < 0.83 ? 'text-red' : '';
        case 't & a':
            return numberValue < 0.85 ? 'text-red' : '';

        case 'phh':
        default:
            return '';
    }
}


const filterState = {macro: '', service: '', gerente: '', month: ''};
let DATA_MODEL = null;


function formatMonthLabel(ym) {
    try {
        const [y, m] = ym.split('-').map(Number);
        const d = new Date(y, (m - 1), 1);
        const monthFormatter = new Intl.DateTimeFormat('pt-BR', {month: 'short'});
        const yearFormatter = new Intl.DateTimeFormat('pt-BR', {year: '2-digit'});
        const monthShort = monthFormatter.format(d).toUpperCase().replace('.', '');
        const yearShort = yearFormatter.format(d);
        return `${monthShort}/${yearShort}`;
    } catch {
        return ym;
    }
}

function renderFilters({months, kpis, gerentes, codigoToGerente, macros, codigoToMacro}) {
    const headerEl = document.getElementById('mr-header');
    const filtersEl = document.getElementById('mr-filters');
    if (!headerEl || !filtersEl) {
        console.error("Elementos de filtro #mr-header ou #mr-filters não encontrados no HTML.");
        return;
    }


    const monthOptions = (months || []).map(ym => `<option value="${ym}">${formatMonthLabel(ym)}</option>`).join('');
    const gerenteOptions = (gerentes || []).sort().map(g => `<option value="${g}">${g}</option>`).join('');
    const macroOptions = (macros || []).sort().map(m => `<option value="${m}">${m}</option>`).join('');

    const allCodes = new Set();

    (kpis || []).forEach(kpi => {
        (DATA_MODEL?.codigosByKpi?.[kpi] || []).forEach(c => allCodes.add(c));
    });

    if (codigoToGerente) Object.keys(codigoToGerente).forEach(c => allCodes.add(c));
    if (codigoToMacro) Object.keys(codigoToMacro).forEach(c => allCodes.add(c));

    const serviceOptions = Array.from(allCodes).sort().map(c => `<option value="${c}">${c}</option>`).join('');

    filtersEl.innerHTML = `
    <select id="mr-filter-macro"><option value="">Macro</option>${macroOptions}</select>
    <select id="mr-filter-service"><option value="">SVC</option>${serviceOptions}</select>
    <select id="mr-filter-gerente"><option value="">Gerente</option>${gerenteOptions}</select>
    <select id="mr-filter-month"><option value="">Mês</option>${monthOptions}</select>
  `;
    headerEl.style.display = 'flex';


    document.getElementById('mr-filter-macro').addEventListener('change', (e) => {
        filterState.macro = e.target.value || '';
        applyFiltersAndRender();
    });
    document.getElementById('mr-filter-service').addEventListener('change', (e) => {
        filterState.service = e.target.value || '';
        applyFiltersAndRender();
    });
    document.getElementById('mr-filter-gerente').addEventListener('change', (e) => {
        filterState.gerente = e.target.value || '';
        applyFiltersAndRender();
    });
    document.getElementById('mr-filter-month').addEventListener('change', (e) => {
        filterState.month = e.target.value || '';
        applyFiltersAndRender();
    });

    const clearBtn = document.getElementById('mr-clear-all');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            filterState.macro = '';
            filterState.service = '';
            filterState.gerente = '';
            filterState.month = '';
            ['mr-filter-macro', 'mr-filter-service', 'mr-filter-gerente', 'mr-filter-month'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            applyFiltersAndRender();
        });
    }
}


function applyFiltersAndRender() {
    if (!DATA_MODEL) return;

    const {
        months,
        kpis,
        codigosByKpi,
        data,
        codigoToGerente,
        macros,
        codigoToMacro,
    } = DATA_MODEL;


    let monthPool = months.slice();
    if (filterState.month) {
        monthPool = monthPool.filter(m => m === filterState.month);
    }
    const filteredMonths = monthPool;


    const kpisToShow = kpis.filter(k => {
        const simplified = simplifyKpiName(k).toLowerCase();
        return simplified !== 't & a';
    }).sort();


    const allCodesMaster = new Set();

    kpisToShow.forEach(kpi => {
        (codigosByKpi[kpi] || []).forEach(c => allCodesMaster.add(c));
    });

    if (codigoToGerente) Object.keys(codigoToGerente).forEach(c => allCodesMaster.add(c));
    if (codigoToMacro) Object.keys(codigoToMacro).forEach(c => allCodesMaster.add(c));

    let visibleCodes = Array.from(allCodesMaster).sort();
    if (filterState.macro) {
        visibleCodes = visibleCodes.filter(c => (codigoToMacro?.[c] || '') === filterState.macro);
    }
    if (filterState.service) {
        visibleCodes = visibleCodes.filter(c => c === filterState.service);
    }
    if (filterState.gerente) {
        visibleCodes = visibleCodes.filter(c => (codigoToGerente?.[c] || '') === filterState.gerente);
    }


    const container = document.getElementById('month-regional-table-container');
    if (!container) return;
    let tableHTML = '';

    if (kpisToShow.length > 0 && visibleCodes.length > 0 && filteredMonths.length > 0) {
        const totalColumns = 2 + (filteredMonths.length * 2);

        tableHTML = `
      <div class="table-frame">
        <div class="table-sticky-wrapper">
          <table class="month-regional-table">
    `;

        tableHTML += '<thead><tr class="header-row-1">';
        tableHTML += '<th colspan="2"></th>';
        filteredMonths.forEach((monthKey) => {
            tableHTML += `<th colspan="2">${formatMonthLabel(monthKey)}</th>`;
        });
        tableHTML += '</tr>';


        tableHTML += '<tr class="header-row-2">';
        tableHTML += '<th class="col-kpi">KPI</th>';
        tableHTML += '<th class="col-service">SVC</th>';
        filteredMonths.forEach(() => {
            tableHTML += '<th>Resultado</th><th>Variação</th>';
        });
        tableHTML += '</tr></thead>';


        tableHTML += '<tbody>';
        kpisToShow.forEach((kpi, kpiIndex) => {
            const codesForThisKpi = (codigosByKpi[kpi] || [])
                .filter(c => visibleCodes.includes(c))
                .sort();
            if (codesForThisKpi.length === 0) return;
            const simplifiedKpi = simplifyKpiName(kpi);

            codesForThisKpi.forEach((codigo, codigoIndex) => {
                tableHTML += '<tr>';
                if (codigoIndex === 0) {
                    tableHTML += `<td class="sticky-kpi" rowspan="${codesForThisKpi.length}">${simplifiedKpi}</td>`;
                }
                tableHTML += `<td class="sticky-codigo">${codigo}</td>`;


                filteredMonths.forEach((currentMonthKey) => {

                    const currentMonthIndexInAll = DATA_MODEL.months.findIndex(m => m === currentMonthKey);
                    const previousMonthKey = (currentMonthIndexInAll + 1 < DATA_MODEL.months.length) ? DATA_MODEL.months[currentMonthIndexInAll + 1] : null;

                    const currentData = data[currentMonthKey]?.[kpi]?.[codigo];
                    const previousData = previousMonthKey ? data[previousMonthKey]?.[kpi]?.[codigo] : null;

                    const currentResult = currentData?.resultado ?? null;
                    const previousResult = previousData?.resultado ?? null;

                    let deltaMom = null;
                    if (currentResult !== null && previousResult !== null &&
                        typeof currentResult === 'number' && typeof previousResult === 'number') {
                        deltaMom = currentResult - previousResult;
                    }

                    const resultadoFormatado = formatValue(currentResult, kpi);
                    const deltaFormatado = formatValue(deltaMom, kpi);
                    const deltaClass = getDeltaClass(deltaMom, kpi);
                    const resultadoClass = getResultadoClass(kpi, currentResult);

                    tableHTML += `<td class="res ${resultadoClass}">${resultadoFormatado}</td>`;
                    tableHTML += `<td class="delta ${deltaClass}">${deltaFormatado}</td>`;
                });
                tableHTML += '</tr>';
            });


            if (kpiIndex < kpisToShow.length - 1) {
                const nextKpiHasVisibleCodes = kpisToShow[kpiIndex + 1] &&
                    (codigosByKpi[kpisToShow[kpiIndex + 1]] || [])
                        .some(c => visibleCodes.includes(c));
                if (nextKpiHasVisibleCodes) {
                    tableHTML += `<tr class="kpi-separator"><td colspan="${totalColumns}"></td></tr>`;
                }
            }
        });
        tableHTML += `
            </tbody>
            </table>
          </div>
        </div>
    `;
    }


    if (tableHTML === '') {
        container.innerHTML = '<p style="text-align:center;padding:20px;">Nenhum dado encontrado para os filtros selecionados.</p>';
    } else {
        container.innerHTML = tableHTML;
    }
}



async function fetchAndRenderMonthRegionalData() {
    const container = document.getElementById('month-regional-table-container');
    const loadingIndicator = document.getElementById('month-regional-loading');
    if (!container) return;

    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    container.innerHTML = '';

    try {
        const edgeFunctionUrl = `https://tzbqdjwgbisntzljwbqp.supabase.co/functions/v1/get-google-sheet-data-month`;
        const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6YnFkandnYmlzbnR6bGp3YnFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0MTQyNTUsImV4cCI6MjA3MTk5MDI1NX0.fl0GBdHF_Pc56FSCVkKmCrCQANMVGvQ8sKLDoqK7eAQ';

        const response = await fetch(edgeFunctionUrl, {
            method: 'POST',
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({error: 'Erro desconhecido ao decodificar JSON.'}));
            throw new Error(`Erro na API (${response.status}): ${errorData.error || response.statusText}`);
        }

        const result = await response.json();

        const {
            months,
            kpis, codigosByKpi, data,
            gerentes, codigoToGerente,
            macros, codigoToMacro
        } = result;


        if (!months?.length || !kpis?.length) {
            container.innerHTML = '<p style="text-align:center;padding:20px;">Nenhum dado mensal encontrado.</p>';
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            return;
        }


        DATA_MODEL = {
            months, kpis, codigosByKpi, data,
            gerentes, codigoToGerente,
            macros, codigoToMacro
        };

        renderFilters(DATA_MODEL);
        applyFiltersAndRender();

    } catch (error) {
        console.error('Erro ao buscar/renderizar dados mensais:', error);
        container.innerHTML = `<p style="color:red; text-align:center;">Erro ao carregar dados: ${error.message}</p>`;
    } finally {
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
}


export function init() {
    console.log("Inicializando Month Regional...");
    fetchAndRenderMonthRegionalData();
}

export function destroy() {
    console.log("Destruindo Month Regional...");
    const container = document.getElementById('month-regional-table-container');
    if (container) container.innerHTML = '';
    DATA_MODEL = null;

    filterState.macro = '';
    filterState.service = '';
    filterState.gerente = '';
    filterState.month = '';
}