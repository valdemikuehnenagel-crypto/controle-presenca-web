import { supabase } from './src/supabaseClient.js';
function getCurrentUserData() {
    try {
        const userDataString = localStorage.getItem('userSession');
        if (!userDataString) {
            console.warn('LogAction: Não foi possível encontrar userSession no localStorage.');
            return null;
        }
        const user = JSON.parse(userDataString);
                const userName = user?.Nome || user?.Usuario || 'Usuário Desconhecido';
        const userMatriz = user?.Matriz || 'Matriz Desconhecida';

        return {userName, userMatriz};
    } catch (e) {
        console.error('LogAction: Erro ao ler userSession.', e);
        return null;
    }
}


export function logAction(actionText) {
    const userData = getCurrentUserData();

        const userName = userData ? userData.userName : 'Sessão Inválida';
    const userMatriz = userData ? userData.userMatriz : 'Sessão Inválida';

    const logEntry = {
        Ação: actionText,
        Data: new Date().toISOString(),         Usuario: userName,
        MATRIZ: userMatriz
            };

                supabase.from('LogUsuario').insert([logEntry])
        .then(({error}) => {
            if (error) {
                console.error('LogAction: Falha ao registrar log no Supabase:', error.message);
                console.error('Log que falhou:', logEntry);
            } else {
                                            }
        });
}