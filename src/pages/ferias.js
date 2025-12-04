import { supabase } from '../supabaseClient.js';
import { logAction } from '../../logAction.js';

// Utilitários de Data para Férias
const toStartOfDay = (dateish) => {
    if (!dateish) return NaN;
    const d = (dateish instanceof Date) ? dateish : new Date(dateish);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

const formatDateLocal = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('T')[0].split('-');
    return `${d}/${m}/${y}`;
};

// Variáveis de controle do Modal (interno do módulo)
let feriasModal, feriasForm, feriasNomeEl, feriasInicioEl, feriasFinalEl, feriasCancelarBtn;
let feriasColaborador = null;
let isSubmittingFerias = false;
let onFeriasChangeCallback = null; // Callback para avisar o colaboradores.js para atualizar a tabela

export function setOnFeriasChangeCallback(cb) {
    onFeriasChangeCallback = cb;
}

// --- LÓGICA PRINCIPAL: O "MOTOR" DE FÉRIAS ---

/**
 * Verifica TODAS as férias no banco.
 * Se hoje for o dia de início, muda status para 'Em andamento' e atualiza o Colaborador para Ferias='SIM'.
 * Se hoje passou do final, muda status para 'Finalizado' e atualiza o Colaborador para Ferias='NAO'.
 */
export async function processarStatusFerias() {
    console.log("🔄 Verificando status de férias (Motor de Processamento)...");

    // Busca férias que NÃO estão finalizadas ou que acabaram de finalizar
    // Trazemos tudo para garantir a integridade, mas poderíamos filtrar por status != 'Finalizado'
    const { data: feriasList, error } = await supabase
        .from('Ferias')
        .select('*')
        .neq('Status', 'Ignorar'); // Exemplo de filtro, ou traga tudo

    if (error || !feriasList) {
        console.error("Erro ao buscar tabela de Férias:", error);
        return;
    }

    const today = toStartOfDay(new Date());
    let updatesCount = 0;

    for (const ferias of feriasList) {
        // Pula registros já finalizados há muito tempo para poupar recurso
        if (ferias.Status === 'Finalizado' && ferias['Dias para finalizar'] === 0) continue;

        const dataInicio = toStartOfDay(ferias['Data Inicio']);
        const dataFinal = toStartOfDay(ferias['Data Final']);

        let newStatus = ferias.Status;
        let updatePayload = {};
        let colabFeriasStatusUpdate = null; // 'SIM' ou 'NAO' para atualizar a tabela Colaboradores

        // Lógica de Status
        if (today > dataFinal) {
            newStatus = 'Finalizado';
        } else if (today >= dataInicio && today <= dataFinal) {
            newStatus = 'Em andamento';
        } else {
            newStatus = 'A iniciar';
        }

        // Lógica de Dias Restantes
        const diasParaFinalizar = (newStatus === 'Finalizado')
            ? 0
            : Math.max(0, Math.ceil((dataFinal - today) / (1000 * 60 * 60 * 24)));

        // Se houve mudança no status ou na contagem de dias, prepara o update
        if (newStatus !== ferias.Status || diasParaFinalizar !== ferias['Dias para finalizar']) {
            updatePayload.Status = newStatus;
            updatePayload['Dias para finalizar'] = diasParaFinalizar;

            // Define se precisamos atualizar o cadastro do colaborador
            if (newStatus === 'Em andamento') colabFeriasStatusUpdate = 'SIM';
            else if (newStatus === 'Finalizado') colabFeriasStatusUpdate = 'NAO';
            // 'A iniciar' não muda o status do colaborador (continua como estava, geralmente NAO)
        }

        // 1. Atualiza a tabela FERIAS
        if (Object.keys(updatePayload).length > 0) {
            await supabase.from('Ferias').update(updatePayload).eq('Numero', ferias.Numero);
            updatesCount++;
        }

        // 2. Atualiza a tabela COLABORADORES (Sincronia)
        if (colabFeriasStatusUpdate) {
            // Verifica o estado atual para não fazer update desnecessário
            const { data: colabAtual } = await supabase
                .from('Colaboradores')
                .select('Ferias')
                .eq('Nome', ferias.Nome)
                .maybeSingle();

            if (colabAtual && colabAtual.Ferias !== colabFeriasStatusUpdate) {
                await supabase
                    .from('Colaboradores')
                    .update({ Ferias: colabFeriasStatusUpdate })
                    .eq('Nome', ferias.Nome);
                console.log(`✅ Colaborador ${ferias.Nome} atualizado para Férias: ${colabFeriasStatusUpdate}`);
                updatesCount++;
            }
        }
    }

    if (updatesCount > 0) {
        console.log(`Processamento de férias concluído. ${updatesCount} atualizações realizadas.`);
        if (onFeriasChangeCallback) onFeriasChangeCallback(); // Atualiza a tela
    } else {
        console.log("Nenhuma alteração de status de férias necessária hoje.");
    }
}

