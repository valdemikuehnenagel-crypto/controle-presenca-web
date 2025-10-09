import {getMatrizesPermitidas} from '../session.js';
import {supabase} from '../supabaseClient.js';

const HOST_SEL = '#hc-diario';
const PARTIAL_URL = '/pages/hc-diario.html';

const ROWS_ORDER = [
    'TOTAL QUADRO', 'LOG I', 'CONFERENTES', 'DSR', 'INJUSTIFICADO', 'JUSTIFICADO',
    'FOLGA ESPECIAL', 'FERIADO', 'ADMISSÃO', 'DESLIGAMENTOS', 'FÉRIAS'
];

let _mounted = false;
let _building = false;
let _buildToken = 0;
let _needsRebuild = false;
let _colabs = [];
const _filters = {matriz: '', svc: '', inicioISO: '', fimISO: ''};

const FALLBACK_HTML = `
<div class="hcd-root">
  <div class="hcd-bar">
    <div class="hcd-filters">
      <input type="date" id="hcd-start"/>
      <input type="date" id="hcd-end"/>
    </div>
  </div>
  <div class="hcd-grid">
    <div class="hcd-card"><table class="hcd-table" id="hcd-t1"></table></div>
    <div class="hcd-card"><table class="hcd-table" id="hcd-t2"></table></div>
    <div class="hcd-card"><table class="hcd-table" id="hcd-t3"></table></div>
    <div class="hcd-card hcd-card--full"><table class="hcd-table" id="hcd-geral"></table></div>
  </div>
</div>`;

const pad2 = n => (n < 10 ? `0${n}` : `${n}`);
const toISODate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const firstDayOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
const norm = v => String(v ?? '').trim().toUpperCase();

function parseAnyToISO(v) {
    if (!v) return '';
    if (typeof v === 'string') {
        const s = v.trim();
        if (s === '0000-00-00') return '';
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
        if (m) {
            let d = +m[1], mo = +m[2], y = +m[3];
            if (y < 100) y += 2000;
            const dt = new Date(Date.UTC(y, mo - 1, d));
            return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
        }
    }
    const d = new Date(v);
    if (isNaN(d)) return '';
    const fx = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    return fx.toISOString().slice(0, 10);
}

