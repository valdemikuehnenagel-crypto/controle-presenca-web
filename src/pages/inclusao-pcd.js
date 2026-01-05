import {supabase} from '../supabaseClient.js';

var HOST_SEL = '#inclusao-pcd-container';
var state = {
    mounted: false,
    filiais: [],
    cargos: [],
    historico: [],
    cidSelecionados: [null, null, null],
    cidIndexAtual: 0,
    scoreCache: {msg: '', val: 0},
    loading: false,
    filtros: {
        nome: '',
        cargo: '',
        filial: ''
    }
};

function getScoreColor(score) {
    if (score <= 100) return '#10b981';
    return '#ef4444';
}

export function renderInclusaoPCD(container) {
    if (container) {
        if (typeof container === 'string') HOST_SEL = container;
        else HOST_SEL = container;
    }

    ensureStyles();

    if (state.mounted) {
        if (typeof HOST_SEL === 'object' && HOST_SEL.innerHTML === '') {
            state.mounted = false;
        } else {
            carregarHistorico();
            return;
        }
    }

    let el = (typeof HOST_SEL === 'string') ? document.querySelector(HOST_SEL) : HOST_SEL;
    if (!el) {
        console.error("Container PCD não encontrado:", HOST_SEL);
        return;
    }

    el.innerHTML = `
        <div class="pcd-root">
            <div class="pcd-toolbar">
                <div class="filters">
                    <input type="text" id="filtroNome" placeholder="🔍 Buscar Nome..." class="filter-input">
                    <select id="filtroCargo"><option value="">Todos Cargos</option></select>
                    <select id="filtroFilial"><option value="">Todas Filiais</option></select>
                    <button id="btnLimparFiltros" class="btn-cancelar" style="border-radius:24px; padding: 8px 14px;">Limpar</button>
                </div>

                <div class="spacer"></div>

                <button class="btn-acao" id="btnExportar" style="background:#003369;">
                    📥 Exportar Excel
                </button>
                <button class="btn-acao" id="pcd-btn-novo" style="background:#28a745;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    Novo Parecer
                </button>
            </div>

            <div class="table-wrapper">
                <table class="pcd-table">
                    <thead>
                        <tr>
                            <th style="width: 90px; text-align:center;">Protocolo</th>
                            <th style="width: 110px; text-align:center;">Data</th>
                            <th style="text-align:left;">Colaborador</th>
                            <th style="text-align:left;">Cargo / Filial</th>
                            <th style="text-align:center;">CIDs</th>
                            <th style="width: 180px; text-align:center;">Parecer</th>
                        </tr>
                    </thead>
                    <tbody id="pcd-tbody">
                        <tr><td colspan="6" style="text-align:center; padding:20px; color:#6b7280;">Carregando histórico...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div id="pcd-modal-overlay" class="pcd-modal hidden">
            <div class="modal-card">
                <div class="modal-header-actions">
                    <h3 id="modalTitle">Novo Parecer Técnico</h3>
                    <button class="pcd-close-icon" id="pcd-modal-close-icon">&times;</button>
                </div>
                
                <div class="form-grid">
                    <div class="form-group">
                        <label>Data</label>
                        <input type="date" id="pcdData">
                    </div>
                    <div class="form-group" style="grid-column: span 2;">
                        <label>Nome Completo</label>
                        <input type="text" id="pcdNome" placeholder="Nome do candidato">
                    </div>

                    <div class="form-group">
                        <label>Cargo</label>
                        <select id="pcdCargo"><option>Carregando...</option></select>
                    </div>
                    <div class="form-group" style="grid-column: span 2;">
                        <label>Filial</label>
                        <select id="pcdFilial"><option>Carregando...</option></select>
                    </div>

                    <div class="form-group">
                        <label>Experiência?</label>
                        <select id="pcdExperiencia">
                            <option value="NAO">NÃO</option>
                            <option value="SIM">SIM</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Possui Laudo?</label>
                        <select id="pcdLaudo">
                            <option value="NAO">NÃO</option>
                            <option value="SIM">SIM</option>
                        </select>
                    </div>
                    
                    <div class="form-group" style="grid-column: span 3;">
                        <label style="color:#003369; border-bottom:1px solid #eee; padding-bottom:4px; margin-top:10px;">🩺 Patologias (CID)</label>
                        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; margin-top:5px;">
                            <div class="cid-row">
                                <span style="font-size:11px; font-weight:700; margin-right:5px;">1.</span>
                                <div id="cidDisplay1" class="cid-input empty" data-idx="0">Selecionar...</div>
                                <button class="btn-lupa" data-idx="0">🔍</button>
                            </div>
                            <div class="cid-row">
                                <span style="font-size:11px; font-weight:700; margin-right:5px;">2.</span>
                                <div id="cidDisplay2" class="cid-input empty" data-idx="1">Selecionar...</div>
                                <button class="btn-lupa" data-idx="1">🔍</button>
                            </div>
                            <div class="cid-row">
                                <span style="font-size:11px; font-weight:700; margin-right:5px;">3.</span>
                                <div id="cidDisplay3" class="cid-input empty" data-idx="2">Selecionar...</div>
                                <button class="btn-lupa" data-idx="2">🔍</button>
                            </div>
                        </div>
                    </div>

                    <div class="form-group" style="grid-column: span 3;">
                        <label>Observações / Restrições</label>
                        <textarea id="pcdRestricoes" class="form-control" style="height:60px;" placeholder="Descreva restrições, necessidade de EPI, mobilidade..."></textarea>
                    </div>

                    <div class="form-group" style="grid-column: span 3;">
                         <div id="statusBox" class="status-banner">AGUARDANDO DADOS</div>
                         <div id="boxRecomendacoes" class="rec-box" style="margin-top:5px;">Aguardando análise...</div>
                    </div>
                </div>

                <div class="form-actions">
                    <button class="btn-cancelar" id="pcd-btn-cancel">Fechar</button>
                    <button class="btn-salvar" id="pcd-btn-save" style="background-color: #003369 !important; color: white !important;">Salvar Relatório</button>
                </div>
            </div>
        </div>

        <div id="pcd-search-overlay" class="pcd-modal hidden" style="z-index: 10050;">
            <div class="modal-card" style="width: 450px;">
                <h3>🔍 Buscar Patologia</h3>
                <div style="padding: 10px 0;">
                    <input type="text" id="pcdSearchInput" class="filter-input" placeholder="Digite código ou nome (Ex: A80)..." style="width:100%;">
                    <ul id="pcdResultList" class="res-list">
                        <li style="text-align:center;padding:15px;color:#94a3b8;">Digite para buscar...</li>
                    </ul>
                </div>
                <div class="form-actions">
                    <button class="btn-cancelar" id="pcd-search-close">Fechar</button>
                </div>
            </div>
        </div>
    `;

    state.mounted = true;
    bindEvents();
    loadInitialData();
}

