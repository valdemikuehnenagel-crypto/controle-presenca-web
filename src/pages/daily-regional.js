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
    day: '',
};
let DATA_MODEL = null;

function formatDateLabel(dateKey) {
    try {
        const [y, m, d] = dateKey.split('-');
        return `${d}/${m}/${y}`;
    } catch {
        return dateKey;
    }
}

function renderFilters({days, kpis, gerentes, codigoToGerente, macros, codigoToMacro, months}) {
    const headerEl = document.getElementById('dr-header');
    const filtersEl = document.getElementById('dr-filters');
    if (!headerEl || !filtersEl) return;
    const dayOptions = days.map(d => {
        return `<option value="${d}">${formatDateLabel(d)}</option>`;
    }).join('');
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
    <select id="dr-filter-macro">
      <option value="">Macro</option>
      ${macroOptions}
    </select>    <select id="dr-filter-service">
      <option value="">Service</option>
      ${serviceOptions}
    </select>    <select id="dr-filter-gerente">
      <option value="">Gerente</option>
      ${gerenteOptions}
    </select>    <select id="dr-filter-day">
      <option value="">Dia</option>
      ${dayOptions}
    </select>
  `;
    headerEl.style.display = 'flex';
    document.getElementById('dr-filter-macro').addEventListener('change', (e) => {
        filterState.macro = e.target.value || '';
        applyFiltersAndRender();
    });
    document.getElementById('dr-filter-service').addEventListener('change', (e) => {
        filterState.service = e.target.value || '';
        applyFiltersAndRender();
    });
    document.getElementById('dr-filter-gerente').addEventListener('change', (e) => {
        filterState.gerente = e.target.value || '';
        applyFiltersAndRender();
    });
    document.getElementById('dr-filter-day').addEventListener('change', (e) => {
        filterState.day = e.target.value || '';
        applyFiltersAndRender();
    });
    const clearBtn = document.getElementById('dr-clear-all');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            filterState.macro = '';
            filterState.service = '';
            filterState.gerente = '';
            filterState.day = '';
            ['dr-filter-macro', 'dr-filter-service', 'dr-filter-gerente', 'dr-filter-day']
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
        days, kpis, codigosByKpi, data,
        codigoToGerente, macros, codigoToMacro, months, dayToMonth
    } = DATA_MODEL;
    let dayPool = days.slice();
    if (filterState.day) dayPool = dayPool.filter(d => d === filterState.day);
    const filteredDays = dayPool;
    const container = document.getElementById('daily-regional-table-container');
    if (!container) return;
    const kpiTaNormalName = 't & a';
    const standardKpis = kpis.filter(
        k => simplifyKpiName(k).toLowerCase() !== kpiTaNormalName
    );
    const taKpi = kpis.find(
        k => simplifyKpiName(k).toLowerCase() === kpiTaNormalName
    );
    let tableHTML = '';
    if (standardKpis.length > 0) {
        tableHTML = `
      <div class="table-frame">
        <div class="table-sticky-wrapper">
          <table class="daily-regional-table">
    `;
        tableHTML += '<thead><tr class="header-row-1">';
        tableHTML += '<th colspan="2"></th>';
        filteredDays.forEach((dateKey) => {
            const dayLabel = dateKey.slice(8, 10) + '/' + dateKey.slice(5, 7);
            tableHTML += `<th colspan="3">${dayLabel}</th>`;
        });
        tableHTML += '</tr>';
        tableHTML += '<tr class="header-row-2">';
        tableHTML += '<th class="col-kpi">KPI</th>';
        tableHTML += '<th class="col-service">SERVICE</th>';
        filteredDays.forEach(() => {
            tableHTML += '<th>Resultado</th><th>Meta</th><th>Delta</th>';
        });
        tableHTML += '</tr></thead>';
        tableHTML += '<tbody>';
        standardKpis.forEach((kpi, kpiIndex) => {
            const allCodesForKpi = (codigosByKpi[kpi] || []).slice();
            let codes = allCodesForKpi;
            if (filterState.macro) {
                codes = codes.filter(c => (codigoToMacro?.[c] || '') === filterState.macro);
            }
            if (filterState.service) {
                codes = codes.filter(c => c === filterState.service);
            }
            if (filterState.gerente) {
                codes = codes.filter(c => (codigoToGerente?.[c] || '') === filterState.gerente);
            }
            if (codes.length === 0) return;
            const simplifiedKpi = simplifyKpiName(kpi);
            codes.forEach((codigo, codigoIndex) => {
                tableHTML += '<tr>';
                if (codigoIndex === 0) {
                    tableHTML += `<td class="sticky-kpi" rowspan="${codes.length}">${simplifiedKpi}</td>`;
                }
                tableHTML += `<td class="sticky-codigo">${codigo}</td>`;
                filteredDays.forEach((currentDateKey) => {
                    const currentData = data[currentDateKey]?.[kpi]?.[codigo];
                    const currentResult = currentData?.resultado ?? null;
                    const currentMeta = currentData?.meta ?? null;
                    const idx = days.indexOf(currentDateKey);
                    const previousDateKey = idx >= 0 ? days[idx + 1] : null;
                    const previousResult = previousDateKey ? (data[previousDateKey]?.[kpi]?.[codigo]?.resultado ?? null) : null;
                    let delta = null;
                    if (currentResult !== null && previousResult !== null &&
                        typeof currentResult === 'number' && typeof previousResult === 'number') {
                        delta = currentResult - previousResult;
                    }
                    const resultadoFormatado = formatValue(currentResult, kpi);
                    const metaFormatada = formatValue(currentMeta, kpi);
                    const deltaFormatado = formatValue(delta, kpi);
                    const deltaClass = getDeltaClass(delta, kpi);
                    const resultadoClass = getResultadoClass(kpi, currentResult, currentMeta);
                    tableHTML += `<td class="res ${resultadoClass}">${resultadoFormatado}</td>`;
                    tableHTML += `<td class="meta">${metaFormatada}</td>`;
                    tableHTML += `<td class="delta ${deltaClass}">${deltaFormatado}</td>`;
                });
                tableHTML += '</tr>';
            });
            if (kpiIndex < standardKpis.length - 1) {
                const totalColumns = 2 + (filteredDays.length * 3);
                tableHTML += `<tr class="kpi-separator"><td colspan="${totalColumns}"></td></tr>`;
            }
        });
        tableHTML += `
            </tbody>
            </table>
          </div>
        </div>
    `;
    }
    if (taKpi) {
        const allCodesForKpi = (codigosByKpi[taKpi] || []).slice();
        let codes = allCodesForKpi;
        if (filterState.macro) {
            codes = codes.filter(c => (codigoToMacro?.[c] || '') === filterState.macro);
        }
        if (filterState.service) {
            codes = codes.filter(c => c === filterState.service);
        }
        if (filterState.gerente) {
            codes = codes.filter(c => (codigoToGerente?.[c] || '') === filterState.gerente);
        }
        if (codes.length > 0) {
            tableHTML += `
        <div class="table-frame">
          <div class="table-sticky-wrapper">
            <table class="daily-regional-table kpi-ta-table">
      `;
            tableHTML += '<thead><tr class="header-row-1 header-ta">';
            tableHTML += '<th colspan="2"></th>';
            filteredDays.forEach((dateKey) => {
                const dayLabel = dateKey.slice(8, 10) + '/' + dateKey.slice(5, 7);
                tableHTML += `<th colspan="3">${dayLabel}</th>`;
            });
            tableHTML += '</tr>';
            tableHTML += '<tr class="header-row-2 header-ta">';
            tableHTML += '<th class="col-kpi">KPI</th>';
            tableHTML += '<th class="col-service">SERVICE</th>';
            filteredDays.forEach(() => {
                tableHTML += '<th>OK</th><th>PENDENTE</th><th>NOK</th>';
            });
            tableHTML += '</tr></thead>';
            tableHTML += '<tbody>';
            const simplifiedKpi = simplifyKpiName(taKpi);
            codes.forEach((codigo, codigoIndex) => {
                tableHTML += '<tr>';
                if (codigoIndex === 0) {
                    tableHTML += `<td class="sticky-kpi" rowspan="${codes.length}">${simplifiedKpi}</td>`;
                }
                tableHTML += `<td class="sticky-codigo">${codigo}</td>`;
                filteredDays.forEach((currentDateKey) => {
                    const currentData = data[currentDateKey]?.[taKpi]?.[codigo];
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
                });
                tableHTML += '</tr>';
            });
            tableHTML += `
          </tbody>
          </table>
        </div>
      </div>
      `;
        }
    }
    container.innerHTML = tableHTML;
}

async function fetchAndRenderDailyRegionalData() {
    const container = document.getElementById('daily-regional-table-container');
    const loadingIndicator = document.getElementById('daily-regional-loading');
    if (!container) return;
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    container.innerHTML = '';
    try {
        const edgeFunctionUrl = `https://tzbqdjwgbisntzljwbqp.supabase.co/functions/v1/get-google-sheet-data-daily`;
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
            days, kpis, codigosByKpi, data,
            gerentes, codigoToGerente,
            macros, codigoToMacro,
            months, dayToMonth
        } = result;
        if (!days?.length || !kpis?.length) {
            container.innerHTML = '<p style="text-align:center;padding:20px;">Nenhum dado diário encontrado para o mês atual.</p>';
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            return;
        }
        DATA_MODEL = {
            days, kpis, codigosByKpi, data,
            gerentes, codigoToGerente,
            macros, codigoToMacro,
            months, dayToMonth
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
    fetchAndRenderDailyRegionalData();
}

export function destroy() {
    const c = document.getElementById('daily-regional-table-container');
    if (c) c.innerHTML = '';
}