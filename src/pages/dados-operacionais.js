import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';

let ui;


const CACHE_TTL_MS = 10 * 60_000;
const _cache = new Map();
const _inflight = new Map();
const _listeners = [];

function keyFromMatrizes(mp) {
    const part = Array.isArray(mp) && mp.length ? [...mp].sort().join('|') : 'ALL';

    return `dados-op:colaboradores:${part}:ativos`;
}

function fetchOnce(key, loader, ttl = CACHE_TTL_MS) {
    const now = Date.now();
    const hit = _cache.get(key);
    if (hit && (now - hit.ts) < hit.ttl) return Promise.resolve(hit.value);

    if (_inflight.has(key)) return _inflight.get(key);

    const p = (async () => {
        try {
            const val = await loader();
            _cache.set(key, {ts: Date.now(), ttl, value: val});
            return val;
        } finally {
            _inflight.delete(key);
        }
    })();

    _inflight.set(key, p);
    return p;
}

function invalidateCache(keys) {
    if (!keys || !keys.length) {
        _cache.clear();
        return;
    }
    keys.forEach(k => _cache.delete(k));
}


const state = {
    mounted: false,
    detailedResults: new Map(),
};


async function fetchAllPages(query) {
    const pageSize = 1000;
    let allData = [];
    let page = 0;
    let keepFetching = true;
    while (keepFetching) {
        const {data, error} = await query.range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (data && data.length > 0) {
            allData = allData.concat(data);
            page++;
        } else {
            keepFetching = false;
        }
        if (!data || data.length < pageSize) {
            keepFetching = false;
        }
    }
    return allData;
}


async function fetchDataCached() {
    const matrizesPermitidas = getMatrizesPermitidas();
    const key = keyFromMatrizes(matrizesPermitidas);

    return fetchOnce(key, async () => {
        let colabQuery = supabase
            .from('Colaboradores')
            .select('Nome, SVC, "Data de admissão", LDAP, "ID GROOT", Gestor, MATRIZ, Cargo, Escala, DSR, Genero')
            .eq('Ativo', 'SIM');

        if (matrizesPermitidas && matrizesPermitidas.length) {
            colabQuery = colabQuery.in('MATRIZ', matrizesPermitidas);
        }

        const colaboradores = await fetchAllPages(colabQuery);


        colaboradores.sort((a, b) => String(a?.Nome || '').localeCompare(String(b?.Nome || ''), 'pt-BR'));

        return {colaboradores};
    });
}


function processDataQuality(colaboradores) {
    state.detailedResults.clear();

    const svcs = [...new Set(colaboradores.map(c => c.SVC).filter(Boolean))].sort();

    const colunasParaVerificar = [
        'ID GROOT', 'LDAP', 'Data de admissão', 'Gestor', 'Cargo', 'DSR', 'Escala', 'Genero'
    ];

    const results = {};
    for (const svc of svcs) {
        results[svc] = {};
        state.detailedResults.set(svc, new Map());

        const colaboradoresSVC = colaboradores.filter(c => c.SVC === svc);
        const totalColabsSVC = colaboradoresSVC.length;
        if (totalColabsSVC === 0) continue;

        let percentualTotalSoma = 0;

        for (const coluna of colunasParaVerificar) {
            const pendentes = colaboradoresSVC.filter(c => {
                const valor = c[coluna];
                return valor === null || valor === undefined || String(valor).trim() === '';
            });
            const preenchidosCount = totalColabsSVC - pendentes.length;
            const percentual = (preenchidosCount / totalColabsSVC) * 100;

            results[svc][coluna] = {percentual, pendentes};
            percentualTotalSoma += percentual;

            if (!state.detailedResults.get(svc).has(coluna)) {
                state.detailedResults.get(svc).set(coluna, {pendentes, total: totalColabsSVC});
            }
        }

        results[svc].totalGeral = percentualTotalSoma / colunasParaVerificar.length;
    }

    return {svcs, results, colunas: colunasParaVerificar};
}

