import {supabase} from '../supabaseClient.js';

let filiaisCache = [];
let cidSelecionados = [null, null, null]; // Armazena os objetos dos 3 CIDs

export function renderInclusaoPCD(container) {
    container.innerHTML = `
        <div class="pcd-container" style="padding: 20px; max-width: 1200px; margin: 0 auto; font-family: sans-serif;">
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #003369; padding-bottom: 10px;">
                <h2 style="color: #003369; margin: 0;">Formulário de Inclusão - PCD</h2>
                <div style="text-align: right; font-size: 12px; color: #666;">
                    SHE System v1.2 (Fix Zero)
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1.5fr; gap: 20px;">
                
                <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; height: fit-content;">
                    <h3 style="background: #003369; color: white; padding: 10px; margin: -20px -20px 20px -20px; border-radius: 8px 8px 0 0; text-align: center;">
                        Informações do Candidato (a)
                    </h3>

                    <div class="form-group" style="margin-bottom: 12px;">
                        <label style="font-weight: bold; font-size: 13px; display: block;">Data</label>
                        <input type="date" id="pcdData" class="form-control" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    </div>

                    <div class="form-group" style="margin-bottom: 12px;">
                        <label style="font-weight: bold; font-size: 13px; display: block;">Nome do Candidato (a)</label>
                        <input type="text" id="pcdNome" placeholder="Digite o nome..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    </div>

                    <div class="form-group" style="margin-bottom: 12px;">
                        <label style="font-weight: bold; font-size: 13px; display: block;">Cargo</label>
                        <select id="pcdCargo" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                            <option value="">-- Selecione --</option>
                            <option value="OPERADOR DE MHE">OPERADOR DE EMPILHADEIRA (MHE)</option>
                            <option value="OPERACIONAL">OPERACIONAL</option>
                            <option value="ADM">ADMINISTRATIVO</option>
                        </select>
                    </div>

                    <div class="form-group" style="margin-bottom: 12px;">
                        <label style="font-weight: bold; font-size: 13px; display: block;">Filial de aplicação</label>
                        <select id="pcdFilial" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                            <option value="">Carregando...</option>
                        </select>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
                        <div>
                            <label style="font-weight: bold; font-size: 13px; display: block;">Tem Experiência?</label>
                            <select id="pcdExperiencia" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                                <option value="NAO">NÃO</option>
                                <option value="SIM">SIM</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-weight: bold; font-size: 13px; display: block;">Tem Laudo?</label>
                            <select id="pcdLaudo" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                                <option value="NAO">NÃO</option>
                                <option value="SIM">SIM</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-group" style="margin-top: 20px;">
                        <label style="font-weight: bold; font-size: 12px; display: block; color: #666; margin-bottom: 5px;">
                            Descreva abaixo caso haja restrições (EPI Especial, Mobilidade, etc):
                        </label>
                        <textarea id="pcdRestricoes" rows="4" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; resize: vertical;" placeholder="Escreva aqui..."></textarea>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 20px;">
                    
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px;">
                        <h3 style="background: #003369; color: white; padding: 10px; margin: 0; border-radius: 8px 8px 0 0; text-align: center;">
                            Informações CID
                        </h3>
                        <div style="padding: 20px;">
                            
                            <div class="cid-row" style="display: flex; gap: 10px; margin-bottom: 10px; align-items: center;">
                                <div style="width: 60px; font-weight: bold; color: #003369;">CID 1</div>
                                <input type="text" id="cidInput1" placeholder="Busca (ex: A80)" style="width: 100px; padding: 6px; border: 1px solid #ccc;">
                                <input type="text" id="cidDesc1" readonly style="flex: 1; background: #f3f4f6; border: 1px solid #eee; padding: 6px; font-size: 12px; color: #555;">
                                <div id="cidScore1" style="width: 40px; background: #94a3b8; color: white; font-weight: bold; text-align: center; padding: 6px; border-radius: 4px;">0</div>
                                <button class="btn-busca-cid" data-index="0" style="background: #003369; color: white; border: none; padding: 6px 12px; cursor: pointer; border-radius: 4px;">🔍</button>
                            </div>

                            <div class="cid-row" style="display: flex; gap: 10px; margin-bottom: 10px; align-items: center;">
                                <div style="width: 60px; font-weight: bold; color: #003369;">CID 2</div>
                                <input type="text" id="cidInput2" placeholder="Busca" style="width: 100px; padding: 6px; border: 1px solid #ccc;">
                                <input type="text" id="cidDesc2" readonly style="flex: 1; background: #f3f4f6; border: 1px solid #eee; padding: 6px; font-size: 12px; color: #555;">
                                <div id="cidScore2" style="width: 40px; background: #94a3b8; color: white; font-weight: bold; text-align: center; padding: 6px; border-radius: 4px;">0</div>
                                <button class="btn-busca-cid" data-index="1" style="background: #003369; color: white; border: none; padding: 6px 12px; cursor: pointer; border-radius: 4px;">🔍</button>
                            </div>

                            <div class="cid-row" style="display: flex; gap: 10px; margin-bottom: 10px; align-items: center;">
                                <div style="width: 60px; font-weight: bold; color: #003369;">CID 3</div>
                                <input type="text" id="cidInput3" placeholder="Busca" style="width: 100px; padding: 6px; border: 1px solid #ccc;">
                                <input type="text" id="cidDesc3" readonly style="flex: 1; background: #f3f4f6; border: 1px solid #eee; padding: 6px; font-size: 12px; color: #555;">
                                <div id="cidScore3" style="width: 40px; background: #94a3b8; color: white; font-weight: bold; text-align: center; padding: 6px; border-radius: 4px;">0</div>
                                <button class="btn-busca-cid" data-index="2" style="background: #003369; color: white; border: none; padding: 6px 12px; cursor: pointer; border-radius: 4px;">🔍</button>
                            </div>

                            <p style="font-size: 11px; color: #02B1EE; margin-top: 10px; text-align: center;">
                                Se o CID não for encontrado, entrar em contato com o time SHE para apuração da patologia.
                            </p>
                        </div>
                    </div>

                    <div style="background: #003369; color: white; padding: 10px; text-align: center; border-radius: 4px; font-weight: bold;">
                        Recomendações
                    </div>
                    <div id="boxRecomendacoes" style="background: white; border: 1px solid #ccc; padding: 15px; font-size: 13px; min-height: 80px; white-space: pre-line;">
                        </div>

                    <div style="display: flex; gap: 20px;">
                        <div style="flex: 1; background: #f1f5f9; padding: 10px; border-radius: 4px; font-size: 12px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Score CID Total:</span> <strong id="detScoreCid">0</strong></div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Score Branch:</span> <strong id="detScoreBranch">1</strong></div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Score Exp:</span> <strong id="detScoreExp">4</strong></div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Score Laudo:</span> <strong id="detScoreLaudo">40</strong></div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>H54 Rule:</span> <strong id="detScoreH54">0</strong></div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>3 CIDs:</span> <strong id="detScore3Cid">1</strong></div>
                        </div>

                        <div style="flex: 1; text-align: center;">
                            <div style="background: #003369; color: white; padding: 10px; font-size: 24px; font-weight: bold; border-radius: 8px;">
                                Score Final
                            </div>
                            <div id="displayScoreFinal" style="font-size: 48px; font-weight: bold; color: #333; margin: 10px 0; border: 2px solid #003369; border-radius: 8px; background: #fff;">
                                0
                            </div>
                        </div>
                    </div>

                    <div id="statusBox" style="border: 2px solid #ccc; padding: 15px; text-align: center; font-weight: bold; font-size: 16px; background: #eee; color: #555;">
                        PREENCHA OS DADOS PARA AVALIAÇÃO
                    </div>

                    <div style="background: #003369; color: white; padding: 8px; text-align: center; font-weight: bold; font-size: 14px;">
                        Observações
                    </div>
                    <div style="font-size: 12px; color: #555; text-align: center; margin-top: 10px;">
                        <p>Recomendado compartilhamento com SHE caso haja alteração de Setor ou Atividade após contratação.</p>
                        <p style="margin-top: 10px;"><strong>Em caso de dúvidas:</strong><br>
                        <a href="mailto:ernanes.piran@kuehne-nagel.com" style="color: #02B1EE;">ernanes.piran@kuehne-nagel.com</a><br>
                        <a href="mailto:nathalia.cerda@kuehne-nagel.com" style="color: #02B1EE;">nathalia.cerda@kuehne-nagel.com</a></p>
                    </div>

                </div>
            </div>
        </div>
        
        <div id="modalBuscaCid" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9999; align-items:center; justify-content:center;">
            <div style="background:white; padding:20px; border-radius:8px; width:90%; max-width:500px; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
                <h3>Buscar CID</h3>
                <input type="text" id="inputBuscaModal" placeholder="Digite código ou nome..." style="width:100%; padding:10px; margin-bottom:10px; border:1px solid #ccc;">
                <ul id="listaResultadosCid" style="list-style:none; padding:0; max-height:300px; overflow-y:auto; border:1px solid #eee;"></ul>
                <div style="text-align:right; margin-top:10px;">
                    <button id="btnFecharModalCid" style="background:#ccc; border:none; padding:8px 16px; border-radius:4px; cursor:pointer;">Cancelar</button>
                </div>
            </div>
        </div>
    `;

    // 1. Carregar Filiais
    carregarFiliais();

    // 2. Data de hoje
    document.getElementById('pcdData').valueAsDate = new Date();

    // 3. Listeners para recálculo
    const triggers = ['pcdCargo', 'pcdFilial', 'pcdExperiencia', 'pcdLaudo'];
    triggers.forEach(id => {
        document.getElementById(id).addEventListener('change', calcularTudo);
    });

    // 4. Configurar botões de busca CID
    document.querySelectorAll('.btn-busca-cid').forEach(btn => {
        btn.addEventListener('click', (e) => abrirModalCid(e.target.dataset.index));
    });

    document.getElementById('btnFecharModalCid').addEventListener('click', () => {
        document.getElementById('modalBuscaCid').style.display = 'none';
    });

    // Busca dinâmica no modal
    document.getElementById('inputBuscaModal').addEventListener('input', (e) => {
        filtrarCids(e.target.value);
    });
}

