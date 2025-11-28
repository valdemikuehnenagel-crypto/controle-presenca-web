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
    if (lowerKpi.includes('volume processado')) return 'Volume Processado';
    if (lowerKpi.includes('t & a')) return 'T & A';
    return kpiName;
}function formatValue(value, kpiName) {
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
    }    const isVolume = simplifiedKpi.includes('volume delivered') ||
        simplifiedKpi.includes('volume forecast') ||
        simplifiedKpi.includes('volume processado');    if (isVolume) {
        return new Intl.NumberFormat('pt-BR', {
            maximumFractionDigits: 0
        }).format(numberValue);
    }
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(numberValue);
}function getDeltaClass(delta, kpiName) {
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
}function getResultadoClass(kpiName, value, meta) {
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
}const filterState = {
    macro: '',
    service: '',
    gerente: '',
    week: ''
};
const PERIOD = {start: '', end: ''};
let DATA_MODEL = null;
let IS_LOADING = false;function _pad2(n) {
    return String(n).padStart(2, '0');
}function _ymdLocal(d) {
    return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
}function formatMonthLabel(ym) {
    try {
        const [y, m] = ym.split('-').map(Number);
        const d = new Date(y, (m - 1), 1);
        const fmt = new Intl.DateTimeFormat('pt-BR', {month: 'short', year: 'numeric'});
        const parts = fmt.format(d).replace('.', '');
        return parts.replace(' de ', '/');
    } catch {
        return ym;
    }
}function _updatePeriodBtnLabel(btn) {
    if (!btn) return;
    if (PERIOD.start && PERIOD.end) {
        const [ys, ms, ds] = PERIOD.start.split('-');
        const [ye, me, de] = PERIOD.end.split('-');
        btn.textContent = `${ds}/${ms}/${ys} — ${de}/${me}/${ye}`;
    } else {
        btn.textContent = 'Selecionar Período';
    }
}function openPeriodModal() {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[99]';
    overlay.innerHTML = `
    <div class="container !h-auto !w-auto max-w-md" style="background:#fff;border-radius:12px;padding:16px 18px 18px;box-shadow:0 12px 28px rgba(0,0,0,.18);">
      <h3 style="font-weight:800;color:#003369;margin:0 0 10px;">Selecionar Período</h3>
      <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
        <button type="button" data-action="hoje" style="padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#f9f9f9; font-size:13px; cursor:pointer;">Hoje</button>
        <button type="button" data-action="ontem" style="padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#f9f9f9; font-size:13px; cursor:pointer;">Ontem</button>
        <button type="button" data-action="mes_anterior" style="padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#f9f9f9; font-size:13px; cursor:pointer;">Mês Anterior</button>
      </div>
      <div class="grid grid-cols-2 gap-4 my-4">
        <div>
          <label for="modal-start-date" class="block mb-1 font-semibold text-sm">Início</label>
          <input type="date" id="modal-start-date" class="w-full p-2 border rounded-md" value="${PERIOD.start || ''}">
        </div>
        <div>
          <label for="modal-end-date" class="block mb-1 font-semibold text-sm">Fim</label>
          <input type="date" id="modal-end-date" class="w-full p-2 border rounded-md" value="${PERIOD.end || ''}">
        </div>
      </div>
      <div class="form-actions" style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" class="btn-cancelar" data-action="cancel" style="padding:8px 12px;border-radius:8px;border:1px solid #e7ebf4;background:#fff;">Cancelar</button>
        <button type="button" class="btn-salvar" data-action="apply" style="padding:8px 12px;border-radius:8px;border:1px solid #003369;background:#003369;color:#fff;">Aplicar</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const startInput = overlay.querySelector('#modal-start-date');
    const endInput = overlay.querySelector('#modal-end-date');
    overlay.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (e.target === overlay || action === 'cancel') {
            document.body.removeChild(overlay);
        } else if (action === 'apply') {
            if (!startInput.value || !endInput.value) {
                alert('Por favor, selecione as duas datas.');
                return;
            }
            PERIOD.start = startInput.value;
            PERIOD.end = endInput.value;
            const btn = document.getElementById('wr-period-btn');
            _updatePeriodBtnLabel(btn);
            document.body.removeChild(overlay);
            fetchAndRenderData();
        } else if (action === 'hoje') {
            const today = new Date();
            const ymd = _ymdLocal(today);
            startInput.value = ymd;
            endInput.value = ymd;
        } else if (action === 'ontem') {
            const today = new Date();
            const d = new Date(today);
            d.setDate(today.getDate() - 1);
            const ymd = _ymdLocal(d);
            startInput.value = ymd;
            endInput.value = ymd;
        } else if (action === 'mes_anterior') {
            const today = new Date();
            const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const last = new Date(today.getFullYear(), today.getMonth(), 0);
            startInput.value = _ymdLocal(first);
            endInput.value = _ymdLocal(last);
        }
    });
}function handleClearFilters() {
    filterState.macro = '';
    filterState.service = '';
    filterState.gerente = '';
    filterState.week = '';
    PERIOD.start = '';
    PERIOD.end = '';
    ['wr-filter-macro', 'wr-filter-service', 'wr-filter-gerente', 'wr-filter-week']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    const periodBtn = document.getElementById('wr-period-btn');
    _updatePeriodBtnLabel(periodBtn);
    fetchAndRenderData();
}function renderFilters({weeks, kpis, gerentes, codigoToGerente, macros, codigoToMacro, months, weekToMonth}) {
    const headerEl = document.getElementById('wr-header');
    const filtersEl = document.getElementById('wr-filters');
    if (!headerEl || !filtersEl) {
        console.error('Elementos #wr-header ou #wr-filters não encontrados.');
        return;
    }
    let actionsEl = headerEl.querySelector('.action-buttons');
    if (!actionsEl) {
        actionsEl = document.createElement('div');
        actionsEl.style.display = 'flex';
        actionsEl.style.gap = '8px';
        actionsEl.style.alignItems = 'center';
        headerEl.appendChild(actionsEl);
    }
    let periodBtn = document.getElementById('wr-period-btn');
    if (!periodBtn) {
        periodBtn = document.createElement('button');
        periodBtn.id = 'wr-period-btn';
        periodBtn.type = 'button';
        periodBtn.style.padding = '8px 16px';
        periodBtn.style.border = '1px solid #003369';
        periodBtn.style.borderRadius = '20px';
        periodBtn.style.background = '#003369';
        periodBtn.style.color = '#fff';
        periodBtn.style.fontWeight = '700';
        periodBtn.style.cursor = 'pointer';
        periodBtn.addEventListener('click', openPeriodModal);
        actionsEl.prepend(periodBtn);
    }
    _updatePeriodBtnLabel(periodBtn);
    let clearBtn = document.getElementById('wr-clear-all');
    if (clearBtn) {
        clearBtn.removeEventListener('click', handleClearFilters);
        clearBtn.addEventListener('click', handleClearFilters);
    } else {
        clearBtn = document.createElement('button');
        clearBtn.id = 'wr-clear-all';
        clearBtn.textContent = 'Limpar';
        clearBtn.addEventListener('click', handleClearFilters);
        actionsEl.appendChild(clearBtn);
    }
    const weekOptions = weeks.map(w => {
        const [year, wnum] = w.split('-W');
        return `<option value="${w}">W${wnum} • ${year}</option>`;
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
}function applyFiltersAndRender() {
    if (!DATA_MODEL) {
        console.warn('Cache (DATA_MODEL) ainda não está pronto.');
        return;
    }
    const {
        weeks, kpis, codigosByKpi, data,
        codigoToGerente, macros, codigoToMacro
    } = DATA_MODEL;
    let weekPool = weeks.slice();
    if (filterState.week) {
        weekPool = weekPool.filter(w => w === filterState.week);
    }
    const filteredWeeks = weekPool;
    const kpiTaNormalName = 't & a';
    const kpiInventarioNormalName = 'inventário';    const masterOrder = [
        '%cia', '%coa', '%utilização lms', 'absenteísmo fatura', 'inventário',
        'dit svc', 'delay', 'fechamento de gaiola', 'oot svc', 'phh', 'tmc',
        'volume delivered', 'volume forecast', 'volume processado'
    ];    const standardKpis = kpis
        .filter(k => simplifyKpiName(k).toLowerCase() !== kpiTaNormalName)
        .sort((a, b) => {
            const simplifiedA = simplifyKpiName(a).toLowerCase();
            const simplifiedB = simplifyKpiName(b).toLowerCase();
            const orderA = masterOrder.indexOf(simplifiedA === 'acuracidade de inventário' ? 'inventário' : simplifiedA);
            const orderB = masterOrder.indexOf(simplifiedB === 'acuracidade de inventário' ? 'inventário' : simplifiedB);
            if (orderA === -1 && orderB === -1) return a.localeCompare(b);
            if (orderA === -1) return 1;
            if (orderB === -1) return -1;
            return orderA - orderB;
        });    const taKpi = kpis.find(
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
}async function fetchAndRenderData() {
    const container = document.getElementById('weekly-regional-table-container');
    const loadingIndicator = document.getElementById('weekly-regional-loading');
    if (IS_LOADING) return;
    IS_LOADING = true;
    if (!container) {
        IS_LOADING = false;
        return;
    }
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    container.innerHTML = '';
    try {
        const edgeFunctionUrl = `https://tzbqdjwgbisntzljwbqp.supabase.co/functions/v1/get-google-sheet-data`;
        const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6YnFkandnYmlzbnR6bGp3YnFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0MTQyNTUsImV4cCI6MjA3MTk5MDI1NX0.fl0GBdHF_Pc56FSCVkKmCrCQANMVGvQ8sKLDoqK7eAQ';
        const body = (PERIOD.start && PERIOD.end)
            ? {periodStart: PERIOD.start, periodEnd: PERIOD.end}
            : {};
        const response = await fetch(edgeFunctionUrl, {
            method: 'POST',
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
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
            container.innerHTML = '<p style="text-align:center;padding:20px;">Nenhum dado semanal encontrado para este período.</p>';
            DATA_MODEL = {
                weeks: [], kpis: [], codigosByKpi: {}, data: {},
                gerentes, codigoToGerente, macros, codigoToMacro, months, weekToMonth
            };
            renderFilters(DATA_MODEL);
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            IS_LOADING = false;
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
        IS_LOADING = false;
    }
}export function init() {
    destroy();
    fetchAndRenderData();
}export function destroy() {
    const c = document.getElementById('weekly-regional-table-container');
    if (c) c.innerHTML = '';
    DATA_MODEL = null;
    IS_LOADING = false;
    PERIOD.start = '';
    PERIOD.end = '';
    filterState.macro = '';
    filterState.service = '';
    filterState.gerente = '';
    filterState.week = '';
    const filtersEl = document.getElementById('wr-filters');
    if (filtersEl) filtersEl.innerHTML = '';
    document.getElementById('wr-period-btn')?.remove();
    const clearBtn = document.getElementById('wr-clear-all');
    if (clearBtn) {
        clearBtn.removeEventListener('click', handleClearFilters);
    }
    const headerEl = document.getElementById('wr-header');
    if (headerEl) headerEl.style.display = 'none';
    document.querySelectorAll('.fixed.inset-0.bg-black\\/60')?.forEach(n => n.remove());
}