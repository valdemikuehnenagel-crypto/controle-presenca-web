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

    function addDaysISO(iso, n) {
        var p = parseAnyDateToISO(iso).split('-').map(Number);
        var dt = new Date(p[0], p[1] - 1, p[2] + n);
        return toISO(dt);
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

    function ilikeEq(v) {
        return clean(v);
    }

    function nice(v) {
        v = clean(v);
        return v ? '"' + v + '"' : '—';
    }

    function isActiveView() {
        return !!document.querySelector('#hc-relatorio-abs.hc-view.active');
    }

    function stripAccents(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function maxISODate(rows) {
        var mx = '';
        (rows || []).forEach(function (r) {
            var d = parseAnyDateToISO(r && r.Data);
            if (d && d > mx) mx = d;
        });
        return mx;
    }

    function defaultLast3Months() {
        var today = new Date();
        var start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        return {start: toISO(start), end: toISO(today)};
    }

    var _colabIdx = null;

    async function getColabIndex() {
        if (_colabIdx) return _colabIdx;

        const matrizesPermitidas = getMatrizesPermitidas();

        let query = supabase.from('Colaboradores').select('Nome, SVC, MATRIZ, Escala, Cargo');
        if (matrizesPermitidas !== null) query = query.in('MATRIZ', matrizesPermitidas);

        const {data, error} = await query;
        if (error) throw error;

        var rows = Array.isArray(data) ? data : [];
        var map = new Map();
        for (var i = 0; i < rows.length; i++) {
            var c = rows[i];
            map.set(String(c.Nome || ''), {
                SVC: (c.SVC == null ? null : c.SVC),
                MATRIZ: (c.MATRIZ == null ? null : c.MATRIZ),
                Escala: (c.Escala == null ? null : c.Escala),
                Cargo: (c.Cargo == null ? null : c.Cargo)
            });
        }
        _colabIdx = map;
        return _colabIdx;
    }

    function computeAbsenteismo(row) {
        var falta = Number(row && row.Falta || 0) > 0;
        var atest = Number(row && row.Atestado || 0) > 0;
        if (atest) return 'Atestado';
        if (falta) return 'Injustificado';
        return null;
    }

    async function syncABSForRow(row) {
        var nome = String(row && row.Nome || '').trim();
        if (!nome) return;
        var dataISO = parseAnyDateToISO(row && row.Data);
        if (!dataISO) return;

        var abs = computeAbsenteismo(row);

        if (!abs) {
            await supabase.from('RelatorioABS').delete().eq('Nome', nome).eq('Data', dataISO);
            return;
        }

        var idx = await getColabIndex();
        var extra = idx.get(nome) || {};
        var escalaRow = row ? (row.Turno || row.Escala || '') : '';
        var base = {
            Nome: nome,
            Data: dataISO,
            Absenteismo: abs,
            Escala: (extra.Escala != null ? extra.Escala : String(escalaRow).toUpperCase()) || null,
            Entrevista: null,
            Acao: null,
            Observacao: null,
            CID: null,
            SVC: (extra.SVC != null ? extra.SVC : null),
            MATRIZ: (extra.MATRIZ != null ? extra.MATRIZ : null)
        };

        var f = await supabase.from('RelatorioABS').select('id').eq('Nome', base.Nome).eq('Data', base.Data).maybeSingle();
        if (f.error) throw f.error;

        if (f.data) {
            var u = await supabase.from('RelatorioABS').update(base).eq('id', f.data.id);
            if (u.error) throw u.error;
        } else {
            var ins = await supabase.from('RelatorioABS').insert(base);
            if (ins.error) throw ins.error;
        }
    }

    async function syncABSBatch(rows) {
        rows = Array.isArray(rows) ? rows : [];
        for (var i = 0; i < rows.length; i++) {
            await syncABSForRow(rows[i]);
        }
    }

    async function backfillABSPeriod(inicioISO, fimISO) {
        var sISO = parseAnyDateToISO(inicioISO);
        var eISO = parseAnyDateToISO(fimISO);
        var q = await supabase
            .from('ControleDiario')
            .select('Nome, Data, Turno, Falta, Atestado')
            .gte('Data', sISO)
            .lte('Data', eISO)
            .or('Falta.gt.0,Atestado.gt.0');

        if (q.error) throw q.error;
        await syncABSBatch(q.data || []);
    }

    window.absSyncForRow = syncABSForRow;
    window.absSyncBatch = syncABSBatch;
    window.absBackfillABS = backfillABSPeriod;

    window.addEventListener('hc-filters-changed', function (ev) {
        var f = ev && ev.detail ? ev.detail : {};
        if (typeof f.matriz === 'string') state.matriz = f.matriz;
        if (typeof f.svc === 'string') state.svc = f.svc;
        state.paging.offset = 0;
        if (isActiveView()) fetchAndRender(); else state.dirty = true;
    });

    window.addEventListener('hc-refresh', function () {
        if (!state.mounted) {
            state.dirty = true;
            return;
        }
        if (isActiveView()) fetchAndRender(); else state.dirty = true;
    });

    window.addEventListener('hc-activated', function (ev) {
        if (ev && ev.detail && ev.detail.view === 'relatorio-abs') {
            ensureMounted(true);
            fetchAndRender();
            state.dirty = false;
        }
    });

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && isActiveView() && state.mounted) {
            fetchAndRender();
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
            '        <th>Abs</th>' +
            '        <th>Escala</th>' +
            '        <th>Entrevista</th>' +
            '        <th>Ação</th>' +
            // '        <th>Observação</th>' +
            '        <th>CID</th>' +
            // '        <th>SVC</th>' +
            '        <th>MATRIZ</th>' +
            '      </tr>' +
            '    </thead>' +
            '    <tbody id="abs-tbody">' +
            // '      <tr><td colspan="10" class="muted">Carregando…</td></tr>' +
            '    </tbody>' +
            '  </table>' +
            '</div>';

        state.mounted = true;

        var btnExport = document.getElementById('abs-export');
        if (btnExport) btnExport.addEventListener('click', handleExport);

        var btnPeriod = document.getElementById('abs-period');
        if (btnPeriod) btnPeriod.addEventListener('click', openPeriodModal);

        var elSearch = document.getElementById('abs-search');
        var elEscala = document.getElementById('abs-filter-escala');
        if (elSearch) elSearch.addEventListener('input', function () {
            state.search = elSearch.value;
            renderRows();
        });
        if (elEscala) elEscala.addEventListener('change', function () {
            state.escala = elEscala.value;
            state.paging.offset = 0;
            fetchAndRender();
        });

        var tbody = document.getElementById('abs-tbody');
        if (tbody) {
            tbody.addEventListener('click', function (ev) {
                var tr = ev.target && ev.target.closest ? ev.target.closest('tr.abs-row') : null;
                if (!tr) return;
                var idx = parseInt(tr.getAttribute('data-idx'), 10);
                var row = (state.rows || [])[idx];
                if (row) openEditModal(row);
            });
            tbody.addEventListener('keydown', function (ev) {
                if (ev.key !== 'Enter') return;
                var tr = ev.target && ev.target.closest ? ev.target.closest('tr.abs-row') : null;
                if (!tr) return;
                var idx = parseInt(tr.getAttribute('data-idx'), 10);
                var row = (state.rows || [])[idx];
                if (row) openEditModal(row);
            });
        }

        if (state.firstLoad) {
            var d3 = defaultLast3Months();
            state.periodo.start = d3.start;
            state.periodo.end = d3.end;
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


    function updateDebug(txt) {
        if (!state.showDebug) return;
        var el = document.getElementById('abs-debug');
        if (el) el.textContent = txt;
    }

    function updatePeriodButton() {
        var b = document.getElementById('abs-period');
        if (!b) return;
        var start = state.periodo.start, end = state.periodo.end;
        b.textContent = (start && end) ? ('Período: ' + fmtBR(start) + ' → ' + fmtBR(end)) : 'Selecionar período';
    }

    async function fetchAndRender() {
        var tbody = document.getElementById('abs-tbody');
        if (!tbody) {
            requestAnimationFrame(fetchAndRender);
            return;
        }
        tbody.innerHTML = '<tr><td colspan="8" class="muted">Carregando…</td></tr>';

        var startISO = toISO(state.periodo.start);
        var endISO = toISO(state.periodo.end);

        try {
            const colabIndex = await getColabIndex();

            // **AJUSTE AQUI: Adicionado Observacao e CID na consulta**
            const {data: allAbsRows, error} = await supabase
                .from('RelatorioABS')
                .select('id, Nome, Data, Absenteismo, Escala, Entrevista, Acao, SVC, MATRIZ, Observacao, CID')
                .gte('Data', startISO)
                .lte('Data', endISO);

            if (error) throw error;

            var rows = (allAbsRows || []).filter(function (absRow) {
                const colabInfo = colabIndex.get(String(absRow.Nome || ''));
                return colabInfo && norm(colabInfo.Cargo) === 'AUXILIAR';
            });

            rows.sort(function (a, b) {
                return (b.Data || '').localeCompare(a.Data || '') || ((b.id || 0) - (a.id || 0));
            });

            var filteredRows = (rows || []).filter(function (r) {
                if (state.escala && String(r.Escala || '') !== state.escala) return false;
                if (state.svc && norm(r.SVC) !== norm(state.svc)) return false;
                if (state.matriz && norm(r.MATRIZ) !== norm(state.matriz)) return false;
                return true;
            });

            state.rows = filteredRows;
            state.paging.total = filteredRows.length;
            state.dirty = false;

            updateDebug('período=' + startISO + '..' + endISO + ' | rows=' + filteredRows.length + ' | filtros: escala=' + nice(state.escala) + ', svc=' + nice(state.svc) + ', matriz=' + nice(state.matriz));

            renderRows();
            removeWarn();
        } catch (e) {
            console.error('RelatorioABS: fetch erro', e);
            var tb = document.getElementById('abs-tbody');
            if (tb) tb.innerHTML = '<tr><td colspan="8" class="muted">Erro ao carregar. Veja o console.</td></tr>';
            updateDebug('Erro: ' + (e && e.message ? e.message : e));
            updateCounters([]);
        }
    }

    function addWarn(text) {
        var bar = document.getElementById('abs-warn');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'abs-warn';
            bar.className = 'muted';
            bar.style.cssText = 'margin:6px 0;font-size:12px;';
            var toolbar = document.querySelector('.abs-toolbar');
            if (toolbar) toolbar.insertAdjacentElement('afterend', bar);
        }
        bar.innerHTML = text;
    }

    function removeWarn() {
        var el = document.getElementById('abs-warn');
        if (el) el.remove();
    }

    async function fetchRelatorioABS_DB(startISO, endISO, applyMode) {
        try {
            const matrizesPermitidas = getMatrizesPermitidas();

            // **AJUSTE AQUI: Adicionado Observacao e CID na consulta**
            var q = supabase
                .from('RelatorioABS')
                .select('id, Nome, Data, Absenteismo, Escala, Entrevista, Acao, SVC, MATRIZ, Observacao, CID', {count: 'exact'})
                .gte('Data', startISO);

            if (applyMode === 'lt') q = q.lt('Data', endISO);
            else q = q.lte('Data', endISO);

            if (state.escala) q = q.ilike('Escala', ilikeEq(state.escala));
            if (state.svc) q = q.ilike('SVC', ilikeEq(state.svc));
            if (state.matriz) q = q.ilike('MATRIZ', ilikeEq(state.matriz));

            if (matrizesPermitidas !== null) q = q.in('MATRIZ', matrizesPermitidas);

            q = q.order('Data', {ascending: false}).order('id', {ascending: false})
                .range(state.paging.offset, state.paging.offset + state.paging.limit - 1);

            var r = await q;
            if (r.error) return {ok: false, error: r.error};
            var rows = Array.isArray(r.data) ? r.data : [];
            var total = (typeof r.count === 'number') ? r.count : rows.length;
            return {ok: true, rows: rows, total: total};
        } catch (err) {
            return {ok: false, error: err};
        }
    }

    async function fetchRelatorioABS_FALLBACK() {
        try {
            const matrizesPermitidas = getMatrizesPermitidas();

            // **AJUSTE AQUI: Adicionado Observacao e CID na consulta**
            var q = supabase
                .from('RelatorioABS')
                .select('id, Nome, Data, Absenteismo, Escala, Entrevista, Acao, SVC, MATRIZ, Observacao, CID', {count: 'exact'});

            if (state.escala) q = q.ilike('Escala', ilikeEq(state.escala));
            if (state.svc) q = q.ilike('SVC', ilikeEq(state.svc));
            if (state.matriz) q = q.ilike('MATRIZ', ilikeEq(state.matriz));

            if (matrizesPermitidas !== null) q = q.in('MATRIZ', matrizesPermitidas);

            q = q.order('id', {ascending: false}).range(0, state.paging.limit - 1);

            var r = await q;
            if (r.error) return {ok: false, error: r.error};
            var rows = Array.isArray(r.data) ? r.data : [];
            var total = (typeof r.count === 'number') ? r.count : rows.length;
            return {ok: true, rows: rows, total: total};
        } catch (err) {
            return {ok: false, error: err};
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
            else if (abs === 'JUSTIFICADO' || abs === 'ATESTADO') just++;

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
            // tbody.innerHTML = '<tr><td colspan="10" class="muted">Sem registros no período/filtros.</td></tr>';
            return;
        }

        var frag = document.createDocumentFragment();
        filtered.forEach(function (row, idx) {
            var tr = document.createElement('tr');
            tr.tabIndex = 0;
            tr.className = 'abs-row';
            tr.dataset.id = row.id == null ? '' : row.id;

            var originalIndex = state.rows.findIndex(r => r.id === row.id);
            tr.setAttribute('data-idx', String(originalIndex));

            tr.innerHTML =
                '<td class="cell-name">' + esc(row.Nome || '') + '</td>' +
                '<td>' + fmtBR(parseAnyDateToISO(row.Data)) + '</td>' +
                '<td>' + esc(row.Absenteismo || '') + '</td>' +
                '<td>' + esc(row.Escala || '') + '</td>' +
                '<td>' + (String(row.Entrevista || '').toUpperCase() === 'SIM' ? 'Sim' : 'Não') + '</td>' +
                '<td>' + esc(row.Acao || '') + '</td>' +
                // '<td>' + esc(row.Observacao || '') + '</td>' +
                '<td>' + esc(row.CID || '') + '</td>' +
                // '<td>' + esc(row.SVC || '') + '</td>' +
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

        // **INÍCIO DA GRANDE MUDANÇA NO HTML DO MODAL**
        modal.innerHTML =
            '<h3 style="margin:0 0 12px 0;">Atualizar registro</h3>' +
            '<div class="abs-modal-meta" style="font-size:14px;line-height:1.4;margin-bottom:12px;">' +
            '  <div><strong>Nome:</strong> ' + esc(row.Nome) + '</div>' +
            '  <div><strong>Data:</strong> ' + fmtBR(parseAnyDateToISO(row.Data)) + '</div>' +
            '  <div><strong>Abs:</strong> ' + esc(row.Absenteismo || '') + '</div>' +
            '  <div><strong>Escala:</strong> ' + esc(row.Escala || '') + '</div>' +
            '</div>' +
            '<div class="abs-modal-form" style="display:flex;flex-direction:column;gap:8px;">' +
            '  <label>Entrevista feita?</label>' +
            '  <div class="abs-radio" style="display:flex;gap:16px;">' +
            '    <label><input type="radio" name="abs-entrevista" value="SIM"> Sim</label>' +
            '    <label><input type="radio" name="abs-entrevista" value="NAO"> Não</label>' +
            '  </div>' +
            // Container para os campos condicionais da entrevista
            '  <div id="abs-entrevista-details" style="display:none; flex-direction:column; gap:8px; margin-top:6px;">' +
            // Campos para ABS Injustificado
            '    <div id="abs-injustificado-fields" style="display:none; flex-direction:column; gap:8px;">' +
            '      <label>Observação</label>' +
            '      <select id="abs-obs-injustificado" class="abs-observacao-select">' +
            '        <option value="">— Selecionar —</option>' +
            '        <option>Falecimento parente</option>' +
            '        <option>Proposital</option>' +
            '        <option>Não quis informar</option>' +
            '        <option>Problemas pessoais</option>' +
            '      </select>' +
            '    </div>' +
            // Campos para ABS Justificado
            '    <div id="abs-justificado-fields" style="display:none; flex-direction:column; gap:8px;">' +
            '      <label>Observação</label>' +
            '      <select id="abs-obs-justificado" class="abs-observacao-select">' +
            '        <option value="">— Selecionar —</option>' +
            '        <option>Atestado médico</option>' +
            '        <option>Acidente</option>' +
            '        <option>Gravidez</option>' +
            '      </select>' +
            '      <div id="abs-cid-container" style="display:none; flex-direction:column; gap:8px;">' +
            '        <label>CID</label>' +
            '        <input type="text" id="abs-cid-input" placeholder="Insira o CID..." style="padding:6px 8px;border:1px solid #ddd;border-radius:8px;"/>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '  <label style="margin-top:6px;">Ação tomada</label>' +
            '  <select id="abs-acao" style="padding:6px 8px;border:1px solid #ddd;border-radius:8px;">' +
            '    <option value="">— Selecionar —</option>' +
            '    <option>Advertencial Verbal</option>' +
            '    <option>Advertencia Escrita</option>' +
            '    <option>Suspensão</option>' +
            '    <option>Afastamento</option>' +
            '    <option>Desligamento</option>' +
            '  </select>' +
            '</div>' +
            '<div class="abs-modal-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">' +
            '  <button class="btn" id="abs-cancel" style="padding:8px 12px;border-radius:8px;border:1px solid #ddd;background:#fafafa;">Cancelar</button>' +
            '  <button class="btn-add" id="abs-save" style="padding:8px 12px;border-radius:8px;border:none;background:#2563eb;color:#fff;">Salvar</button>' +
            '</div>';
        // **FIM DA GRANDE MUDANÇA NO HTML DO MODAL**

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Elementos do formulário
        var radioSim = modal.querySelector('input[value="SIM"]');
        var radioNao = modal.querySelector('input[value="NAO"]');
        var selAcao = modal.querySelector('#abs-acao');

        var entrevistaDetails = modal.querySelector('#abs-entrevista-details');
        var injustificadoFields = modal.querySelector('#abs-injustificado-fields');
        var justificadoFields = modal.querySelector('#abs-justificado-fields');
        var selObsInjustificado = modal.querySelector('#abs-obs-injustificado');
        var selObsJustificado = modal.querySelector('#abs-obs-justificado');
        var cidContainer = modal.querySelector('#abs-cid-container');
        var cidInput = modal.querySelector('#abs-cid-input');

        // Função para controlar a visibilidade dos campos condicionais
        function toggleConditionalFields() {
            var entrevistaSim = radioSim.checked;
            entrevistaDetails.style.display = entrevistaSim ? 'flex' : 'none';

            if (entrevistaSim) {
                var absType = String(row.Absenteismo || '').toUpperCase().trim();
                if (absType === 'INJUSTIFICADO') {
                    injustificadoFields.style.display = 'flex';
                    justificadoFields.style.display = 'none';
                } else if (absType === 'JUSTIFICADO' || absType === 'ATESTADO') {
                    injustificadoFields.style.display = 'none';
                    justificadoFields.style.display = 'flex';
                    // Também controla o campo CID baseado na seleção de 'Atestado'
                    cidContainer.style.display = selObsJustificado.value === 'Atestado médico' ? 'flex' : 'none';
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

        // Listeners para os eventos de mudança
        radioSim.addEventListener('change', toggleConditionalFields);
        radioNao.addEventListener('change', toggleConditionalFields);
        selObsJustificado.addEventListener('change', toggleConditionalFields);


        // Preencher valores iniciais
        if (String(row.Entrevista || '').toUpperCase() === 'SIM') {
            radioSim.checked = true;
        } else {
            radioNao.checked = true;
        }
        selAcao.value = row.Acao || '';
        selObsInjustificado.value = row.Observacao || '';
        selObsJustificado.value = row.Observacao || '';
        cidInput.value = row.CID || '';

        // Chamar a função uma vez para definir o estado inicial do modal
        toggleConditionalFields();

        var btnCancel = modal.querySelector('#abs-cancel');
        if (btnCancel) btnCancel.addEventListener('click', function () {
            document.body.removeChild(overlay);
        });
        overlay.addEventListener('click', function (ev) {
            if (ev.target === overlay) document.body.removeChild(overlay);
        });

        // **INÍCIO DA MUDANÇA NA LÓGICA DE SALVAMENTO**
        var btnSave = modal.querySelector('#abs-save');
        if (btnSave) btnSave.addEventListener('click', async function () {
            var entrevista = (modal.querySelector('input[name="abs-entrevista"]:checked') || {}).value || 'NAO';
            var acao = selAcao.value || null;

            var updatePayload = {
                Entrevista: entrevista,
                Acao: acao,
                Observacao: null,
                CID: null
            };

            if (entrevista === 'SIM') {
                var absType = String(row.Absenteismo || '').toUpperCase().trim();
                if (absType === 'INJUSTIFICADO') {
                    updatePayload.Observacao = selObsInjustificado.value || null;
                } else if (absType === 'JUSTIFICADO' || absType === 'ATESTADO') {
                    updatePayload.Observacao = selObsJustificado.value || null;
                    if (updatePayload.Observacao === 'Atestado médico') {
                        updatePayload.CID = cidInput.value.trim() || null;
                    }
                }
            }

            try {
                if (row.id != null && row.id !== '') {
                    var u = await supabase
                        .from('RelatorioABS')
                        .update(updatePayload)
                        .eq('id', row.id);
                    if (u.error) throw u.error;
                } else {
                    // Adiciona os campos obrigatórios para o upsert
                    updatePayload.Nome = row.Nome;
                    updatePayload.Data = parseAnyDateToISO(row.Data);
                    var up = await supabase
                        .from('RelatorioABS')
                        .upsert([updatePayload], {onConflict: 'Nome,Data'});
                    if (up.error) throw up.error;
                }
                await fetchAndRender();
                document.body.removeChild(overlay);
            } catch (e) {
                console.error('abs-update erro', e);
                alert('Falha ao salvar. Veja o console.');
            }
        });
        // **FIM DA MUDANÇA NA LÓGICA DE SALVAMENTO**
    }

    function openPeriodModal() {
        var overlay = document.createElement('div');
        overlay.id = 'cd-period-overlay';
        overlay.innerHTML =
            '<div>' +
            '  <h3>Selecionar Período</h3>' +
            '  <div class="dates-grid">' +
            '    <div>' +
            '      <label>Início</label>' +
            '      <input id="abs-period-start" type="date" value="' + esc(toISO(state.periodo.start)) + '">' +
            '    </div>' +
            '    <div>' +
            '      <label>Fim</label>' +
            '      <input id="abs-period-end" type="date" value="' + esc(toISO(state.periodo.end)) + '">' +
            '    </div>' +
            '  </div>' +
            '  <div class="form-actions">' +
            '    <button id="cd-period-cancel" class="btn">Cancelar</button>' +
            '    <button id="cd-period-apply" class="btn-add">Aplicar</button>' +
            '  </div>' +
            '</div>';

        document.body.appendChild(overlay);

        var btnCancel = overlay.querySelector('#cd-period-cancel');
        var btnApply = overlay.querySelector('#cd-period-apply');

        var close = function () {
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };

        overlay.addEventListener('click', function (ev) {
            if (ev.target === overlay) close();
        });
        if (btnCancel) btnCancel.addEventListener('click', close);

        if (btnApply) btnApply.addEventListener('click', function () {
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

            // **AJUSTE AQUI: Adicionado Observacao e CID ao objeto de exportação**
            var csvRows = rows.map(function (r) {
                return {
                    Nome: r.Nome || '',
                    Data: fmtBR(parseAnyDateToISO(r.Data || '')),
                    Abs: r.Absenteismo || '',
                    Escala: r.Escala || '',
                    Entrevista: String(r.Entrevista || '').toUpperCase() === 'SIM' ? 'Sim' : 'Não',
                    'Ação': r.Acao || '',
                    // 'Observação': r.Observacao || '',
                    'CID': r.CID || '',
                    // SVC: r.SVC || '',
                    MATRIZ: r.MATRIZ || ''
                };
            });
            var keys = Object.keys(csvRows[0] || {});

            function escv(v) {
                if (v == null) return '';
                var s = String(v);
                return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }

            var csv = [keys.join(',')].concat(csvRows.map(function (r) {
                return keys.map(function (k) {
                    return escv(r[k]);
                }).join(',');
            })).join('\n');
            var blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'relatorio_abs_' + toISO(new Date()) + '.csv';
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
        fetchAndRender();
    };
})();