function ensureStyles() {
    if (document.getElementById('pcd-styles')) return;
    const style = document.createElement('style');
    style.id = 'pcd-styles';
    style.textContent = `
        .pcd-root {
            --p-primary: #003369;
            --p-accent: #02B1EE;
            --p-surface: #fff;
            --p-border: #eceff5;
            --p-muted: #6b7280;
            --p-shadow: 0 6px 16px rgba(0, 0, 0, .08);

            display: flex;
            flex-direction: column;
            gap: 12px;
            height: 100%;
            width: 100%;
        }

        .pcd-toolbar {
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }
        .spacer { flex: 1; }

        .filters {
            display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
        }
        .filters select, .filters input, .filter-input {
            padding: 8px 10px;
            border: 1px solid #ddd;
            border-radius: 20px;
            background: #fff;
            font-weight: 600;
            color: #333;
            font-size: 12px;
            outline: none;
            transition: all .2s ease;
        }
        .filters select:focus, .filters input:focus {
            border-color: var(--p-primary);
        }

        .btn-acao, .btn-salvar, .btn-cancelar {
            padding: 8px 14px;
            border: none;
            border-radius: 24px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all .2s ease;
            box-shadow: 0 6px 14px rgba(0, 0, 0, .10);
            display: inline-flex; align-items: center; justify-content: center;
        }
        .btn-acao { color: #fff; }
        .btn-acao:hover { transform: translateY(-2px); opacity: 0.9; }

        .btn-salvar { background-color: #003369; color: #fff; }
        .btn-salvar:hover { background-color: #002244; transform: translateY(-2px); }

        .btn-cancelar { background-color: #e4e6eb; color: #4b4f56; }
        .btn-cancelar:hover { background-color: #d8dadf; transform: translateY(-2px); }
        
        .table-wrapper {
            background: #fff;
            border: 1px solid var(--p-border);
            border-radius: 14px;
            box-shadow: var(--p-shadow);
            flex-grow: 1;
            min-height: 0;
            overflow: auto;
            width: 100%;
        }
        .pcd-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
        }
        .pcd-table thead th {
            position: sticky; top: 0; z-index: 2;
            background: var(--p-primary);
            color: #fff;
            text-transform: uppercase;
            padding: 10px;
            font-size: 12px;
            font-weight: 800;
            border-bottom: 1px solid var(--p-border);
            white-space: nowrap;
        }
        .pcd-table tbody td {
            padding: 8px 10px;
            border-bottom: 1px solid var(--p-border);
            font-size: 13px;
            color: #334155;
            vertical-align: middle;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            background: #fff;
        }
        .pcd-table tr:hover td { background: #f0f9ff; cursor: pointer; }

        .pcd-modal {
            position: fixed; inset: 0;
            background: rgba(0, 0, 0, .35);
            display: flex; align-items: center; justify-content: center;
            z-index: 1000;
        }
        .pcd-modal.hidden { display: none; }

        .modal-card {
            width: min(860px, 94vw);
            background: #fff;
            border-radius: 16px;
            box-shadow: 0 14px 36px rgba(0, 0, 0, .18);
            padding: 16px 18px;
            border: 1px solid #e7ebf4;
            display: flex; flex-direction: column;
        }

        .modal-header-actions {
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid #e7ebf4; padding-bottom: 8px; margin-bottom: 12px;
        }

        .modal-card h3 {
            color: var(--p-primary);
            font-weight: 700;
            margin: 0;
            font-size: 16px;
        }
        
        .pcd-close-icon {
            background: transparent; border: none; font-size: 24px; 
            color: #94a3b8; cursor: pointer; line-height: 1;
        }
        .pcd-close-icon:hover { color: #ef4444; }

        .form-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
        }
        
        .form-group { display: flex; flex-direction: column; }
        .form-group label {
            font-size: 12px; color: #56607f; margin-bottom: 4px; font-weight: 600;
        }
        .form-group input, .form-group select, .form-group textarea {
            padding: 8px 9px;
            border: 2px solid #e8ecf3;
            border-radius: 10px;
            font-size: 13px; font-weight: 600; color: #242c4c;
            background: #fff; outline: none; transition: all .2s ease;
        }
        .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
            border-color: var(--p-accent);
            box-shadow: 0 0 0 3px rgba(2, 177, 238, .15);
        }
        .form-group input:disabled, .form-group select:disabled, .form-group textarea:disabled {
            background: #f1f5f9; color: #94a3b8; cursor: not-allowed;
        }

        .form-actions {
            margin-top: 15px;
            display: flex; justify-content: flex-end; align-items: center; gap: 10px;
        }

        .badge-status { padding: 4px 10px; border-radius: 12px; font-weight: 700; font-size: 10px; text-transform: uppercase; display: inline-block; }
        .bg-green { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
        .bg-yellow { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
        .bg-red { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }

        .status-banner { padding: 10px; text-align: center; border-radius: 8px; font-weight: 800; font-size: 14px; background: #f1f5f9; color: #94a3b8; border: 2px dashed #cbd5e1; text-transform: uppercase; transition: all 0.3s; }
        .rec-box { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 10px; font-size: 12px; color: #78350f; line-height: 1.4; border-radius: 4px; }

        .cid-row { display: flex; align-items: center; min-width: 0; }
        .cid-input { 
            flex: 1; 
            min-width: 0; 
            background: #f8fafc; 
            padding: 6px 8px; 
            border-radius: 8px; 
            border: 2px solid #e8ecf3; 
            font-size: 14px; 
            font-weight: 700; 
            color: #003369; 
            cursor: pointer; 
            white-space: nowrap; 
            overflow: hidden; 
            text-overflow: ellipsis; 
            height: 32px; 
            display: block; 
            line-height: 16px; 
            text-align: center; 
        }
        .cid-input:hover { border-color: #cbd5e1; }
        .cid-input.empty { font-weight: 400; color: #94a3b8; } 
        
        .btn-lupa { margin-left:5px; background: var(--p-primary); color:white; border:none; width:30px; height:30px; border-radius:8px; cursor:pointer; flex-shrink: 0; }

        .res-list { list-style: none; padding: 0; margin: 5px 0 0 0; border: 1px solid #e2e8f0; border-radius: 8px; max-height: 250px; overflow-y: auto; }
        .res-list li { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; cursor: pointer; font-size: 12px; display: flex; justify-content: space-between; }
        .res-list li:hover { background: #f0f9ff; }
        .res-list li strong { background: #e0f2fe; color: #003369; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
    `;
    document.head.appendChild(style);
}