function getStatusClass(percentual) {
    if (percentual === 100) return 'status-ok';
    if (percentual > 0) return 'status-pendente';
    if (percentual === 0) return 'status-nok';
    return 'status-na';
}

function getTotalStatusClass(percentual) {
    if (percentual === 100) return 'status-ok';
    if (percentual >= 90) return 'status-pendente';
    return 'status-nok';
}

function showDetailsModal(svc, coluna) {
    const details = state.detailedResults.get(svc)?.get(coluna);
    if (!details) return;

    const oldModal = document.getElementById('dados-op-details-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'dados-op-details-modal';
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[99]';

    let contentHtml = '';
    if (details.pendentes.length === 0) {
        contentHtml = '<p>Nenhum colaborador com pendência neste campo.</p>';
    } else {
        contentHtml = `
      <p class="mb-2">Total de colaboradores no SVC: <strong>${details.total}</strong> | Pendentes: <strong>${details.pendentes.length}</strong></p>
      <ul class="details-list">
        ${details.pendentes.map(p => `<li><strong>${p.Nome}</strong></li>`).join('')}
      </ul>
    `;
    }

    modal.innerHTML = `
    <div class="container !h-auto !w-auto max-w-lg">
      <h3 class="mb-4">Pendências de "${coluna}" em ${svc}</h3>
      <div class="max-h-[60vh] overflow-y-auto pr-2">
        ${contentHtml}
      </div>
      <div class="form-actions" style="justify-content:flex-end;">
        <button type="button" class="btn-cancelar" data-close-modal>Cancelar</button>
      </div>
    </div>
  `;

    document.body.appendChild(modal);
    modal.querySelector('[data-close-modal]').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

function renderTable(svcs, colunas, results) {
    if (!ui.resultContainer) return;

    const colunasDisplay = {
        'ID GROOT': 'ID GROOT',
        'LDAP': 'LDAP',
        'Data de admissão': 'Dt Admissão',
        'Gestor': 'Gestor',
        'Cargo': 'Cargo',
        'DSR': 'DSR',
        'Escala': 'Escala',
        'Genero': 'Gênero',
    };

    const headerHtml = `<tr><th>SVC</th>${colunas.map(col => `<th>${colunasDisplay[col] || col}</th>`).join('')}<th>Total</th></tr>`;

    const bodyHtml = svcs.map(svc => {
        const totalPercent = results[svc]?.totalGeral || 0;
        const totalStatusClass = getTotalStatusClass(Math.round(totalPercent));
        const totalCellHtml = `
      <td class="${totalStatusClass}" style="font-weight: bold; font-size: 14px;">
        ${totalPercent.toFixed(0)}%
      </td>
    `;

        return `
      <tr>
        <td>${svc}</td>
        ${colunas.map(col => {
            const data = results[svc]?.[col];
            if (!data) return '<td class="status-na">N/A</td>';
            const percentual = data.percentual;
            const statusClass = getStatusClass(percentual);
            const podeClicar = percentual < 100 && data.pendentes.length > 0;
            const title = podeClicar ? 'Duplo clique para ver os pendentes' : '100% preenchido';
            return `<td data-svc="${svc}" data-coluna="${col}" class="${statusClass}" title="${title}">
                    ${percentual.toFixed(0)}%
                  </td>`;
        }).join('')}
        ${totalCellHtml} 
      </tr>
    `;
    }).join('');

    ui.resultContainer.innerHTML = `
    <div class="table-container">
      <table class="main-table">
        <thead>${headerHtml}</thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  `;

    const table = ui.resultContainer.querySelector('.main-table');
    if (table) {
        table.addEventListener('dblclick', (event) => {
            const cell = event.target.closest('td[data-svc]');
            if (!cell || !cell.dataset.coluna) return;
            showDetailsModal(cell.dataset.svc, cell.dataset.coluna);
        });
    }
}

async function generateReport() {
    if (ui?.loader) ui.loader.style.display = 'flex';
    if (ui?.resultContainer) ui.resultContainer.innerHTML = `<p class="p-4 text-center">Gerando relatório...</p>`;

    try {
        const {colaboradores} = await fetchDataCached();
        const {svcs, results, colunas} = processDataQuality(colaboradores);

        if (svcs.length > 0) {
            svcs.sort((svcA, svcB) => {
                const avgA = results[svcA]?.totalGeral || 0;
                const avgB = results[svcB]?.totalGeral || 0;
                if (avgA !== avgB) return avgB - avgA;

                const count100A = colunas.filter(col => (results[svcA][col]?.percentual || 0) === 100).length;
                const count100B = colunas.filter(col => (results[svcB][col]?.percentual || 0) === 100).length;
                if (count100A !== count100B) return count100B - count100A;

                return svcA.localeCompare(svcB);
            });
        }

        if (!svcs.length) {
            if (ui?.resultContainer) ui.resultContainer.innerHTML = '<p class="p-4 text-center">Nenhum SVC encontrado para gerar o relatório.</p>';
        } else {
            renderTable(svcs, colunas, results);
        }
    } catch (error) {
        console.error('Erro ao gerar relatório de dados operacionais:', error);
        if (ui?.resultContainer) {
            ui.resultContainer.innerHTML = `<p class="p-4 text-center text-red-500">Falha ao gerar relatório: ${error.message}</p>`;
        }
    } finally {
        if (ui?.loader) ui.loader.style.display = 'none';
    }
}


export function init() {
    if (state.mounted) return;

    ui = {
        resultContainer: document.getElementById('dados-op-result'),
        loader: document.getElementById('dados-op-loader'),
    };

    // --- INÍCIO DA CORREÇÃO ---

    // 1. Pega a sessão do localStorage
    const sessionString = localStorage.getItem('userSession');
    let userNivel = null;

    if (sessionString) {
        try {
            const userData = JSON.parse(sessionString);
            // Pega o Nivel, garante que é uma string, e bota em minúsculas
            userNivel = (userData?.Nivel || '').toLowerCase();
        } catch (e) {
            console.error('Erro ao ler userSession:', e);
        }
    }

    // 2. Compara com 'administrador' (minúsculas)
    if (userNivel !== 'administrador') {
        console.warn(`Acesso ao Painel Gerencial bloqueado. Nível detectado: [${userNivel || 'Nenhum'}]`);

        // 3. Mostra a mensagem de erro no container principal da página
        if (ui.resultContainer) {
            ui.resultContainer.innerHTML = `
                <div style="padding: 2rem; text-align: center;">
                    <h2 style="color: #dc3545; font-size: 1.5rem;">Acesso Bloqueado</h2>
                    <p style="font-size: 1.1rem; margin-top: 0.5rem;">
                        Apenas usuários com nível "Administrador" podem acessar esta página.
                    </p>
                    <p style="color: #6c757d; margin-top: 1rem;">
                        (Nível detectado: <strong>${userNivel ? userNivel.charAt(0).toUpperCase() + userNivel.slice(1) : 'Nenhum'}</strong>)
                    </p>
                </div>
            `;
        }
        if (ui.loader) ui.loader.style.display = 'none'; // Esconde o loader

        // 4. Para a execução da página
        return;
    }

    // --- FIM DA CORREÇÃO ---

    // Se chegou aqui, o usuário é Admin. Continua o carregamento normal.
    const evts = ['hc-refresh', 'colaborador-added', 'colaborador-updated', 'colaborador-removed', 'dadosop-invalidate'];
    const matrizesPermitidas = getMatrizesPermitidas();
    const key = keyFromMatrizes(matrizesPermitidas);
    evts.forEach(name => {
        const handler = () => {
            invalidateCache([key]);
            generateReport();
        };
        window.addEventListener(name, handler);
        _listeners.push(() => window.removeEventListener(name, handler));
    });

    state.mounted = true;
    generateReport();
}

export function destroy() {

    const modal = document.getElementById('dados-op-details-modal');
    if (modal) modal.remove();


    try {
        _listeners.forEach(off => off());
    } catch {
    }
    _listeners.length = 0;

    state.mounted = false;
}
