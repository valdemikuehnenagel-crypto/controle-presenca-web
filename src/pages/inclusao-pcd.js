import {supabase} from '../supabaseClient.js';

let filiaisCache = [];
let cidSelecionados = [null, null, null];


function getScoreColor(score) {
    if (score <= 100) return '#10b981';
    if (score < 1000) return '#f59e0b';
    return '#ef4444';
}

export function renderInclusaoPCD(container) {
    const style = document.createElement('style');
    style.textContent = `
        /* --- ESTILO COMPACTO --- */
        .pcd-wrapper {
            font-family: 'Inter', 'Segoe UI', sans-serif;
            background-color: transparent;
            padding: 15px; /* Reduzido de 30px */
            min-height: 100vh;
            color: #334155;
            box-sizing: border-box;
        }

        /* HEADER MAIS BAIXO */
        .pcd-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px; /* Reduzido */
            border-bottom: 2px solid #003369;
            padding: 10px 15px; /* Reduzido */
            background: rgba(255, 255, 255, 0.95);
            border-radius: 8px;
            backdrop-filter: blur(5px);
        }
        .pcd-header h2 { margin: 0; color: #003369; font-size: 20px; font-weight: 800; }
        .version-badge { background: #e2e8f0; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; color: #64748b; }

        /* GRID */
        .pcd-grid {
            display: grid;
            grid-template-columns: 1fr 1.4fr;
            gap: 15px; /* Reduzido gap */
            align-items: start;
        }
        @media (max-width: 900px) { .pcd-grid { grid-template-columns: 1fr; } }

        /* CARDS */
        .pcd-card {
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            border: 1px solid #cbd5e1;
            overflow: hidden;
        }
        .card-header {
            background: #003369;
            color: white;
            padding: 8px 15px; /* Mais fino */
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            text-transform: uppercase;
        }
        .card-body { padding: 15px; } /* Reduzido padding interno */

        /* FORMULÁRIOS COMPACTOS */
        .form-group { margin-bottom: 10px; } /* Menos espaço entre campos */
        
        .form-label {
            display: block;
            font-size: 12px;
            font-weight: 700;
            margin-bottom: 3px;
            color: #475569;
        }
        .form-control {
            width: 100%;
            padding: 6px 10px; /* Input mais baixo */
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            font-size: 13px;
            box-sizing: border-box;
            transition: all 0.2s;
            height: 34px; /* Altura fixa para alinhar */
        }
        textarea.form-control { height: auto; } /* Textarea livre */

        .form-control:focus {
            border-color: #02B1EE;
            outline: none;
            box-shadow: 0 0 0 2px rgba(2, 177, 238, 0.1);
        }

        /* GRID INTERNO PARA INPUTS (LADO A LADO) */
        .form-row-compact {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 10px;
        }
        .form-row-compact.uneven { grid-template-columns: 1fr 2fr; } /* Para Data(pequeno) e Nome(grande) */

        /* CIDS */
        .cid-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px; /* Mais junto */
            background: #f8fafc;
            padding: 6px 10px;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
            transition: border-color 0.2s;
        }
        .cid-row:hover { border-color: #02B1EE; }
        
        .cid-label { font-weight: 800; color: #003369; font-size: 12px; min-width: 40px; }
        
        .cid-display-input {
            flex: 1;
            background: white;
            border: 1px solid #cbd5e1;
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 12px;
            color: #334155;
            cursor: pointer;
            height: 30px; /* Fixo */
            display: flex;
            align-items: center;
        }
        .cid-display-input:hover { border-color: #02B1EE; }
        .cid-display-input.empty { color: #94a3b8; font-style: italic; }

        .cid-score-badge {
            width: 30px; height: 30px;
            display: flex; align-items: center; justify-content: center;
            background: #cbd5e1; color: white;
            font-weight: 800; border-radius: 6px; font-size: 12px;
        }

        .btn-lupa {
            background: #003369; color: white; border: none;
            width: 30px; height: 30px; border-radius: 6px;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        .btn-lupa:hover { background: #02B1EE; }

        /* DASHBOARD COMPACTO */
        .dashboard-container { display: flex; gap: 10px; margin-top: 10px; }
        
        .stats-list {
            flex: 1;
            background: #f8fafc;
            border-radius: 6px;
            padding: 8px 12px;
            border: 1px solid #e2e8f0;
            font-size: 11px;
        }
        .stat-item {
            display: flex; justify-content: space-between;
            padding: 3px 0;
            border-bottom: 1px solid #e2e8f0;
        }
        .stat-item:last-child { border: none; }

        .score-box {
            width: 140px; /* Largura fixa menor */
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            background: white; border: 1px solid #e2e8f0;
            border-radius: 6px; position: relative; overflow: hidden;
        }
        .score-box::before {
            content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 4px;
            background: linear-gradient(90deg, #10b981, #f59e0b, #ef4444);
        }
        
        .score-number { font-size: 36px; font-weight: 900; line-height: 1; margin-top: 5px; }
        .score-title { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700; }

        /* STATUS BANNER */
        .status-banner {
            margin-top: 10px;
            padding: 8px;
            text-align: center;
            border-radius: 6px;
            font-weight: 700;
            font-size: 13px;
            background: #f1f5f9; color: #64748b;
        }

        /* RECOMENDAÇÕES */
        .rec-box {
            background: #fffbeb; border-left: 3px solid #f59e0b;
            padding: 8px 12px; font-size: 12px; color: #78350f;
            border-radius: 4px; min-height: 30px;
            margin-bottom: 0;
        }

        /* MODAL */
        #modalBuscaCid { backdrop-filter: blur(2px); }
        .modal-card {
            background: white; width: 90%; max-width: 500px;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            animation: slideUp 0.15s ease-out;
            display: flex; flex-direction: column;
            max-height: 85vh;
        }
        @keyframes slideUp { from { transform: translateY(15px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        
        .modal-header {
            padding: 10px 15px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
            font-weight: 700; color: #003369; display: flex; justify-content: space-between; align-items: center;
        }
        .modal-body { padding: 15px; overflow: hidden; display: flex; flex-direction: column; }
        
        .modal-search-bar {
            width: 100%; padding: 8px; font-size: 14px;
            border: 2px solid #02B1EE; border-radius: 6px;
            margin-bottom: 10px; box-sizing: border-box;
        }
        
        .cid-list {
            list-style: none; padding: 0; margin: 0; overflow-y: auto;
            border: 1px solid #e2e8f0; border-radius: 6px; flex: 1;
        }
        .cid-list li {
            padding: 8px 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer;
            display: flex; justify-content: space-between; align-items: center; font-size: 13px;
        }
        .cid-list li:hover { background: #f0f9ff; }
        .cid-list li.action-row { background: #f0f9ff; color: #003369; font-weight: 700; justify-content: center; }
        .cid-list li.action-row:hover { background: #e0f2fe; }
    `;
    document.head.appendChild(style);

    container.innerHTML = `
        <div class="pcd-wrapper">
            <div class="pcd-header">
                <h2>Inclusão <span style="color:#02B1EE">PCD</span></h2>
                <span class="version-badge">SHE System v1.2</span>
            </div>

            <div class="pcd-grid">
                <div class="pcd-card">
                    <div class="card-header">👤 Dados do Candidato</div>
                    <div class="card-body">
                        
                        <div class="form-row-compact uneven">
                            <div>
                                <label class="form-label">Data</label>
                                <input type="date" id="pcdData" class="form-control">
                            </div>
                            <div>
                                <label class="form-label">Nome Completo</label>
                                <input type="text" id="pcdNome" class="form-control" placeholder="Nome do candidato">
                            </div>
                        </div>

                        <div class="form-row-compact">
                            <div>
                                <label class="form-label">Cargo</label>
                                <select id="pcdCargo" class="form-control">
                                    <option value="">-- Selecione --</option>
                                    <option value="OPERADOR DE MHE">OPERADOR MHE</option>
                                    <option value="OPERACIONAL">OPERACIONAL</option>
                                    <option value="ADM">ADMINISTRATIVO</option>
                                </select>
                            </div>
                            <div>
                                <label class="form-label">Filial</label>
                                <select id="pcdFilial" class="form-control">
                                    <option value="">Carregando...</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-row-compact">
                            <div>
                                <label class="form-label">Experiência?</label>
                                <select id="pcdExperiencia" class="form-control">
                                    <option value="NAO">NÃO</option>
                                    <option value="SIM">SIM</option>
                                </select>
                            </div>
                            <div>
                                <label class="form-label">Possui Laudo?</label>
                                <select id="pcdLaudo" class="form-control">
                                    <option value="NAO">NÃO</option>
                                    <option value="SIM">SIM</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label">Observações / Restrições</label>
                            <textarea id="pcdRestricoes" class="form-control" style="height:60px; resize:vertical;" placeholder="EPI especial, mobilidade, etc..."></textarea>
                        </div>
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:15px;">
                    
                    <div class="pcd-card">
                        <div class="card-header">🩺 Análise Médica (CID)</div>
                        <div class="card-body">
                            
                            <div class="cid-row">
                                <div class="cid-label">CID 1</div>
                                <div id="cidDisplay1" class="cid-display-input empty" onclick="abrirModalCid(0)">
                                    Selecionar via lupa...
                                </div>
                                <div id="cidScoreBadge1" class="cid-score-badge">0</div>
                                <button class="btn-lupa" onclick="abrirModalCid(0)">🔍</button>
                            </div>

                            <div class="cid-row">
                                <div class="cid-label">CID 2</div>
                                <div id="cidDisplay2" class="cid-display-input empty" onclick="abrirModalCid(1)">
                                    Selecionar via lupa...
                                </div>
                                <div id="cidScoreBadge2" class="cid-score-badge">0</div>
                                <button class="btn-lupa" onclick="abrirModalCid(1)">🔍</button>
                            </div>

                            <div class="cid-row">
                                <div class="cid-label">CID 3</div>
                                <div id="cidDisplay3" class="cid-display-input empty" onclick="abrirModalCid(2)">
                                    Selecionar via lupa...
                                </div>
                                <div id="cidScoreBadge3" class="cid-score-badge">0</div>
                                <button class="btn-lupa" onclick="abrirModalCid(2)">🔍</button>
                            </div>

                            <div style="text-align:center; font-size:10px; color:#94a3b8; margin-top:5px;">
                                * Se o CID não constar, contate o SHE.
                            </div>
                        </div>
                    </div>

                    <div class="pcd-card">
                        <div class="card-header" style="background:#f1f5f9; color:#003369; border-bottom:1px solid #e2e8f0;">
                            📊 Resultado
                        </div>
                        <div class="card-body">
                            
                            <label class="form-label">Recomendações</label>
                            <div id="boxRecomendacoes" class="rec-box">
                                Aguardando preenchimento...
                            </div>

                            <div class="dashboard-container">
                                <div class="stats-list">
                                    <div class="stat-item"><span>CIDs</span><strong id="detScoreCid">0</strong></div>
                                    <div class="stat-item"><span>Branch</span><strong id="detScoreBranch">1</strong></div>
                                    <div class="stat-item"><span>Exp</span><strong id="detScoreExp">4</strong></div>
                                    <div class="stat-item"><span>Laudo</span><strong id="detScoreLaudo">40</strong></div>
                                    <div class="stat-item"><span>H54</span><strong id="detScoreH54">0</strong></div>
                                    <div class="stat-item"><span>3 CIDs</span><strong id="detScore3Cid">1</strong></div>
                                </div>
                                <div class="score-box">
                                    <div class="score-title">SCORE FINAL</div>
                                    <div id="displayScoreFinal" class="score-number" style="color:#94a3b8">0</div>
                                </div>
                            </div>

                            <div id="statusBox" class="status-banner">
                                AGUARDANDO DADOS
                            </div>

                            <div style="margin-top:10px; text-align:center; font-size:10px; color:#94a3b8;">
                                <a href="#" style="color:#02B1EE">ernanes.piran@kuehne-nagel.com</a>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>

        <div id="modalBuscaCid" style="display:none; position:fixed; inset:0; z-index:9999; align-items:center; justify-content:center;">
            <div class="modal-card">
                <div class="modal-header">
                    <span>🔎 Buscar Patologia</span>
                    <button id="btnFecharModalCid" style="border:none; background:transparent; font-size:20px; cursor:pointer;">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="text" id="inputBuscaModal" class="modal-search-bar" placeholder="Ex: A80 ou Paralisia...">
                    <ul id="listaResultadosCid" class="cid-list">
                        <li style="text-align:center; color:#94a3b8; cursor:default;">...</li>
                    </ul>
                </div>
            </div>
        </div>
    `;


    carregarFiliais();
    const elDate = document.getElementById('pcdData');
    if (elDate) elDate.valueAsDate = new Date();

    ['pcdCargo', 'pcdFilial', 'pcdExperiencia', 'pcdLaudo'].forEach(id => {
        document.getElementById(id).addEventListener('change', calcularTudo);
    });

    document.getElementById('btnFecharModalCid').addEventListener('click', () => {
        document.getElementById('modalBuscaCid').style.display = 'none';
    });

    document.getElementById('inputBuscaModal').addEventListener('input', (e) => {
        filtrarCids(e.target.value);
    });

    window.abrirModalCid = abrirModalCid;
    window.carregarTodosCids = carregarTodosCids;
}