function bindEvents() {
    const btnNovo = document.getElementById('pcd-btn-novo');
    if (btnNovo) btnNovo.onclick = () => openModal(false);

    const btnClose = document.getElementById('pcd-btn-cancel');
    if (btnClose) btnClose.onclick = closeModal;

    const btnIconClose = document.getElementById('pcd-modal-close-icon');
    if (btnIconClose) btnIconClose.onclick = closeModal;

    const btnSave = document.getElementById('pcd-btn-save');
    if (btnSave) btnSave.onclick = salvarRelatorio;

    const btnSearchClose = document.getElementById('pcd-search-close');
    if (btnSearchClose) btnSearchClose.onclick = closeSearch;

    const inputSearch = document.getElementById('pcdSearchInput');
    if (inputSearch) inputSearch.oninput = (e) => filtrarCids(e.target.value);

    const displayInputs = document.querySelectorAll('.cid-input, .btn-lupa');
    displayInputs.forEach(el => {
        el.onclick = (e) => {
            if (document.getElementById('pcdNome').disabled) return;
            let idx = e.currentTarget.getAttribute('data-idx');
            if (idx !== null) openSearch(parseInt(idx));
        };
    });

    ['pcdCargo', 'pcdFilial', 'pcdExperiencia', 'pcdLaudo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', calcularTudo);
    });

    const filtroNome = document.getElementById('filtroNome');
    if (filtroNome) filtroNome.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            state.filtros.nome = e.target.value;
            carregarHistorico();
        }
    });

    const filtroCargo = document.getElementById('filtroCargo');
    if (filtroCargo) filtroCargo.addEventListener('change', (e) => {
        state.filtros.cargo = e.target.value;
        carregarHistorico();
    });

    const filtroFilial = document.getElementById('filtroFilial');
    if (filtroFilial) filtroFilial.addEventListener('change', (e) => {
        state.filtros.filial = e.target.value;
        carregarHistorico();
    });

    const btnLimpar = document.getElementById('btnLimparFiltros');
    if (btnLimpar) btnLimpar.onclick = () => {
        state.filtros = {nome: '', cargo: '', filial: ''};
        document.getElementById('filtroNome').value = '';
        document.getElementById('filtroCargo').value = '';
        document.getElementById('filtroFilial').value = '';
        carregarHistorico();
    };

    const btnExport = document.getElementById('btnExportar');
    if (btnExport) btnExport.onclick = exportarRelatorio;
}