function eachDateISO(a, b) {
    const out = [], [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
    let cur = new Date(Date.UTC(y1, m1 - 1, d1)), end = new Date(Date.UTC(y2, m2 - 1, d2));
    while (cur <= end) {
        out.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
}

const labelDM = iso => {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
};

function weekdayKey(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    return ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'][d.getUTCDay()];
}

function clampEndToToday(startISO, endISO) {
    if (!startISO || !endISO) return [startISO, endISO];
    const todayISO = toISODate(new Date());
    return [startISO, endISO > todayISO ? todayISO : endISO];
}

const onlyActiveAux = arr => (arr || []).filter(c => norm(c.Cargo) === 'AUXILIAR' && norm(c.Ativo || 'SIM') === 'SIM');
const onlyActiveConf = arr => (arr || []).filter(c => norm(c.Cargo) === 'CONFERENTE' && norm(c.Ativo || 'SIM') === 'SIM');

function canonicalMark(row) {
    if (row?.['Presença'] === 1 || row?.['Presença'] === true) return 'PRESENCA';
    if (row?.Falta === 1 || row?.Falta === true) return 'FALTA';
    if (row?.Atestado === 1 || row?.Atestado === true) return 'ATESTADO';
    if (row?.['Folga Especial'] === 1 || row?.['Folga Especial'] === true) return 'F_ESPECIAL';
    if (row?.Feriado === 1 || row?.Feriado === true) return 'FERIADO';
    const s = norm(row?.Marcacao || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (s === 'P' || s === 'PRESENCA' || s === 'PRESENÇA') return 'PRESENCA';
    if (s === 'F' || s === 'FALTA') return 'FALTA';
    if (s === 'A' || s === 'ATESTADO') return 'ATESTADO';
    if (['FE', 'F_ESPECIAL', 'FOLGA ESPECIAL', 'FOLGA_ESPECIAL'].includes(s)) return 'F_ESPECIAL';
    if (s === 'FER' || s === 'FERIADO') return 'FERIADO';
    return '';
}

function firstISOFrom(row, keys) {
    for (const k of keys) {
        const iso = parseAnyToISO(row?.[k]);
        if (iso) return iso;
    }
    return '';
}


async function fetchAllWithPagination(queryBuilder, pageSize = 1000) {
    let all = [], page = 0, more = true;
    while (more) {
        const {data, error} = await queryBuilder.range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (data && data.length) {
            all = all.concat(data);
            page++;
            if (data.length < pageSize) more = false;
        } else {
            more = false;
        }
    }
    return all;
}

async function fetchColabs() {
    const matrizesPermitidas = getMatrizesPermitidas();

    let query = supabase
        .from('Colaboradores')
        .select('Nome, Cargo, MATRIZ, SVC, Escala, DSR, Ativo, "Data de admissão"');

    if (matrizesPermitidas !== null) {
        query = query.in('MATRIZ', matrizesPermitidas);
    }
    if (_filters.matriz) query = query.eq('MATRIZ', _filters.matriz);
    if (_filters.svc) query = query.eq('SVC', _filters.svc);

    _colabs = await fetchAllWithPagination(query);
}

async function fetchControleDiario(startISO, endISO) {
    const pageSize = 1000;
    let from = 0;
    const all = [];

    while (true) {
        const to = from + pageSize - 1;

        const {data, error} = await supabase
            .from('ControleDiario')
            .select('*')
            .gte('Data', startISO)
            .lte('Data', endISO)
            .order('Data', {ascending: true})
            .range(from, to);

        if (error) throw error;

        const rows = Array.isArray(data) ? data : [];
        all.push(...rows);

        if (rows.length < pageSize) break;

        from += pageSize;
        if (from > 200000) break;
    }

    return all;
}

async function fetchFeriasRange(startISO, endISO) {
    if (!_colabs.length) await fetchColabs();
    const nomesPermitidos = _colabs.map(c => c.Nome);
    if (!nomesPermitidos.length) return [];

    const {data, error} = await supabase
        .rpc('get_ferias_no_intervalo', {
            nomes: nomesPermitidos,
            data_inicio: startISO,
            data_fim: endISO
        });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function fetchDesligadosRange(startISO, endISO) {
    const matrizesPermitidas = getMatrizesPermitidas();

    let query = supabase
        .from('Desligados')
        .select('*')
        .gte('Data de Desligamento', startISO)
        .lte('Data de Desligamento', endISO)
        .order('Data de Desligamento', {ascending: true});

    if (matrizesPermitidas !== null) {
        query = query.in('MATRIZ', matrizesPermitidas);
    }

    const {data, error} = await query;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

function byTurnFilterAux(turno) {
    return onlyActiveAux(_colabs).filter(c => {
        if (norm(c.Escala) !== norm(turno)) return false;
        if (_filters.matriz && norm(c.MATRIZ) !== norm(_filters.matriz)) return false;
        if (_filters.svc && norm(c.SVC) !== norm(_filters.svc)) return false;
        return true;
    });
}

function byTurnFilterConf(turno) {
    return onlyActiveConf(_colabs).filter(c => {
        if (norm(c.Escala) !== norm(turno)) return false;
        if (_filters.matriz && norm(c.MATRIZ) !== norm(_filters.matriz)) return false;
        if (_filters.svc && norm(c.SVC) !== norm(_filters.svc)) return false;
        return true;
    });
}

function countAdmissoes(setNames, dateISO) {
    let n = 0;
    for (const nome of setNames) {
        const c = _colabs.find(x => x.Nome === nome);
        const iso = parseAnyToISO(c?.['Data de admissão']);
        if (iso === dateISO) n++;
    }
    return n;
}

function matchFiltersFor(nome, turno, extra) {
    const c = _colabs.find(x => x.Nome === nome) || {};
    const cargo = norm(extra?.Cargo ?? c.Cargo);
    const escala = norm(extra?.Escala ?? c.Escala);
    const svc = norm(extra?.SVC ?? c.SVC);
    const matriz = norm(extra?.MATRIZ ?? c.MATRIZ);
    if (cargo !== 'AUXILIAR') return false;
    if (_filters.matriz && matriz !== norm(_filters.matriz)) return false;
    if (_filters.svc && svc !== norm(_filters.svc)) return false;
    if (escala !== norm(turno)) return false;
    return true;
}

function emptyTable(el, title) {
    el.innerHTML = `<thead><tr><th>${title}</th></tr></thead><tbody><tr><td>Carregando...</td></tr></tbody>`;
}

function tableFromRows(title, datesISO, rows) {
    const head = `<thead><tr><th>${title}</th>${datesISO.map(d => `<th>${labelDM(d)}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${
        ROWS_ORDER.map(lbl => `<tr><td>${lbl}</td>${datesISO.map(d => `<td>${rows[lbl]?.[d] ?? 0}</td>`).join('')}</tr>`).join('')
    }</tbody>`;
    return head + body;
}

function sumRowsByDate(a, b, dates) {
    const out = {};
    ROWS_ORDER.forEach(k => out[k] = {});
    for (const k of ROWS_ORDER) for (const d of dates) out[k][d] = (Number(a?.[k]?.[d] || 0) + Number(b?.[k]?.[d] || 0));
    return out;
}

// Arquivo: hc-diario.js

async function buildTurnoRows(turno, datesISO, feriasPorDia, desligRows, marksByDate) {
    const rows = {};
    ROWS_ORDER.forEach(k => rows[k] = {});

    const auxTurno = byTurnFilterAux(turno);
    const confTurno = byTurnFilterConf(turno);

    for (const d of datesISO) {
        // 1. Determina o quadro de elegíveis PARA ESTE DIA, filtrando por admissão
        const auxElegiveisDoDia = auxTurno.filter(c => !c['Data de admissão'] || c['Data de admissão'] <= d);
        const confElegiveisDoDia = confTurno.filter(c => !c['Data de admissão'] || c['Data de admissão'] <= d);

        const setAux = new Set(auxElegiveisDoDia.map(c => c.Nome));
        const setConf = new Set(confElegiveisDoDia.map(c => c.Nome));

        // 2. Inicia todos os contadores do dia
        let presAux = 0, presConf = 0, fal = 0, ate = 0, fe = 0, fer = 0;

        // 3. Calcula as ausências PROGRAMADAS (DSR e Férias)
        const want = weekdayKey(d);
        const dsrAux = auxElegiveisDoDia.filter(c => norm(c.DSR || '').replace(/Ç|Á/g, a => ({'Ç':'C', 'Á':'A'})[a]) === want).length;
        const dsrConf = confElegiveisDoDia.filter(c => norm(c.DSR || '').replace(/Ç|Á/g, a => ({'Ç':'C', 'Á':'A'})[a]) === want).length;

        const nomesEmFeriasHoje = feriasPorDia.get(d) || new Set();
        let feriasAux = 0, feriasConf = 0;
        for (const c of auxElegiveisDoDia) if (nomesEmFeriasHoje.has(c.Nome)) feriasAux++;
        for (const c of confElegiveisDoDia) if (nomesEmFeriasHoje.has(c.Nome)) feriasConf++;

        // 4. Processa as marcações do dia (Presentes, Faltas, Atestados...)
        const nomesMarcados = new Set();
        const marks = marksByDate.get(d) || [];
        for (const m of marks) {
            const nome = m.Nome;
            if (!setAux.has(nome) && !setConf.has(nome)) continue;

            nomesMarcados.add(nome);
            const tipo = canonicalMark(m);

            if (setAux.has(nome)) {
                switch (tipo) {
                    case 'PRESENCA': presAux++; break;
                    case 'FALTA': fal++; break;
                    case 'ATESTADO': ate++; break;
                    case 'F_ESPECIAL': fe++; break;
                    case 'FERIADO': fer++; break;
                }
            } else if (setConf.has(nome)) {
                 switch (tipo) {
                    case 'PRESENCA': presConf++; break;
                    case 'FALTA': fal++; break;
                    case 'ATESTADO': ate++; break;
                    case 'F_ESPECIAL': fe++; break;
                    case 'FERIADO': fer++; break;
                }
            }
        }

        // 5. Calcula os Presentes para quem NÃO teve marcação
        // Um colaborador elegível que não foi marcado com nenhuma ausência e não está de DSR/Férias, é considerado presente.
        const naoMarcadosAux = auxElegiveisDoDia.filter(c =>
            !nomesMarcados.has(c.Nome) &&
            !nomesEmFeriasHoje.has(c.Nome) &&
            norm(c.DSR || '').replace(/Ç|Á/g, a => ({'Ç':'C', 'Á':'A'})[a]) !== want
        ).length;

        const naoMarcadosConf = confElegiveisDoDia.filter(c =>
            !nomesMarcados.has(c.Nome) &&
            !nomesEmFeriasHoje.has(c.Nome) &&
            norm(c.DSR || '').replace(/Ç|Á/g, a => ({'Ç':'C', 'Á':'A'})[a]) !== want
        ).length;

        // O total de presentes é a soma dos marcados + os não marcados (que são considerados presentes por padrão)
        presAux += naoMarcadosAux;
        presConf += naoMarcadosConf;

        // 6. Contabiliza Admissões e Desligamentos
        const adm = countAdmissoes(new Set([...setAux, ...setConf]), d);
        const deslig = (desligRows || []).reduce((acc, r) => {
             const iso = firstISOFrom(r, ['Data de Desligamento']);
             if (iso === d && (setAux.has(r.Nome) || setConf.has(r.Nome))) {
                 return acc + 1;
             }
             return acc;
        }, 0);

        // 7. Preenche as linhas da tabela
        rows['LOG I'][d] = presAux;
        rows['CONFERENTES'][d] = presConf;
        rows['DSR'][d] = dsrAux + dsrConf;
        rows['FÉRIAS'][d] = feriasAux + feriasConf;
        rows['INJUSTIFICADO'][d] = fal;
        rows['JUSTIFICADO'][d] = ate;
        rows['FOLGA ESPECIAL'][d] = fe;
        rows['FERIADO'][d] = fer;
        rows['ADMISSÃO'][d] = adm;
        rows['DESLIGAMENTOS'][d] = deslig;

        // O TOTAL QUADRO é a soma de todas as partes
        rows['TOTAL QUADRO'][d] = presAux + presConf + dsrAux + dsrConf + feriasAux + feriasConf + fal + ate + fe + fer + adm - deslig;
    }
    return rows;
}


export async function buildHCDiario() {
    if (_building) {
        _needsRebuild = true;
        return;
    }
    const myToken = ++_buildToken;
    _building = true;

    const host = document.querySelector(HOST_SEL);
    if (!host) {
        _building = false;
        return;
    }

    try {
        if (
            !host.querySelector('#hcd-period-btn') ||
            host.querySelector('#hcd-start')?.style.display !== 'none'
        ) {
            setDefaultMonthRange(host);
        }

        const prevGlobalM = _filters.matriz;
        const prevGlobalS = _filters.svc;
        if (window.__HC_GLOBAL_FILTERS) {
            _filters.matriz = window.__HC_GLOBAL_FILTERS.matriz || '';
            _filters.svc = window.__HC_GLOBAL_FILTERS.svc || '';
        }

        const startEl = host.querySelector('#hcd-start');
        const endEl = host.querySelector('#hcd-end');

        let inicioISO = startEl?.value || _filters.inicioISO;
        let fimISO = endEl?.value || _filters.fimISO;

        [inicioISO, fimISO] = clampEndToToday(inicioISO, fimISO);

        if (startEl && startEl.value !== inicioISO) startEl.value = inicioISO;
        if (endEl && endEl.value !== fimISO) endEl.value = fimISO;

        const selM = document.querySelector('#hc-filter-matriz');
        const selS = document.querySelector('#hc-filter-svc');

        const prevM = _filters.matriz;
        const prevS = _filters.svc;

        if (selM) _filters.matriz = selM.value || '';
        if (selS) _filters.svc = selS.value || '';

        if (!inicioISO || !fimISO) {
            _building = false;
            return;
        }

        const dates = eachDateISO(inicioISO, fimISO);

        const t1El = host.querySelector('#hcd-t1');
        const t2El = host.querySelector('#hcd-t2');
        const t3El = host.querySelector('#hcd-t3');
        const gEl = host.querySelector('#hcd-geral');

        if (t1El) emptyTable(t1El, 'TURNO 1');
        if (t2El) emptyTable(t2El, 'TURNO 2');
        if (t3El) emptyTable(t3El, 'TURNO 3');
        if (gEl) emptyTable(gEl, 'QUADRO GERAL');

        const filtrosMudaram =
            prevM !== _filters.matriz ||
            prevS !== _filters.svc ||
            prevGlobalM !== _filters.matriz ||
            prevGlobalS !== _filters.svc;

        if (!_colabs.length || filtrosMudaram) {
            try {
                await fetchColabs();
            } catch {
                _colabs = [];
            }
            if (myToken !== _buildToken) return;
        }

        const [cdRows, feriasRows, desligRows] = await Promise.all([
            fetchControleDiario(inicioISO, fimISO).catch(() => []),
            fetchFeriasRange(inicioISO, fimISO).catch(() => []),
            fetchDesligadosRange(inicioISO, fimISO).catch(() => [])
        ]);

        if (myToken !== _buildToken) return;


        const marksByDate = new Map();
        for (const d of dates) marksByDate.set(d, []);
        for (const r of cdRows) {
            const iso = parseAnyToISO(r?.Data);
            if (iso && marksByDate.has(iso)) marksByDate.get(iso).push(r);
        }


        const feriasPorDia = new Map();
        for (const f of feriasRows) {
            const nome = f.Nome;
            if (!nome) continue;
            const inicio = firstISOFrom(f, ['Data Inicio']);
            const fim = firstISOFrom(f, ['Data Final', 'Data Fim', 'Data Retorno']);
            if (inicio && fim) {
                for (const d of eachDateISO(inicio, fim)) {
                    if (d < dates[0] || d > dates[dates.length - 1]) continue;
                    if (!feriasPorDia.has(d)) feriasPorDia.set(d, new Set());
                    feriasPorDia.get(d).add(nome);
                }
            }
        }

        const [r1, r2, r3] = await Promise.all([
            buildTurnoRows('T1', dates, feriasPorDia, desligRows, marksByDate),
            buildTurnoRows('T2', dates, feriasPorDia, desligRows, marksByDate),
            buildTurnoRows('T3', dates, feriasPorDia, desligRows, marksByDate)
        ]);
        const g = sumRowsByDate(sumRowsByDate(r1, r2, dates), r3, dates);

        if (t1El) t1El.innerHTML = tableFromRows('TURNO 1', dates, r1);
        if (t2El) t2El.innerHTML = tableFromRows('TURNO 2', dates, r2);
        if (t3El) t3El.innerHTML = tableFromRows('TURNO 3', dates, r3);
        if (gEl) gEl.innerHTML = tableFromRows('QUADRO GERAL', dates, g);

    } catch (e) {
        console.error('HC Diário build:', e);
    } finally {
        _building = false;
        if (_needsRebuild) {
            _needsRebuild = false;
            queueMicrotask(() => buildHCDiario());
        }
    }
}

function setDefaultMonthRange(host) {
    if (!host) return;

    let startEl = host.querySelector('#hcd-start');
    let endEl = host.querySelector('#hcd-end');

    if (!startEl || !endEl) {
        const bar = host.querySelector('.hcd-bar .hcd-filters') || (() => {
            const hcdBar = document.createElement('div');
            hcdBar.className = 'hcd-bar';
            const hcdFilters = document.createElement('div');
            hcdFilters.className = 'hcd-filters';
            hcdBar.appendChild(hcdFilters);
            host.querySelector('.hcd-root')?.insertAdjacentElement('afterbegin', hcdBar);
            return hcdFilters;
        })();
        if (!startEl) {
            startEl = document.createElement('input');
            startEl.type = 'date';
            startEl.id = 'hcd-start';
            bar.appendChild(startEl);
        }
        if (!endEl) {
            endEl = document.createElement('input');
            endEl.type = 'date';
            endEl.id = 'hcd-end';
            bar.appendChild(endEl);
        }
    }

    const now = new Date();
    const sDef = toISODate(firstDayOfMonth(now));
    const eDef = toISODate(now);

    if (!parseAnyToISO(startEl.value)) startEl.value = sDef;
    if (!parseAnyToISO(endEl.value)) endEl.value = eDef;

    _filters.inicioISO = startEl.value.slice(0, 10);
    _filters.fimISO = endEl.value.slice(0, 10);


    startEl.style.display = 'none';
    endEl.style.display = 'none';

    let bar = host.querySelector('.hcd-bar .hcd-filters');
    if (!bar) {
        const hcdBar = document.createElement('div');
        hcdBar.className = 'hcd-bar';
        const hcdFilters = document.createElement('div');
        hcdFilters.className = 'hcd-filters';
        hcdBar.appendChild(hcdFilters);
        host.querySelector('.hcd-root')?.insertAdjacentElement('afterbegin', hcdBar);
        bar = hcdFilters;
    }

    let btn = host.querySelector('#hcd-period-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'hcd-period-btn';
        btn.className = 'btn-add';
        btn.textContent = 'Selecionar período';
        bar.appendChild(btn);
    }

    btn.onclick = () => {
        const curStart = _filters.inicioISO || startEl.value || sDef;
        const curEnd = _filters.fimISO || endEl.value || eDef;

        const overlay = document.createElement('div');
        overlay.id = 'cd-period-overlay';
        overlay.innerHTML = `
      <div>
        <h3>Selecionar Período</h3>
        <div class="dates-grid">
          <div>
            <label>Início</label>
            <input id="hcd-period-start" type="date" value="${curStart}">
          </div>
          <div>
            <label>Fim</label>
            <input id="hcd-period-end" type="date" value="${curEnd}">
          </div>
        </div>
        <div class="form-actions">
          <button id="cd-period-cancel" class="btn">Cancelar</button>
          <button id="cd-period-apply"  class="btn-add">Aplicar</button>
        </div>
      </div>
    `;
        document.body.appendChild(overlay);

        const elStart = overlay.querySelector('#hcd-period-start');
        const elEnd = overlay.querySelector('#hcd-period-end');
        const btnCancel = overlay.querySelector('#cd-period-cancel');
        const btnApply = overlay.querySelector('#cd-period-apply');

        const close = () => overlay.remove();

        overlay.addEventListener('click', (ev) => {
            if (ev.target === overlay) close();
        });
        btnCancel.onclick = close;

        btnApply.onclick = () => {
            let sVal = (elStart?.value || '').slice(0, 10);
            let eVal = (elEnd?.value || '').slice(0, 10);
            if (!sVal || !eVal) {
                alert('Selecione as duas datas.');
                return;
            }

            const todayISO = toISODate(new Date());
            if (eVal > todayISO) eVal = todayISO;

            _filters.inicioISO = sVal;
            _filters.fimISO = eVal;
            startEl.value = sVal;
            endEl.value = eVal;

            buildHCDiario();
            close();
        };
    };

    startEl.onchange = () => {
        _filters.inicioISO = startEl.value.slice(0, 10);
        if (_filters.inicioISO && _filters.fimISO) buildHCDiario();
    };
    endEl.onchange = () => {
        _filters.fimISO = endEl.value.slice(0, 10);
        if (_filters.inicioISO && _filters.fimISO) buildHCDiario();
    };
}

async function ensureHCDiarioMountedOnce() {
    const host = document.querySelector(HOST_SEL);
    if (!host) return;

    if (!_mounted) {
        let html = '';
        try {
            const r = await fetch(PARTIAL_URL);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            html = await r.text();
        } catch {
            html = FALLBACK_HTML;
        }
        host.innerHTML = html;
        _mounted = true;

        host.querySelector('#hcd-refresh')?.remove();

        try {
            await fetchColabs();
        } catch {
            _colabs = [];
        }
    } else {
        if (!host.querySelector('#hcd-period-btn') || !host.querySelector('#hcd-start') || !host.querySelector('#hcd-end')) {
            if (!host.querySelector('.hcd-root')) {
                try {
                    const r = await fetch(PARTIAL_URL);
                    if (r.ok) host.innerHTML = await r.text();
                } catch {
                    host.innerHTML = FALLBACK_HTML;
                }
            }
        }
    }

    setDefaultMonthRange(host);
    await buildHCDiario();
}

window.addEventListener('hc-filters-changed', async (ev) => {
    const f = ev?.detail || {};
    _filters.matriz = f.matriz || '';
    _filters.svc = f.svc || '';

    if (_building) {
        _needsRebuild = true;
        return;
    }

    if (!_mounted) {
        await ensureHCDiarioMountedOnce();
    } else {
        try {
            await fetchColabs();
        } catch {
            _colabs = [];
        }
        buildHCDiario();
    }
});

['controle-diario-saved', 'cd-saved', 'cd-bulk-saved', 'colaborador-added', 'hc-refresh']
    .forEach(evt => window.addEventListener(evt, () => {
        if (_mounted) buildHCDiario();
    }));

window.ensureHCDiarioMountedOnce = ensureHCDiarioMountedOnce;
window.buildHCDiario = buildHCDiario;
