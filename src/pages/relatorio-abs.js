import {getMatrizesPermitidas} from '../session.js';
import {supabase} from '../supabaseClient.js';

(function () {
    var HOST_SEL = '#hc-relatorio-abs';
    var state = {
        periodo: {start: '', end: ''},
        search: '',
        escala: '',
        svc: '',
        matriz: '',
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

    function esc(s) {
        return String(s == null ? '' : s);
    }

    function norm(v) {
        return String(v == null ? '' : v).trim().toUpperCase();
    }

    function clean(v) {
        return String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
    }

    function stripAccents(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function isActiveView() {
        return !!document.querySelector('#hc-relatorio-abs.hc-view.active');
    }

    function defaultCurrentMonth() {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return {start: toISO(start), end: toISO(today)};
    }

    /* ---------------------------
       Paginação genérica (helpers)
    ---------------------------- */
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

    var _colabIdx = null;

    /**
     * Índice unificado de dados cadastrais por Nome:
     * - Colaboradores (ativos)
     * - Desligados (últimos dados antes do desligamento)
     * Regras:
     *   - Se o nome existir nas duas, o ATIVO prevalece.
     *   - Caso contrário, usamos o do DESLIGADOS.
     */
    async function getColabIndex() {
        if (_colabIdx) return _colabIdx;

        const matrizesPermitidas = getMatrizesPermitidas();

        // Base (ativos)
        let qAtivos = supabase
            .from('Colaboradores')
            .select('Nome, SVC, MATRIZ, Escala, Cargo, Gestor')
            .order('Nome', {ascending: true});

        if (matrizesPermitidas !== null) qAtivos = qAtivos.in('MATRIZ', matrizesPermitidas);
        if (state.matriz) qAtivos = qAtivos.eq('MATRIZ', state.matriz);
        if (state.svc) qAtivos = qAtivos.eq('SVC', state.svc);

        // Desligados (histórico)
        // Campos esperados (exemplo do Hugo): Nome, Contrato, Cargo, Data de Desligamento, Período Trabalhado,
        // Escala, SVC, MATRIZ, Gestor, Motivo...
        let qDeslig = supabase
            .from('Desligados')
            .select('Nome, SVC, MATRIZ, Escala, Cargo, Gestor, "Data de Desligamento"')
            .order('Nome', {ascending: true});

        if (matrizesPermitidas !== null) qDeslig = qDeslig.in('MATRIZ', matrizesPermitidas);
        if (state.matriz) qDeslig = qDeslig.eq('MATRIZ', state.matriz);
        if (state.svc) qDeslig = qDeslig.eq('SVC', state.svc);

        const [ativos, desligados] = await Promise.all([
            fetchAllPagesGeneric(qAtivos, 1000),
            fetchAllPagesGeneric(qDeslig, 1000)
        ]);

        // Monta índice com prioridade para ATIVOS
        const map = new Map();
        (Array.isArray(desligados) ? desligados : []).forEach(d => {
            const nome = String(d.Nome || '');
            if (!nome) return;
            map.set(nome, {
                SVC: d.SVC ?? null,
                MATRIZ: d.MATRIZ ?? null,
                Escala: d.Escala ?? null,
                Cargo: d.Cargo ?? null,
                Gestor: d.Gestor ?? null,
                _origem: 'Desligados',
                _data_desligamento: d['Data de Desligamento'] || null
            });
        });
        (Array.isArray(ativos) ? ativos : []).forEach(c => {
            const nome = String(c.Nome || '');
            if (!nome) return;
            // Ativo sobrescreve o que veio do desligado se houver duplicidade
            map.set(nome, {
                SVC: c.SVC ?? (map.get(nome)?.SVC ?? null),
                MATRIZ: c.MATRIZ ?? (map.get(nome)?.MATRIZ ?? null),
                Escala: c.Escala ?? (map.get(nome)?.Escala ?? null),
                Cargo: c.Cargo ?? (map.get(nome)?.Cargo ?? null),
                Gestor: c.Gestor ?? (map.get(nome)?.Gestor ?? null),
                _origem: 'Colaboradores',
                _data_desligamento: map.get(nome)?._data_desligamento ?? null
            });
        });

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
        var mudouSvc = (typeof f.svc === 'string' && state.svc !== f.svc);
        if (mudouMatriz) state.matriz = f.matriz;
        if (mudouSvc) state.svc = f.svc;
        if (mudouMatriz || mudouSvc) {
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
        var hasTable = !!(host.querySelector && host.querySelector('#abs-tbody'));
        if (state.mounted && hasTable && !forceEnsure) return;

        host.innerHTML =
            '<div class="abs-toolbar">' +
            '  <div class="abs-left">' +
            '    <input id="abs-search" type="search" placeholder="Pesquisar por nome..." />' +
            '    <select id="abs-filter-escala">' +
            '      <option value="">Escala: Todas</option>' +
            '      <option value="T1">T1</option>' +
            '      <option value="T2">T2</option>' +
            '      <option value="T3">T3</option>' +
            '    </select>' +
            '    <select id="abs-filter-cargo">' +
            '      <option value="">Cargo: Todos</option>' +
            '      <option value="AUXILIAR">AUXILIAR</option>' +
            '      <option value="CONFERENTE">CONFERENTE</option>' +
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
            '        <th style="min-width:220px;text-align:left;">Nome</th>' +
            '        <th>Data</th>' +
            '        <th>Absenteísmo</th>' +
            '        <th>Escala</th>' +
            '        <th>Cargo</th>' +
            '        <th>Entrevista</th>' +
            '        <th>Ação</th>' +
            '        <th>CID</th>' +
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
        updatePeriodButton();

        if (window.__HC_GLOBAL_FILTERS) {
            state.matriz = window.__HC_GLOBAL_FILTERS.matriz || '';
            state.svc = window.__HC_GLOBAL_FILTERS.svc || '';
        }

        requestAnimationFrame(fetchAndRender);
        watchActivation();
    }

    function updatePeriodButton() {
        var b = document.getElementById('abs-period');
        if (!b) return;
        var start = state.periodo.start, end = state.periodo.end;
        b.textContent = (start && end) ? ('Período: ' + fmtBR(start) + ' → ' + fmtBR(end)) : 'Selecionar período';
    }

    async function fetchControleDiarioPaginado(baseFilters, pageSize = 500) {
        let from = 0;
        const all = [];
        while (true) {
            let q = supabase
                .from('ControleDiario')
                .select('Numero, Nome, Data, Turno, Falta, Atestado, Entrevista, Acao, Observacao, CID, TipoAtestado')
                .gte('Data', baseFilters.startISO)
                .lt('Data', baseFilters.endISONextDay)
                .or('Falta.gt.0,Atestado.gt.0')
                .order('Data', {ascending: false})
                .range(from, from + pageSize - 1);

            if (state.escala) q = q.eq('Turno', state.escala);

            const {data, error} = await q;
            if (error) throw error;

            const batch = Array.isArray(data) ? data : [];
            all.push(...batch);

            if (batch.length < pageSize) break;
            from += pageSize;
        }
        return all;
    }

    async function fetchAndRender() {
        var tbody = document.getElementById('abs-tbody');
        if (!tbody) {
            return;
        }
        tbody.innerHTML = '<tr><td colspan="9" class="muted">Carregando…</td></tr>';

        var startISO = parseAnyDateToISO(state.periodo.start);
        var endStr = parseAnyDateToISO(state.periodo.end);
        var endISONextDay;
        if (endStr) {
            var parts = endStr.split('-').map(Number);
            var endDate = new Date(parts[0], parts[1] - 1, parts[2]);
            endDate.setDate(endDate.getDate() + 1);
            endISONextDay = toISO(endDate);
        } else {
            endISONextDay = endStr;
        }

        try {
            // Índice unificado (Ativos + Desligados)
            const colabIndex = await getColabIndex();

            // Busca Controle Diário (inclui históricos de desligados)
            const controleRows = await fetchControleDiarioPaginado({startISO, endISONextDay}, 500);

            // Enriquecimento com SVC/MATRIZ/Escala/Cargo do índice unificado
            const transformedRows = (controleRows || []).map(row => {
                const colabInfo = colabIndex.get(String(row.Nome || '')) || {};
                return {
                    Numero: row.Numero,
                    Nome: row.Nome,
                    Data: row.Data,
                    Absenteismo: row.Atestado > 0 ? 'Justificado' : 'Injustificado',
                    Escala: row.Turno,                    // do ControleDiario do dia
                    Entrevista: row.Entrevista,
                    Acao: row.Acao,
                    Observacao: row.Observacao,
                    CID: row.CID,
                    TipoAtestado: row.TipoAtestado,
                    SVC: colabInfo.SVC || null,
                    MATRIZ: colabInfo.MATRIZ || null,
                    Cargo: colabInfo.Cargo || null,
                    _origemCadastro: colabInfo._origem || null // debug opcional
                };
            });

            // Filtros por cargo/SVC/MATRIZ (mantidos)
            const filteredRows = transformedRows.filter(r => {
                const cargo = norm(r.Cargo);
                if (cargo !== 'AUXILIAR' && cargo !== 'CONFERENTE') return false;
                if (state.cargo && cargo !== norm(state.cargo)) return false;
                if (state.svc && norm(r.SVC) !== norm(state.svc)) return false;
                if (state.matriz && norm(r.MATRIZ) !== norm(state.matriz)) return false;
                return true;
            });

            filteredRows.sort((a, b) => (b.Data || '').localeCompare(a.Data || ''));

            state.rows = filteredRows;
            state.dirty = false;
            renderRows();
        } catch (e) {
            console.error('RelatorioABS: fetch erro', e);
            var tb = document.getElementById('abs-tbody');
            if (tb) tb.innerHTML = '<tr><td colspan="9" class="muted">Erro ao carregar. Veja o console.</td></tr>';
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
            tbody.innerHTML = '<tr><td colspan="9" class="muted">Nenhum registro encontrado para o período e filtros selecionados.</td></tr>';
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
            tr.innerHTML =
                '<td class="cell-name">' + esc(row.Nome || '') + '</td>' +
                '<td>' + fmtBR(parseAnyDateToISO(row.Data)) + '</td>' +
                '<td>' + esc(row.Absenteismo || '') + '</td>' +
                '<td>' + esc(row.Escala || '') + '</td>' +
                '<td>' + esc(row.Cargo || '') + '</td>' +
                '<td>' + (String(row.Entrevista || '').toUpperCase() === 'SIM' ? 'Sim' : 'Não') + '</td>' +
                '<td>' + esc(row.Acao || '') + '</td>' +
                '<td>' + esc(row.CID || '') + '</td>' +
                '<td>' + esc(row.MATRIZ || '') + '</td>';
            frag.appendChild(tr);
        });
        tbody.replaceChildren(frag);
    }

    function openEditModal(row) {
        var overlay = document.createElement('div');
        overlay.className = 'abs-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
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
        modal.innerHTML =
            '<h3 style="margin:0 0 12px 0;">Atualizar registro de absenteísmo</h3>' +
            '<div class="abs-modal-meta" style="font-size:14px;line-height:1.4;margin-bottom:12px;">' +
            '  <div><strong>Nome:</strong> ' + esc(row.Nome) + '</div>' +
            '  <div><strong>Data:</strong> ' + fmtBR(parseAnyDateToISO(row.Data)) + '</div>' +
            '  <div><strong>Absenteísmo:</strong> ' + esc(row.Absenteismo || '') + '</div>' +
            '  <div><strong>Escala:</strong> ' + esc(row.Escala || '') + '</div>' +
            '</div>' +
            '<div class="abs-modal-form" style="display:flex;flex-direction:column;gap:8px;">' +
            '  <label>Entrevista feita?</label>' +
            '  <div class="abs-radio" style="display:flex;gap:16px;">' +
            '    <label><input type="radio" name="abs-entrevista" value="SIM"> Sim</label>' +
            '    <label><input type="radio" name="abs-entrevista" value="NAO"> Não</label>' +
            '  </div>' +
            '  <div id="abs-entrevista-details" style="display:none; flex-direction:column; gap:8px; margin-top:6px;">' +
            '    <div id="abs-injustificado-fields" style="display:none; flex-direction:column; gap:8px;">' +
            '      <label>Observação (Falta Injustificada)</label>' +
            '      <select id="abs-obs-injustificado" class="abs-observacao-select">' +
            '        <option value="">— Selecionar —</option>' +
            '        <option>Falecimento parente</option>' +
            '        <option>Proposital</option>' +
            '        <option>Não quis informar</option>' +
            '        <option>Problemas pessoais</option>' +
            '      </select>' +
            '    </div>' +
            '    <div id="abs-justificado-fields" style="display:none; flex-direction:column; gap:8px;">' +
            '      <label>Tipo de Atestado</label>' +
            '      <select id="abs-tipo-atestado">' +
            '        <option value="">— Selecionar —</option>' +
            '        <option>Atestado médico</option>' +
            '        <option>Acidente de trabalho</option>' +
            '        <option>Licença Maternidade/Paternidade</option>' +
            '        <option>Outros</option>' +
            '      </select>' +
            '      <div id="abs-cid-container" style="display:none; flex-direction:column; gap:8px;">' +
            '        <label>CID</label>' +
            '        <input type="text" id="abs-cid-input" placeholder="Insira o CID..." style="padding:6px 8px;border:1px solid #ddd;border-radius:8px;"/>' +
            '      </div>' +
            '      <label>Observação (Atestado)</label>' +
            '      <input type="text" id="abs-obs-justificado" placeholder="Observações adicionais..." style="padding:6px 8px;border:1px solid #ddd;border-radius:8px;"/>' +
            '    </div>' +
            '  </div>' +
            '  <label style="margin-top:6px;">Ação tomada</label>' +
            '  <select id="abs-acao" style="padding:6px 8px;border:1px solid #ddd;border-radius:8px;">' +
            '    <option value="">— Selecionar —</option>' +
            '    <option>Advertência Verbal</option>' +
            '    <option>Advertência Escrita</option>' +
            '    <option>Suspensão</option>' +
            '    <option>Afastamento</option>' +
            '    <option>Desligamento</option>' +
            '  </select>' +
            '</div>' +
            '<div class="abs-modal-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">' +
            '  <button class="btn" id="abs-cancel" style="padding:8px 12px;border-radius:8px;border:1px solid #ddd;background:#fafafa;">Cancelar</button>' +
            '  <button class="btn-add" id="abs-save" style="padding:8px 12px;border-radius:8px;border:none;background:#2563eb;color:#fff;">Salvar</button>' +
            '</div>';
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        var radioSim = modal.querySelector('input[value="SIM"]');
        var radioNao = modal.querySelector('input[value="NAO"]');
        var selAcao = modal.querySelector('#abs-acao');
        var entrevistaDetails = modal.querySelector('#abs-entrevista-details');
        var injustificadoFields = modal.querySelector('#abs-injustificado-fields');
        var justificadoFields = modal.querySelector('#abs-justificado-fields');
        var selObsInjustificado = modal.querySelector('#abs-obs-injustificado');
        var selTipoAtestado = modal.querySelector('#abs-tipo-atestado');
        var inputObsJustificado = modal.querySelector('#abs-obs-justificado');
        var cidContainer = modal.querySelector('#abs-cid-container');
        var cidInput = modal.querySelector('#abs-cid-input');

        function toggleConditionalFields() {
            var entrevistaSim = radioSim.checked;
            entrevistaDetails.style.display = entrevistaSim ? 'flex' : 'none';
            if (entrevistaSim) {
                var absType = String(row.Absenteismo || '').toUpperCase().trim();
                if (absType === 'INJUSTIFICADO') {
                    injustificadoFields.style.display = 'flex';
                    justificadoFields.style.display = 'none';
                } else if (absType === 'JUSTIFICADO') {
                    injustificadoFields.style.display = 'none';
                    justificadoFields.style.display = 'flex';
                    cidContainer.style.display = selTipoAtestado.value === 'Atestado médico' ? 'flex' : 'none';
                } else {
                    injustificadoFields.style.display = 'none';
                    justificadoFields.style.display = 'none';
                }
            } else {
                injustificadoFields.style.display = 'none';
                justificadoFields.style.display = 'none';
                cidContainer.style.display = 'none';
            }
        }

        radioSim.addEventListener('change', toggleConditionalFields);
        radioNao.addEventListener('change', toggleConditionalFields);
        selTipoAtestado.addEventListener('change', toggleConditionalFields);
        if (String(row.Entrevista || '').toUpperCase() === 'SIM') radioSim.checked = true; else radioNao.checked = true;
        selAcao.value = row.Acao || '';
        cidInput.value = row.CID || '';
        if (row.Absenteismo === 'Justificado') {
            selTipoAtestado.value = row.TipoAtestado || '';
            inputObsJustificado.value = row.Observacao || '';
        } else {
            selObsInjustificado.value = row.Observacao || '';
        }
        toggleConditionalFields();

        modal.querySelector('#abs-cancel')?.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        overlay.addEventListener('click', function (ev) {
            if (ev.target === overlay) document.body.removeChild(overlay);
        });

        var btnSave = modal.querySelector('#abs-save');
        if (btnSave) btnSave.addEventListener('click', async function () {
            btnSave.disabled = true;
            btnSave.textContent = 'Salvando...';
            var entrevista = (modal.querySelector('input[name="abs-entrevista"]:checked') || {}).value || 'NAO';
            var acao = selAcao.value || null;
            var updatePayload = {Entrevista: entrevista, Acao: acao, Observacao: null, TipoAtestado: null, CID: null};
            if (entrevista === 'SIM') {
                var absType = String(row.Absenteismo || '').toUpperCase().trim();
                if (absType === 'INJUSTIFICADO') {
                    updatePayload.Observacao = selObsInjustificado.value || null;
                } else if (absType === 'JUSTIFICADO') {
                    updatePayload.TipoAtestado = selTipoAtestado.value || null;
                    updatePayload.Observacao = inputObsJustificado.value || null;
                    if (updatePayload.TipoAtestado === 'Atestado médico') {
                        updatePayload.CID = (cidInput.value || '').trim() || null;
                    }
                }
            }
            try {
                const {error} = await supabase.from('ControleDiario').update(updatePayload).eq('Numero', row.Numero);
                if (error) throw error;
                window.dispatchEvent(new CustomEvent('controle-diario-saved', {detail: {id: row.Numero}}));
                document.body.removeChild(overlay);
            } catch (e) {
                console.error('Falha ao atualizar registro no ControleDiario:', e);
                alert('Falha ao salvar. Verifique o console para mais detalhes.');
                btnSave.disabled = false;
                btnSave.textContent = 'Salvar';
            }
        });
    }

    function openPeriodModal() {
        var overlay = document.createElement('div');
        overlay.id = 'cd-period-overlay';
        overlay.innerHTML =
            '<div>' +
            '  <h3>Selecionar Período</h3>' +
            '  <div class="dates-grid">' +
            '    <div><label>Início</label><input id="abs-period-start" type="date" value="' + esc(toISO(state.periodo.start)) + '"></div>' +
            '    <div><label>Fim</label><input id="abs-period-end" type="date" value="' + esc(toISO(state.periodo.end)) + '"></div>' +
            '  </div>' +
            '  <div class="form-actions">' +
            '    <button id="cd-period-cancel" class="btn">Cancelar</button>' +
            '    <button id="cd-period-apply" class="btn-add">Aplicar</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(overlay);
        var close = () => {
            overlay?.parentNode?.removeChild(overlay);
        };
        overlay.addEventListener('click', function (ev) {
            if (ev.target === overlay) close();
        });
        overlay.querySelector('#cd-period-cancel')?.addEventListener('click', close);
        overlay.querySelector('#cd-period-apply')?.addEventListener('click', function () {
            var s = (overlay.querySelector('#abs-period-start') || {}).value;
            var e = (overlay.querySelector('#abs-period-end') || {}).value;
            if (!s || !e) {
                alert('Selecione as duas datas.');
                return;
            }
            state.periodo.start = toISO(s);
            state.periodo.end = toISO(e);
            state.paging.offset = 0;
            updatePeriodButton();
            close();
            fetchAndRender();
        });
    }

    async function handleExport() {
        if (!state.periodo.start || !state.periodo.end) {
            alert('Selecione um período antes de exportar.');
            return;
        }
        try {
            var s = stripAccents(state.search || '').toLowerCase();
            var rows = (state.rows || []).filter(function (r) {
                var nm = stripAccents(String(r.Nome || '')).toLowerCase();
                return !s || nm.indexOf(s) !== -1;
            });
            if (!rows.length) {
                alert('Nada para exportar com os filtros atuais.');
                return;
            }
            var csvRows = rows.map(function (r) {
                return {
                    'Nome': r.Nome || '',
                    'Data': fmtBR(parseAnyDateToISO(r.Data || '')),
                    'Absenteismo': r.Absenteismo || '',
                    'Escala': r.Escala || '',
                    'Cargo': r.Cargo || '',
                    'Entrevista': String(r.Entrevista || '').toUpperCase() === 'SIM' ? 'Sim' : 'Não',
                    'Ação': r.Acao || '',
                    'Tipo de Atestado': r.TipoAtestado || '',
                    'Observação': r.Observacao || '',
                    'CID': r.CID || '',
                    'MATRIZ': r.MATRIZ || '',
                    'SVC': r.SVC || ''
                };
            });
            var keys = Object.keys(csvRows[0] || {});

            function escv(v) {
                if (v == null) return '';
                var s = String(v);
                return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }

            var header = keys.join(',');
            var body = csvRows.map(r => keys.map(k => escv(r[k])).join(',')).join('\n');
            var csv = header + '\n' + body;
            var blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'relatorio_abs_' + toISO(state.periodo.start) + '_a_' + toISO(state.periodo.end) + '.csv';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Export fallback erro', e);
            alert('Falha ao exportar. Veja o console.');
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
        state.svc = f.svc || '';
        state.paging.offset = 0;
        scheduleRefresh(true);
    };
})();