function loadInitialData() {
    carregarFiliais();
    carregarCargos();
    carregarHistorico();
}

function openModal(modeReadOnly, data = null) {
    const titleEl = document.getElementById('modalTitle');
    const btnSave = document.getElementById('pcd-btn-save');
    const inputs = document.querySelectorAll('.modal-card input, .modal-card select, .modal-card textarea, .btn-lupa');

    if (modeReadOnly && data) {
        titleEl.textContent = `Visualizar Protocolo #${data.id}`;
        btnSave.style.display = 'none';

        document.getElementById('pcdNome').value = data.nome_candidato;
        document.getElementById('pcdData').value = data.created_at.split('T')[0];

        setTimeout(() => {
            const elCargo = document.getElementById('pcdCargo');
            const elFilial = document.getElementById('pcdFilial');

            Array.from(elCargo.options).forEach(opt => {
                if (opt.value === data.cargo) opt.selected = true;
            });

            const filObj = state.filiais.find(f => f.nome === data.filial);
            if (filObj) elFilial.value = filObj.id;

            document.getElementById('pcdExperiencia').value = data.experiencia || 'NAO';
            document.getElementById('pcdLaudo').value = data.possui_laudo || 'NAO';
            document.getElementById('pcdRestricoes').value = data.observacoes || '';

            state.cidSelecionados = [null, null, null];
            if (data.cids_json && Array.isArray(data.cids_json)) {
                data.cids_json.forEach((c, idx) => {
                    if (idx < 3) selectCid(c, idx);
                });
            }


            calcularTudo();
            inputs.forEach(el => el.disabled = true);
        }, 200);

    } else {

        titleEl.textContent = 'Novo Parecer Técnico';
        btnSave.style.display = 'inline-flex';
        inputs.forEach(el => el.disabled = false);

        document.getElementById('pcdNome').value = '';
        document.getElementById('pcdRestricoes').value = '';
        document.getElementById('pcdCargo').value = '';
        document.getElementById('pcdFilial').value = '';
        document.getElementById('pcdExperiencia').value = 'NAO';
        document.getElementById('pcdLaudo').value = 'NAO';

        const dt = new Date();
        document.getElementById('pcdData').value = dt.toISOString().split('T')[0];

        state.cidSelecionados = [null, null, null];
        [0, 1, 2].forEach(i => {
            const el = document.getElementById(`cidDisplay${i + 1}`);
            if (el) {
                el.textContent = 'Selecionar...';
                el.classList.add('empty');
                el.style.color = '#94a3b8';
                el.style.borderColor = '#e8ecf3';
                el.style.background = '#f8fafc';
                el.title = '';
            }
        });


        updateStatus("AGUARDANDO DADOS", [], "#f1f5f9", "#94a3b8", "2px dashed #cbd5e1");
        state.scoreCache = {msg: '', val: 0};
    }

    document.getElementById('pcd-modal-overlay').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('pcd-modal-overlay').classList.add('hidden');
}

