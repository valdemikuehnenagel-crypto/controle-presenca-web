import { supabase } from './supabaseClient.js'; // Verifique se este caminho está correto

/**
 * Pega os dados do usuário da sessão atual no localStorage.
 * @returns {{userName: string, userMatriz: string} | null}
 */
function getCurrentUserData() {
    try {
        const userDataString = localStorage.getItem('userSession');
        if (!userDataString) {
            console.warn('LogAction: Não foi possível encontrar userSession no localStorage.');
            return null;
        }
        const user = JSON.parse(userDataString);
        // Tenta pegar o Nome, se não, o Usuário (email), se não, um padrão
        const userName = user?.Nome || user?.Usuario || 'Usuário Desconhecido';
        const userMatriz = user?.Matriz || 'Matriz Desconhecida';

        return { userName, userMatriz };
    } catch (e) {
        console.error('LogAction: Erro ao ler userSession.', e);
        return null;
    }
}

/**
 * Registra uma ação do usuário na tabela 'LogUsuario'.
 * Esta é uma função "fire and forget" e não deve bloquear a UI.
 * @param {string} actionText - A descrição da ação (ex: "Adicionou colaborador X").
 */
export function logAction(actionText) {
    const userData = getCurrentUserData();

    // Se não conseguir dados da sessão, o log ainda será registrado, mas com dados de "Sessão Inválida"
    const userName = userData ? userData.userName : 'Sessão Inválida';
    const userMatriz = userData ? userData.userMatriz : 'Sessão Inválida';

    const logEntry = {
        Ação: actionText,
        Data: new Date().toISOString(), // O Supabase armazena como UTC (correto) e seu banco converte
        Usuario: userName,
        MATRIZ: userMatriz
        // A coluna 'id' (protocolo) será preenchida automaticamente pelo Supabase
    };

    // Envia o log para o Supabase.
    // Usamos .then() em vez de 'await' para não bloquear a thread principal.
    // O log é importante, mas não mais importante que a ação do usuário.
    supabase.from('LogUsuario').insert([logEntry])
        .then(({ error }) => {
            if (error) {
                console.error('LogAction: Falha ao registrar log no Supabase:', error.message);
                console.error('Log que falhou:', logEntry);
            } else {
                // Opcional: descomente para debug
                // console.log('LogAction: Ação registrada:', actionText);
            }
        });
}