// ---------------------------------------------------------
// LÓGICA DE DADOS
// ---------------------------------------------------------

async function carregarFiliais() {
    const {data, error} = await supabase.from('pcd_filiais').select('*').order('nome');
    if (!error) {
        filiaisCache = data;
        const sel = document.getElementById('pcdFilial');
        sel.innerHTML = '<option value="">-- Selecione --</option>';
        data.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = f.nome;
            sel.appendChild(opt);
        });
    }
}

// ---------------------------------------------------------
// LÓGICA DE BUSCA DE CID (MODAL)
// ---------------------------------------------------------
let cidIndexAtual = 0;

function abrirModalCid(index) {
    cidIndexAtual = parseInt(index);
    document.getElementById('inputBuscaModal').value = '';
    document.getElementById('listaResultadosCid').innerHTML = '<li style="padding:10px; color:#999;">Digite para buscar...</li>';
    document.getElementById('modalBuscaCid').style.display = 'flex';
    document.getElementById('inputBuscaModal').focus();
}

async function filtrarCids(termo) {
    const lista = document.getElementById('listaResultadosCid');
    if (termo.length < 2) return;

    const {data, error} = await supabase
        .from('pcd_cids')
        .select('*')
        .or(`codigo.ilike.%${termo}%,patologia.ilike.%${termo}%`)
        .limit(20);

    if (error) {
        console.error(error);
        return;
    }

    lista.innerHTML = '';
    if (data.length === 0) {
        lista.innerHTML = '<li style="padding:10px;">Nenhum encontrado.</li>';
        return;
    }

    data.forEach(cid => {
        const li = document.createElement('li');
        li.textContent = `${cid.codigo} - ${cid.patologia}`;
        li.style.padding = '10px';
        li.style.borderBottom = '1px solid #eee';
        li.style.cursor = 'pointer';
        li.onmouseover = () => li.style.background = '#f0f9ff';
        li.onmouseout = () => li.style.background = 'white';

        li.onclick = () => {
            selecionarCid(cid);
        };
        lista.appendChild(li);
    });
}