function openSearch(index) {
    state.cidIndexAtual = index;
    document.getElementById('pcdSearchInput').value = '';
    document.getElementById('pcdResultList').innerHTML =
        `<li style="background:#f0f9ff;color:#003369;font-weight:700;justify-content:center;" id="btnLoadAllCids">📂 Ver lista completa</li>`;

    setTimeout(() => {
        const btnLoad = document.getElementById('btnLoadAllCids');
        if (btnLoad) btnLoad.onclick = loadAllCids;
    }, 0);

    document.getElementById('pcd-search-overlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('pcdSearchInput').focus(), 100);
}

function closeSearch() {
    document.getElementById('pcd-search-overlay').classList.add('hidden');
}

async function carregarFiliais() {
    const {data, error} = await supabase.from('pcd_filiais').select('*').order('nome');
    if (!error && data) {
        state.filiais = data;
        const sel = document.getElementById('pcdFilial');
        const filt = document.getElementById('filtroFilial');
        if (sel) {
            sel.innerHTML = '<option value="">-- Selecione --</option>';
            data.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.id;
                opt.textContent = f.nome;
                sel.appendChild(opt);
            });
        }
        if (filt) {
            filt.innerHTML = '<option value="">Todas as Filiais</option>';
            data.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.nome;
                opt.textContent = f.nome;
                filt.appendChild(opt);
            });
        }
    }
}