async function carregarFiliais() {
    const {data, error} = await supabase.from('pcd_filiais').select('*').order('nome');
    if (!error) {
        filiaisCache = data;
        const sel = document.getElementById('pcdFilial');
        if (!sel) return;
        sel.innerHTML = '<option value="">-- Selecione a Filial --</option>';
        data.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = f.nome;
            sel.appendChild(opt);
        });
    }
}


let cidIndexAtual = 0;

function abrirModalCid(index) {
    cidIndexAtual = parseInt(index);
    const modal = document.getElementById('modalBuscaCid');
    const input = document.getElementById('inputBuscaModal');
    const lista = document.getElementById('listaResultadosCid');

    input.value = '';


    lista.innerHTML = `
        <li class="action-row" onclick="carregarTodosCids()">
            📂 Checar na base completa
        </li>
    `;

    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 100);
}

async function carregarTodosCids() {
    const lista = document.getElementById('listaResultadosCid');
    lista.innerHTML = '<li style="text-align:center; padding:20px; color:#64748b;">Carregando base de dados...</li>';

    const {data, error} = await supabase
        .from('pcd_cids')
        .select('*')
        .limit(1000)
        .order('codigo', {ascending: true});

    if (error) {
        console.error(error);
        lista.innerHTML = '<li style="text-align:center; color:#ef4444;">Erro ao carregar dados.</li>';
        return;
    }

    renderizarListaCids(data);
}

