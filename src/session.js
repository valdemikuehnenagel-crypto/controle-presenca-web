export function getUser() {
    const userDataString = localStorage.getItem('userSession');
    if (!userDataString) {
        return null;
    }
    try {
        return JSON.parse(userDataString);
    } catch (e) {
        console.error("Erro ao interpretar dados da sessão:", e);
        return null;
    }
}

export function getMatrizesPermitidas() {
    const user = getUser();


    if (!user || !user.Matriz) {
        return [];
    }

    const matrizDoUsuario = user.Matriz.trim().toUpperCase();


    if (matrizDoUsuario === 'TODOS') {
        return null;
    }

    return matrizDoUsuario.split(',').map(matriz => matriz.trim());
}