async function carregarCargos() {
    let html = `
        <option value="">-- Selecione --</option>
        <optgroup label="Cargos Padrão (Legado)">
            <option value="OPERADOR DE MHE">OPERADOR DE MHE</option>
            <option value="OPERACIONAL">OPERACIONAL</option>
            <option value="ADM">ADMINISTRATIVO</option>
        </optgroup>
    `;
    const {data, error} = await supabase.from('pcd_lista_cargos').select('*').order('nome');
    if (!error && data) {
        state.cargos = data;
        html += `<optgroup label="Específicos">`;
        data.forEach(c => html += `<option value="${c.nome}">${c.nome}</option>`);
        html += `</optgroup>`;
    }
    const sel = document.getElementById('pcdCargo');
    if (sel) sel.innerHTML = html;

    const filt = document.getElementById('filtroCargo');
    if (filt) {
        let htmlFilt = '<option value="">Todos os Cargos</option>';
        if (data) data.forEach(c => htmlFilt += `<option value="${c.nome}">${c.nome}</option>`);
        filt.innerHTML = htmlFilt;
    }
}

async function loadAllCids() {
    const ul = document.getElementById('pcdResultList');
    ul.innerHTML = '<li style="text-align:center;padding:15px;color:#64748b;">Carregando...</li>';
    const {data} = await supabase.from('pcd_cids').select('*').limit(500).order('codigo');
    renderList(data);
};

async function filtrarCids(termo) {
    if (termo.length < 2) return;
    const {data} = await supabase.from('pcd_cids').select('*')
        .or(`codigo.ilike.%${termo}%,patologia.ilike.%${termo}%`)
        .limit(50);
    renderList(data);
}

function renderList(data) {
    const ul = document.getElementById('pcdResultList');
    ul.innerHTML = '';
    if (!data || !data.length) {
        ul.innerHTML = '<li style="text-align:center;color:red;padding:10px;">Nada encontrado</li>';
        return;
    }

    data.forEach(cid => {
        const li = document.createElement('li');

        li.title = cid.patologia;
        li.innerHTML = `<span style="font-weight:700; color:#003369; width:100%; text-align:center;">${cid.codigo}</span>`;
        li.onclick = () => selectCid(cid);
        ul.appendChild(li);
    });
}

function selectCid(cid, specificIndex = null) {
    const idx = specificIndex !== null ? specificIndex : state.cidIndexAtual;
    state.cidSelecionados[idx] = cid;
    const el = document.getElementById(`cidDisplay${idx + 1}`);
    if (el) {

        el.textContent = cid.codigo;

        el.title = cid.codigo;

        el.classList.remove('empty');
        el.style.color = '#003369';
        el.style.background = '#f0f9ff';
        el.style.borderColor = '#02B1EE';
    }
    if (specificIndex === null) {
        closeSearch();
        calcularTudo();
    }
}