function selecionarCid(cid) {
    cidSelecionados[cidIndexAtual] = cid;

    // Atualiza input visual
    document.getElementById(`cidInput${cidIndexAtual + 1}`).value = cid.codigo;
    document.getElementById(`cidDesc${cidIndexAtual + 1}`).value = cid.patologia;

    // Fecha modal e recalcula
    document.getElementById('modalBuscaCid').style.display = 'none';
    calcularTudo();
}


function calcularTudo() {
    const cargo = document.getElementById('pcdCargo').value; // OPERADOR DE MHE, OPERACIONAL, ADM
    const filialId = document.getElementById('pcdFilial').value;
    const exp = document.getElementById('pcdExperiencia').value; // SIM / NAO
    const laudo = document.getElementById('pcdLaudo').value; // SIM / NAO

    // Reset se faltar dados básicos
    if (!cargo || !filialId) {
        atualizarDisplay(0, "Preencha Cargo e Filial", [], {});
        return;
    }

    // 1. SCORE DO BRANCH (FILIAL)
    // --- CORREÇÃO AQUI: Aceitar 0 como valor válido ---
    const filialObj = filiaisCache.find(f => f.id == filialId);
    let scoreBranch = 1;
    let mapCargoCol = '';

    if (cargo === 'OPERADOR DE MHE') mapCargoCol = 'grau_mhe';
    else if (cargo === 'OPERACIONAL') mapCargoCol = 'grau_operacional';
    else if (cargo === 'ADM') mapCargoCol = 'grau_adm';

    if (filialObj) {
        const val = filialObj[mapCargoCol];
        // Se val for undefined ou null usa 1, mas se for 0, usa 0
        scoreBranch = (val !== undefined && val !== null) ? val : 1;
    }

    // 2. SCORE DOS CIDS (SOMA DE TODOS)
    let totalScoreCid = 0;
    let countCids = 0;
    let temH54 = false;
    let recs = [];

    cidSelecionados.forEach((cid, idx) => {
        if (!cid) {
            document.getElementById(`cidScore${idx + 1}`).textContent = '0';
            document.getElementById(`cidScore${idx + 1}`).style.background = '#94a3b8'; // Cinza
            return;
        }
        countCids++;

        // Pega o score específico para este cargo e SOMA
        const scoreDeste = cid[mapCargoCol] || 1;
        totalScoreCid += scoreDeste;

        // Atualiza a bolinha colorida do lado do CID
        const elScore = document.getElementById(`cidScore${idx + 1}`);
        elScore.textContent = scoreDeste;
        if (scoreDeste >= 4) elScore.style.background = '#dc2626'; // Vermelho
        else if (scoreDeste >= 2) elScore.style.background = '#f59e0b'; // Laranja
        else elScore.style.background = '#22c55e'; // Verde

        // Regra H54 (Verifica se começa com H54)
        if (cid.codigo.toUpperCase().startsWith('H54')) {
            temH54 = true;
        }

        // Recomendações
        const pat = cid.patologia.toUpperCase();
        if (pat.includes('HIV')) recs.push(`⚠️ HIV: Recomenda-se evitar atividades em câmaras frias.`);
        if (pat.includes('VISÃO') || pat.includes('CEGUEIRA')) recs.push(`👁️ Visão: SHE poderá solicitar laudo de acuidade visual.`);
        if (pat.includes('AUDIÇÃO') || pat.includes('SURDEZ')) recs.push(`👂 Audição: Alocar em local de baixo ruído e risco.`);
    });

    if (filialObj && filialObj.recomendacao) {
        recs.unshift(`🏢 Filial: ${filialObj.recomendacao}`);
    }

    // 3. SCORE EXPERIÊNCIA (NÃO=4, SIM=1.1)
    const scoreExp = (exp === 'NAO') ? 4 : 1.1;

    // 4. SCORE LAUDO (NÃO=40, SIM=1)
    const scoreLaudo = (laudo === 'NAO') ? 40 : 1;


    let scoreH54 = 0;
    if (temH54 && cargo === 'OPERADOR DE MHE') {

    }


    let score3Cids = 1;
    if (countCids === 3) {
        score3Cids = 100;
        recs.push(`❗ 3 CIDs identificados: Atenção redobrada.`);
    }
        const baseCidParaConta = totalScoreCid === 0 ? 1 : totalScoreCid;

    const baseMult = baseCidParaConta * scoreBranch * scoreExp * scoreLaudo;
    const finalScore = baseMult + scoreH54 + score3Cids;

    const details = {
        cid: totalScoreCid,
        branch: scoreBranch,
        exp: scoreExp,
        laudo: scoreLaudo,
        h54: scoreH54,
        three: score3Cids
    };


    let msg = "";
    let color = "#333";
    let bg = "#eee";

    if (finalScore >= 1001) {
        msg = "ATIVIDADE COM EMPILHADEIRA NÃO AUTORIZADA";
        bg = "#7f1d1d";
        color = "white";
    } else if (finalScore >= 1000) {
        msg = "APROVAÇÃO SUSPENSA – ENTRAR EM CONTATO COM O SHE";
        bg = "#dc2626";
        color = "white";
    } else if (finalScore >= 900) {
        msg = "NECESSÁRIA A AVALIAÇÃO DE SHE";
        bg = "#dc2626";
        color = "white";
    } else if (finalScore >= 100) {
        msg = "ACOMPANHAMENTO VISANDO DESVIO DE FUNÇÃO";
        bg = "#f97316";
        color = "white";
    } else if (finalScore >= 30) {
        msg = "RECOMENDADO ACOMPANHAMENTO PERIÓDICOS";
        bg = "#facc15";
        color = "black";
    } else if (finalScore >= 15) {
        msg = "APROVADO – CHECAR AS RECOMENDAÇÕES";
        bg = "#22c55e";
        color = "white";
    } else {
        msg = "ATIVIDADE NÃO SE APLICA - CHECAR DADOS";
        bg = "#ccc";
    }

    atualizarDisplay(finalScore, msg, recs, details, bg, color);
}

function atualizarDisplay(score, msg, recs, details, bgStatus, colorStatus) {
    document.getElementById('displayScoreFinal').textContent = Math.round(score);

    if (details) {
        document.getElementById('detScoreCid').textContent = details.cid;
        document.getElementById('detScoreBranch').textContent = details.branch;
        document.getElementById('detScoreExp').textContent = details.exp;
        document.getElementById('detScoreLaudo').textContent = details.laudo;
        document.getElementById('detScoreH54').textContent = details.h54;
        document.getElementById('detScore3Cid').textContent = details.three;
    }

    const statusBox = document.getElementById('statusBox');
    statusBox.textContent = msg;
    statusBox.style.backgroundColor = bgStatus || '#eee';
    statusBox.style.color = colorStatus || '#333';

    const boxRec = document.getElementById('boxRecomendacoes');
    if (recs.length === 0) {
        boxRec.textContent = "Nenhuma recomendação específica identificada.";
        boxRec.style.color = "#999";
    } else {

        const recsUnicos = [...new Set(recs)];
        boxRec.innerHTML = recsUnicos.map(r => `<div style="margin-bottom:6px;">• ${r}</div>`).join('');
        boxRec.style.color = "#333";
    }
}