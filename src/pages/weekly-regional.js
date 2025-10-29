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

function getDeltaClass(delta, kpiName) {
    if (delta === null || isNaN(delta) || Number(delta) === 0) return 'delta-neutral';
    const simplifiedKpi = simplifyKpiName(kpiName).toLowerCase();
    const increaseIsBadMap = {
        '%cia': true,
        '%coa': true,
        'absenteísmo fatura': true,
        'dit svc': true,
        'delay': true, '%utilização lms': false,
        'fechamento de gaiola': false,
        'phh': false,
        'tmc': false,
        'acuracidade de inventário': false,
        'oot svc': false,
        'opsclock': false,
    };
    if (Object.prototype.hasOwnProperty.call(increaseIsBadMap, simplifiedKpi)) {
        const isBadIncrease = increaseIsBadMap[simplifiedKpi];
        return delta > 0 ? (isBadIncrease ? 'delta-negative' : 'delta-positive')
            : (isBadIncrease ? 'delta-positive' : 'delta-negative');
    }
    return delta > 0 ? 'delta-positive' : 'delta-negative';
}

function getResultadoClass(kpiName, value, meta) {
    if (value === null || isNaN(Number(value))) {
        return '';
    }
    const simplifiedKpi = simplifyKpiName(kpiName).toLowerCase();
    switch (simplifiedKpi) {
        case '%cia':
        case '%coa':
        case 'absenteísmo fatura':
            return value > 0.05 ? 'text-red' : '';
        case '%utilização lms':
            return value < 0.80 ? 'text-red' : '';
        case 'inventário':
            return value < 0.88 ? 'text-red' : '';
        case 'dit svc':
            return value > 100 ? 'text-red' : '';
        case 'delay':
            return value > 0.0395 ? 'text-red' : '';
        case 'fechamento de gaiola':
            return value < 0.70 ? 'text-red' : '';
        case 'oot svc':
            return value < 0.85 ? 'text-red' : '';
        case 'tmc':
            return value < 0.83 ? 'text-red' : '';
        case 'phh':
            if (meta === null || isNaN(Number(meta))) return '';
            return value < meta ? 'text-red' : '';
        case 't & a':
            return value < 0.85 ? 'text-red' : '';
        default:
            return '';
    }
}

const filterState = {
    macro: '',
    service: '',
    gerente: '',
    week: '',
    mes: ''
};
let DATA_MODEL = null;

function formatMonthLabel(ym) {
    try {
        const [y, m] = ym.split('-').map(Number);
        const d = new Date(y, (m - 1), 1);
        const fmt = new Intl.DateTimeFormat('pt-BR', {month: 'short', year: 'numeric'});
        const parts = fmt.format(d).replace('.', '');
        return parts.replace(' de ', '/');
    } catch {
        return ym;
    }
}