function calcularTudo() {
    const nomeCargo = document.getElementById('pcdCargo').value;
    const filialId = document.getElementById('pcdFilial').value;
    const exp = document.getElementById('pcdExperiencia').value;
    const laudo = document.getElementById('pcdLaudo').value;

    if (!nomeCargo || (!filialId && !document.getElementById('pcdFilial').disabled) || nomeCargo.includes('Carregando')) {
        updateStatus("AGUARDANDO DADOS", [], "#f1f5f9", "#94a3b8", "2px dashed #cbd5e1");
        return;
    }

    let filialObj = state.filiais.find(f => f.id == filialId);
    if (!filialObj && document.getElementById('pcdFilial').disabled) return;

    let scoreBranch = 1;
    if (filialObj) {
        const cUp = nomeCargo.toUpperCase();
        if (cUp.includes('ADMINISTRATIVO') || cUp.includes('ESCRITÓRIO') || cUp === 'ADM' || cUp === 'ADMINISTRATIVO') {
            scoreBranch = filialObj.grau_adm || 1;
        } else {
            scoreBranch = filialObj.grau_operacional || 1;
        }
    }

    let totalScore = 0;
    let count = 0;
    let recs = [];

    state.cidSelecionados.forEach(cid => {
        if (!cid) return;
        count++;

        let scoreDeste = 1;
        if (nomeCargo === 'OPERADOR DE MHE') scoreDeste = cid.grau_mhe || 1;
        else if (nomeCargo === 'OPERACIONAL') scoreDeste = cid.grau_operacional || 1;
        else if (nomeCargo === 'ADM') scoreDeste = cid.grau_adm || 1;
        else if (cid.scores_por_cargo && cid.scores_por_cargo[nomeCargo] !== undefined) {
            scoreDeste = cid.scores_por_cargo[nomeCargo];
        } else {
            let col = 'grau_operacional';
            const cUp = nomeCargo.toUpperCase();
            if (cUp.includes('MHE') || cUp.includes('OPERADOR')) col = 'grau_mhe';
            else if (cUp.includes('ADM') || cUp.includes('ANALISTA')) col = 'grau_adm';
            scoreDeste = cid[col] || 1;
        }
        totalScore += scoreDeste;

        if (cid.patologia.toUpperCase().includes('HIV')) recs.push('⚠️ HIV: Evitar câmaras frias.');
        if (cid.codigo.startsWith('H54')) recs.push('👁️ Visão: Solicitar laudo detalhado.');
    });

    if (count === 0) {
        let r = [];
        if (filialObj && filialObj.recomendacao) r.push(`🏢 <strong>Filial:</strong> ${filialObj.recomendacao}`);
        updateStatus("AGUARDANDO SELEÇÃO DE CIDS", r, "#f1f5f9", "#94a3b8", "2px dashed #cbd5e1");
        return;
    }

    if (filialObj && filialObj.recomendacao) recs.unshift(`🏢 <strong>Filial:</strong> ${filialObj.recomendacao}`);

    const scoreExp = (exp === 'NAO') ? 4 : 1.1;
    const scoreLaudo = (laudo === 'NAO') ? 40 : 1;
    let score3Cids = (count >= 3) ? 100 : 1;
    if (score3Cids > 1) recs.push('❗ Atenção: 3 ou mais CIDs.');

    const base = totalScore === 0 ? 1 : totalScore;
    const finalScore = (base * scoreBranch * scoreExp * scoreLaudo) + score3Cids;

    let msg = "", bg = "", color = "", border = "";

    if (finalScore >= 1000) {
        msg = "⛔ REPROVADO / RISCO CRÍTICO";
        bg = "#fef2f2";
        color = "#b91c1c";
        border = "2px solid #fecaca";
    } else if (finalScore > 100) {
        msg = "⛔ REPROVADO / RISCO EXISTENTE";
        bg = "#fef2f2";
        color = "#b91c1c";
        border = "2px solid #fecaca";
    } else {
        msg = "✅ APROVADO / BAIXO RISCO";
        bg = "#f0fdf4";
        color = "#15803d";
        border = "2px solid #bbf7d0";
    }

    state.scoreCache = {msg, val: finalScore};
    updateStatus(msg, recs, bg, color, border);
}

function updateStatus(msg, recs, bg, color, border) {
    const el = document.getElementById('statusBox');
    if (el) {
        el.textContent = msg;
        Object.assign(el.style, {backgroundColor: bg, color, border});
    }

    const recBox = document.getElementById('boxRecomendacoes');
    if (recBox) {
        if (!recs.length) {
            recBox.textContent = "Nenhuma recomendação específica.";
            recBox.style.color = "#94a3b8";
        } else {
            recBox.innerHTML = [...new Set(recs)].map(r => `<div style="margin-bottom:6px;">${r}</div>`).join('');
            recBox.style.color = "#334155";
        }
    }
}