// --- FUNÇÕES DE AGENDAMENTO ---

async function getNonFinalizedFerias(nome) {
    const { data, error } = await supabase
        .from('Ferias')
        .select('Numero, Status, "Data Final"')
        .eq('Nome', nome)
        .neq('Status', 'Finalizado')
        .order('Numero', { ascending: false })
        .limit(1);
    if (error) return { error };
    return { data: (data && data.length > 0) ? data[0] : null };
}

async function agendarFerias(info) {
    const { colaborador, dataInicio, dataFinal } = info;

    // Verifica se já tem férias pendentes
    const { data: feriasPendentes, error: feriasCheckError } = await getNonFinalizedFerias(colaborador.Nome);
    if (feriasCheckError) {
        console.error("Erro check férias:", feriasCheckError);
        return { error: new Error('Erro ao verificar férias existentes.') };
    }
    if (feriasPendentes) {
        const status = feriasPendentes.Status || 'pendente';
        const dataFinalStr = feriasPendentes['Data Final'] ? ` (terminando em ${formatDateLocal(feriasPendentes['Data Final'])})` : '';
        return { error: new Error(`Colaborador já possui férias "${status}"${dataFinalStr}. Finalize as anteriores primeiro.`) };
    }

    // Pega ultimo numero
    const { data: lastFerias, error: numError } = await supabase
        .from('Ferias')
        .select('Numero')
        .order('Numero', { ascending: false })
        .limit(1);
    if (numError) return { error: numError };

    const newNumero = (lastFerias && lastFerias.length > 0) ? (lastFerias[0].Numero + 1) : 1;
    const hoje = toStartOfDay(new Date());
    const inicio = toStartOfDay(dataInicio);
    const fim = toStartOfDay(dataFinal);

    // Define status inicial baseado na data de hoje
    let statusInicial = 'A iniciar';
    if (hoje > fim) statusInicial = 'Finalizado';
    else if (hoje >= inicio) statusInicial = 'Em andamento';

    const diasParaFinalizar = Math.max(0, Math.ceil((fim - hoje) / (1000 * 60 * 60 * 24)));

    // Tenta pegar dados extras
    const svcUp = (colaborador.SVC || '').toString().toUpperCase();
    // Tenta pegar a matriz do colaborador ou do mapa (se passado, precisaria ser injetado, mas vamos tentar direto do obj)
    let matriz = colaborador.MATRIZ;

    const feriasData = {
        Numero: newNumero,
        Nome: colaborador.Nome,
        Cargo: colaborador.Cargo || null,
        Escala: colaborador.Escala,
        SVC: colaborador.SVC,
        MATRIZ: matriz || null,
        'Data Inicio': dataInicio,
        'Data Final': dataFinal,
        Status: statusInicial,
        'Dias para finalizar': diasParaFinalizar
    };

    const { error } = await supabase.from('Ferias').insert([feriasData]);
    if (error) return { error };

    // Roda o processador imediatamente para garantir sincronia com a tabela Colaboradores
    await processarStatusFerias();
    return { success: true };
}