function renderFilters({weeks, kpis, gerentes, codigoToGerente, macros, codigoToMacro, months, weekToMonth}) {
    const headerEl = document.getElementById('wr-header');
    const filtersEl = document.getElementById('wr-filters');
    if (!headerEl || !filtersEl) return;
    const weekOptions = weeks.map(w => {
        const [year, wnum] = w.split('-W');
        return `<option value="${w}">W${wnum} • ${year}</option>`;
    }).join('');
    const monthOptions = (months || []).map(ym => `<option value="${ym}">${formatMonthLabel(ym)}</option>`).join('');
    const gerenteOptions = (gerentes || []).map(g => `<option value="${g}">${g}</option>`).join('');
    const macroOptions = (macros || []).map(m => `<option value="${m}">${m}</option>`).join('');
    const allCodes = new Set();
    if (codigoToGerente) Object.keys(codigoToGerente).forEach(c => allCodes.add(c));
    if (DATA_MODEL?.codigosByKpi) {
        Object.values(DATA_MODEL.codigosByKpi).forEach(codeSet => {
            (codeSet || []).forEach(c => allCodes.add(c));
        });
    }
    const serviceOptions = Array.from(allCodes).sort().map(c => `<option value="${c}">${c}</option>`).join('');
    filtersEl.innerHTML = `
<select id="wr-filter-macro">
 <option value="">Macro</option>
 ${macroOptions}
</select>
<select id="wr-filter-service">
 <option value="">SVC</option>
 ${serviceOptions}
</select>
<select id="wr-filter-gerente">
 <option value="">Gerente</option>
 ${gerenteOptions}
</select>
<select id="wr-filter-week">
 <option value="">Week</option>
 ${weekOptions}
</select>
<select id="wr-filter-mes">
 <option value="">Mês</option>
 ${monthOptions}
</select>
`;
    headerEl.style.display = 'flex';
    document.getElementById('wr-filter-macro').addEventListener('change', (e) => {
        filterState.macro = e.target.value || '';
        applyFiltersAndRender();
    });
    document.getElementById('wr-filter-service').addEventListener('change', (e) => {
        filterState.service = e.target.value || '';
        applyFiltersAndRender();
    });
    document.getElementById('wr-filter-gerente').addEventListener('change', (e) => {
        filterState.gerente = e.target.value || '';
        applyFiltersAndRender();
    });
    document.getElementById('wr-filter-week').addEventListener('change', (e) => {
        filterState.week = e.target.value || '';
        applyFiltersAndRender();
    });
    document.getElementById('wr-filter-mes').addEventListener('change', (e) => {
        filterState.mes = e.target.value || '';
        applyFiltersAndRender();
    });
    const clearBtn = document.getElementById('wr-clear-all');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            filterState.macro = '';
            filterState.service = '';
            filterState.gerente = '';
            filterState.week = '';
            filterState.mes = '';
            ['wr-filter-macro', 'wr-filter-service', 'wr-filter-gerente', 'wr-filter-week', 'wr-filter-mes']
                .forEach(id => {
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
        weeks, kpis, codigosByKpi, data,
        codigoToGerente, macros, codigoToMacro, months, weekToMonth
    } = DATA_MODEL;
    let weekPool = weeks.slice();
    if (filterState.week) weekPool = weekPool.filter(w => w === filterState.week);
    if (filterState.mes) weekPool = weekPool.filter(w => (weekToMonth?.[w] || '') === filterState.mes);
    const filteredWeeks = weekPool;
    const kpiTaNormalName = 't & a';
    const kpiInventarioNormalName = 'inventário';
    const standardKpis = kpis.filter(
        k => simplifyKpiName(k).toLowerCase() !== kpiTaNormalName
    );
    const taKpi = kpis.find(
        k => simplifyKpiName(k).toLowerCase() === kpiTaNormalName
    );
    const allCodesMaster = new Set();
    kpis.forEach(kpi => {
        (codigosByKpi[kpi] || []).forEach(c => allCodesMaster.add(c));
    });
    let filteredCodes = Array.from(allCodesMaster).sort();
    if (filterState.macro) {
        filteredCodes = filteredCodes.filter(c => (codigoToMacro?.[c] || '') === filterState.macro);
    }
    if (filterState.service) {
        filteredCodes = filteredCodes.filter(c => c === filterState.service);
    }
    if (filterState.gerente) {
        filteredCodes = filteredCodes.filter(c => (codigoToGerente?.[c] || '') === filterState.gerente);
    }
    const container = document.getElementById('weekly-regional-table-container');
    if (!container) return;
    let tableHTML = '';
    if (standardKpis.length > 0 && filteredCodes.length > 0) {
        let totalStandardColumns = 2;
        standardKpis.forEach(kpi => {
            totalStandardColumns += (simplifyKpiName(kpi).toLowerCase() === kpiInventarioNormalName ? 3 : 2);
        });
        tableHTML += `
   <div class="table-frame">
    <div class="table-sticky-wrapper">
     <table class="weekly-regional-table">
   `;
        tableHTML += '<thead><tr class="header-row-1">';
        tableHTML += '<th colspan="2"></th>';
        standardKpis.forEach((kpi) => {
            const simplified = simplifyKpiName(kpi).toLowerCase();
            if (simplified === kpiInventarioNormalName) {
                tableHTML += `<th colspan="3">${simplifyKpiName(kpi)}</th>`;
            } else {
                tableHTML += `<th colspan="2">${simplifyKpiName(kpi)}</th>`;
            }
        });
        tableHTML += '</tr>';
        tableHTML += '<tr class="header-row-2">';
        tableHTML += '<th class="col-kpi">Week</th>';
        tableHTML += '<th class="col-service">SVC</th>';
        standardKpis.forEach((kpi) => {
            const simplified = simplifyKpiName(kpi).toLowerCase();
            if (simplified === kpiInventarioNormalName) {
                tableHTML += '<th>C/ POC</th><th>S/ POC</th><th>Variação</th>';
            } else {
                tableHTML += '<th>Resultado</th><th>Variação</th>';
            }
        });
        tableHTML += '</tr></thead>';
        tableHTML += '<tbody>';
        filteredWeeks.forEach((currentWeekKey, weekIndex) => {
            const weekLabel = currentWeekKey.split('-')[1] || currentWeekKey;
            filteredCodes.forEach((codigo, codigoIndex) => {
                tableHTML += '<tr>';
                if (codigoIndex === 0) {
                    tableHTML += `<td class="sticky-kpi" rowspan="${filteredCodes.length}">${weekLabel}</td>`;
                }
                tableHTML += `<td class="sticky-codigo">${codigo}</td>`;
                standardKpis.forEach((kpi) => {
                    const idx = weeks.indexOf(currentWeekKey);
                    const previousWeekKey = idx >= 0 ? weeks[idx + 1] : null;
                    const simplified = simplifyKpiName(kpi).toLowerCase();
                    const currentData = data[kpi]?.[currentWeekKey]?.[codigo];
                    if (simplified === kpiInventarioNormalName) {
                        const currentResult = currentData?.com_poc ?? null;
                        const currentMeta = currentData?.sem_poc ?? null;
                        const previousResult = previousWeekKey ? (data[kpi]?.[previousWeekKey]?.[codigo]?.com_poc ?? null) : null;
                        let delta = null;
                        if (currentResult !== null && previousResult !== null &&
                            typeof currentResult === 'number' && typeof previousResult === 'number') {
                            delta = currentResult - previousResult;
                        }
                        const resultadoFormatado = formatValue(currentResult, kpi);
                        const metaFormatada = formatValue(currentMeta, kpi);
                        const deltaFormatado = formatValue(delta, kpi);
                        const deltaClass = getDeltaClass(delta, kpi);
                        const resultadoClass = getResultadoClass(kpi, currentResult, null);
                        tableHTML += `<td class="res ${resultadoClass}">${resultadoFormatado}</td>`;
                        tableHTML += `<td class="meta">${metaFormatada}</td>`;
                        tableHTML += `<td class="delta ${deltaClass}">${deltaFormatado}</td>`;
                    } else {
                        const currentResult = currentData?.resultado ?? null;
                        const previousResult = previousWeekKey ? (data[kpi]?.[previousWeekKey]?.[codigo]?.resultado ?? null) : null;
                        let delta = null;
                        if (currentResult !== null && previousResult !== null &&
                            typeof currentResult === 'number' && typeof previousResult === 'number') {
                            delta = currentResult - previousResult;
                        }
                        const resultadoFormatado = formatValue(currentResult, kpi);
                        const deltaFormatado = formatValue(delta, kpi);
                        const deltaClass = getDeltaClass(delta, kpi);
                        const resultadoClass = getResultadoClass(kpi, currentResult, null);
                        tableHTML += `<td class="res ${resultadoClass}">${resultadoFormatado}</td>`;
                        tableHTML += `<td class="delta ${deltaClass}">${deltaFormatado}</td>`;
                    }
                });
                tableHTML += '</tr>';
            });
            if (weekIndex < filteredWeeks.length - 1) {
                tableHTML += `<tr class="kpi-separator"><td colspan="${totalStandardColumns}"></td></tr>`;
            }
        });
        tableHTML += `
     </tbody>
     </table>
    </div>
   </div>
  `;
    }
    if (taKpi && filteredCodes.length > 0) {
        const taCodes = filteredCodes.filter(c => codigosByKpi[taKpi] && codigosByKpi[taKpi].includes(c));
        if (taCodes.length > 0) {
            tableHTML += `
     <div class="table-frame">
      <div class="table-sticky-wrapper">
       <table class="weekly-regional-table kpi-ta-table">
     `;
            tableHTML += '<thead><tr class="header-row-1 header-ta">';
            tableHTML += '<th colspan="2"></th>';
            tableHTML += `<th colspan="3">${simplifyKpiName(taKpi)}</th>`;
            tableHTML += '</tr>';
            tableHTML += '<tr class="header-row-2 header-ta">';
            tableHTML += '<th class="col-kpi">Week</th>';
            tableHTML += '<th class="col-service">SVC</th>';
            tableHTML += '<th>OK</th><th>PENDENTE</th><th>NOK</th>';
            tableHTML += '</tr></thead>';
            tableHTML += '<tbody>';
            filteredWeeks.forEach((currentWeekKey, weekIndex) => {
                const weekLabel = currentWeekKey.split('-')[1] || currentWeekKey;
                taCodes.forEach((codigo, codigoIndex) => {
                    tableHTML += '<tr>';
                    if (codigoIndex === 0) {
                        tableHTML += `<td class="sticky-kpi" rowspan="${taCodes.length}">${weekLabel}</td>`;
                    }
                    tableHTML += `<td class="sticky-codigo">${codigo}</td>`;
                    const currentData = data[taKpi]?.[currentWeekKey]?.[codigo];
                    const okVal = currentData?.ok ?? null;
                    const pendenteVal = currentData?.pendente ?? null;
                    const nokVal = currentData?.nok ?? null;
                    const okFormatado = formatValue(okVal, taKpi);
                    const pendenteFormatado = formatValue(pendenteVal, taKpi);
                    const nokFormatado = formatValue(nokVal, taKpi);
                    const okClass = getResultadoClass(taKpi, okVal, null);
                    tableHTML += `<td class="res ok ${okClass}">${okFormatado}</td>`;
                    tableHTML += `<td class="meta pendente">${pendenteFormatado}</td>`;
                    tableHTML += `<td class="delta nok">${nokFormatado}</td>`;
                    tableHTML += '</tr>';
                });
                if (weekIndex < filteredWeeks.length - 1) {
                    tableHTML += `<tr class="kpi-separator"><td colspan="5"></td></tr>`;
                }
            });
            tableHTML += `
      </tbody>
      </table>
     </div>
    </div>
   `;
        }
    }
    if (tableHTML === '') {
        container.innerHTML = '<p style="text-align:center;padding:20px;">Nenhum dado encontrado para os filtros selecionados.</p>';
    } else {
        container.innerHTML = tableHTML;
    }
}

async function fetchAndRenderWeeklyRegionalData() {
    const container = document.getElementById('weekly-regional-table-container');
    const loadingIndicator = document.getElementById('weekly-regional-loading');
    if (!container) return;
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    container.innerHTML = '';
    try {
        const edgeFunctionUrl = `https://tzbqdjwgbisntzljwbqp.supabase.co/functions/v1/get-google-sheet-data`;
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
            const errorData = await response.json().catch(() => ({error: 'Erro desconhecido.'}));
            throw new Error(`API (${response.status}): ${errorData.error || response.statusText}`);
        }
        const result = await response.json();
        const {
            weeks, kpis, codigosByKpi, data,
            gerentes, codigoToGerente,
            macros, codigoToMacro,
            months, weekToMonth
        } = result;
        if (!weeks?.length || !kpis?.length) {
            container.innerHTML = '<p style="text-align:center;padding:20px;">Nenhum dado semanal encontrado.</p>';
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            return;
        }
        DATA_MODEL = {
            weeks, kpis, codigosByKpi, data,
            gerentes, codigoToGerente,
            macros, codigoToMacro,
            months, weekToMonth
        };
        renderFilters(DATA_MODEL);
        applyFiltersAndRender();
    } catch (error) {
        console.error('Erro:', error);
        container.innerHTML = `<p style="color:red; text-align:center;">Erro: ${error.message}</p>`;
    } finally {
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
}

export function init() {
    fetchAndRenderWeeklyRegionalData();
}

export function destroy() {
    const c = document.getElementById('weekly-regional-table-container');
    if (c) c.innerHTML = '';
}