async function carregarHistorico() {
    const tb = document.getElementById('pcd-tbody');
    if (!tb) return;

    tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#94a3b8;">Carregando...</td></tr>';

    let query = supabase.from('pcd_reports').select('*').order('created_at', {ascending: false});

    if (state.filtros.nome) query = query.ilike('nome_candidato', `%${state.filtros.nome}%`);
    if (state.filtros.cargo) query = query.eq('cargo', state.filtros.cargo);
    if (state.filtros.filial) query = query.eq('filial', state.filtros.filial);

    query = query.limit(50);

    const {data, error} = await query;

    if (error || !data || !data.length) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">Nenhum histórico encontrado com estes filtros.</td></tr>';
        return;
    }

    state.historico = data;

    tb.innerHTML = data.map(r => {
        const dt = new Date(r.created_at).toLocaleDateString('pt-BR');
        let statusClass = 'bg-red';
        if ((r.status_parecer || '').includes('APROVADO')) statusClass = 'bg-green';

        const cids = (r.cids_json || []).map(c =>
            `<span style="background:#e0f2fe;color:#003369;padding:2px 5px;border-radius:4px;font-size:10px;margin-right:4px;display:inline-block;">${c.codigo}</span>`
        ).join('');

        return `
            <tr data-id="${r.id}" title="Clique duplo para detalhes">
                <td style="text-align: center;"><strong>#${r.id}</strong></td>
                <td style="text-align: center;">${dt}</td>
                <td style="text-align: left;">${r.nome_candidato || '-'}</td>
                <td style="text-align: left;">
                    <div style="font-weight:700;">${r.cargo}</div>
                    <div style="font-size:10px;color:#64748b;">${r.filial}</div>
                </td>
                <td style="text-align: center;">${cids}</td>
                <td style="text-align: center;"><span class="badge-status ${statusClass}">${r.status_parecer}</span></td>
            </tr>
        `;
    }).join('');

    const rows = tb.querySelectorAll('tr');
    rows.forEach(row => {
        row.ondblclick = () => {
            const id = row.getAttribute('data-id');
            const report = state.historico.find(item => item.id == id);
            if (report) openModal(true, report);
        };
    });
}

async function salvarRelatorio() {
    const nome = document.getElementById('pcdNome').value;
    const cargo = document.getElementById('pcdCargo').value;
    const filialId = document.getElementById('pcdFilial').value;

    if (!nome || !cargo || !filialId) {
        await window.customAlert("Preencha Nome, Cargo e Filial.", "Campos Obrigatórios");
        return;
    }

    const cidsValidos = state.cidSelecionados.filter(c => c).map(c => ({codigo: c.codigo, patologia: c.patologia}));
    if (cidsValidos.length === 0) {
        await window.customAlert("Selecione pelo menos um CID.", "Atenção");
        return;
    }

    const filialObj = state.filiais.find(f => f.id == filialId);

    const payload = {
        nome_candidato: nome,
        cargo: cargo,
        filial: filialObj ? filialObj.nome : '-',
        experiencia: document.getElementById('pcdExperiencia').value,
        possui_laudo: document.getElementById('pcdLaudo').value,
        observacoes: document.getElementById('pcdRestricoes').value,
        cids_json: cidsValidos,
        status_parecer: state.scoreCache.msg,
        score_final: state.scoreCache.val
    };

    const {error} = await supabase.from('pcd_reports').insert(payload);
    if (error) {
        await window.customAlert("Erro ao salvar: " + error.message, "Erro");
    } else {
        await window.customAlert("✅ Salvo com sucesso!", "Sucesso");
        closeModal();
        carregarHistorico();
    }
}

async function exportarRelatorio() {
    let query = supabase.from('pcd_reports').select('*').order('created_at', {ascending: false}).limit(1000);
    if (state.filtros.nome) query = query.ilike('nome_candidato', `%${state.filtros.nome}%`);
    if (state.filtros.cargo) query = query.eq('cargo', state.filtros.cargo);
    if (state.filtros.filial) query = query.eq('filial', state.filtros.filial);

    const {data, error} = await query;
    if (error || !data || !data.length) {
        await window.customAlert("Nada para exportar com os filtros atuais.", "Aviso");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "Protocolo;Data;Nome;Cargo;Filial;Experiencia;Laudo;Parecer;CIDs\r\n";

    data.forEach(r => {
        const dt = new Date(r.created_at).toLocaleDateString('pt-BR');
        const cids = (r.cids_json || []).map(c => c.codigo).join(', ');
        const nome = (r.nome_candidato || '').replace(/;/g, ' ');
        const obs = (r.observacoes || '').replace(/;/g, ' ').replace(/\n/g, ' ');

        csvContent += `${r.id};${dt};${nome};${r.cargo};${r.filial};${r.experiencia};${r.possui_laudo};${r.status_parecer};${cids}\r\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_pcd_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}