// --- INTERFACE DE USUÁRIO (MODAL) ---

async function onFeriasSubmit(e) {
    e.preventDefault();
    if (isSubmittingFerias) return;
    try {
        if (!feriasColaborador || !feriasColaborador.Nome) {
            await window.customAlert('Erro: dados do colaborador não carregados.', 'Erro');
            return;
        }
        const dataInicio = (feriasInicioEl?.value || '').trim();
        const dataFinal = (feriasFinalEl?.value || '').trim();

        if (!dataInicio || !dataFinal) {
            await window.customAlert('Selecione a Data de Início e a Data Final.', 'Campos Obrigatórios');
            return;
        }
        const dIni = new Date(dataInicio);
        const dFim = new Date(dataFinal);

        if (isNaN(dIni) || isNaN(dFim)) {
            await window.customAlert('Datas inválidas.', 'Erro');
            return;
        }
        if (dFim < dIni) {
            await window.customAlert('A Data Final não pode ser anterior à Data de Início.', 'Data Inválida');
            return;
        }

        const ok = await window.customConfirm(
            `Confirmar férias de <b>${feriasColaborador.Nome}</b><br>De: ${formatDateLocal(dataInicio)}<br>Até: ${formatDateLocal(dataFinal)}?`,
            'Confirmar Férias',
            'warning'
        );
        if (!ok) return;

        isSubmittingFerias = true;
        const submitButton = feriasForm ? feriasForm.querySelector('button[type="submit"]') : null;
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = 'Agendando...';
        }

        const { success, error } = await agendarFerias({ colaborador: feriasColaborador, dataInicio, dataFinal });

        if (!success) {
            await window.customAlert(`Erro ao agendar férias: ${error?.message || error}`, 'Erro');
        } else {
            await window.customAlert('Férias agendadas com sucesso!', 'Sucesso');
            logAction(`Agendou férias para ${feriasColaborador.Nome} de ${formatDateLocal(dataInicio)} até ${formatDateLocal(dataFinal)}`);
            closeFeriasModal();
            // Callback para atualizar a tela principal
            if (onFeriasChangeCallback) onFeriasChangeCallback();
        }
    } catch (err) {
        console.error(err);
        await window.customAlert('Erro inesperado.', 'Erro');
    } finally {
        isSubmittingFerias = false;
        const submitButton = feriasForm ? feriasForm.querySelector('button[type="submit"]') : null;
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = 'Confirmar';
        }
    }
}

function closeFeriasModal() {
    if (!feriasModal) return;
    feriasModal.classList.add('hidden');
    feriasColaborador = null;
    feriasForm?.reset();
}

export function openFeriasModal(colab) {
    feriasColaborador = colab;
    // Tenta pegar referências se ainda não pegou
    if (!feriasModal) wireFerias();

    if (!feriasModal) {
        console.error("Modal de férias não encontrado no DOM.");
        return;
    }

    if (feriasNomeEl) feriasNomeEl.value = colab?.Nome || '';

    // Sugere datas (hoje)
    const hoje = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;

    if (feriasInicioEl) feriasInicioEl.value = iso;
    if (feriasFinalEl) feriasFinalEl.value = iso;

    feriasModal.classList.remove('hidden');
}

export function wireFerias() {
    feriasModal = document.getElementById('feriasModal');
    if (!feriasModal) return; // Se não existir na tela, aborta
    if (feriasModal.dataset.wired === '1') return; // Já configurado

    feriasModal.dataset.wired = '1';
    feriasForm = document.getElementById('feriasForm');
    feriasNomeEl = document.getElementById('feriasNome');
    feriasInicioEl = document.getElementById('feriasDataInicio');
    feriasFinalEl = document.getElementById('feriasDataFinal');
    feriasCancelarBtn = document.getElementById('feriasCancelarBtn');

    feriasCancelarBtn?.addEventListener('click', closeFeriasModal);
    feriasForm?.addEventListener('submit', onFeriasSubmit);
    console.log("Módulo de Férias: Eventos configurados.");
}