async function filtrarCids(termo) {
    if (termo.length < 2) return;

    const {data, error} = await supabase
        .from('pcd_cids')
        .select('*')
        .or(`codigo.ilike.%${termo}%,patologia.ilike.%${termo}%`)
        .limit(50);

    if (error) {
        console.error(error);
        return;
    }

    renderizarListaCids(data);
}

function renderizarListaCids(data) {
    const lista = document.getElementById('listaResultadosCid');
    lista.innerHTML = '';

    if (!data || data.length === 0) {
        lista.innerHTML = '<li style="text-align:center; color:#ef4444; cursor:default;">Nenhum CID encontrado.</li>';
        return;
    }

    data.forEach(cid => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${cid.patologia}</span>
            <strong style="background:#e0f2fe; color:#003369; padding:2px 6px; border-radius:4px;">${cid.codigo}</strong>
        `;
        li.onclick = () => selecionarCid(cid);
        lista.appendChild(li);
    });
}

function selecionarCid(cid) {
    cidSelecionados[cidIndexAtual] = cid;


    const displayEl = document.getElementById(`cidDisplay${cidIndexAtual + 1}`);
    displayEl.textContent = `${cid.codigo} - ${cid.patologia}`;
    displayEl.classList.remove('empty');
    displayEl.style.fontWeight = "600";
    displayEl.style.color = "#334155";

    document.getElementById('modalBuscaCid').style.display = 'none';
    calcularTudo();
}

function calcularTudo() {
    const cargo = document.getElementById('pcdCargo').value;
    const filialId = document.getElementById('pcdFilial').value;
    const exp = document.getElementById('pcdExperiencia').value;
    const laudo = document.getElementById('pcdLaudo').value;

    if (!cargo || !filialId) {
        atualizarDisplay(0, "PREENCHA CARGO E FILIAL", [], {});
        return;
    }

    const filialObj = filiaisCache.find(f => f.id == filialId);
    let scoreBranch = 1;
    let mapCargoCol = '';

    if (cargo === 'OPERADOR DE MHE') mapCargoCol = 'grau_mhe';
    else if (cargo === 'OPERACIONAL') mapCargoCol = 'grau_operacional';
    else if (cargo === 'ADM') mapCargoCol = 'grau_adm';

    if (filialObj) {
        const val = filialObj[mapCargoCol];
        scoreBranch = (val !== undefined && val !== null) ? val : 1;
    }

    let totalScoreCid = 0;
    let countCids = 0;
    let temH54 = false;
    let recs = [];

    cidSelecionados.forEach((cid, idx) => {
        const elBadge = document.getElementById(`cidScoreBadge${idx + 1}`);
        if (!cid) {
            elBadge.textContent = '0';
            elBadge.style.background = '#cbd5e1';
            return;
        }
        countCids++;
        const scoreDeste = cid[mapCargoCol] || 1;
        totalScoreCid += scoreDeste;

        elBadge.textContent = scoreDeste;

        elBadge.style.background = getScoreColor(scoreDeste * 20);

        if (cid.codigo.toUpperCase().startsWith('H54')) temH54 = true;

        const pat = cid.patologia.toUpperCase();
        if (pat.includes('HIV')) recs.push(`⚠️ HIV: Recomenda-se evitar atividades em câmaras frias.`);
        if (pat.includes('VISÃO') || pat.includes('CEGUEIRA')) recs.push(`👁️ Visão: SHE poderá solicitar laudo.`);
        if (pat.includes('AUDIÇÃO') || pat.includes('SURDEZ')) recs.push(`👂 Audição: Alocar em local de baixo ruído.`);
    });

    if (filialObj && filialObj.recomendacao) {
        recs.unshift(`🏢 Filial: ${filialObj.recomendacao}`);
    }

    const scoreExp = (exp === 'NAO') ? 4 : 1.1;
    const scoreLaudo = (laudo === 'NAO') ? 40 : 1;
    let scoreH54 = 0;
    let score3Cids = 1;

    if (countCids === 3) {
        score3Cids = 100;
        recs.push(`❗ 3 CIDs identificados: Atenção redobrada.`);
    }

    const baseCidParaConta = totalScoreCid === 0 ? 1 : totalScoreCid;
    const finalScore = (baseCidParaConta * scoreBranch * scoreExp * scoreLaudo) + scoreH54 + score3Cids;

    const details = {
        cid: totalScoreCid,
        branch: scoreBranch,
        exp: scoreExp,
        laudo: scoreLaudo,
        h54: scoreH54,
        three: score3Cids
    };


    let msg = "";
    let bg = "#f1f5f9";
    let color = "#334155";
    let border = "transparent";

    if (finalScore >= 1000) {
        msg = "⛔ REPROVADO / RISCO CRÍTICO";
        bg = "#fef2f2";
        color = "#b91c1c";
        border = "#fecaca";
    } else if (finalScore > 100) {
        msg = "⚠️ ATENÇÃO / AVALIAÇÃO NECESSÁRIA";
        bg = "#fffbeb";
        color = "#b45309";
        border = "#fcd34d";
    } else {
        msg = "✅ APROVADO / BAIXO RISCO";
        bg = "#f0fdf4";
        color = "#15803d";
        border = "#bbf7d0";
    }

    atualizarDisplay(finalScore, msg, recs, details, bg, color, border);
}

function atualizarDisplay(score, msg, recs, details, bg, color, border) {
    const elFinal = document.getElementById('displayScoreFinal');
    if (elFinal) {
        elFinal.textContent = Math.round(score);
        elFinal.style.color = getScoreColor(score);
    }

    if (details) {
        document.getElementById('detScoreCid').textContent = details.cid;
        document.getElementById('detScoreBranch').textContent = details.branch;
        document.getElementById('detScoreExp').textContent = details.exp;
        document.getElementById('detScoreLaudo').textContent = details.laudo;
        document.getElementById('detScoreH54').textContent = details.h54;
        document.getElementById('detScore3Cid').textContent = details.three;
    }

    const statusBox = document.getElementById('statusBox');
    if (statusBox) {
        statusBox.textContent = msg;
        statusBox.style.backgroundColor = bg;
        statusBox.style.color = color;
        statusBox.style.borderColor = border;
        statusBox.style.borderStyle = 'solid';
        statusBox.style.borderWidth = '1px';
    }

    const boxRec = document.getElementById('boxRecomendacoes');
    if (boxRec) {
        if (recs.length === 0) {
            boxRec.textContent = "Nenhuma recomendação específica.";
            boxRec.style.color = "#94a3b8";
        } else {
            const unique = [...new Set(recs)];
            boxRec.innerHTML = unique.map(r => `<div style="margin-bottom:5px;">• ${r}</div>`).join('');
            boxRec.style.color = "#334155";
        }
    }
}