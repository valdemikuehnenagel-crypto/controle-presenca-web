import {getMatrizesPermitidas} from '../session.js';
import {supabase} from '../supabaseClient.js';

(function () {
    var HOST_SEL = '#hc-relatorio-abs';
    var state = {
        periodo: {start: '', end: ''},
        search: '',
        escala: '',
        matriz: '',
        regiao: '',
        gerencia: '',
        cargo: '',
        acao: '',
        entrevista: '',
        rows: [],
        paging: {limit: 2000, offset: 0, total: 0},
        mounted: false,
        dirty: false,
        firstLoad: true,
        showDebug: false
    };

    function pad2(n) {
        return (n < 10 ? '0' + n : '' + n);
    }

    function toISO(v) {
        if (v && v instanceof Date) return v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
        var s = String(v || '');
        var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
        var br = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
        if (br) {
            var d = +br[1], mo = +br[2], y = +br[3];
            if (y < 100) y += 2000;
            return y + '-' + pad2(mo) + '-' + pad2(d);
        }
        return s.slice(0, 10);
    }

    function parseAnyDateToISO(val) {
        if (!val) return '';
        var s = String(val);
        var mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (mISO) return mISO[1] + '-' + mISO[2] + '-' + mISO[3];
        var mBR = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (mBR) {
            var d = +mBR[1], mo = +mBR[2], yRaw = +mBR[3];
            var y = yRaw < 100 ? yRaw + 2000 : yRaw;
            return y + '-' + pad2(mo) + '-' + pad2(d);
        }
        try {
            var dt = new Date(s);
            if (!isNaN(dt)) return toISO(dt);
        } catch (_) {
        }
        return toISO(s);
    }

    function fmtBR(iso) {
        if (!iso) return '';
        var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? (m[3] + '/' + m[2] + '/' + m[1]) : iso;
    }

    const todayISO = () => toISO(new Date());

    function clampEndToToday(startISO, endISO) {
        if (!startISO || !endISO) return [startISO, endISO];
        var t = todayISO();
        return [startISO, endISO > t ? t : endISO];
    }

    function defaultCurrentMonth() {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return {start: toISO(start), end: toISO(today)};
    }

    function esc(s) {
        return String(s == null ? '' : s);
    }

    function norm(v) {
        return String(v == null ? '' : v).trim().toUpperCase();
    }

    function stripAccents(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function isActiveView() {
        return !!document.querySelector('#hc-relatorio-abs.hc-view.active');
    }

    async function loadSheetJS() {
        if (window.XLSX) return;
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        } catch (error) {
            console.error("Falha ao carregar a biblioteca XLSX:", error);
            alert("Erro ao carregar a biblioteca de exportação de Excel. Tente recarregar a página.");
        }
    }

    function ensureCidStyles() {
        if (document.getElementById('abs-cid-styles')) return;
        const style = document.createElement('style');
        style.id = 'abs-cid-styles';
        style.textContent = `
            /* Overlay do Modal de Busca */
            .cid-search-overlay {
                position: fixed; inset: 0; background: rgba(0,0,0,0.6); 
                z-index: 10000; display: none; align-items: center; justify-content: center;
                backdrop-filter: blur(2px);
                animation: fadeIn 0.2s ease-out;
            }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }            /* Card do Modal de Busca */
            .cid-search-card {
                background: white; width: 90%; max-width: 500px; border-radius: 8px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.3); display: flex; flex-direction: column;
                max-height: 85vh; overflow: hidden;
                animation: slideUp 0.2s ease-out;
            }
            @keyframes slideUp { from { transform: translateY(15px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }            /* Header */
            .cid-search-header {
                padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
                display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #003369;
            }            /* Corpo */
            .cid-search-body { padding: 16px; display: flex; flex-direction: column; height: 100%; overflow: hidden; }            /* Input de Busca */
            .cid-search-input {
                width: 100%; padding: 10px; font-size: 14px; border: 2px solid #02B1EE;
                border-radius: 6px; margin-bottom: 10px; box-sizing: border-box; outline: none;
            }            /* Lista de Resultados */
            .cid-result-list {
                list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1;
                border: 1px solid #e2e8f0; border-radius: 6px;
            }
            .cid-result-item {
                padding: 10px 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer;
                display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #334155;
            }
            .cid-result-item:hover { background: #f0f9ff; }            /* Badge do Código CID */
            .cid-code-badge { 
                background: #e0f2fe; color: #003369; padding: 3px 8px; 
                border-radius: 4px; font-weight: bold; font-size: 12px; 
            }            /* Item de Ação (Carregar todos) */
            .cid-action-row {
                background: #f8fafc; color: #003369; font-weight: 700; 
                justify-content: center; text-align: center;
            }
            .cid-action-row:hover { background: #e0f2fe; }
        `;
        document.head.appendChild(style);
    }

    async function fetchAllPagesGeneric(query, pageSize = 1000) {
        let from = 0;
        const all = [];
        while (true) {
            const {data, error} = await query.range(from, from + pageSize - 1);
            if (error) throw error;
            const batch = Array.isArray(data) ? data : [];
            all.push(...batch);
            if (batch.length < pageSize) break;
            from += pageSize;
        }
        return all;
    }

    async function loadMatrizesMapping() {
        const matrizesPermitidas = getMatrizesPermitidas();
        let query = supabase.from('Matrizes').select('MATRIZ, GERENCIA, REGIAO');
        if (matrizesPermitidas !== null) {
            query = query.in('MATRIZ', matrizesPermitidas);
        }
        const {data, error} = await query;
        if (error) {
            console.error("RelatorioABS: Erro ao buscar 'Matrizes'", error);
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

    var _colabIdx = null;

    async function getColabIndex() {
        if (_colabIdx) return _colabIdx;
        const matrizesMap = await loadMatrizesMapping();
        const matrizesPermitidas = getMatrizesPermitidas();
        const applyFilters = (query) => {
            if (matrizesPermitidas !== null) query = query.in('MATRIZ', matrizesPermitidas);
            if (state.matriz) query = query.eq('MATRIZ', state.matriz);
            return query;
        };
        let qAtivos = supabase
            .from('Colaboradores')
            .select('Nome, Contrato, MATRIZ, Escala, Cargo, Gestor, "ID GROOT", LDAP')
            .order('Nome', {ascending: true});
        qAtivos = applyFilters(qAtivos);
        let qDeslig = supabase
            .from('Desligados')
            .select('Nome, Contrato, MATRIZ, Escala, Cargo, Gestor, "Data de Desligamento", "ID GROOT", LDAP, Motivo')
            .order('Nome', {ascending: true});
        qDeslig = applyFilters(qDeslig);
        const [ativosRaw, desligadosRaw] = await Promise.all([
            fetchAllPagesGeneric(qAtivos, 1000),
            fetchAllPagesGeneric(qDeslig, 1000)
        ]);
        const enrichAndFilter = (colab) => {
            const mapping = matrizesMap.get(norm(colab.MATRIZ));
            const regiao = mapping?.regiao || '';
            const gerencia = mapping?.gerencia || '';
            if (state.regiao && norm(regiao) !== norm(state.regiao)) return null;
            if (state.gerencia && norm(gerencia) !== norm(state.gerencia)) return null;
            return {...colab, REGIAO: regiao, GERENCIA: gerencia};
        };
        const ativos = (Array.isArray(ativosRaw) ? ativosRaw : []).map(enrichAndFilter).filter(Boolean);
        const desligados = (Array.isArray(desligadosRaw) ? desligadosRaw : []).map(enrichAndFilter).filter(Boolean);
        const map = new Map();
        const addToMap = (arr, origem, dateGetter = null) => {
            arr.forEach(item => {
                const rawName = String(item.Nome || '');
                const nome = norm(rawName);
                if (!nome) return;
                const existing = map.get(nome) || {};
                let dt = null;
                if (dateGetter && typeof dateGetter === 'function') {
                    dt = dateGetter(item);
                }
                map.set(nome, {
                    ...existing,
                    Contrato: item.Contrato ?? existing.Contrato,
                    MATRIZ: item.MATRIZ ?? existing.MATRIZ,
                    REGIAO: item.REGIAO ?? existing.REGIAO,
                    GERENCIA: item.GERENCIA ?? existing.GERENCIA,
                    Escala: item.Escala ?? existing.Escala,
                    Cargo: item.Cargo ?? existing.Cargo,
                    Gestor: item.Gestor ?? existing.Gestor,
                    "ID GROOT": item["ID GROOT"] ?? existing["ID GROOT"],
                    LDAP: item.LDAP ?? existing.LDAP,
                    Motivo: item.Motivo ?? existing.Motivo,
                    _origem: origem,
                    _data_desligamento: dt || existing._data_desligamento
                });
            });
        };
        addToMap(desligados, 'Desligados', (d) => d['Data de Desligamento']);
        addToMap(ativos, 'Colaboradores');
        _colabIdx = map;
        return _colabIdx;
    }

    function scheduleRefresh(invalidate = false) {
        if (invalidate) _colabIdx = null;
        if (!state.mounted) {
            state.dirty = true;
            return;
        }
        if (isActiveView()) fetchAndRender(); else state.dirty = true;
    }

    window.addEventListener('hc-filters-changed', function (ev) {
        var f = (ev && ev.detail) ? ev.detail : {};
        var mudouMatriz = (typeof f.matriz === 'string' && state.matriz !== f.matriz);
        var mudouRegiao = (typeof f.regiao === 'string' && state.regiao !== f.regiao);
        var mudouGerencia = (typeof f.gerencia === 'string' && state.gerencia !== f.gerencia);
        if (mudouMatriz) state.matriz = f.matriz;
        if (mudouRegiao) state.regiao = f.regiao;
        if (mudouGerencia) state.gerencia = f.gerencia;
        if (mudouMatriz || mudouRegiao || mudouGerencia) {
            state.paging.offset = 0;
            scheduleRefresh(true);
        }
    });
    ['hc-refresh', 'controle-diario-saved', 'cd-saved', 'cd-bulk-saved'].forEach(evt => {
        window.addEventListener(evt, () => scheduleRefresh(false));
    });
    ['colaborador-added'].forEach(evt => {
        window.addEventListener(evt, () => scheduleRefresh(true));
    });
    window.addEventListener('hc-activated', function (ev) {
        if (ev && ev.detail && ev.detail.view === 'relatorio-abs') {
            ensureMounted(true);
            state.dirty = false;
        }
    });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && isActiveView() && state.mounted) {
            if (state.dirty) fetchAndRender();
        }
    });

    function watchActivation() {
        var host = document.querySelector(HOST_SEL);
        if (!host) return;
        var mo = new MutationObserver(function () {
            if (host.classList.contains('active')) {
                ensureMounted(true);
                if (state.dirty) fetchAndRender();
            }
        });
        mo.observe(host, {attributes: true, attributeFilter: ['class']});
    }

    function ensureMounted(forceEnsure) {
        if (forceEnsure !== true) forceEnsure = false;
        var host = document.querySelector(HOST_SEL);
        if (!host) return;
        if (typeof state.cargo !== 'string') state.cargo = '';
        if (typeof state.acao !== 'string') state.acao = '';
        if (typeof state.entrevista !== 'string') state.entrevista = '';
        var hasTable = !!(host.querySelector && host.querySelector('#abs-tbody'));
        if (state.mounted && hasTable && !forceEnsure) return;
        host.innerHTML =
            '<div class="abs-toolbar">' +
            '  <div class="abs-left">' +
            '    <input id="abs-search" type="search" placeholder="Pesquisar por nome..." />' +
            '    <select id="abs-filter-escala">' +
            '      <option value="">Escala</option>' +
            '      <option value="T1">T1</option>' +
            '      <option value="T2">T2</option>' +
            '      <option value="T3">T3</option>' +
            '    </select>' +
            '    <select id="abs-filter-cargo">' +
            '      <option value="">Cargo</option>' +
            '      <option value="AUXILIAR">AUXILIAR</option>' +
            '      <option value="CONFERENTE">CONFERENTE</option>' +
            '    </select>' +
            '    <select id="abs-filter-acao">' +
            '      <option value="">Ação</option>' +
            '      <option value="Advertência Verbal">Advertência Verbal</option>' +
            '      <option value="Advertência Escrita">Advertência Escrita</option>' +
            '      <option value="Suspensão">Suspensão</option>' +
            '      <option value="Afastamento">Afastamento</option>' +
            '      <option value="Desligamento">Desligamento</option>' +
            '    </select>' +
            '    <select id="abs-filter-entrevista">' +
            '      <option value="">Entrevista</option>' +
            '      <option value="SIM">Sim</option>' +
            '      <option value="NAO">Não</option>' +
            '      <option value="DES">DES (Desligado)</option>' +
            '    </select>' +
            '    <span id="abs-counts" class="abs-counts" aria-live="polite">' +
            '      Injustificado: 0 <span class="sep">|</span> Justificado: 0 <span class="sep">|</span> ABS Total: 0 <span class="sep">|</span> Entrevistas feitas: 0' +
            '    </span>' +
            '  </div>' +
            '  <div class="abs-right">' +
            '    <button id="abs-period" class="btn btn-add">Selecionar período</button>' +
            '    <button id="abs-export" class="btn btn-add">Exportar Dados</button>' +
            '  </div>' +
            '</div>' +
            (state.showDebug ? '<div id="abs-debug" class="abs-debug muted"></div>' : '') +
            '<div class="abs-table-wrap">' +
            '  <table class="abs-table">' +
            '    <thead>' +
            '      <tr>' +
            '        <th>GROOT ID</th>' +
            '        <th style="min-width:220px;text-align:left;">Nome</th>' +
            '        <th>Contrato</th>' +
            '        <th>Cargo</th>' +
            '        <th>Data</th>' +
            '        <th>Absenteísmo</th>' +
            '        <th>Entrevista</th>' +
            '        <th>Ação</th>' +
            '        <th>CID</th>' +
            '        <th>LDAP</th>' +
            '        <th>Motivo</th>' + /* Exibe a coluna unificada de motivo */
            '        <th>MATRIZ</th>' +
            '      </tr>' +
            '    </thead>' +
            '    <tbody id="abs-tbody"></tbody>' +
            '  </table>' +
            '</div>';
        state.mounted = true;
        document.getElementById('abs-export')?.addEventListener('click', handleExport);
        document.getElementById('abs-period')?.addEventListener('click', openPeriodModal);
        const elSearch = document.getElementById('abs-search');
        const elEscala = document.getElementById('abs-filter-escala');
        const elCargo = document.getElementById('abs-filter-cargo');
        const elAcao = document.getElementById('abs-filter-acao');
        const elEntrevista = document.getElementById('abs-filter-entrevista');
        elSearch?.addEventListener('input', function () {
            state.search = elSearch.value;
            renderRows();
        });
        elEscala?.addEventListener('change', function () {
            state.escala = elEscala.value;
            fetchAndRender();
        });
        elCargo?.addEventListener('change', function () {
            state.cargo = elCargo.value;
            fetchAndRender();
        });
        elAcao?.addEventListener('change', function () {
            state.acao = elAcao.value;
            fetchAndRender();
        });
        elEntrevista?.addEventListener('change', function () {
            state.entrevista = elEntrevista.value;
            fetchAndRender();
        });
        const tbody = document.getElementById('abs-tbody');
        if (tbody) {
            tbody.addEventListener('dblclick', function (ev) {
                const tr = ev.target?.closest ? ev.target.closest('tr.abs-row') : null;
                if (!tr) return;
                const idx = parseInt(tr.getAttribute('data-idx'), 10);
                const row = (state.rows || [])[idx];
                if (row) openEditModal(row);
            });
        }
        if (state.firstLoad) {
            const cur = defaultCurrentMonth();
            state.periodo.start = cur.start;
            state.periodo.end = cur.end;
            state.firstLoad = false;
        }
        updatePeriodButtonText();
        if (window.__HC_GLOBAL_FILTERS) {
            state.matriz = window.__HC_GLOBAL_FILTERS.matriz || '';
            state.regiao = window.__HC_GLOBAL_FILTERS.regiao || '';
            state.gerencia = window.__HC_GLOBAL_FILTERS.gerencia || '';
        }
        requestAnimationFrame(fetchAndRender);
        watchActivation();
    }

    function updatePeriodButtonText() {
        var b = document.getElementById('abs-period');
        if (!b) return;
        b.textContent = 'Selecionar período';
    }

    async function fetchControleDiarioPaginado(baseFilters, pageSize = 500) {
        let from = 0;
        const all = [];
        while (true) {
            let q = supabase
                .from('ControleDiario')
                .select('Numero, Nome, Data, Turno, Falta, Atestado, Entrevista, Acao, Observacao, CID, TipoAtestado')
                .gte('Data', baseFilters.startISO)
                .lt('Data', baseFilters.endISONextDay).or('Falta.gt.0,Atestado.gt.0')
                .order('Data', {ascending: false})
                .range(from, from + pageSize - 1);
            if (state.escala) q = q.eq('Turno', state.escala);
            const {data, error} = await q;
            if (error) throw error;
            const batch = Array.isArray(data) ? data : [];
            all.push(...batch);
            if (batch.length < pageSize) break;
            from += pageSize;
            if (from > 100000) break;
        }
        console.log(`Relatório ABS: Carregados ${all.length} registros (paginado).`);
        return all;
    }

    async function fetchAndRender() {
        var tbody = document.getElementById('abs-tbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="12" class="muted">Carregando…</td></tr>';
        var startISO = parseAnyDateToISO(state.periodo.start);
        var endStr = parseAnyDateToISO(state.periodo.end);
        [startISO, endStr] = clampEndToToday(startISO, endStr);
        var endISONextDay;
        if (endStr) {
            var parts = endStr.split('-').map(Number);
            var endDate = new Date(parts[0], parts[1] - 1, parts[2]);
            endDate.setDate(endDate.getDate() + 1);
            endISONextDay = toISO(endDate);
        } else {
            var today = new Date();
            today.setDate(today.getDate() + 1);
            endISONextDay = toISO(today);
        }
        if (!startISO) {
            startISO = defaultCurrentMonth().start;
        }
        try {
            const colabIndex = await getColabIndex();
            const rawControleRows = await fetchControleDiarioPaginado({startISO, endISONextDay}, 500);
            const uniqueRowsMap = new Map();
            (rawControleRows || []).forEach(r => {
                if (r.Numero && !uniqueRowsMap.has(r.Numero)) {
                    uniqueRowsMap.set(r.Numero, r);
                }
            });
            const controleRows = Array.from(uniqueRowsMap.values());
            const transformedRows = (controleRows || []).map(row => {
                const colabInfo = colabIndex.get(norm(row.Nome || '')) || {};
                const isJustificado = row.Atestado > 0;
                let motivoReal = '';
                if (isJustificado) {
                    motivoReal = row.TipoAtestado || '';
                } else {
                    motivoReal = row.Observacao || '';
                }
                let statusEntrevista = String(row.Entrevista || '').toUpperCase() === 'SIM' ? 'Sim' : 'Não';
                const dataDesligamento = colabInfo._data_desligamento;
                if (dataDesligamento) {
                    const dtDeslig = new Date(dataDesligamento + 'T00:00:00');
                    const hoje = new Date();
                    hoje.setHours(0, 0, 0, 0);
                    if (!isNaN(dtDeslig) && dtDeslig <= hoje) {
                        statusEntrevista = 'DES';
                    }
                }
                return {
                    Numero: row.Numero,
                    Nome: row.Nome,
                    Data: row.Data,
                    Absenteismo: isJustificado ? 'Justificado' : 'Injustificado',
                    Escala: row.Turno,
                    Entrevista: statusEntrevista,
                    Acao: row.Acao,
                    Observacao: row.Observacao,
                    CID: row.CID,
                    TipoAtestado: row.TipoAtestado,
                    MotivoReal: motivoReal,
                    Contrato: colabInfo.Contrato || null,
                    MATRIZ: colabInfo.MATRIZ || null,
                    REGIAO: colabInfo.REGIAO || null,
                    GERENCIA: colabInfo.GERENCIA || null,
                    Cargo: colabInfo.Cargo || null,
                    "ID GROOT": colabInfo["ID GROOT"] || null,
                    LDAP: colabInfo.LDAP || null,
                    _origemCadastro: colabInfo._origem || null
                };
            });
            const filteredRows = transformedRows.filter(r => {
                const cargo = norm(r.Cargo);
                if (cargo !== 'AUXILIAR' && cargo !== 'CONFERENTE') return false;
                if (state.cargo && cargo !== norm(state.cargo)) return false;
                if (state.acao && norm(r.Acao) !== norm(state.acao)) return false;
                if (state.matriz && norm(r.MATRIZ) !== norm(state.matriz)) return false;
                if (state.regiao && norm(r.REGIAO) !== norm(state.regiao)) return false;
                if (state.gerencia && norm(r.GERENCIA) !== norm(state.gerencia)) return false;
                if (state.entrevista) {
                    const temEntrevista = norm(r.Entrevista);
                    if (state.entrevista === 'DES' && temEntrevista !== 'DES') return false;
                    if (state.entrevista === 'SIM' && temEntrevista !== 'SIM') return false;
                    if (state.entrevista === 'NAO' && (temEntrevista === 'SIM' || temEntrevista === 'DES')) return false;
                }
                return true;
            });
            filteredRows.sort((a, b) => (b.Data || '').localeCompare(a.Data || ''));
            state.rows = filteredRows;
            state.dirty = false;
            renderRows();
        } catch (e) {
            console.error('RelatorioABS: fetch erro', e);
            var tb = document.getElementById('abs-tbody');
            if (tb) tb.innerHTML = '<tr><td colspan="12" class="muted">Erro ao carregar. Veja o console.</td></tr>';
            updateCounters([]);
        }
    }

    function updateCounters(filtered) {
        var el = document.getElementById('abs-counts');
        if (!el) return;
        filtered = Array.isArray(filtered) ? filtered : [];
        var injust = 0, just = 0, total = filtered.length, entrevistas = 0;
        for (var i = 0; i < filtered.length; i++) {
            var row = filtered[i] || {};
            var abs = String(row.Absenteismo || '').toUpperCase().trim();
            if (abs === 'INJUSTIFICADO') injust++;
            else if (abs === 'JUSTIFICADO') just++;
            var ent = String(row.Entrevista || '').toUpperCase().trim();
            if (ent === 'SIM') entrevistas++;
        }
        el.innerHTML = 'Injustificado: ' + injust +
            ' <span class="sep">|</span> Justificado: ' + just +
            ' <span class="sep">|</span> ABS Total: ' + total +
            ' <span class="sep">|</span> Entrevistas feitas: ' + entrevistas;
    }

    function renderRows() {
        var tbody = document.getElementById('abs-tbody');
        if (!tbody) {
            updateCounters([]);
            return;
        }
        var s = stripAccents(state.search || '').toLowerCase();
        var filtered = (state.rows || []).filter(function (r) {
            var nm = stripAccents(String(r.Nome || '')).toLowerCase();
            if (s && nm.indexOf(s) === -1) return false;
            return true;
        });
        updateCounters(filtered);
        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="12" class="muted">Nenhum registro encontrado para o período e filtros selecionados.</td></tr>';
            return;
        }
        var frag = document.createDocumentFragment();
        filtered.forEach(function (row) {
            var tr = document.createElement('tr');
            tr.tabIndex = 0;
            tr.className = 'abs-row';
            tr.dataset.id = row.Numero;
            var originalIndex = state.rows.findIndex(r => r.Numero === row.Numero);
            tr.setAttribute('data-idx', String(originalIndex));
            let entDisplay = row.Entrevista;
            let entStyle = '';
            if (entDisplay === 'DES') {
                entStyle = 'color: #ef4444; font-weight: bold; font-size: 0.9em;';
            }
            tr.innerHTML =
                '<td>' + esc(row["ID GROOT"] || '') + '</td>' +
                '<td class="cell-name">' + esc(row.Nome || '') + '</td>' +
                '<td>' + esc(row.Contrato || '') + '</td>' +
                '<td>' + esc(row.Cargo || '') + '</td>' +
                '<td>' + fmtBR(parseAnyDateToISO(row.Data)) + '</td>' +
                '<td>' + esc(row.Absenteismo || '') + '</td>' +
                '<td style="' + entStyle + '">' + entDisplay + '</td>' +
                '<td>' + esc(row.Acao || '') + '</td>' +
                '<td>' + esc(row.CID || '') + '</td>' +
                '<td>' + esc(row.LDAP || '') + '</td>' +
                '<td>' + esc(row.MotivoReal || '') + '</td>' + /* Usa o Motivo unificado */
                '<td>' + esc(row.MATRIZ || '') + '</td>';
            frag.appendChild(tr);
        });
        tbody.replaceChildren(frag);
    }

    function openEditModal(row) {
        ensureCidStyles();
        var overlay = document.createElement('div');
        overlay.className = 'abs-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,.45)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '9999';
        var modal = document.createElement('div');
        modal.className = 'abs-modal';
        modal.style.background = '#fff';
        modal.style.borderRadius = '12px';
        modal.style.padding = '16px';
        modal.style.minWidth = '420px';
        modal.style.maxWidth = '90vw';
        modal.style.boxShadow = '0 10px 30px rgba(0,0,0,.25)';
        var absInicial = String(row.Absenteismo || '').toUpperCase().trim();
        var isJustificadoInicial = absInicial === 'JUSTIFICADO';
        modal.innerHTML =
            '<h3 style="margin:0 0 12px 0; color:#003369;">Atualizar registro de absenteísmo</h3>' + '<div class="abs-modal-meta" style="font-size:13px; color:#475569; line-height:1.5; margin-bottom:15px; display:grid; grid-template-columns:1fr 1fr; gap:4px 12px; background:#f8fafc; padding:10px; border-radius:8px; border:1px solid #e2e8f0;">' +
            '  <div><strong style="color:#003369">Nome:</strong> ' + esc(row.Nome) + '</div>' +
            '  <div><strong style="color:#003369">Data:</strong> ' + fmtBR(parseAnyDateToISO(row.Data)) + '</div>' +
            '  <div><strong style="color:#003369">Escala:</strong> ' + esc(row.Escala || '') + '</div>' +
            '  <div><strong style="color:#003369">MATRIZ:</strong> ' + esc(row.MATRIZ || '') + '</div>' +
            '</div>' + '<div class="abs-modal-form" style="display:flex;flex-direction:column;gap:10px;">' + '  <div>' +
            '    <label style="font-weight:700; font-size:12px; color:#475569;">Tipo de Absenteísmo</label>' +
            '    <select id="abs-status-select" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-weight:600; color:#334155;">' +
            '      <option value="INJUSTIFICADO">Injustificado</option>' +
            '      <option value="JUSTIFICADO">Justificado</option>' +
            '    </select>' +
            '  </div>' + '  <div>' +
            '    <label style="font-weight:700; font-size:12px; color:#475569;">Entrevista feita?</label>' +
            '    <div class="abs-radio" style="display:flex; gap:16px; margin-top:4px;">' +
            '      <label style="cursor:pointer; display:flex; align-items:center; gap:4px;"><input type="radio" name="abs-entrevista" value="SIM"> Sim</label>' +
            '      <label style="cursor:pointer; display:flex; align-items:center; gap:4px;"><input type="radio" name="abs-entrevista" value="NAO"> Não</label>' +
            '    </div>' +
            '  </div>' + '  <div id="abs-entrevista-details" style="display:none; flex-direction:column; gap:10px; padding:10px; background:#f1f5f9; border-radius:8px; border:1px solid #e2e8f0;">' + '    <div id="abs-injustificado-fields" style="display:none; flex-direction:column; gap:8px;">' +
            '      <label style="font-weight:700; font-size:12px; color:#475569;">Motivo (Falta Injustificada)</label>' +
            '      <select id="abs-obs-injustificado" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px;">' +
            '        <option value="">— Selecionar —</option>' +
            '        <option>Problemas de saúde sem atestado</option>' +
            '        <option>Pediu demissão/desistência</option>' +
            '        <option>Problemas pessoais</option>' +
            '      </select>' +
            '    </div>' + '    <div id="abs-justificado-fields" style="display:none; flex-direction:column; gap:8px;">' +
            '      <label style="font-weight:700; font-size:12px; color:#475569;">Motivo (Falta Justificada)</label>' +
            '      <select id="abs-tipo-atestado" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px;">' +
            '        <option value="">— Selecionar —</option>' +
            '        <option>Licença Maternidade/Paternidade</option>' +
            '        <option>Licença Nojo</option>' +
            '        <option>Atestado</option>' +
            '        <option>Problema com Fretado</option>' +
            '      </select>' + '      <div id="abs-cid-container" style="display:none; flex-direction:column; gap:4px;">' +
            '        <label style="font-weight:700; font-size:12px; color:#475569;">CID (Patologia)</label>' +
            '        <div style="display:flex; gap:8px;">' +
            '            <input type="text" id="abs-cid-input" placeholder="Selecione via lupa..." readonly style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; background-color:white; cursor:pointer; font-weight:600; color:#334155;"/>' +
            '            <button id="btn-search-cid" type="button" style="background:#003369; color:white; border:none; width:40px; border-radius:6px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:16px;">🔎</button>' +
            '        </div>' +
            '      </div>' + '      <div>' +
            '          <label style="font-weight:700; font-size:12px; color:#475569;">Observação Adicional</label>' +
            '          <input type="text" id="abs-obs-justificado" placeholder="Detalhes..." style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;"/>' +
            '      </div>' +
            '    </div>' +
            '  </div>' + '  <div>' +
            '    <label style="font-weight:700; font-size:12px; color:#475569;">Ação tomada</label>' +
            '    <select id="abs-acao" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px;">' +
            '      <option value="">— Selecionar —</option>' +
            '      <option>Advertência Verbal</option>' +
            '      <option>Advertência Escrita</option>' +
            '      <option>Suspensão</option>' +
            '      <option>Afastamento</option>' +
            '      <option>Desligamento</option>' +
            '    </select>' +
            '  </div>' + '</div>' + '<div class="abs-modal-actions" style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; padding-top:15px; border-top:1px solid #f1f5f9;">' +
            '  <button class="btn" id="abs-cancel" style="padding:8px 16px; border-radius:6px; border:1px solid #cbd5e1; background:white; cursor:pointer;">Cancelar</button>' +
            '  <button class="btn-add" id="abs-save" style="padding:8px 16px; border-radius:6px; border:none; background:#2563eb; color:white; cursor:pointer; font-weight:600;">Salvar Alterações</button>' +
            '</div>';
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        var searchOverlay = document.createElement('div');
        searchOverlay.className = 'cid-search-overlay';
        searchOverlay.innerHTML =
            '<div class="cid-search-card">' +
            '   <div class="cid-search-header">' +
            '       <span>🔎 Buscar Patologia</span>' +
            '       <button id="cid-search-close" style="background:transparent; border:none; font-size:24px; cursor:pointer; color:#64748b;">&times;</button>' +
            '   </div>' +
            '   <div class="cid-search-body">' +
            '       <input type="text" id="cid-search-input" class="cid-search-input" placeholder="Digite código ou nome (Ex: A80)...">' +
            '       <ul id="cid-result-list" class="cid-result-list">' +
            '           <li style="padding:20px; text-align:center; color:#94a3b8;">Digite para buscar ou clique em "Carregar Todos"</li>' +
            '       </ul>' +
            '   </div>' +
            '</div>';
        document.body.appendChild(searchOverlay);
        var selStatus = modal.querySelector('#abs-status-select');
        var radioSim = modal.querySelector('input[value="SIM"]');
        var radioNao = modal.querySelector('input[value="NAO"]');
        var selAcao = modal.querySelector('#abs-acao');
        var selTipoAtestado = modal.querySelector('#abs-tipo-atestado');
        var cidInput = modal.querySelector('#abs-cid-input');
        var btnSearchCid = modal.querySelector('#btn-search-cid');
        var searchInput = searchOverlay.querySelector('#cid-search-input');
        var resultList = searchOverlay.querySelector('#cid-result-list');
        var btnCloseSearch = searchOverlay.querySelector('#cid-search-close');

        function openCidSearch() {
            searchOverlay.style.display = 'flex';
            searchInput.value = '';
            resultList.innerHTML = `
                <li class="cid-result-item cid-action-row" id="cid-load-all">
                    📂 Carregar base completa (pode demorar)
                </li>
                <li style="padding:20px; text-align:center; color:#94a3b8;">Ou digite o código/nome acima...</li>
            `;
            document.getElementById('cid-load-all').addEventListener('click', loadAllCids);
            setTimeout(() => searchInput.focus(), 100);
        }

        function closeCidSearch() {
            searchOverlay.style.display = 'none';
        }

        async function loadAllCids() {
            resultList.innerHTML = '<li style="padding:20px; text-align:center; color:#64748b;">Carregando dados...</li>';
            const {data, error} = await supabase
                .from('pcd_cids')
                .select('codigo, patologia')
                .limit(1000)
                .order('codigo', {ascending: true});
            if (error) {
                console.error(error);
                resultList.innerHTML = '<li style="color:#ef4444; padding:10px; text-align:center;">Erro ao carregar.</li>';
                return;
            }
            renderCidList(data);
        }

        async function filterCids(termo) {
            if (termo.length < 2) return;
            const {data, error} = await supabase
                .from('pcd_cids')
                .select('codigo, patologia')
                .or(`codigo.ilike.%${termo}%,patologia.ilike.%${termo}%`)
                .limit(50);
            if (error) {
                console.error(error);
                return;
            }
            renderCidList(data);
        }

        function renderCidList(data) {
            resultList.innerHTML = '';
            if (!data || data.length === 0) {
                resultList.innerHTML = '<li style="color:#ef4444; padding:20px; text-align:center;">Nenhum CID encontrado.</li>';
                return;
            }
            data.forEach(cid => {
                var li = document.createElement('li');
                li.className = 'cid-result-item';
                li.innerHTML =
                    '<span>' + esc(cid.patologia) + '</span>' +
                    '<span class="cid-code-badge">' + esc(cid.codigo) + '</span>';
                li.onclick = function () {
                    cidInput.value = cid.codigo + ' - ' + cid.patologia;
                    closeCidSearch();
                };
                resultList.appendChild(li);
            });
        }

        btnSearchCid.addEventListener('click', openCidSearch);
        cidInput.addEventListener('click', openCidSearch);
        btnCloseSearch.addEventListener('click', closeCidSearch);
        searchOverlay.addEventListener('click', function (ev) {
            if (ev.target === searchOverlay) closeCidSearch();
        });
        searchInput.addEventListener('input', function (e) {
            filterCids(e.target.value);
        });
        selStatus.value = isJustificadoInicial ? 'JUSTIFICADO' : 'INJUSTIFICADO';

        function toggleConditionalFields() {
            var entrevistaSim = radioSim.checked;
            modal.querySelector('#abs-entrevista-details').style.display = entrevistaSim ? 'flex' : 'none';
            if (entrevistaSim) {
                var currentStatus = selStatus.value;
                if (currentStatus === 'INJUSTIFICADO') {
                    modal.querySelector('#abs-injustificado-fields').style.display = 'flex';
                    modal.querySelector('#abs-justificado-fields').style.display = 'none';
                } else {
                    modal.querySelector('#abs-injustificado-fields').style.display = 'none';
                    modal.querySelector('#abs-justificado-fields').style.display = 'flex';
                    modal.querySelector('#abs-cid-container').style.display = (selTipoAtestado.value === 'Atestado') ? 'flex' : 'none';
                }
            } else {
                modal.querySelector('#abs-injustificado-fields').style.display = 'none';
                modal.querySelector('#abs-justificado-fields').style.display = 'none';
            }
        }

        selStatus.addEventListener('change', toggleConditionalFields);
        radioSim.addEventListener('change', toggleConditionalFields);
        radioNao.addEventListener('change', toggleConditionalFields);
        selTipoAtestado.addEventListener('change', toggleConditionalFields);
        if (String(row.Entrevista || '').toUpperCase() === 'SIM') radioSim.checked = true; else radioNao.checked = true;
        selAcao.value = row.Acao || '';
        cidInput.value = row.CID || '';
        if (isJustificadoInicial) {
            selTipoAtestado.value = row.TipoAtestado || '';
            modal.querySelector('#abs-obs-justificado').value = row.Observacao || '';
        } else {
            modal.querySelector('#abs-obs-injustificado').value = row.Observacao || '';
        }
        toggleConditionalFields();
        modal.querySelector('#abs-cancel')?.addEventListener('click', () => {
            document.body.removeChild(overlay);
            if (searchOverlay.parentNode) document.body.removeChild(searchOverlay);
        });
        overlay.addEventListener('click', function (ev) {
            if (ev.target === overlay) {
                document.body.removeChild(overlay);
                if (searchOverlay.parentNode) document.body.removeChild(searchOverlay);
            }
        });
        var btnSave = modal.querySelector('#abs-save');
        btnSave.addEventListener('click', async function () {
            btnSave.disabled = true;
            btnSave.textContent = 'Salvando...';
            var entrevista = (modal.querySelector('input[name="abs-entrevista"]:checked') || {}).value || 'NAO';
            var acao = selAcao.value || null;
            var novoStatus = selStatus.value;
            var updatePayload = {
                Entrevista: entrevista,
                Acao: acao,
                Observacao: null,
                TipoAtestado: null,
                CID: null, Falta: (novoStatus === 'INJUSTIFICADO' ? 1 : 0),
                Atestado: (novoStatus === 'JUSTIFICADO' ? 1 : 0)
            };
            if (entrevista === 'SIM') {
                if (novoStatus === 'INJUSTIFICADO') {
                    updatePayload.Observacao = modal.querySelector('#abs-obs-injustificado').value || null;
                } else if (novoStatus === 'JUSTIFICADO') {
                    updatePayload.TipoAtestado = selTipoAtestado.value || null;
                    updatePayload.Observacao = modal.querySelector('#abs-obs-justificado').value || null;
                    if (updatePayload.TipoAtestado === 'Atestado') {
                        updatePayload.CID = (cidInput.value || '').trim() || null;
                    }
                }
            }
            try {
                const {error} = await supabase.from('ControleDiario').update(updatePayload).eq('Numero', row.Numero);
                if (error) throw error;
                window.dispatchEvent(new CustomEvent('controle-diario-saved', {detail: {id: row.Numero}}));
                document.body.removeChild(overlay);
                if (searchOverlay.parentNode) document.body.removeChild(searchOverlay);
            } catch (e) {
                console.error('Erro ao salvar:', e);
                alert('Falha ao salvar. Verifique o console.');
                btnSave.disabled = false;
                btnSave.textContent = 'Salvar Alterações';
            }
        });
    }

    function openPeriodModal() {
        const curStart = toISO(state.periodo.start) || defaultCurrentMonth().start;
        const curEnd = toISO(state.periodo.end) || defaultCurrentMonth().end;
        const today = new Date();
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
              <div><label>Início</label><input id="abs-period-start" type="date" value="${esc(curStart)}"></div>
              <div><label>Fim</label><input id="abs-period-end"   type="date" value="${esc(curEnd)}"></div>
            </div>
            <div class="form-actions">
              <button id="cd-period-cancel" class="btn">Cancelar</button>
              <button id="cd-period-apply"  class="btn-add">Aplicar</button>
            </div>
          </div>`;
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
        const elStart = overlay.querySelector('#abs-period-start');
        const elEnd = overlay.querySelector('#abs-period-end');
        const btnCancel = overlay.querySelector('#cd-period-cancel');
        const btnApply = overlay.querySelector('#cd-period-apply');
        const close = () => overlay.remove();
        overlay.addEventListener('click', (ev) => {
            if (ev.target === overlay) close();
        });
        btnCancel.onclick = close;
        overlay.querySelector('#cdp-today').onclick = () => {
            const iso = toISO(today);
            [state.periodo.start, state.periodo.end] = [iso, iso];
            state.paging.offset = 0;
            updatePeriodButtonText();
            close();
            fetchAndRender();
        };
        overlay.querySelector('#cdp-yday').onclick = () => {
            const iso = toISO(yesterday);
            [state.periodo.start, state.periodo.end] = [iso, iso];
            state.paging.offset = 0;
            updatePeriodButtonText();
            close();
            fetchAndRender();
        };
        overlay.querySelector('#cdp-prevmo').onclick = () => {
            const s = toISO(prevStart);
            const e = toISO(prevEnd);
            const [cs, ce] = clampEndToToday(s, e);
            state.periodo.start = cs;
            state.periodo.end = ce;
            state.paging.offset = 0;
            updatePeriodButtonText();
            close();
            fetchAndRender();
        };
        btnApply.onclick = () => {
            let sVal = (elStart?.value || '').slice(0, 10);
            let eVal = (elEnd?.value || '').slice(0, 10);
            if (!sVal || !eVal) {
                alert('Selecione as duas datas.');
                return;
            }
            [sVal, eVal] = clampEndToToday(sVal, eVal);
            state.periodo.start = sVal;
            state.periodo.end = eVal;
            state.paging.offset = 0;
            updatePeriodButtonText();
            close();
            fetchAndRender();
        };
    }

    async function handleExport() {
        if (!state.periodo.start || !state.periodo.end) {
            alert('Selecione um período antes de exportar.');
            return;
        }
        var btn = document.getElementById('abs-export');
        if (btn) btn.disabled = true;
        try {
            await loadSheetJS();
            if (!window.XLSX) {
                throw new Error("Biblioteca XLSX não carregou.");
            }
            var s = stripAccents(state.search || '').toLowerCase();
            var rows = (state.rows || []).filter(function (r) {
                var nm = stripAccents(String(r.Nome || '')).toLowerCase();
                return !s || nm.indexOf(s) !== -1;
            });
            if (!rows.length) {
                alert('Nada para exportar com os filtros atuais.');
                return;
            }
            var exportRows = rows.map(function (r) {
                return {
                    'GROOT ID': r["ID GROOT"] || '',
                    'Nome': r.Nome || '',
                    'Contrato': r.Contrato || '',
                    'Cargo': r.Cargo || '',
                    'Data': fmtBR(parseAnyDateToISO(r.Data || '')),
                    'Absenteismo': r.Absenteismo || '',
                    'Entrevista': r.Entrevista || '',
                    'Ação': r.Acao || '',
                    'CID': r.CID || '',
                    'LDAP': r.LDAP || '',
                    'Motivo': r.MotivoReal || '',
                    'MATRIZ': r.MATRIZ || ''
                };
            });
            const ws = XLSX.utils.json_to_sheet(exportRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Relatório ABS');
            const fileName = `relatorio_abs_${toISO(state.periodo.start)}_a_${toISO(state.periodo.end)}.xlsx`;
            XLSX.writeFile(wb, fileName);
        } catch (e) {
            console.error('Export erro', e);
            alert('Falha ao exportar. Veja o console.');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    window.ensureHCRelatorioMountedOnce = function () {
        ensureMounted(true);
        if (state.dirty || isActiveView()) fetchAndRender();
    };
    window.buildHCRelatorio = function () {
        ensureMounted(true);
        fetchAndRender();
    };
    window.hcRelatorioApplyFilters = function (f) {
        f = f || {};
        state.matriz = f.matriz || '';
        state.regiao = f.regiao || '';
        state.gerencia = f.gerencia || '';
        state.paging.offset = 0;
        scheduleRefresh(true);
    };
})();