import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';
import {logAction} from '../../logAction.js';

const _cache = new Map();
const _inflight = new Map();
const CACHE_TTL_MS = 10 * 60_000;
const MIN_LABEL_FONT_PX = 12;
const MIN_SEGMENT_PERCENT = 9;

function cacheKeyForColabs() {
    return `colabs:ALL`;
}

function toUpperTrim(str) {
    return typeof str === 'string' ? str.toUpperCase().trim() : str;
}

function normalizeCPF(value) {
    if (!value) return null;
    return value.replace(/\D/g, '');
}

function formatDateTimeLocal(iso) {
    if (!iso) return '-';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('pt-BR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    } catch (e) {
        return iso;
    }
}

function wireCepVagas() {
    const form = document.getElementById('formVagas');
    if (!form) return;
    const inputCep = form.querySelector('[name="cep_candidato"]');
    if (inputCep) {
        const newClone = inputCep.cloneNode(true);
        inputCep.parentNode.replaceChild(newClone, inputCep);
        newClone.addEventListener('input', async (e) => {
            let val = e.target.value.replace(/\D/g, '');
            if (val.length > 5) {
                val = val.substring(0, 5) + '-' + val.substring(5, 8);
            }
            e.target.value = val;
            const cleanCep = val.replace(/\D/g, '');
            if (cleanCep.length === 8) {
                const inputEnd = form.querySelector('[name="endereco_candidato"]');
                if (inputEnd) inputEnd.placeholder = "Buscando...";
                try {
                    const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
                    const data = await res.json();
                    if (!data.erro) {
                        const setVal = (name, valor) => {
                            const el = form.querySelector(`[name="${name}"]`);
                            if (el) el.value = (valor || '').toUpperCase();
                        };
                        setVal('endereco_candidato', data.logradouro);
                        setVal('bairro_candidato', data.bairro);
                        setVal('cidade_candidato', data.localidade);
                        const elNum = form.querySelector('[name="numero_candidato"]');
                        if (elNum) elNum.focus();
                    } else {
                        if (inputEnd) inputEnd.value = '';
                    }
                } catch (err) {
                    console.error("Erro ViaCEP Vagas:", err);
                } finally {
                    if (inputEnd) inputEnd.placeholder = "";
                }
            }
        });
    }
}

async function loadSheetJS() {
    if (window.XLSX) return;
    try {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    } catch (error) {
        console.error("Falha ao carregar a biblioteca XLSX:", error);
    }
}

async function desligamento_prepararDadosAbsenteismo(nomeColaborador) {
    console.log(`[DEBUG] Iniciando busca de absenteísmo (apenas ocorrências) para: ${nomeColaborador}`);
    if (!nomeColaborador) return null;
    const dataCorte = new Date();
    dataCorte.setDate(dataCorte.getDate() - 45);
    const dataCorteISO = dataCorte.toISOString().split('T')[0];
    const {data: registros, error} = await supabase
        .from('ControleDiario')
        .select('Data, Turno, Falta, Atestado, Observacao, TipoAtestado, CID')
        .eq('Nome', nomeColaborador)
        .gte('Data', dataCorteISO)
        .or('Falta.gt.0,Atestado.gt.0')
        .order('Data', {ascending: false});
    if (error || !registros) {
        console.error('[DEBUG] Erro ao buscar absenteísmo:', error);
        return null;
    }
    let injustificado = 0;
    let justificado = 0;
    registros.forEach(row => {
        if (row.Atestado > 0) justificado++;
        else if (row.Falta > 0) injustificado++;
    });
    let attachment = null;
    try {
        await loadSheetJS();
        if (window.XLSX) {
            const rowsExcel = registros.map(r => ({
                Data: r.Data ? r.Data.split('-').reverse().join('/') : '-',
                Turno: r.Turno || '-',
                Status: (r.Atestado > 0 ? 'Atestado/Justificado' : 'Falta Injustificada'),
                TipoAtestado: r.TipoAtestado || '',
                CID: r.CID || '',
                Observacao: r.Observacao || ''
            }));
            const ws = XLSX.utils.json_to_sheet(rowsExcel);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Absenteísmo 45 Dias");
            const excelBase64 = XLSX.write(wb, {bookType: 'xlsx', type: 'base64'});
            attachment = {
                filename: `Relatorio_Absenteismo_${nomeColaborador.replace(/\s+/g, '_')}.xlsx`,
                content: excelBase64,
                encoding: 'base64'
            };
            console.log('[DEBUG] Excel gerado (apenas absenteísmo). Linhas:', rowsExcel.length);
        }
    } catch (err) {
        console.warn('[DEBUG] Erro ao gerar Excel:', err);
    }
    return {
        stats: {justificado, injustificado},
        attachment: attachment
    };
}

function getLocalISOString(date) {
    if (!date) date = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const second = pad(date.getSeconds());
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function ymdToday() {
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function desligamento_getCurrentUserEmail() {
    try {
        const userDataString = localStorage.getItem('userSession');
        if (userDataString) {
            const user = JSON.parse(userDataString);
            return user?.Usuario || '';
        }
    } catch (e) {
        console.error('Erro ao ler e-mail do usuário:', e);
    }
    return '';
}

function desligamento_calcularSLA(dataSolicitada, dataFinal = null) {
    if (!dataSolicitada) return null;
    const start = new Date(dataSolicitada);
    const end = dataFinal ? new Date(dataFinal) : new Date();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    const diffMs = end - start;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays < 0 ? 0 : diffDays;
}

async function desligamento_fetchEmailsSugestao(contrato) {
    const emailsSugestao = new Set();
    const myEmail = desligamento_getCurrentUserEmail();
    if (myEmail) {
        emailsSugestao.add(myEmail.toLowerCase());
    }
    if (contrato && contrato.toUpperCase() !== 'KN') {
        const {data, error} = await supabase
            .from('Consultoria')
            .select('EMAIL')
            .eq('CONTRATO', contrato);
        if (!error && data) {
            data.forEach(row => {
                if (row.EMAIL) emailsSugestao.add(row.EMAIL.toLowerCase());
            });
        }
    }
    return Array.from(emailsSugestao).join(', ');
}

async function fetchOnce(key, loaderFn, ttlMs = CACHE_TTL_MS) {
    const now = Date.now();
    const hit = _cache.get(key);
    if (hit && (now - hit.ts) < hit.ttl) return hit.value;
    if (_inflight.has(key)) return _inflight.get(key);
    const p = (async () => {
        try {
            const val = await loaderFn();
            _cache.set(key, {ts: Date.now(), ttl: ttlMs, value: val});
            return val;
        } finally {
            _inflight.delete(key);
        }
    })();
    _inflight.set(key, p);
    return p;
}

function invalidateCache(keys = []) {
    if (!keys.length) {
        _cache.clear();
    } else {
        keys.forEach(k => _cache.delete(k));
    }
    try {
        localStorage.removeItem('knc:colaboradoresCache');
    } catch (e) {
        console.warn('Falha ao invalidar cache de colaboradores no localStorage', e);
    }
}

function populateOptionsTamanhos(idSelectSapato, idSelectColete) {
    const selSapato = document.getElementById(idSelectSapato);
    const selColete = document.getElementById(idSelectColete);
    if (selSapato) {
        const valorAtual = selSapato.getAttribute('data-selected') || selSapato.value;
        selSapato.innerHTML = '<option value="">Selecione...</option>';
        for (let i = 34; i <= 46; i++) {
            const opt = document.createElement('option');
            opt.value = i.toString();
            opt.textContent = i.toString();
            selSapato.appendChild(opt);
        }
        if (valorAtual) selSapato.value = valorAtual;
    }
    if (selColete) {
        const valorAtual = selColete.getAttribute('data-selected') || selColete.value;
        const tamanhos = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG'];
        selColete.innerHTML = '<option value="">Selecione...</option>';
        tamanhos.forEach(tam => {
            const opt = document.createElement('option');
            opt.value = tam;
            opt.textContent = tam;
            selColete.appendChild(opt);
        });
        if (valorAtual) selColete.value = valorAtual;
    }
}

async function fetchAllWithPagination(queryBuilder) {
    let allData = [];
    let page = 0;
    const pageSize = 1000;
    let moreData = true;
    while (moreData) {
        const {data, error} = await queryBuilder.range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (data && data.length > 0) {
            allData = allData.concat(data);
            page++;
        } else {
            moreData = false;
        }
    }
    return allData;
}

const HOST_SEL = '#hc-indice';
const state = {
    mounted: false,
    loading: false,
    charts: {
        idade: null,
        genero: null,
        dsr: null,
        contrato: null,
        contratoSvc: null, auxPrazoSvc: null,
        idadeRegiao: null,
        generoRegiao: null,
        contratoRegiao: null,
        auxPrazoRegiao: null, spamHcEvolucaoSvc: null,
        spamHcEvolucaoRegiao: null,
        spamHcGerente: null,
        spamHcVsAux: null,
        spamContractDonut: null
    },
    matriz: '',
    gerencia: '',
    regiao: '',
    colabs: [],
    interactive: {
        genero: new Set(),
        dsr: new Set(),
        idade: new Set(),
        contrato: new Set(),
        contratoSvc: new Set(), auxPrazoSvc: new Set(),
    },
    isUserRH: false,
    desligamentoModule: {
        pendentes: [],
        colaboradorAtual: null,
        tbody: null,
        modal: null,
        form: null,
        currentUser: null,
        submitBtn: null,
        cancelBtn: null,
        refreshBtn: null
    }
};
const norm = (v) => String(v ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const root = () => document.documentElement;
const css = (el, name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;

function parseRGB(str) {
    if (!str) return {r: 0, g: 0, b: 0};
    const s = String(str).trim();
    if (s.startsWith('#')) {
        const hex = s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
        return {
            r: parseInt(hex.slice(1, 3), 16),
            g: parseInt(hex.slice(3, 5), 16),
            b: parseInt(hex.slice(5, 7), 16)
        };
    }
    const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
    return m ? {r: +m[1], g: +m[2], b: +m[3]} : {r: 30, g: 64, b: 124};
}

const lum = ({r, g, b}) => 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
const bestLabel = (bg) => lum(parseRGB(bg)) < 0.45 ? '#fff' : css(root(), '--hcidx-primary', '#003369');
const AGE_BUCKETS = ['<20', '20-29', '30-39', '40-49', '50-59', '60+', 'N/D'];
const DOW_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'N/D'];
const MONTH_ORDER = {
    'JANEIRO': 1, 'FEVEREIRO': 2, 'MARÇO': 3, 'ABRIL': 4, 'MAIO': 5, 'JUNHO': 6,
    'JULHO': 7, 'AGOSTO': 8, 'SETEMBRO': 9, 'OUTUBRO': 10, 'NOVEMBRO': 11, 'DEZEMBRO': 12
};
const sortMesAno = (a, b) => (a.ANO * 100 + a.mesOrder) - (b.ANO * 100 + b.mesOrder);
const getMesOrder = (mesStr) => MONTH_ORDER[norm(mesStr)] || 0;

function parseDateMaybe(s) {
    const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(String(s || '').trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateLocal(iso) {
    if (!iso) return '';
    const datePart = iso.split('T')[0];
    const [y, m, d] = datePart.split('-');
    if (!y || !m || !d) return '';
    return `${d}/${m}/${y}`;
}

function daysBetween(d1, d2) {
    const ms = 24 * 60 * 60 * 1000;
    const a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()).getTime();
    const b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate()).getTime();
    return Math.floor((b - a) / ms);
}

function daysSinceAdmission(c) {
    const raw = c?.['Data de admissão'] ?? c?.['Data de admissao'] ?? c?.Admissao ?? c?.['Data Admissão'] ?? c?.['Data Admissao'] ?? '';
    const d = parseDateMaybe(raw);
    if (!d) return null;
    return daysBetween(d, new Date());
}

function calcAgeFromStr(s) {
    const d = parseDateMaybe(s);
    if (!d) return null;
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    const dm = now.getMonth() - d.getMonth();
    if (dm < 0 || (dm === 0 && now.getDate() < d.getDate())) a--;
    return a;
}

function ageBucket(a) {
    if (a == null) return 'N/D';
    if (a < 20) return '<20';
    if (a < 30) return '20-29';
    if (a < 40) return '30-39';
    if (a < 50) return '40-49';
    if (a < 60) return '50-59';
    return '60+';
}

function getNascimento(c) {
    return c?.['Data de Nascimento'] || c?.['Data de nascimento'] || c?.Nascimento || c?.['Nascimento'] || '';
}

function mapGeneroLabel(raw) {
    const n = norm(raw);
    if (n.startsWith('MASC')) return 'Masculino';
    if (n.startsWith('FEM')) return 'Feminino';
    return n ? 'Outros' : 'N/D';
}

function mapSvcLabel(rawSvc) {
    const svc = String(rawSvc || 'N/D').toUpperCase();
    if (svc === 'SBA2' || svc === 'SBA4') {
        return 'SBA2/4';
    }
    if (svc === 'SBA3' || svc === 'SBA7') {
        return 'SBA3/7';
    }
    return svc;
}

function mapDSR(raw) {
    const n = norm(raw);
    if (!n) return ['N/D'];
    const days = n.split(',').map(d => d.trim());
    const mapped = days.map(day => {
        if (day.includes('SEG')) return 'SEG';
        if (day.includes('TER')) return 'TER';
        if (day.includes('QUA')) return 'QUA';
        if (day.includes('QUI')) return 'QUI';
        if (day.includes('SEX')) return 'SEX';
        if (day.includes('SAB')) return 'SAB';
        if (day.includes('DOM')) return 'DOM';
        return null;
    }).filter(Boolean);
    return mapped.length > 0 ? mapped : ['N/D'];
}

function palette() {
    const r = root();
    return [
        css(r, '--hcidx-p-1', '#02B1EE'),
        css(r, '--hcidx-p-2', '#003369'),
        css(r, '--hcidx-p-3', '#69D4FF'),
        css(r, '--hcidx-p-4', '#2677C7'),
        css(r, '--hcidx-p-5', '#A9E7FF'),
        css(r, '--hcidx-p-6', '#225B9E'),
        css(r, '--hcidx-p-7', '#7FB8EB'),
        css(r, '--hcidx-p-8', '#99CCFF')
    ];
}

let _resizeObs = null;

function setResponsiveHeights() {
    if (window.Chart) {
        Chart.defaults.devicePixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
        Object.values(state.charts).forEach(ch => {
            if (!ch) return;
            forceLegendBottom(ch);
            ch.resize();
        });
    }
}

function wireResizeObserver() {
    if (_resizeObs) return;
    const rootEl = document.querySelector(HOST_SEL);
    if (!rootEl) return;
    _resizeObs = new ResizeObserver(() => {
        setResponsiveHeights();
    });
    _resizeObs.observe(rootEl);
    window.addEventListener('resize', setResponsiveHeights);
}

function ensureMounted() {
    const host = document.querySelector(HOST_SEL);
    if (!host || state.mounted) return;
    ['hc-refresh', 'colaborador-added', 'colaborador-updated', 'colaborador-removed']
        .forEach(evt => window.addEventListener(evt, () => {
            invalidateCache([cacheKeyForColabs(), 'spamData', 'matrizesData']);
            if (state.mounted && !state.loading) refresh();
        }));
    document.getElementById('hc-idx-clear-filters')?.addEventListener('click', clearAllFilters);
    const selMatriz = document.getElementById('efet-filter-matriz');
    const selGerencia = document.getElementById('efet-filter-gerencia');
    const selReg = document.getElementById('efet-filter-regiao');
    if (selMatriz) {
        selMatriz.addEventListener('change', (e) => {
            state.matriz = e.target.value;
            refresh();
        });
    }
    if (selGerencia) {
        selGerencia.addEventListener('change', (e) => {
            state.gerencia = e.target.value;
            refresh();
        });
    }
    if (selReg) {
        selReg.addEventListener('change', (e) => {
            state.regiao = e.target.value;
            refresh();
        });
    }
    state.mounted = true;
    setResponsiveHeights();
    wireResizeObserver();
}

async function ensureChartLib() {
    if (!window.Chart) await loadJs('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js');
    if (!window.ChartDataLabels) await loadJs('https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js');
    try {
        if (window.Chart && window.ChartDataLabels && !Chart.registry?.plugins?.get?.('datalabels')) Chart.register(window.ChartDataLabels);
    } catch (_) {
    }
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.devicePixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.6);
}

function loadJs(src) {
    return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
    });
}

function showBusy(f) {
    const el = document.getElementById('hcidx-busy');
    if (el) el.style.display = f ? 'flex' : 'none';
}

const uniqueNonEmptySorted = (v) =>
    Array.from(new Set((v || []).map(x => String(x ?? '')).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'pt-BR', {sensitivity: 'base'}));
const escapeHtml = s => String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
let _filtersPopulated = false;

function populateFilters(allColabs, matrizesMap) {
    if (_filtersPopulated) return;
    const selM = document.getElementById('efet-filter-matriz');
    const selG = document.getElementById('efet-filter-gerencia');
    const selR = document.getElementById('efet-filter-regiao');
    if (selM) {
        const matrizes = uniqueNonEmptySorted(allColabs.map(c => c.MATRIZ));
        selM.innerHTML = `<option value="">Matriz</option>` + matrizes.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
        if (state.matriz) selM.value = state.matriz;
    }
    if (selG && matrizesMap) {
        const gerentes = uniqueNonEmptySorted(Array.from(matrizesMap.values()).map(m => m.GERENCIA));
        selG.innerHTML = `<option value="">Gerência</option>` + gerentes.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
        if (state.gerencia) selG.value = state.gerencia;
    }
    if (selR) {
        const regs = uniqueNonEmptySorted(allColabs.map(c => c.REGIAO || 'N/D'));
        selR.innerHTML = `<option value="">Região</option>` + regs.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
        if (state.regiao) selR.value = state.regiao;
    }
    _filtersPopulated = true;
}

async function loadColabsCached() {
    const key = cacheKeyForColabs();
    const now = Date.now();
    const CACHE_KEY_NAME = 'knc:hcIndiceCache';
    try {
        const cached = localStorage.getItem(CACHE_KEY_NAME);
        if (cached) {
            const {timestamp, data} = JSON.parse(cached);
            if ((now - timestamp) < CACHE_TTL_MS) {
                console.log("Usando cache exclusivo do RH (localStorage).");
                return data;
            } else {
                localStorage.removeItem(CACHE_KEY_NAME);
            }
        }
    } catch (e) {
        console.warn('Falha ao ler cache do RH', e);
        localStorage.removeItem(CACHE_KEY_NAME);
    }
    return fetchOnce(key, async () => {
        let query = supabase
            .from('Colaboradores')
            .select('Nome, Cargo, Contrato, MATRIZ, SVC, REGIAO, Escala, DSR, Ativo, Genero, "Data de nascimento", "Data de admissão", StatusDesligamento, Efetivacao, "Data Fluxo", Fluxo, "Observacao Fluxo", Smartoff, DataDesligamentoSolicitada, SolicitanteDesligamento, Gestor, MotivoDesligamento');
        const data = await fetchAllWithPagination(query);
        const rows = Array.isArray(data) ? data.slice() : [];
        rows.sort((a, b) => String(a?.Nome || '').localeCompare(String(b?.Nome || ''), 'pt-BR'));
        try {
            localStorage.setItem(CACHE_KEY_NAME, JSON.stringify({
                timestamp: Date.now(),
                data: rows
            }));
        } catch (e) {
            console.warn('Falha ao salvar cache do RH', e);
        }
        return rows;
    });
}

async function loadSpamData() {
    return fetchOnce('spamData', async () => {
        const {data, error} = await supabase.from('Spam').select('"HC Fixo", "HC PT", SVC, REGIAO, MÊS, ANO');
        if (error) throw error;
        return (data || []).map(r => ({
            ...r,
            HC_Fixo: Number(r['HC Fixo']) || 0,
            HC_PT: Number(r['HC PT']) || 0,
            HC_Total: (Number(r['HC Fixo']) || 0) + (Number(r['HC PT']) || 0),
            SVC: norm(r.SVC).replace(/\s+/g, ''),
            REGIAO: norm(r.REGIAO),
            MÊS: norm(r.MÊS),
            ANO: Number(r.ANO) || 2025,
            mesOrder: getMesOrder(r.MÊS)
        }));
    });
}

async function loadMatrizesData() {
    return fetchOnce('matrizesData', async () => {
        const {data, error} = await supabase.from('Matrizes').select('SERVICE, MATRIZ, GERENCIA, REGIAO');
        if (error) throw error;
        const map = new Map();
        (data || []).forEach(r => {
            const svc = norm(r.SERVICE).replace(/\s+/g, '');
            if (svc) {
                map.set(svc, {
                    MATRIZ: String(r.MATRIZ || '').trim(), GERENCIA: String(r.GERENCIA || 'N/D').trim(),
                    REGIAO: norm(r.REGIAO || 'N/D')
                });
            }
        });
        return map;
    });
}

function enforceMinSegmentPct(percs, minPct) {
    const arr = percs.map(v => Math.max(0, +v || 0));
    const nonZeroIdx = arr.map((v, i) => v > 0 ? i : -1).filter(i => i >= 0);
    const k = nonZeroIdx.length;
    if (k === 0) return arr.map(() => 0);
    const effMin = Math.min(minPct, 100 / k - 1e-9);
    const sumOriginal = nonZeroIdx.reduce((s, i) => s + arr[i], 0) || 1;
    const floorsSum = effMin * k;
    let available = Math.max(0, 100 - floorsSum);
    const out = arr.slice();
    nonZeroIdx.forEach(i => {
        const share = available * (arr[i] / sumOriginal);
        out[i] = effMin + share;
    });
    const total = out.reduce((a, b) => a + b, 0);
    const diff = 100 - total;
    if (Math.abs(diff) > 1e-6) {
        let maxIdx = nonZeroIdx[0];
        nonZeroIdx.forEach(i => {
            if (out[i] > out[maxIdx]) maxIdx = i;
        });
        out[maxIdx] += diff;
    }
    return out;
}

function applyMinWidthToStack(datasets, minPct) {
    if (!datasets || datasets.length === 0) return;
    const n = Math.max(...datasets.map(ds => ds.data?.length || 0));
    for (let j = 0; j < n; j++) {
        const real = datasets.map(ds => +((ds.data?.[j]) || 0));
        const rendered = enforceMinSegmentPct(real, minPct);
        datasets.forEach((ds, idx) => {
            if (!ds._realPct) ds._realPct = [];
            if (!ds._renderData) ds._renderData = [];
            ds._realPct[j] = real[idx];
            ds._renderData[j] = rendered[idx];
        });
    }
    datasets.forEach(ds => {
        ds.data = ds._renderData;
    });
}

async function refresh() {
    if (!state.mounted || state.loading) {
        if (state.loading) console.warn("Refresh chamado enquanto já estava carregando.");
        return;
    }
    state.loading = true;
    showBusy(true);
    try {
        await ensureChartLib();
        const [allRows, matrizesMap] = await Promise.all([
            loadColabsCached(),
            loadMatrizesData()
        ]);
        populateFilters(allRows, matrizesMap);
        let svcsDoGerente = null;
        if (state.gerencia && matrizesMap) {
            svcsDoGerente = new Set();
            for (const [svc, data] of matrizesMap.entries()) {
                if (data.GERENCIA === state.gerencia) {
                    svcsDoGerente.add(svc);
                }
            }
        }
        state.colabs = allRows.filter(c => {
            const isDesligamentoView = document.querySelector('#efet-desligamento.active');


            if (!isDesligamentoView && norm(c?.Ativo || 'SIM') !== 'SIM') {
                return false;
            }



            const ativoNormalizado = norm(c?.Ativo);
            const isAtivoOuPen = (ativoNormalizado === 'SIM' || ativoNormalizado === 'PEN');

            if (isDesligamentoView) {
                if (c.StatusDesligamento === 'CONCLUIDO') {

                } else if (c.StatusDesligamento === 'RECUSADO' && !isAtivoOuPen) {
                    return false;
                } else if (c.StatusDesligamento === 'PENDENTE' && !isAtivoOuPen) {
                    return false;
                }
            }

            if (state.matriz && c?.MATRIZ !== state.matriz) return false;
            if (svcsDoGerente) {
                const colabSvcNorm = norm(c.SVC).replace(/\s+/g, '');
                if (!svcsDoGerente.has(colabSvcNorm)) {
                    return false;
                }
            }
            if (state.regiao && (String(c?.REGIAO || 'N/D') !== state.regiao)) return false;
            return true;
        });
        const visaoServiceAtiva = document.querySelector('#efet-visao-service.active');
        const visaoRegionalAtiva = document.querySelector('#efet-visao-regional.active');
        const visaoEmEfetivacaoAtiva = document.querySelector('#efet-em-efetivacao.active');
        const visaoSpamHcAtiva = document.querySelector('#spam-hc-view.active');
        const visaoDesligamentoAtiva = document.querySelector('#efet-desligamento.active');
        const visaoControleVagas = document.querySelector('#efet-controle-vagas.active');
        if (visaoServiceAtiva) {
            ensureChartsCreatedService();
            updateChartsNow();
        } else if (visaoRegionalAtiva) {
            ensureChartsCreatedRegional();
            updateRegionalChartsNow();
        } else if (visaoEmEfetivacaoAtiva) {
            updateEmEfetivacaoTable();
        } else if (visaoSpamHcAtiva) {
            await updateSpamCharts(matrizesMap, svcsDoGerente);
        } else if (visaoDesligamentoAtiva) {
            await desligamento_fetchPendentes();
        } else if (visaoControleVagas) {
            await fetchVagas();
        } else {
            console.log("Nenhuma sub-aba ativa ou permissão negada.");
        }
    } catch (e) {
        console.error('Efetivações (Índice) erro', e);
        alert('Falha ao carregar Efetivações. Veja o console.');
    } finally {
        state.loading = false;
        showBusy(false);
        setTimeout(() => setResponsiveHeights(), 100);
    }
}

function wireSubtabs() {
    const host = document.querySelector(HOST_SEL);
    if (!host) return;
    const subButtons = host.querySelectorAll('.efet-subtab-btn');
    if (subButtons.length > 0 && subButtons[0].dataset.wired === '1') {
        return;
    }
    const scrollContainer = document.querySelector('.container');
    let layoutCorrectionInterval = null;
    subButtons.forEach(btn => {
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => {
            const viewName = btn.dataset.view;
            const currentView = host.querySelector('.efet-view.active');
            const nextView = host.querySelector(`#${viewName}`);
            if (currentView === nextView) return;
            subButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            host.querySelectorAll('.efet-view').forEach(v => v.classList.remove('active'));
            if (nextView) {
                nextView.classList.add('active');
            }
            if (scrollContainer) {
                if (viewName === 'efet-em-efetivacao' || viewName === 'efet-desligamento') {
                    scrollContainer.classList.add('travar-scroll-pagina');
                } else {
                    scrollContainer.classList.remove('travar-scroll-pagina');
                }
            }
            if (['efet-visao-service', 'efet-visao-regional', 'efet-em-efetivacao', 'spam-hc-view', 'efet-desligamento'].includes(viewName)) {
                refresh();
            }
            if (layoutCorrectionInterval) clearInterval(layoutCorrectionInterval);
            let attempts = 0;
            layoutCorrectionInterval = setInterval(() => {
                Object.values(state.charts).forEach(ch => {
                    if (ch && typeof ch.resize === 'function') {
                        ch.resize();
                        ch.update('none');
                    }
                });
                window.dispatchEvent(new Event('resize'));
                attempts++;
                if (attempts >= 12) clearInterval(layoutCorrectionInterval);
            }, 50);
        });
    });
}

function setDynamicChartHeight(chart, labels) {
    if (!chart || !chart.canvas || chart.options.indexAxis !== 'y') return;
    const pixelsPerBar = 32;
    const headerAndLegendHeight = 96;
    const minHeight = 300;
    const calculatedHeight = (labels.length * pixelsPerBar) + headerAndLegendHeight;
    const finalHeight = Math.max(minHeight, calculatedHeight);
    const wrapper = chart.canvas.parentElement;
    if (wrapper && wrapper.style.height !== `${finalHeight}px`) {
        wrapper.style.height = `${finalHeight}px`;
        if (typeof chart.resize === 'function') {
            setTimeout(() => chart.resize(), 50);
        }
    }
}

function baseLegendConfig(pos, show) {
    return {
        display: show,
        position: pos,
        fullSize: true,
        align: 'center',
        labels: {boxWidth: 10, boxHeight: 10, padding: 10, usePointStyle: true}
    };
}

function forceLegendBottom(chart) {
    if (!chart?.options) return;
    const leg = chart.options.plugins.legend || (chart.options.plugins.legend = {});
    const lbls = leg.labels || (leg.labels = {});
    leg.display = leg.display !== false;
    leg.position = 'bottom';
    leg.fullSize = true;
    leg.align = 'center';
    lbls.usePointStyle = true;
    lbls.boxWidth = 12;
    lbls.boxHeight = 12;
    lbls.padding = 12;
    const w = chart.canvas?.parentElement?.clientWidth || 800;
    const size = Math.max(13, Math.min(16, Math.round(w / 48)));
    lbls.font = {size};
}

function baseOptsPercent(canvas, onClick, axis = 'x') {
    const w = canvas?.parentElement?.clientWidth || 800;
    const baseSize = Math.max(13, Math.min(16, Math.round(w / 48)));
    const isHorizontal = axis === 'y';
    const valueScale = {
        stacked: true,
        grid: {display: false},
        ticks: {callback: v => `${v}%`, font: {size: baseSize + 1}},
        min: 0,
        max: 100
    };
    const categoryScale = {
        stacked: true,
        grid: {display: false},
        ticks: {maxRotation: 0, font: {size: baseSize + 1}}
    };
    return {
        indexAxis: axis,
        layout: {
            padding: {top: 16, left: 10, right: 18, bottom: 10}
        },
        interaction: {mode: 'nearest', axis: isHorizontal ? 'y' : 'x', intersect: true},
        animation: {duration: 800, easing: 'easeOutQuart'},
        onClick: (e, elements, chart) => {
            if (elements.length > 0 && onClick) onClick(chart, elements[0]);
        },
        plugins: {
            title: {display: false},
            legend: baseLegendConfig('bottom', true),
            datalabels: {
                clip: false,
                clamp: false,
                display: (ctx) => {
                    const real = ctx.dataset._realPct?.[ctx.dataIndex];
                    const v = (real != null) ? real : (+ctx.dataset.data[ctx.dataIndex] || 0);
                    return v > 0;
                },
                font: () => ({size: Math.max(MIN_LABEL_FONT_PX, baseSize + 1), weight: 'bold'}),
                color: (ctx) => {
                    const bg = Array.isArray(ctx.dataset.backgroundColor)
                        ? ctx.dataset.backgroundColor[ctx.dataIndex]
                        : ctx.dataset.backgroundColor;
                    return bestLabel(bg);
                },
                anchor: 'center',
                align: 'center',
                offset: 0,
                formatter: (value, ctx) => {
                    const real = ctx.dataset._realPct?.[ctx.dataIndex];
                    const use = (real != null) ? real : (+value || 0);
                    if (use <= 0) return '';
                    const pct = use < 1 ? 1 : Math.round(use);
                    const count = ctx.dataset._rawCounts?.[ctx.dataIndex];
                    return count != null ? `${pct}% (${count})` : `${pct}%`;
                }
            },
            tooltip: {
                displayColors: false,
                filter: (item) => (item.parsed?.y ?? item.parsed?.x) > 0,
                callbacks: {
                    title: (items) => items?.[0]?.label ?? '',
                    label: (ctx) => {
                        const real = ctx.dataset._realPct?.[ctx.dataIndex];
                        const pct = Math.round(real != null ? real : ((ctx.chart?.options?.indexAxis === 'y') ? ctx.parsed?.x : ctx.parsed?.y) || 0);
                        return `${ctx.dataset?.label ? `${ctx.dataset.label}: ` : ''}${pct}% (${ctx.dataset._rawCounts?.[ctx.dataIndex] ?? 0})`;
                    }
                }
            }
        },
        scales: {x: isHorizontal ? valueScale : categoryScale, y: isHorizontal ? categoryScale : valueScale},
        elements: {bar: {borderSkipped: false, borderRadius: 4}}
    };
}

function baseOptsNumber(canvas, onClick, axis = 'x') {
    const w = canvas?.parentElement?.clientWidth || 800;
    const baseSize = Math.max(12, Math.min(14, Math.round(w / 55)));
    const isHorizontal = axis === 'y';
    const valueScale = {
        grid: {display: false},
        ticks: {font: {size: baseSize}},
        min: 0,
    };
    const categoryScale = {
        grid: {display: false},
        ticks: {
            maxRotation: 45,
            minRotation: 0,
            font: {size: baseSize}
        }
    };
    return {
        indexAxis: axis,
        layout: {padding: {top: 24, left: 10, right: 18, bottom: 10}},
        interaction: {mode: 'nearest', axis: isHorizontal ? 'y' : 'x', intersect: true},
        animation: {duration: 800, easing: 'easeOutQuart'},
        onClick: (e, elements, chart) => {
            if (elements.length > 0 && onClick) onClick(chart, elements[0]);
        },
        plugins: {
            title: {
                display: false,
                position: 'top',
                text: '',
                font: {size: baseSize + 4, weight: 'bold'},
                padding: {top: 0, bottom: 12},
                color: '#003369',
                align: 'start'
            },
            legend: {
                display: true,
                position: 'top',
                align: 'end',
                labels: {
                    boxWidth: 10,
                    boxHeight: 10,
                    padding: 10,
                    usePointStyle: true,
                    font: {size: baseSize}
                }
            },
            tooltip: {
                displayColors: false,
                filter: (item) => (item.parsed?.y ?? item.parsed?.x) > 0,
                callbacks: {
                    title: (items) => items?.[0]?.label ?? '',
                    label: (ctx) => {
                        const val = Math.round(isHorizontal ? ctx.parsed?.x : ctx.parsed?.y ?? 0);
                        const label = `${ctx.dataset?.label ? `${ctx.dataset.label}: ` : ''}`;
                        return `${label}${val}`;
                    }
                }
            }
        },
        scales: {x: isHorizontal ? valueScale : categoryScale, y: isHorizontal ? categoryScale : valueScale},
        elements: {bar: {borderSkipped: false, borderRadius: 4}}
    };
}

function createStackedBar(canvasId, onClick, axis = 'x') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const options = baseOptsPercent(canvas, onClick, axis);
    options.plugins.legend.onClick = (e, legendItem, legend) => {
        if (onClick) onClick(legend.chart, {datasetIndex: legendItem.datasetIndex});
    };
    const chart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {labels: [], datasets: []},
        options,
        plugins: [ChartDataLabels]
    });
    forceLegendBottom(chart);
    return chart;
}

function createBar(canvasId, onClick, axis = 'x') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const options = baseOptsNumber(canvas, onClick, axis);
    const chart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {labels: [], datasets: []},
        options,
        plugins: [ChartDataLabels]
    });
    forceLegendBottom(chart);
    return chart;
}

function splitByTurno(colabs) {
    const t1 = colabs.filter(c => c.Escala === 'T1');
    const t2 = colabs.filter(c => c.Escala === 'T2');
    const t3 = colabs.filter(c => c.Escala === 'T3');
    return {labels: ['T1', 'T2', 'T3', 'GERAL'], groups: [t1, t2, t3, colabs]};
}

function splitByRegiao(colabs) {
    const map = new Map();
    colabs.forEach(c => {
        const r = String(c?.REGIAO || 'N/D');
        if (!map.has(r)) map.set(r, []);
        map.get(r).push(c);
    });
    const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', {sensitivity: 'base'}));
    const labels = entries.map(([k]) => k);
    const groups = entries.map(([, arr]) => arr);
    labels.push('GERAL');
    groups.push(colabs.slice());
    return {labels, groups};
}

function ensureChartsCreatedService() {
    if (!state.charts.idade) {
        state.charts.idade = createStackedBar('ind-idade-bar', (chart, element) => toggleFilter('idade', chart, element), 'x');
    }
    if (!state.charts.genero) {
        state.charts.genero = createStackedBar('ind-genero-bar', (chart, element) => toggleFilter('genero', chart, element), 'x');
        if (state.charts.genero && state.charts.genero.options.elements.bar) {
            state.charts.genero.options.elements.bar.barPercentage = 0.9;
            state.charts.genero.options.elements.bar.categoryPercentage = 0.9;
        }
    }
    if (!state.charts.dsr) {
        const canvas = document.getElementById('ind-dsr-pie');
        if (canvas) {
            const baseSize = Math.max(13, Math.min(15, Math.round((canvas?.parentElement?.clientWidth || 600) / 45)));
            const options = {
                layout: {padding: 6},
                animation: {duration: 800, easing: 'easeOutQuart'},
                onClick: (e, elements) => {
                    if (elements.length > 0) toggleFilter('dsr', null, elements[0]);
                },
                plugins: {
                    legend: baseLegendConfig('bottom', true),
                    datalabels: {
                        display: true,
                        formatter: (v) => `${Math.round(+v)}%`,
                        color: (ctx) => bestLabel(Array.isArray(ctx.dataset.backgroundColor) ? ctx.dataset.backgroundColor[ctx.dataIndex] : ctx.dataset.backgroundColor),
                        font: {size: Math.max(MIN_LABEL_FONT_PX, baseSize), weight: 'bold'},
                        anchor: 'center',
                        align: 'center',
                        clamp: true
                    },
                    tooltip: {
                        displayColors: false,
                        callbacks: {
                            label: (ctx) => `${ctx.label || ''}: ${Math.round(ctx.parsed ?? 0)}% (${(ctx.dataset._rawCounts || [])[ctx.dataIndex] ?? 0})`
                        }
                    }
                },
                cutout: '40%'
            };
            const chart = new Chart(canvas.getContext('2d'), {
                type: 'doughnut',
                data: {labels: [], datasets: [{data: [], backgroundColor: palette()}]},
                options,
                plugins: [ChartDataLabels]
            });
            forceLegendBottom(chart);
            state.charts.dsr = chart;
        }
    }
    if (!state.charts.contrato) state.charts.contrato = createStackedBar('ind-contrato-bar', (chart, element) => toggleFilter('contrato', chart, element), 'y');
    if (!state.charts.contratoSvc) state.charts.contratoSvc = createStackedBar('ind-contrato-svc-bar', (chart, element) => toggleFilter('contratoSvc', chart, element), 'y');
    if (!state.charts.auxPrazoSvc) {
        const auxPrazoSvcId = document.getElementById('ind-aux-30-60-90-svc-bar') ? 'ind-aux-30-60-90-svc-bar' : 'ind-contrato-90d-svc-bar';
        state.charts.auxPrazoSvc = createStackedBar(auxPrazoSvcId, (chart, element) => toggleFilter('auxPrazoSvc', chart, element), 'y');
    }
    if (!state.charts.consultoriaSvc) {
        state.charts.consultoriaSvc = createStackedBar('ind-consultoria-svc-bar', null, 'y');
    }
}

function ensureChartsCreatedRegional() {
    if (!state.charts.idadeRegiao) {
        const id = document.getElementById('reg-idade-bar') ? 'reg-idade-bar' : 'ind-idade-regiao-bar';
        state.charts.idadeRegiao = createStackedBar(id, null, 'x');
    }
    if (!state.charts.generoRegiao) {
        const id = document.getElementById('reg-genero-bar') ? 'reg-genero-bar' : 'ind-genero-regiao-bar';
        state.charts.generoRegiao = createStackedBar(id, null, 'x');
    }
    if (!state.charts.contratoRegiao) {
        const id = document.getElementById('reg-contrato-bar') ? 'reg-contrato-bar' : 'ind-contrato-regiao-bar';
        state.charts.contratoRegiao = createStackedBar(id, null, 'x');
    }
    if (!state.charts.auxPrazoRegiao) {
        const id = document.getElementById('reg-aux-30-60-90-bar') ? 'reg-aux-30-60-90-bar' : 'ind-contrato-90d-regiao-bar';
        state.charts.auxPrazoRegiao = createStackedBar(id, null, 'x');
    }
}

function toggleFilter(type, chart, element) {
    const set = state.interactive[type];
    if (!set) return;
    let label = (type === 'dsr')
        ? state.charts.dsr.data.labels[element.index]
        : chart.data.datasets[element.datasetIndex].label;
    if (set.has(label)) set.delete(label);
    else set.add(label);
    const visaoServiceAtiva = document.querySelector('#efet-visao-service.active');
    const visaoRegionalAtiva = document.querySelector('#efet-visao-regional.active');
    if (visaoServiceAtiva) updateChartsNow();
    if (visaoRegionalAtiva) updateRegionalChartsNow();
}

function applyInteractiveFilter(colabs) {
    let out = [...colabs];
    if (state.interactive.idade.size > 0) out = out.filter(c => state.interactive.idade.has(ageBucket(calcAgeFromStr(getNascimento(c)))));
    if (state.interactive.genero.size > 0) out = out.filter(c => state.interactive.genero.has(mapGeneroLabel(c.Genero)));
    if (state.interactive.dsr.size > 0) {
        out = out.filter(c => {
            const dsrDays = mapDSR(c.DSR);
            return dsrDays.some(day => state.interactive.dsr.has(day));
        });
    }
    return out;
}

function clearAllFilters() {
    Object.values(state.interactive).forEach(set => set.clear());
    const visaoServiceAtiva = document.querySelector('#efet-visao-service.active');
    const visaoRegionalAtiva = document.querySelector('#efet-visao-regional.active');
    if (visaoServiceAtiva) updateChartsNow();
    if (visaoRegionalAtiva) updateRegionalChartsNow();
}

function updateChartsNow() {
    if (!state.charts.idade) {
        console.warn("Tentando atualizar gráficos Service, mas eles não estão inicializados.");
        return;
    }
    const baseColabs = applyInteractiveFilter(state.colabs.filter(c => norm(c?.Ativo) === 'SIM'));
    const pal = palette();
    const createOpacity = (color, opacity) => color + Math.round(opacity * 255).toString(16).padStart(2, '0');
    const colabsAuxiliares = baseColabs.filter(c => norm(c?.Cargo) === 'AUXILIAR');
    {
        const {labels, groups} = splitByTurno(colabsAuxiliares);
        const counts = groups.map(g => {
            const m = new Map(AGE_BUCKETS.map(k => [k, 0]));
            g.forEach(c => {
                const b = ageBucket(calcAgeFromStr(getNascimento(c)));
                m.set(b, (m.get(b) || 0) + 1);
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = AGE_BUCKETS.map((b, i) => {
            const raw = counts.map(m => m.get(b) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            const sel = state.interactive.idade;
            const base = pal[i % pal.length];
            const bg = sel.size === 0 || sel.has(b) ? base : createOpacity(base, 0.2);
            return {label: b, data: pctReal, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        if (state.charts.idade) {
            state.charts.idade.data.labels = labels;
            state.charts.idade.data.datasets = datasets;
            state.charts.idade.update('none');
        }
    }
    {
        const {labels, groups} = splitByTurno(colabsAuxiliares);
        const cats = ['Masculino', 'Feminino', 'Outros', 'N/D'];
        const counts = groups.map(g => {
            const m = new Map(cats.map(k => [k, 0]));
            g.forEach(c => {
                const k = mapGeneroLabel(c?.Genero);
                m.set(k, (m.get(k) || 0) + 1);
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = cats.map((cat, i) => {
            const raw = counts.map(m => m.get(cat) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            let color = pal[i % pal.length];
            if (cat === 'Masculino') color = css(root(), '--hcidx-gender-male', '#02B1EE');
            if (cat === 'Feminino') color = css(root(), '--hcidx-gender-female', '#FF5C8A');
            const sel = state.interactive.genero;
            const bg = sel.size === 0 || sel.has(cat) ? color : createOpacity(color, 0.2);
            return {label: cat, data: pctReal, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        if (state.charts.genero) {
            state.charts.genero.data.labels = labels;
            state.charts.genero.data.datasets = datasets;
            state.charts.genero.update('none');
        }
    }
    {
        const labels = DOW_LABELS.slice();
        const counts = new Map(labels.map(k => [k, 0]));
        colabsAuxiliares.forEach(c => {
            const dsrDays = mapDSR(c.DSR);
            dsrDays.forEach(d => counts.set(d, (counts.get(d) || 0) + 1));
        });
        const rawArr = labels.map(l => counts.get(l) || 0);
        const totalMarks = rawArr.reduce((a, b) => a + b, 0) || 1;
        const pctArr = rawArr.map(v => (v * 100) / totalMarks);
        if (state.charts.dsr) {
            state.charts.dsr.data.labels = labels;
            state.charts.dsr.data.datasets = [{
                data: pctArr,
                backgroundColor: palette().slice(0, labels.length),
                _rawCounts: rawArr
            }];
            state.charts.dsr.update();
        }
    }
    {
        const {labels, groups} = splitByTurno(colabsAuxiliares);
        const cats = ['Efetivo', 'Em efetivação', 'Potencial (>90d)', 'Temporário (≤90d)'];
        const colors = [
            css(root(), '--hcidx-p-2', '#003369'),
            '#FCB803',
            css(root(), '--hcidx-p-success', '#28a745'),
            css(root(), '--hcidx-p-3', '#69D4FF')
        ];
        const counts = groups.map(g => {
            const m = new Map(cats.map(k => [k, 0]));
            g.forEach(c => {
                if (norm(c.Contrato).includes('KN')) {
                    m.set('Efetivo', m.get('Efetivo') + 1);
                } else if (norm(c.Efetivacao) === 'ABERTO') {
                    m.set('Em efetivação', m.get('Em efetivação') + 1);
                } else {
                    const dias = daysSinceAdmission(c);
                    if (dias != null && dias > 90) {
                        m.set('Potencial (>90d)', m.get('Potencial (>90d)') + 1);
                    } else {
                        m.set('Temporário (≤90d)', m.get('Temporário (≤90d)') + 1);
                    }
                }
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = cats.map((cat, i) => {
            const raw = counts.map(m => m.get(cat) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            const sel = state.interactive.contrato;
            const base = colors[i];
            const bg = sel.size === 0 || sel.has(cat) ? base : (base + '33');
            return {label: cat, data: pctReal, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        const ch = state.charts.contrato;
        if (ch) {
            setDynamicChartHeight(ch, labels);
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update();
        }
    }
    {
        const bySvc = new Map();
        colabsAuxiliares.forEach(c => {
            const k = mapSvcLabel(c?.SVC);
            if (!bySvc.has(k)) bySvc.set(k, []);
            bySvc.get(k).push(c);
        });
        const rows = [...bySvc.entries()].map(([svc, arr]) => {
            const counts = {efetivo: 0, emEfetivacao: 0, temp90: 0, potencial: 0};
            arr.forEach(c => {
                if (norm(c.Contrato).includes('KN')) {
                    counts.efetivo++;
                } else if (norm(c.Efetivacao) === 'ABERTO') {
                    counts.emEfetivacao++;
                } else {
                    (daysSinceAdmission(c) > 90) ? counts.potencial++ : counts.temp90++;
                }
            });
            const total = arr.length || 1;
            const allMatrices = new Set(arr.map(c => c.MATRIZ).filter(Boolean));
            const matriz = allMatrices.size === 1 ? ` (${arr[0].MATRIZ})` : '';
            const combinedLabel = `${svc}${matriz}`;
            return {
                svc: combinedLabel,
                pctEfetivo: (counts.efetivo * 100) / total,
                pctEmEfetivacao: (counts.emEfetivacao * 100) / total,
                pctTemp90: (counts.temp90 * 100) / total,
                pctPotencial: (counts.potencial * 100) / total,
                rawEfetivo: counts.efetivo,
                rawEmEfetivacao: counts.emEfetivacao,
                rawTemp90: counts.temp90,
                rawPotencial: counts.potencial,
                total
            };
        });
        rows.sort((a, b) => b.pctEfetivo - a.pctEfetivo || b.rawEfetivo - a.rawEfetivo || a.svc.localeCompare(b.svc));
        const totalG = colabsAuxiliares.length || 1;
        const countsG = colabsAuxiliares.reduce((acc, c) => {
            if (norm(c.Contrato).includes('KN')) acc.efetivo++;
            else if (norm(c.Efetivacao) === 'ABERTO') acc.emEfetivacao++;
            else (daysSinceAdmission(c) > 90) ? acc.potencial++ : acc.temp90++;
            return acc;
        }, {efetivo: 0, emEfetivacao: 0, temp90: 0, potencial: 0});
        const lbls = rows.map(r => r.svc);
        const dsData = {
            efetivo: {pct: rows.map(r => r.pctEfetivo), raw: rows.map(r => r.rawEfetivo)},
            emEfetivacao: {pct: rows.map(r => r.pctEmEfetivacao), raw: rows.map(r => r.rawEmEfetivacao)},
            temp90: {pct: rows.map(r => r.pctTemp90), raw: rows.map(r => r.rawTemp90)},
            potencial: {pct: rows.map(r => r.pctPotencial), raw: rows.map(r => r.rawPotencial)}
        };
        lbls.push('GERAL');
        dsData.efetivo.pct.push((countsG.efetivo * 100) / totalG);
        dsData.efetivo.raw.push(countsG.efetivo);
        dsData.emEfetivacao.pct.push((countsG.emEfetivacao * 100) / totalG);
        dsData.emEfetivacao.raw.push(countsG.emEfetivacao);
        dsData.temp90.pct.push((countsG.temp90 * 100) / totalG);
        dsData.temp90.raw.push(countsG.temp90);
        dsData.potencial.pct.push((countsG.potencial * 100) / totalG);
        dsData.potencial.raw.push(countsG.potencial);
        const colors = [
            css(root(), '--hcidx-p-2', '#003369'),
            '#FCB803',
            css(root(), '--hcidx-p-success', '#28a745'),
            css(root(), '--hcidx-p-3', '#69D4FF')
        ];
        const ch = state.charts.contratoSvc;
        if (ch) {
            setDynamicChartHeight(ch, lbls);
            const datasets = [
                {
                    label: 'Efetivo',
                    data: dsData.efetivo.pct,
                    backgroundColor: colors[0],
                    _rawCounts: dsData.efetivo.raw,
                    borderWidth: 0
                },
                {
                    label: 'Em efetivação',
                    data: dsData.emEfetivacao.pct,
                    backgroundColor: colors[1],
                    _rawCounts: dsData.emEfetivacao.raw,
                    borderWidth: 0
                },
                {
                    label: 'Potencial (>90d)',
                    data: dsData.potencial.pct,
                    backgroundColor: colors[2],
                    _rawCounts: dsData.potencial.raw,
                    borderWidth: 0
                },
                {
                    label: 'Temporário (≤90d)',
                    data: dsData.temp90.pct,
                    backgroundColor: colors[3],
                    _rawCounts: dsData.temp90.raw,
                    borderWidth: 0
                }
            ];
            applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
            ch.data.labels = lbls;
            ch.data.datasets = datasets;
            ch.update();
        }
    }
    {
        const colabsAuxNaoKN = colabsAuxiliares.filter(c => !norm(c?.Contrato).includes('KN'));
        const bySvc = new Map();
        colabsAuxNaoKN.forEach(c => {
            const k = mapSvcLabel(c?.SVC);
            if (!bySvc.has(k)) bySvc.set(k, []);
            bySvc.get(k).push(c);
        });
        const rows = [...bySvc.entries()].map(([svc, arr]) => {
            const counts = {b30: 0, b60: 0, b90: 0, bMais90: 0};
            arr.forEach(c => {
                const d = daysSinceAdmission(c);
                if (d == null) return;
                if (d <= 30) counts.b30++;
                else if (d <= 60) counts.b60++;
                else if (d <= 90) counts.b90++;
                else counts.bMais90++;
            });
            const total = arr.length || 1;
            const allMatrices = new Set(arr.map(c => c.MATRIZ).filter(Boolean));
            const matriz = allMatrices.size === 1 ? ` (${arr[0].MATRIZ})` : '';
            const combinedLabel = `${svc}${matriz}`;
            return {
                svc: combinedLabel,
                pct30: (counts.b30 * 100) / total,
                pct60: (counts.b60 * 100) / total,
                pct90: (counts.b90 * 100) / total,
                pctMais90: (counts.bMais90 * 100) / total,
                raw30: counts.b30,
                raw60: counts.b60,
                raw90: counts.b90,
                rawMais90: counts.bMais90,
                total
            };
        });
        rows.sort((a, b) => a.rawMais90 - b.rawMais90 || a.svc.localeCompare(b.svc));
        const countsG = colabsAuxNaoKN.reduce((acc, c) => {
            const d = daysSinceAdmission(c);
            if (d != null) {
                if (d <= 30) acc.g30++;
                else if (d <= 60) acc.g60++;
                else if (d <= 90) acc.g90++;
                else acc.gMais90++;
            }
            return acc;
        }, {g30: 0, g60: 0, g90: 0, gMais90: 0});
        const totalG = colabsAuxNaoKN.length || 1;
        const lbls = rows.map(r => r.svc);
        const dsMap = {
            '≤30d': {pct: rows.map(r => r.pct30), raw: rows.map(r => r.raw30)},
            '31–60d': {pct: rows.map(r => r.pct60), raw: rows.map(r => r.raw60)},
            '61–90d': {pct: rows.map(r => r.pct90), raw: rows.map(r => r.raw90)},
            '>90d': {pct: rows.map(r => r.pctMais90), raw: rows.map(r => r.rawMais90)}
        };
        lbls.push('GERAL');
        dsMap['≤30d'].pct.push((countsG.g30 * 100) / totalG);
        dsMap['≤30d'].raw.push(countsG.g30);
        dsMap['31–60d'].pct.push((countsG.g60 * 100) / totalG);
        dsMap['31–60d'].raw.push(countsG.g60);
        dsMap['61–90d'].pct.push((countsG.g90 * 100) / totalG);
        dsMap['61–90d'].raw.push(countsG.g90);
        dsMap['>90d'].pct.push((countsG.gMais90 * 100) / totalG);
        dsMap['>90d'].raw.push(countsG.gMais90);
        const colors = [
            css(root(), '--hcidx-p-2', '#003369'),
            css(root(), '--hcidx-p-3', '#69D4FF'),
            '#0CC494',
            '#C00000'
        ];
        const ch = state.charts.auxPrazoSvc;
        if (ch) {
            setDynamicChartHeight(ch, lbls);
            const datasets = Object.keys(dsMap).map((key, i) => ({
                label: key,
                data: dsMap[key].pct,
                backgroundColor: colors[i],
                _rawCounts: dsMap[key].raw,
                borderWidth: 0
            }));
            applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
            ch.data.labels = lbls;
            ch.data.datasets = datasets;
            ch.update();
        }
    }
    {
        const colabsConsultoria = colabsAuxiliares.filter(c => !norm(c.Contrato).includes('KN'));
        const bySvc = new Map();
        const allContracts = new Set();
        colabsConsultoria.forEach(c => {
            const k = mapSvcLabel(c?.SVC);
            const contrato = c.Contrato ? c.Contrato.trim().toUpperCase() : 'OUTROS';
            if (!bySvc.has(k)) bySvc.set(k, new Map());
            const svcMap = bySvc.get(k);
            svcMap.set(contrato, (svcMap.get(contrato) || 0) + 1);
            allContracts.add(contrato);
        });
        const contractTypes = Array.from(allContracts).sort();
        const svcs = Array.from(bySvc.keys()).sort();
        const globalCounts = new Map();
        colabsConsultoria.forEach(c => {
            const contrato = c.Contrato ? c.Contrato.trim().toUpperCase() : 'OUTROS';
            globalCounts.set(contrato, (globalCounts.get(contrato) || 0) + 1);
        });
        const totalGlobal = colabsConsultoria.length || 1;
        const datasets = contractTypes.map((ctype, i) => {
            const dataPct = [];
            const dataRaw = [];
            svcs.forEach(svc => {
                const svcMap = bySvc.get(svc);
                const count = svcMap.get(ctype) || 0;
                const totalSvc = Array.from(svcMap.values()).reduce((a, b) => a + b, 0) || 1;
                dataPct.push((count * 100) / totalSvc);
                dataRaw.push(count);
            });
            const countGeral = globalCounts.get(ctype) || 0;
            dataPct.push((countGeral * 100) / totalGlobal);
            dataRaw.push(countGeral);
            return {
                label: ctype,
                data: dataPct,
                backgroundColor: pal[i % pal.length],
                _rawCounts: dataRaw,
                borderWidth: 0
            };
        });
        svcs.push('GERAL');
        const ch = state.charts.consultoriaSvc;
        if (ch) {
            setDynamicChartHeight(ch, svcs);
            applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
            ch.data.labels = svcs;
            ch.data.datasets = datasets;
            ch.update();
        }
    }
}

function updateRegionalChartsNow() {
    if (!state.charts.idadeRegiao) {
        console.warn("Tentando atualizar gráficos Regionais, mas eles não estão inicializados.");
        return;
    }
    const baseColabs = applyInteractiveFilter(state.colabs.filter(c => norm(c?.Ativo) === 'SIM'));
    const pal = palette();
    const colabsAuxiliares = baseColabs.filter(c => norm(c?.Cargo) === 'AUXILIAR');
    {
        const {labels, groups} = splitByRegiao(colabsAuxiliares);
        const counts = groups.map(g => {
            const m = new Map(AGE_BUCKETS.map(k => [k, 0]));
            g.forEach(c => {
                const b = ageBucket(calcAgeFromStr(getNascimento(c)));
                m.set(b, (m.get(b) || 0) + 1);
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = AGE_BUCKETS.map((b, i) => {
            const raw = counts.map(m => m.get(b) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            return {label: b, data: pctReal, backgroundColor: pal[i % pal.length], _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        const ch = state.charts.idadeRegiao;
        if (ch) {
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update('none');
        }
    }
    {
        const {labels, groups} = splitByRegiao(colabsAuxiliares);
        const cats = ['Masculino', 'Feminino', 'Outros', 'N/D'];
        const counts = groups.map(g => {
            const m = new Map(cats.map(k => [k, 0]));
            g.forEach(c => {
                const k = mapGeneroLabel(c?.Genero);
                m.set(k, (m.get(k) || 0) + 1);
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = cats.map((cat, i) => {
            const raw = counts.map(m => m.get(cat) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            let color = pal[i % pal.length];
            if (cat === 'Masculino') color = css(root(), '--hcidx-gender-male', '#02B1EE');
            if (cat === 'Feminino') color = css(root(), '--hcidx-gender-female', '#FF5C8A');
            return {label: cat, data: pctReal, backgroundColor: color, _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        const ch = state.charts.generoRegiao;
        if (ch) {
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update('none');
        }
    }
    {
        const {labels, groups} = splitByRegiao(colabsAuxiliares);
        const cats = ['Efetivo', 'Em efetivação', 'Potencial (>90d)', 'Temporário (≤90d)'];
        const colors = [
            css(root(), '--hcidx-p-2', '#003369'),
            '#FCB803',
            css(root(), '--hcidx-p-success', '#28a745'),
            css(root(), '--hcidx-p-3', '#69D4FF')
        ];
        const counts = groups.map(g => {
            const m = new Map(cats.map(k => [k, 0]));
            g.forEach(c => {
                if (norm(c.Contrato).includes('KN')) m.set('Efetivo', m.get('Efetivo') + 1);
                else if (norm(c.Efetivacao) === 'ABERTO') m.set('Em efetivação', m.get('Em efetivação') + 1);
                else (daysSinceAdmission(c) > 90) ? m.set('Potencial (>90d)', m.get('Potencial (>90d)') + 1) : m.set('Temporário (≤90d)', m.get('Temporário (≤90d)') + 1);
            });
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = cats.map((cat, i) => {
            const raw = counts.map(m => m.get(cat) || 0);
            const pctReal = raw.map((v, x) => (v * 100) / totals[x]);
            return {label: cat, data: pctReal, backgroundColor: colors[i], _rawCounts: raw, borderWidth: 0};
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        const ch = state.charts.contratoRegiao;
        if (ch) {
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update();
        }
    }
    {
        const colabsAuxNaoKN = colabsAuxiliares.filter(c => !norm(c?.Contrato).includes('KN'));
        const {labels, groups} = splitByRegiao(colabsAuxNaoKN);
        const rows = groups.map(arr => {
            const counts = {b30: 0, b60: 0, b90: 0, bMais90: 0};
            arr.forEach(c => {
                const d = daysSinceAdmission(c);
                if (d == null) return;
                if (d <= 30) counts.b30++;
                else if (d <= 60) counts.b60++;
                else if (d <= 90) counts.b90++;
                else counts.bMais90++;
            });
            const total = arr.length || 1;
            return {
                pct30: (counts.b30 * 100) / total,
                pct60: (counts.b60 * 100) / total,
                pct90: (counts.b90 * 100) / total,
                pctMais90: (counts.bMais90 * 100) / total,
                raw30: counts.b30, raw60: counts.b60, raw90: counts.b90, rawMais90: counts.bMais90
            };
        });
        const ds = {
            '≤30d': {pct: rows.map(r => r.pct30), raw: rows.map(r => r.raw30)},
            '31–60d': {pct: rows.map(r => r.pct60), raw: rows.map(r => r.raw60)},
            '61–90d': {pct: rows.map(r => r.pct90), raw: rows.map(r => r.raw90)},
            '>90d': {pct: rows.map(r => r.pctMais90), raw: rows.map(r => r.rawMais90)}
        };
        const colors = [
            css(root(), '--hcidx-p-2', '#003369'),
            css(root(), '--hcidx-p-3', '#69D4FF'),
            '#0CC494',
            '#C00000'
        ];
        const ch = state.charts.auxPrazoRegiao;
        if (ch) {
            const datasets = Object.keys(ds).map((key, i) => ({
                label: key,
                data: ds[key].pct,
                backgroundColor: colors[i],
                _rawCounts: ds[key].raw,
                borderWidth: 0
            }));
            applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
            ch.data.labels = labels;
            ch.data.datasets = datasets;
            ch.update();
        }
    }
}

function updateEmEfetivacaoTable() {
    const tbody = document.getElementById('efet-table-tbody');
    if (!tbody) {
        console.warn("Elemento #efet-table-tbody não encontrado. A tabela 'Em Efetivação' não pode ser populada.");
        return;
    }
    const colabsEmEfetivacao = state.colabs.filter(c => norm(c.Efetivacao) === 'ABERTO');
    colabsEmEfetivacao.sort((a, b) => {
        const dateA = a['Data Fluxo'] ? new Date(a['Data Fluxo']) : new Date('2999-12-31');
        const dateB = b['Data Fluxo'] ? new Date(b['Data Fluxo']) : new Date('2999-12-31');
        return dateA - dateB;
    });
    tbody.innerHTML = '';
    if (colabsEmEfetivacao.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center p-4">Nenhum colaborador com fluxo "Aberto" encontrado.</td></tr>';
        return;
    }
    colabsEmEfetivacao.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${c.Fluxo || ''}</td>
            <td>${c.Efetivacao || ''}</td>
            <td>${c.Nome || ''}</td>
            <td>${formatDateLocal(c['Data Fluxo'])}</td>
            <td>${c['Observacao Fluxo'] || ''}</td>
            <td>${c.SVC || ''}</td>
            <td>${c.REGIAO || ''}</td>
        `;
        tbody.appendChild(tr);
    });
}

function ensureChartsCreatedSpam() {
    const pal = palette();
    if (!state.charts.spamHcEvolucaoSvc) {
        const chart = createBar('spam-chart-evolucao-svc', null, 'x');
        if (chart) {
            chart.options.plugins.datalabels = {
                clamp: false,
                labels: {
                    value: {
                        display: (ctx) => (ctx.dataset.label === ctx.chart.data._mesAtualLabel && ctx.dataset.data[ctx.dataIndex] > 0),
                        formatter: (v) => v.toFixed(0),
                        font: {weight: 'bold', size: 14},
                        anchor: 'end',
                        align: 'end',
                        offset: 8,
                        color: '#333'
                    }, previousValue: {
                        display: (ctx) => (ctx.dataset.label === ctx.chart.data._mesAnteriorLabel && ctx.dataset.data[ctx.dataIndex] > 0),
                        formatter: (v) => v.toFixed(0),
                        font: {weight: 'bold', size: 14},
                        anchor: 'end',
                        align: 'end',
                        offset: 8,
                        color: '#333'
                    }, delta: {
                        display: (ctx) => {
                            const deltas = ctx.dataset._deltas;
                            if (!deltas) return false;
                            const isMesAtual = ctx.dataset.label === ctx.chart.data._mesAtualLabel;
                            const delta = deltas[ctx.dataIndex] ?? 0;
                            return isMesAtual && delta !== 0;
                        },
                        formatter: (v, ctx) => {
                            const delta = ctx.dataset._deltas[ctx.dataIndex];
                            const abs = Math.abs(delta).toFixed(0);
                            return delta > 0 ? `+${abs}\n▲` : `-${abs}\n▼`;
                        },
                        color: (ctx) => (ctx.dataset._deltas[ctx.dataIndex] > 0 ? '#28a745' : '#dc3545'),
                        textAlign: 'center',
                        font: {weight: '800', size: 16, lineHeight: 1.15},
                        anchor: 'end',
                        align: 'end',
                        offset: 35
                    }
                }
            };
            state.charts.spamHcEvolucaoSvc = chart;
        }
    }
    if (!state.charts.spamHcEvolucaoRegiao) {
        const chart = createBar('spam-chart-evolucao-regiao', null, 'x');
        if (chart) {
            chart.options.plugins.datalabels = {
                clamp: false,
                display: true,
                align: 'center',
                anchor: 'center',
                color: (ctx) => bestLabel(ctx.dataset.backgroundColor),
                font: {weight: 'bold', size: 14},
                formatter: (v) => v > 0 ? v.toFixed(0) : ''
            };
            state.charts.spamHcEvolucaoRegiao = chart;
        }
    }
    if (!state.charts.spamHcGerente) {
        const chart = createBar('spam-chart-gerente-mes', null, 'y');
        if (chart) {
            chart.options.plugins.datalabels = {
                clamp: false,
                display: true,
                anchor: 'end',
                align: 'right',
                color: '#333',
                font: {size: 14, weight: 'bold'},
                formatter: (v) => v.toFixed(0),
                offset: 4
            };
            state.charts.spamHcGerente = chart;
        }
    }
    if (!state.charts.spamHcVsAux) {
        const chart = createBar('spam-chart-hc-vs-aux', null, 'x');
        if (chart) {
            chart.options.scales.x.stacked = false;
            chart.options.scales.y.stacked = false;
            chart.options.plugins.datalabels = {
                clamp: false,
                labels: {
                    value: {
                        display: (ctx) => (ctx.dataset.data[ctx.dataIndex] || 0) > 0,
                        formatter: (v) => v.toFixed(0),
                        font: {size: 14, weight: 'bold'},
                        anchor: 'end',
                        align: 'end',
                        offset: 8,
                        color: '#333'
                    }, delta: {
                        display: (ctx) => {
                            if (ctx.datasetIndex !== 1) return false;
                            const deltas = ctx.dataset._deltas;
                            return Array.isArray(deltas) && (deltas[ctx.dataIndex] ?? 0) !== 0;
                        },
                        formatter: (v, ctx) => {
                            const d = ctx.dataset._deltas[ctx.dataIndex];
                            return d > 0 ? `+${d.toFixed(0)}\n▲` : `${d.toFixed(0)}\n▼`;
                        },
                        color: (ctx) => (ctx.dataset._deltas[ctx.dataIndex] > 0 ? '#28a745' : '#dc3545'),
                        textAlign: 'center',
                        font: {weight: '800', size: 16, lineHeight: 1.15},
                        anchor: 'end',
                        align: 'end',
                        offset: 35
                    }
                }
            };
            state.charts.spamHcVsAux = chart;
        }
    }
    if (!state.charts.spamContractDonut) {
        const canvas = document.getElementById('spam-chart-contrato-donut');
        if (canvas) {
            const baseSize = Math.max(13, Math.min(15, Math.round((canvas?.parentElement?.clientWidth || 600) / 45)));
            const options = {
                layout: {padding: 6},
                animation: {duration: 800, easing: 'easeOutQuart'},
                plugins: {
                    legend: baseLegendConfig('bottom', true),
                    datalabels: {
                        display: true,
                        formatter: (v) => `${Math.round(+v)}%`,
                        color: (ctx) => bestLabel(Array.isArray(ctx.dataset.backgroundColor) ? ctx.dataset.backgroundColor[ctx.dataIndex] : ctx.dataset.backgroundColor),
                        font: {size: Math.max(MIN_LABEL_FONT_PX, baseSize), weight: 'bold'},
                        anchor: 'center',
                        align: 'center',
                        clamp: true
                    },
                    tooltip: {
                        displayColors: false,
                        callbacks: {
                            label: (ctx) => `${ctx.label || ''}: ${Math.round(ctx.parsed ?? 0)}% (${(ctx.dataset._rawCounts || [])[ctx.dataIndex] ?? 0})`
                        }
                    }
                },
                cutout: '40%'
            };
            const chart = new Chart(canvas.getContext('2d'), {
                type: 'doughnut',
                data: {labels: [], datasets: [{data: [], backgroundColor: palette()}]},
                options,
                plugins: [ChartDataLabels]
            });
            forceLegendBottom(chart);
            state.charts.spamContractDonut = chart;
        }
    }
}

async function updateSpamCharts(matrizesMap, svcsDoGerente) {
    if (!state.mounted) return;
    ensureChartsCreatedSpam();
    const [allSpamData] = await Promise.all([loadSpamData()]);
    const colabsAtivos = state.colabs.filter(c => norm(c?.Ativo) === 'SIM');
    const colabsAuxiliaresAtivos = colabsAtivos.filter(c => norm(c?.Cargo) === 'AUXILIAR');
    const spamData = allSpamData.filter(r => {
        if (state.regiao && r.REGIAO !== state.regiao) return false;
        const matrizInfo = matrizesMap.get(r.SVC);
        if (state.matriz) {
            if (!matrizInfo || matrizInfo.MATRIZ !== state.matriz) return false;
        }
        if (state.gerencia) {
            if (!matrizInfo || matrizInfo.GERENCIA !== state.gerencia) return false;
        }
        if (svcsDoGerente) {
            if (!svcsDoGerente.has(r.SVC)) return false;
        }
        return true;
    });
    const pal = palette();
    const allMonths = [...spamData].sort(sortMesAno);
    const latestMonth = allMonths.pop();
    if (!latestMonth) {
        console.warn("SPAM: Nenhum dado encontrado (com os filtros aplicados).");
        Object.values(state.charts).forEach(chart => {
            if (chart && chart.canvas?.id?.startsWith('spam-')) {
                chart.data.labels = [];
                chart.data.datasets = [];
                chart.update();
            }
        });
        return;
    }
    const {MÊS: mesUltimo, ANO: anoUltimo} = latestMonth;
    const mesUltimoLabel = `${mesUltimo.slice(0, 3)}/${anoUltimo}`;
    const previousMonth = allMonths
        .filter(m => m.ANO < anoUltimo || (m.ANO === anoUltimo && m.mesOrder < latestMonth.mesOrder))
        .pop();
    const mesAnteriorLabel = previousMonth ? `${previousMonth.MÊS.slice(0, 3)}/${previousMonth.ANO}` : null;
    const hoje = new Date();
    const anoSistema = hoje.getFullYear();
    const mesSistemaOrder = hoje.getMonth() + 1;
    const spamMesAtualSistema = spamData.filter(r =>
        r.ANO === anoSistema && r.mesOrder === mesSistemaOrder
    );
    let mesReferenciaSpamVsReal = mesUltimo;
    let anoReferenciaSpamVsReal = anoUltimo;
    if (spamMesAtualSistema.length > 0) {
        mesReferenciaSpamVsReal = spamMesAtualSistema[0].MÊS;
        anoReferenciaSpamVsReal = spamMesAtualSistema[0].ANO;
    }
    if (state.charts.spamHcEvolucaoSvc) {
        const dadosPorSvcMes = new Map();
        const mesesSet = new Set();
        const svcsSet = new Set();
        spamData.forEach(r => {
            const mesLabel = `${r.MÊS.slice(0, 3)}/${r.ANO}`;
            const svcAgrupado = mapSvcLabel(r.SVC);
            const key = `${svcAgrupado}__${mesLabel}`;
            const totalAnterior = dadosPorSvcMes.get(key) || 0;
            dadosPorSvcMes.set(key, totalAnterior + r.HC_Total);
            mesesSet.add(mesLabel);
            svcsSet.add(svcAgrupado);
        });
        const labels = [...svcsSet].sort();
        const meses = [...mesesSet].sort((a, b) => {
            const [m1, y1] = a.split('/');
            const [m2, y2] = b.split('/');
            return (y1 - y2) || (getMesOrder(m1.toUpperCase()) - getMesOrder(m2.toUpperCase()));
        });
        const datasets = meses.map((mesLabel, i) => {
            const data = labels.map(svc => dadosPorSvcMes.get(`${svc}__${mesLabel}`) || 0);
            return {
                label: mesLabel,
                data,
                backgroundColor: pal[i % pal.length]
            };
        });
        let maxHcParaEscala = 0;
        datasets.forEach(ds => {
            const max = ds.data.length > 0 ? Math.max(...ds.data) : 0;
            if (max > maxHcParaEscala) maxHcParaEscala = max;
        });
        const chart = state.charts.spamHcEvolucaoSvc;
        if (chart.options.scales.y) {
            chart.options.scales.y.max = maxHcParaEscala + 100;
            if (chart.options.scales.y.max < 10) chart.options.scales.y.max = 10;
        }
        const datasetAtual = datasets.find(d => d.label === mesUltimoLabel);
        if (datasetAtual && mesAnteriorLabel) {
            const datasetAnterior = datasets.find(d => d.label === mesAnteriorLabel);
            if (datasetAnterior) {
                datasetAtual._deltas = labels.map((svc, idx) => {
                    const atual = datasetAtual.data[idx] || 0;
                    const anterior = datasetAnterior.data[idx] || 0;
                    return atual - anterior;
                });
            } else {
                datasetAtual._deltas = labels.map(() => 0);
            }
        } else if (datasetAtual) {
            datasetAtual._deltas = labels.map(() => 0);
        }
        chart.data._mesAtualLabel = mesUltimoLabel;
        chart.data._mesAnteriorLabel = mesAnteriorLabel;
        chart.data.labels = labels;
        chart.data.datasets = datasets;
        chart.update();
    }
    if (state.charts.spamHcEvolucaoRegiao) {
        const dadosPorRegiaoMes = new Map();
        const mesesSet = new Set();
        const regioesSet = new Set();
        spamData.forEach(r => {
            const regiao = r.REGIAO || 'N/D';
            const mesLabel = `${r.MÊS.slice(0, 3)}/${r.ANO}`;
            const key = `${regiao}__${mesLabel}`;
            mesesSet.add(mesLabel);
            regioesSet.add(regiao);
            const totalAnterior = dadosPorRegiaoMes.get(key) || 0;
            dadosPorRegiaoMes.set(key, totalAnterior + r.HC_Total);
        });
        const labels = [...regioesSet].sort();
        const meses = [...mesesSet].sort((a, b) => {
            const [m1, y1] = a.split('/');
            const [m2, y2] = b.split('/');
            return (y1 - y2) || (getMesOrder(m1.toUpperCase()) - getMesOrder(m2.toUpperCase()));
        });
        const datasets = meses.map((mesLabel, i) => {
            const data = labels.map(regiao => dadosPorRegiaoMes.get(`${regiao}__${mesLabel}`) || 0);
            const totalMes = data.reduce((a, b) => a + b, 0);
            data.push(totalMes);
            return {
                label: mesLabel,
                data,
                backgroundColor: pal[i % pal.length]
            };
        });
        labels.push('GERAL');
        const chart = state.charts.spamHcEvolucaoRegiao;
        chart.data.labels = labels;
        chart.data.datasets = datasets;
        chart.update();
    }
    if (state.charts.spamHcGerente) {
        const hcPorGerente = new Map();
        colabsAuxiliaresAtivos.forEach(c => {
            let gerente = 'SEM GERENTE';
            if (c.SVC) {
                const rawSvc = mapSvcLabel(c.SVC);
                const svcNorm = norm(rawSvc).replace(/\s+/g, '');
                let infoSvc = matrizesMap.get(norm(c.SVC).replace(/\s+/g, ''));
                if (!infoSvc) {
                    infoSvc = matrizesMap.get(svcNorm);
                }
                if (infoSvc && infoSvc.GERENCIA) {
                    gerente = infoSvc.GERENCIA;
                }
            }
            if (gerente === 'SEM GERENTE' && c.MATRIZ) {
                const matrizColab = String(c.MATRIZ).trim();
                for (const info of matrizesMap.values()) {
                    if (info.MATRIZ === matrizColab && info.GERENCIA) {
                        gerente = info.GERENCIA;
                        break;
                    }
                }
            }
            hcPorGerente.set(gerente, (hcPorGerente.get(gerente) || 0) + 1);
        });
        const chart = state.charts.spamHcGerente;
        if (hcPorGerente.size === 0) {
            chart.data.labels = [];
            chart.data.datasets = [];
            chart.update();
        } else {
            const dataSorted = [...hcPorGerente.entries()].sort((a, b) => b[1] - a[1]);
            const labels = dataSorted.map(d => d[0]);
            const dataValues = dataSorted.map(d => d[1]);
            const totalGeral = dataValues.reduce((acc, val) => acc + val, 0);
            labels.push('GERAL');
            dataValues.push(totalGeral);
            const maxHc = dataValues.length > 0 ? Math.max(...dataValues) : 1;
            if (chart.options.scales.x) {
                chart.options.scales.x.max = maxHc * 1.25;
            }
            setDynamicChartHeight(chart, labels);
            chart.data.labels = labels;
            chart.data.datasets = [{
                label: 'HC Real (Auxiliares Ativos)',
                data: dataValues,
                backgroundColor: pal[1]
            }];
            chart.update();
        }
    }
    if (state.charts.spamHcVsAux) {
        const auxPorSvc = new Map();
        colabsAuxiliaresAtivos.forEach(c => {
            const svcAgrupado = mapSvcLabel(c.SVC || '');
            auxPorSvc.set(svcAgrupado, (auxPorSvc.get(svcAgrupado) || 0) + 1);
        });
        const hcPorSvc = new Map();
        spamData
            .filter(r => r.MÊS === mesReferenciaSpamVsReal && r.ANO === anoReferenciaSpamVsReal)
            .forEach(r => {
                const svcAgrupado = mapSvcLabel(r.SVC);
                const totalAnterior = hcPorSvc.get(svcAgrupado) || 0;
                hcPorSvc.set(svcAgrupado, totalAnterior + r.HC_Total);
            });
        const allSvcs = new Set([...auxPorSvc.keys(), ...hcPorSvc.keys()]);
        const labels = [...allSvcs].sort();
        const dataHcTotalSpam = labels.map(svc => hcPorSvc.get(svc) || 0);
        const dataAuxAtivoReal = labels.map(svc => auxPorSvc.get(svc) || 0);
        const maxSpam = dataHcTotalSpam.length > 0 ? Math.max(...dataHcTotalSpam) : 0;
        const maxReal = dataAuxAtivoReal.length > 0 ? Math.max(...dataAuxAtivoReal) : 0;
        const maxHcParaEscala = Math.max(maxSpam, maxReal);
        const chart = state.charts.spamHcVsAux;
        if (chart.options.scales.y) {
            chart.options.scales.y.max = maxHcParaEscala + 100;
            if (chart.options.scales.y.max < 10) chart.options.scales.y.max = 10;
        }
        const deltas = dataAuxAtivoReal.map((real, i) => real - dataHcTotalSpam[i]);
        chart.data.labels = labels;
        chart.data.datasets = [
            {
                label: `HC Total (SPAM - ${mesReferenciaSpamVsReal.slice(0, 3)}/${anoReferenciaSpamVsReal})`,
                data: dataHcTotalSpam,
                backgroundColor: pal[1],
                _deltas: deltas.map(() => 0)
            },
            {
                label: 'HC Real (Auxiliares Ativos)',
                data: dataAuxAtivoReal,
                backgroundColor: pal[0],
                _deltas: deltas
            }
        ];
        chart.update();
    }
    if (!state.charts.spamContractDonut || state.charts.spamContractDonut.config.type !== 'bar') {
        if (state.charts.spamContractDonut) {
            state.charts.spamContractDonut.destroy();
        }
        state.charts.spamContractDonut = createStackedBar('spam-chart-contrato-donut', null, 'x');
    }
    if (state.charts.spamContractDonut) {
        const targetColabs = colabsAuxiliaresAtivos.filter(c => {
            const contrato = norm(c.Contrato || 'OUTROS');
            return !contrato.includes('KN');
        });
        const dataMap = new Map();
        const globalCounts = new Map();
        const allContracts = new Set();
        targetColabs.forEach(c => {
            const reg = c.REGIAO || 'N/D';
            const cont = c.Contrato ? c.Contrato.trim().toUpperCase() : 'OUTROS';
            if (!dataMap.has(reg)) dataMap.set(reg, new Map());
            const regMap = dataMap.get(reg);
            regMap.set(cont, (regMap.get(cont) || 0) + 1);
            globalCounts.set(cont, (globalCounts.get(cont) || 0) + 1);
            allContracts.add(cont);
        });
        const labels = Array.from(dataMap.keys()).sort();
        labels.push('GERAL');
        const contractTypes = Array.from(allContracts).sort();
        const datasets = contractTypes.map((ctype, i) => {
            const dataPct = [];
            const dataRaw = [];
            labels.forEach(reg => {
                let count = 0;
                let totalReg = 0;
                if (reg === 'GERAL') {
                    count = globalCounts.get(ctype) || 0;
                    totalReg = Array.from(globalCounts.values()).reduce((a, b) => a + b, 0) || 1;
                } else {
                    const regMap = dataMap.get(reg);
                    if (regMap) {
                        count = regMap.get(ctype) || 0;
                        totalReg = Array.from(regMap.values()).reduce((a, b) => a + b, 0) || 1;
                    }
                }
                const pct = (count * 100) / totalReg;
                dataPct.push(pct);
                dataRaw.push(count);
            });
            return {
                label: ctype,
                data: dataPct,
                backgroundColor: pal[i % pal.length],
                _rawCounts: dataRaw,
                borderWidth: 0
            };
        });
        applyMinWidthToStack(datasets, MIN_SEGMENT_PERCENT);
        state.charts.spamContractDonut.data.labels = labels;
        state.charts.spamContractDonut.data.datasets = datasets;
        state.charts.spamContractDonut.update();
    }
}

function desligamento_getCurrentUser() {
    try {
        const userDataString = localStorage.getItem('userSession');
        if (userDataString) {
            const user = JSON.parse(userDataString);
            return user?.Nome || 'Usuário RH Desconhecido';
        }
    } catch (e) {
        console.error('Erro ao ler sessão do usuário:', e);
    }
    return 'Usuário RH Desconhecido';
}

async function desligamento_fetchPendentes() {
    const tbody = state.desligamentoModule.tbody;
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="11" class="text-center p-4">Carregando...</td></tr>';
    const matrizesMap = await loadMatrizesData();
    const matrizesPermitidas = getMatrizesPermitidas();
    const colunas = 'Nome, Smartoff, DataDesligamentoSolicitada, DataRetorno, SolicitanteDesligamento, Gestor, MotivoDesligamento, Contrato, MATRIZ, SVC, Escala, StatusDesligamento, REGIAO';


    let queryPendentes = supabase
        .from('Colaboradores')
        .select(colunas)
        .in('StatusDesligamento', ['PENDENTE', 'RECUSADO'])
        .in('Ativo', ['SIM', 'PEN']);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let queryConcluidos = supabase
        .from('Colaboradores')
        .select(colunas)
        .eq('StatusDesligamento', 'CONCLUIDO')
        .eq('Ativo', 'NÃO')
        .gte('DataDesligamentoSolicitada', sevenDaysAgo);

    if (matrizesPermitidas) {
        queryPendentes = queryPendentes.in('MATRIZ', matrizesPermitidas);
        queryConcluidos = queryConcluidos.in('MATRIZ', matrizesPermitidas);
    }
    if (state.matriz) {
        queryPendentes = queryPendentes.eq('MATRIZ', state.matriz);
        queryConcluidos = queryConcluidos.eq('MATRIZ', state.matriz);
    }
    if (state.regiao) {
        queryPendentes = queryPendentes.eq('REGIAO', state.regiao);
        queryConcluidos = queryConcluidos.eq('REGIAO', state.regiao);
    }

    const [
        {data: pendentesRaw, error: pendentesError},
        {data: concluidos, error: concluidosError}
    ] = await Promise.all([
        queryPendentes,
        queryConcluidos.order('DataDesligamentoSolicitada', {ascending: false})
    ]);

    if (pendentesError || concluidosError) {
        const error = pendentesError || concluidosError;
        console.error('Erro ao buscar solicitações de desligamento:', error);
        tbody.innerHTML = `<tr><td colspan="11" class="text-center p-4 text-red-500">Erro ao carregar: ${error.message}</td></tr>`;
        return;
    }


    let pendentes = pendentesRaw || [];
    pendentes.sort((a, b) => {

        if (a.StatusDesligamento === 'PENDENTE' && b.StatusDesligamento !== 'PENDENTE') return -1;
        if (a.StatusDesligamento !== 'PENDENTE' && b.StatusDesligamento === 'PENDENTE') return 1;


        const dateA = new Date(a.DataDesligamentoSolicitada || 0);
        const dateB = new Date(b.DataDesligamentoSolicitada || 0);
        return dateA - dateB;
    });

    let allItems = [...pendentes, ...(concluidos || [])];

    if (state.gerencia) {
        allItems = allItems.filter(c => {
            const svcNorm = norm(c.SVC).replace(/\s+/g, '');
            const mInfo = matrizesMap.get(svcNorm);
            return mInfo && mInfo.GERENCIA === state.gerencia;
        });
    }
    state.desligamentoModule.pendentes = allItems;
    desligamento_renderTable();
}

function desligamento_renderTable() {
    const tbody = state.desligamentoModule.tbody;
    if (!tbody) return;
    if (state.desligamentoModule.pendentes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center p-4">Nenhuma solicitação pendente ou recente encontrada.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    state.desligamentoModule.pendentes.forEach(colab => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-nome', colab.Nome);
        let actionsHtml = '';
        let statusClass = '';
        const isKN = (colab.Contrato || '').trim().toUpperCase() === 'KN';
        const diasSla = desligamento_calcularSLA(colab.DataDesligamentoSolicitada, colab.DataRetorno);
        let slaDisplay = '-';
        let slaStyle = '';
        if (diasSla !== null) {
            let sufixo = 'Dias';
            if (diasSla === 0 || diasSla === 1) {
                sufixo = diasSla === 0 ? 'dia' : 'Dia';
            }
            slaDisplay = `${diasSla} ${sufixo}`;
            if (colab.StatusDesligamento === 'PENDENTE') {
                if (diasSla >= 4) {
                    slaStyle = 'color: #dc2626; font-weight: 800;';
                } else if (diasSla >= 2) {
                    slaStyle = 'color: #d97706; font-weight: 700;';
                } else {
                    slaStyle = 'color: #15803d; font-weight: 600;';
                }
            } else {
                slaStyle = 'color: #4b5563; font-weight: 500; font-style: italic;';
            }
        }
        if (!state.isUserRH) {
            switch (colab.StatusDesligamento) {
                case 'PENDENTE':
                    statusClass = 'row-pending';
                    actionsHtml = '<span class="text-xs text-gray-500 italic">Aguardando RH</span>';
                    break;
                case 'CONCLUIDO':
                    statusClass = 'row-completed';
                    actionsHtml = '<span class="text-xs text-green-600 font-bold">Concluído</span>';
                    break;
                case 'RECUSADO':
                    statusClass = 'row-rejected';
                    actionsHtml = '<span class="text-xs text-red-600 font-bold">Recusado</span>';
                    break;
            }
        } else {
            const btnDeleteStyle = `
                width: 28px; 
                height: 28px; 
                border-radius: 50%; 
                background-color: #ef4444; 
                color: white; 
                border: none; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                cursor: pointer;
                transition: background 0.2s;
            `;
            const btnDeleteIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
            switch (colab.StatusDesligamento) {
                case 'PENDENTE':
                    statusClass = 'row-pending';
                    const btnAprovarAction = isKN ? 'approve-direct-kn' : 'approve';
                    const btnLabel = isKN ? 'Desligar KN' : 'Aprovar';
                    const btnColor = isKN ? 'background-color: #4338ca;' : '';
                    actionsHtml = `
                        <div style="display:flex; align-items:center; gap:6px;">
                            <button data-action="${btnAprovarAction}" data-nome="${colab.Nome}" style="${btnColor}" class="btn-salvar text-xs !px-2 !py-1">${btnLabel}</button>
                            <button data-action="reject" data-nome="${colab.Nome}" class="btn-cancelar text-xs !px-2 !py-1">Recusar</button>
                            <button data-action="delete-request" data-nome="${colab.Nome}" style="${btnDeleteStyle}" title="Excluir solicitação">
                                ${btnDeleteIcon}
                            </button>
                        </div>
                    `;
                    break;
                case 'CONCLUIDO':
                    statusClass = 'row-completed';
                    if (!isKN) {
                        actionsHtml = `
                            <button data-action="resend" data-nome="${colab.Nome}" class="btn-neutral text-xs !px-2 !py-1" title="Reenviar e-mail">Reenviar</button>
                        `;
                    } else {
                        actionsHtml = `<span class="text-gray-500 text-xs font-semibold">Concluído (KN)</span>`;
                    }
                    break;
                case 'RECUSADO':
                    statusClass = 'row-rejected';
                    actionsHtml = `
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="text-red-600 font-semibold text-xs mr-2">Recusado</span>
                            <button data-action="delete-request" data-nome="${colab.Nome}" style="${btnDeleteStyle}" title="Excluir registro">
                                ${btnDeleteIcon}
                            </button>
                        </div>
                    `;
                    break;
                default:
                    actionsHtml = 'N/A';
            }
        }
        if (statusClass) tr.classList.add(statusClass);
        const smartoffDisplay = colab.Smartoff ? `<span class="font-mono font-bold text-blue-700">${colab.Smartoff}</span>` : '-';
        const dtSolicitada = formatDateTimeLocal(colab.DataDesligamentoSolicitada);
        const dtRetornoRH = formatDateTimeLocal(colab.DataRetorno);
        tr.innerHTML = `
            <td data-label="Colaborador">${colab.Nome}</td>
            <td data-label="Smartoff">${smartoffDisplay}</td> 
            <td data-label="Data Solicitada" style="white-space: nowrap;">${dtSolicitada}</td>
            <td data-label="Retorno RH" style="white-space: nowrap; font-weight:bold; color:#555;">${dtRetornoRH}</td>
            <td data-label="SLA" style="${slaStyle}">${slaDisplay}</td>
            <td data-label="Solicitante">${colab.SolicitanteDesligamento || 'N/A'}</td>
            <td data-label="Gestor Vinculado">${colab.Gestor || 'N/A'}</td>
            <td data-label="Motivo">${colab.MotivoDesligamento || 'N/A'}</td>
            <td data-label="Contrato">${colab.Contrato || 'N/A'}</td>
            <td data-label="MATRIZ">${colab.MATRIZ || 'N/A'}</td>
            <td data-label="Ações">${actionsHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

function desligamento_handleTableClick(event) {
    const target = event.target.closest('button');
    if (!target) return;
    const action = target.dataset.action;
    const nome = target.dataset.nome;
    state.desligamentoModule.colaboradorAtual = state.desligamentoModule.pendentes.find(c => c.Nome === nome);
    if (!state.desligamentoModule.colaboradorAtual) {
        alert('Erro: Colaborador não encontrado na lista de pendentes/recentes.');
        return;
    }
    if (action === 'approve' || action === 'resend') {
        desligamento_openApproveModal();
    } else if (action === 'approve-direct-kn') {
        desligamento_handleDirectKN();
    } else if (action === 'reject') {
        desligamento_handleReject();
    } else if (action === 'delete-request') {
        desligamento_handleDeleteRequest();
    }
}

async function desligamento_handleDeleteRequest() {
    const mod = state.desligamentoModule;
    if (!mod.colaboradorAtual) return;
    const ok = await window.customConfirm(
        `Tem certeza que deseja <b>EXCLUIR</b> a solicitação de desligamento de <b>${mod.colaboradorAtual.Nome}</b>?<br><br>` +
        `Isso irá limpar todos os dados do desligamento (Data, Motivo, Smartoff, etc) e o colaborador voltará ao status normal (ATIVO).`,
        'Excluir Solicitação',
        'danger'
    );
    if (!ok) return;
    const {error} = await supabase
        .from('Colaboradores')
        .update({
            StatusDesligamento: 'ATIVO',
            DataDesligamentoSolicitada: null,
            MotivoDesligamento: null,
            SolicitanteDesligamento: null,
            Smartoff: null,
            DataRetorno: null
        })
        .eq('Nome', mod.colaboradorAtual.Nome);
    if (error) {
        console.error('Erro ao excluir solicitação:', error);
        await window.customAlert('Erro ao excluir solicitação: ' + error.message, 'Erro');
        return;
    }
    await window.customAlert('Solicitação excluída e dados limpos com sucesso!', 'Sucesso');
    logAction(`Excluiu/Limpou solicitação de desligamento de: ${mod.colaboradorAtual.Nome}`);
    invalidateCache();
    desligamento_fetchPendentes();
}

async function desligamento_handleDirectKN() {
    const mod = state.desligamentoModule;
    const colab = mod.colaboradorAtual;
    if (!colab) return;
    let dataFinalParaBanco = ymdToday();
    if (colab.MotivoDesligamento) {
        const match = colab.MotivoDesligamento.match(/Data Prevista: (\d{2}\/\d{2}\/\d{4})/);
        if (match && match[1]) {
            dataFinalParaBanco = match[1].split('/').reverse().join('-');
        } else if (colab.DataDesligamentoSolicitada) {
            dataFinalParaBanco = colab.DataDesligamentoSolicitada.split('T')[0];
        }
    }
    const confirmMsg = `Confirma o desligamento <b>IMEDIATO</b> de <b>${colab.Nome}</b>?<br><br>` +
        `Data considerada: <b>${formatDateLocal(dataFinalParaBanco)}</b>`;
    const ok = await window.customConfirm(confirmMsg, 'Desligar KN', 'danger');
    if (!ok) return;
    const btn = document.querySelector(`button[data-action="approve-direct-kn"][data-nome="${colab.Nome}"]`);
    const originalText = btn ? btn.textContent : '';
    if (btn) {
        btn.textContent = 'Processando...';
        btn.disabled = true;
    }
    try {
        const {data: colabCompleto, error: fetchError} = await supabase
            .from('Colaboradores')
            .select('*')
            .eq('Nome', colab.Nome)
            .single();
        if (fetchError || !colabCompleto) {
            throw new Error('Erro ao buscar dados do colaborador: ' + (fetchError?.message || 'Não encontrado'));
        }
        const periodoTrabalhado = desligamento_calcularPeriodoTrabalhado(colabCompleto['Data de admissão'], dataFinalParaBanco);
        const dataHoraDecisao = getLocalISOString(new Date());
        const desligadoData = {
            Nome: colab.Nome,
            Contrato: colab.Contrato || null,
            Cargo: colabCompleto.Cargo || null,
            'Data de Admissão': colabCompleto['Data de admissão'] || null,
            Gestor: colab.Gestor || null,
            'Data de Desligamento': dataFinalParaBanco,
            'Período Trabalhado': periodoTrabalhado,
            Escala: colab.Escala || null,
            SVC: colab.SVC || null,
            MATRIZ: colab.MATRIZ || null,
            Motivo: colab.MotivoDesligamento || null,
            SolicitanteDesligamento: colab.SolicitanteDesligamento || null,
            AprovadorDesligamento: mod.currentUser || 'RH (Sistema)',
            DataRetorno: dataHoraDecisao
        };
        const {error: rpcError} = await supabase.rpc('aprovar_desligamento_atomic', {
            p_nome: colab.Nome,
            p_payload_desligado: desligadoData
        });
        if (rpcError) {
            throw new Error(`Erro RPC: ${rpcError.message}`);
        }
        await window.customAlert(`Colaborador KN (${colab.Nome}) desligado com sucesso!`, 'Sucesso');
        logAction(`Aprovou desligamento KN (Direto): ${colab.Nome} (Data Saída: ${formatDateLocal(dataFinalParaBanco)})`);
        invalidateCache();
        desligamento_fetchPendentes();
    } catch (err) {
        console.error(err);
        await window.customAlert('Falha ao desligar: ' + err.message, 'Erro');
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}

async function desligamento_openApproveModal() {
    const mod = state.desligamentoModule;
    if (!mod.modal || !mod.colaboradorAtual) return;
    const colab = mod.colaboradorAtual;
    const isResend = colab.StatusDesligamento === 'CONCLUIDO';
    mod.currentAttachment = null;
    document.getElementById('approveNome').textContent = colab.Nome;
    document.getElementById('approveSolicitante').textContent = colab.SolicitanteDesligamento || 'N/A';
    document.getElementById('approveGestor').textContent = colab.Gestor || 'N/A';
    document.getElementById('approveSVC').textContent = colab.SVC || 'N/A';
    document.getElementById('approveDataSolicitacao').textContent = formatDateTimeLocal(colab.DataDesligamentoSolicitada);
    const dateInput = document.getElementById('approveDataInput');
    const rhInput = document.getElementById('approveRH');
    const emailInput = document.getElementById('approveEmails');
    const bodyInput = document.getElementById('approveBody');
    const submitBtn = mod.submitBtn;
    let dataAlvo = null;
    if (isResend) {
        dateInput.value = '';
    } else {
        if (colab.MotivoDesligamento) {
            const match = colab.MotivoDesligamento.match(/Data Prevista:\s*(\d{2}\/\d{2}\/\d{4})/i);
            if (match && match[1]) {
                dataAlvo = match[1].split('/').reverse().join('-');
            }
        }
        if (!dataAlvo && colab.DataDesligamentoSolicitada) {
            dataAlvo = colab.DataDesligamentoSolicitada.split('T')[0];
        }
        if (!dataAlvo) {
            dataAlvo = ymdToday();
        }
        dateInput.value = dataAlvo;
    }
    if (!isResend && rhInput) rhInput.value = mod.currentUser || '';
    if (isResend && rhInput && !rhInput.value) rhInput.value = mod.currentUser || '';
    const nomeAprovador = rhInput.value || mod.currentUser || 'RH';
    const dataVisual = dataAlvo ? formatDateLocal(dataAlvo) : 'DATA_A_DEFINIR';
    let templateBody = `Olá, prezado(a)\n\nKNConecta solicita o desligamento do colaborador abaixo:\n\n` +
        `COLABORADOR: ${colab.Nome}\n` +
        `PARA A DATA: ${dataVisual}\n` +
        `MOTIVO: ${colab.MotivoDesligamento || 'N/A'}\n` +
        `SOLICITADO PELA GESTÃO: ${colab.Gestor || 'N/A'}\n` +
        `APROVADO POR: ${nomeAprovador}\n` +
        `MATRIZ: ${colab.MATRIZ || 'N/A'}\n\n`;
    bodyInput.value = templateBody + "Carregando dados de absenteísmo...";
    if (isResend) submitBtn.textContent = 'Reenviar E-mail';
    else submitBtn.textContent = 'Confirmar e Enviar E-mail';
    emailInput.value = 'Carregando e-mails sugeridos...';
    emailInput.disabled = true;
    submitBtn.disabled = true;
    try {
        const [emailsAuto, absData] = await Promise.all([
            desligamento_fetchEmailsSugestao(colab.Contrato),
            desligamento_prepararDadosAbsenteismo(colab.Nome)
        ]);
        emailInput.value = emailsAuto;
        let absTexto = "";
        if (absData && absData.stats) {
            absTexto = `Resumo Absenteísmo (Últimos 45 dias):\n` +
                `Injustificado: ${absData.stats.injustificado}\n` +
                `Justificado: ${absData.stats.justificado}\n\n` +
                `*Segue em anexo o relatório detalhado de absenteísmo.*`;
            if (absData.attachment) {
                mod.currentAttachment = absData.attachment;
            }
        } else {
            absTexto = "Não foi possível recuperar dados de absenteísmo recentes.";
        }
        bodyInput.value = templateBody + absTexto +
            `\n\n--\nE-mail gerado automático pelo sistema, qualquer dúvida entre em contato com o RH.`;
    } catch (error) {
        console.error("Erro ao carregar dados:", error);
        emailInput.value = '';
        bodyInput.value = templateBody + `\n\n--\nE-mail gerado automático.`;
    } finally {
        emailInput.disabled = false;
        submitBtn.disabled = false;
        if (isResend) emailInput.focus();
    }
    dateInput.onchange = () => {
        if (dateInput.value) {
            const novaDataFmt = formatDateLocal(dateInput.value);
            bodyInput.value = bodyInput.value.replace(/PARA A DATA: .*/, `PARA A DATA: ${novaDataFmt}`);
        }
    };
    mod.modal.classList.remove('hidden');
}

function desligamento_closeApproveModal() {
    const mod = state.desligamentoModule;
    if (!mod.modal) return;
    mod.modal.classList.add('hidden');
    if (mod.form) mod.form.reset();
    mod.colaboradorAtual = null;
}

async function desligamento_handleReject() {
    const mod = state.desligamentoModule;
    if (!mod.colaboradorAtual) return;
    const motivoRecusa = prompt('Qual o motivo da recusa? (Isso será registrado no log)');
    if (motivoRecusa === null) return;
    const ok = await window.customConfirm(
        `Tem certeza que deseja <b>RECUSAR</b> o desligamento de <b>${mod.colaboradorAtual.Nome}</b>?`,
        'Confirmar Recusa',
        'warning'
    );
    if (!ok) return;
    const dataHoraDecisao = getLocalISOString(new Date());
    const {error} = await supabase
        .from('Colaboradores')
        .update({
            StatusDesligamento: 'RECUSADO',
            DataRetorno: dataHoraDecisao
        })
        .eq('Nome', mod.colaboradorAtual.Nome);
    if (error) {
        await window.customAlert('Erro ao recusar solicitação: ' + error.message, 'Erro');
        return;
    }
    await window.customAlert('Solicitação recusada com sucesso.', 'Sucesso');
    logAction(`Recusou o desligamento de: ${mod.colaboradorAtual.Nome}. Motivo: ${motivoRecusa || 'N/A'}`);
    invalidateCache();
    desligamento_fetchPendentes();
}

function desligamento_calcularPeriodoTrabalhado(dataAdmissao, dataDesligamento) {
    if (!dataAdmissao) return '0';
    const inicio = new Date(dataAdmissao);
    const fim = new Date(dataDesligamento);
    if (isNaN(inicio.getTime())) return '0';
    const inicioUTC = Date.UTC(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
    const fimUTC = Date.UTC(fim.getFullYear(), fim.getMonth(), fim.getDate());
    const dias = Math.floor((fimUTC - inicioUTC) / (1000 * 60 * 60 * 24));
    if (dias < 0) return 'Data inválida';
    if (dias === 0) return '0';
    if (dias <= 15) return `${dias} dia(s)`;
    let meses = (fim.getFullYear() - inicio.getFullYear()) * 12;
    meses -= inicio.getMonth();
    meses += fim.getMonth();
    const anos = Math.floor(meses / 12);
    const mesesRestantes = meses % 12;
    if (meses < 1) return 'Menos de 1 mês';
    if (meses < 2) return '1 mês';
    if (anos > 0) return mesesRestantes > 0 ? `${anos} ano(s) e ${mesesRestantes} mes(es)` : `${anos} ano(s)`;
    return `${meses} mes(es)`;
}

async function desligamento_handleApproveSubmit(event) {
    event.preventDefault();
    const mod = state.desligamentoModule;
    if (!mod.colaboradorAtual) return;
    const submitBtn = mod.submitBtn;
    submitBtn.disabled = true;
    const colab = mod.colaboradorAtual;
    const nomeRH = document.getElementById('approveRH').value.trim();
    const emails = document.getElementById('approveEmails').value.trim();
    const emailBodyContent = document.getElementById('approveBody').value;
    const dataEfetivaInput = document.getElementById('approveDataInput').value;
    const isResend = colab.StatusDesligamento === 'CONCLUIDO';
    submitBtn.textContent = isResend ? 'Enviando E-mail...' : 'Processando...';
    if (!nomeRH) {
        await window.customAlert('Por favor, preencha o campo "Aprovado por (RH)".', 'Campo Obrigatório');
        submitBtn.disabled = false;
        return;
    }
    if (!isResend && !dataEfetivaInput) {
        await window.customAlert('Por favor, confirme a Data Efetiva do Desligamento.', 'Campo Obrigatório');
        submitBtn.disabled = false;
        return;
    }
    if (!emails) {
        await window.customAlert('Por favor, preencha os E-mails para notificar.', 'Campo Obrigatório');
        submitBtn.disabled = false;
        return;
    }
    try {
        let dataDesligamentoFinal = dataEfetivaInput;
        if (isResend) {
            const {data: colabCompleto} = await supabase.from('Desligados').select('*').eq('Nome', colab.Nome).single();
            if (colabCompleto) dataDesligamentoFinal = colabCompleto['Data de Desligamento'];
        }
        if (!isResend) {
            submitBtn.textContent = 'Aprovando no banco...';
            const {
                data: colabCompleto,
                error: fetchError
            } = await supabase.from('Colaboradores').select('*').eq('Nome', colab.Nome).single();
            if (fetchError || !colabCompleto) throw fetchError || new Error('Colaborador não encontrado.');
            const periodoTrabalhado = desligamento_calcularPeriodoTrabalhado(colabCompleto['Data de admissão'], dataDesligamentoFinal);
            const dataHoraDecisao = getLocalISOString(new Date());
            const desligadoData = {
                Nome: colab.Nome,
                Contrato: colab.Contrato || null,
                Cargo: colabCompleto.Cargo || null,
                'Data de Admissão': colabCompleto['Data de admissão'] || null,
                Gestor: colab.Gestor || null,
                'Data de Desligamento': dataDesligamentoFinal,
                'Período Trabalhado': periodoTrabalhado,
                Escala: colab.Escala || null,
                SVC: colab.SVC || null,
                MATRIZ: colab.MATRIZ || null,
                Motivo: colab.MotivoDesligamento || null,
                SolicitanteDesligamento: colab.SolicitanteDesligamento || null,
                AprovadorDesligamento: nomeRH,
                DataRetorno: dataHoraDecisao
            };
            const {error: rpcError} = await supabase.rpc('aprovar_desligamento_atomic', {
                p_nome: colab.Nome,
                p_payload_desligado: desligadoData
            });
            if (rpcError) throw new Error(`Erro ao processar no banco: ${rpcError.message}`);
            logAction(`Aprovou desligamento (E-mail): ${colab.Nome}`);
            invalidateCache();
        }
        submitBtn.textContent = 'Enviando e-mail...';
        const emailPayload = {
            to: emails,
            subject: `SOLICITAÇÃO DE DESLIGAMENTO - COLABORADOR: ${colab.Nome}`,
            body: emailBodyContent
        };
        if (mod.currentAttachment) {
            emailPayload.attachments = [mod.currentAttachment];
        }
        const {data: fnData, error: emailError} = await supabase.functions.invoke('send-email', {
            body: JSON.stringify(emailPayload)
        });
        if (emailError) {
            let msg = emailError.message;
            try {
                if (fnData && JSON.parse(fnData).error) msg = JSON.parse(fnData).error;
            } catch (e) {
            }
            await window.customAlert(`Salvo, mas erro ao enviar e-mail: ${msg}`, 'Alerta');
        } else {
            await window.customAlert('Processo concluído com sucesso!', 'Sucesso');
        }
        if (isResend) logAction(`Reenviou e-mail de desligamento para: ${colab.Nome}`);
        desligamento_closeApproveModal();
        desligamento_fetchPendentes();
    } catch (error) {
        console.error('Erro no fluxo:', error);
        await window.customAlert('Falha no processo: ' + error.message, 'Erro Crítico');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isResend ? 'Reenviar E-mail' : 'Confirmar e Enviar E-mail';
    }
}

function wireDesligamentoLogic() {
    const mod = state.desligamentoModule;
    mod.tbody = document.getElementById('desligamento-tbody');
    mod.modal = document.getElementById('approveModal');
    mod.form = document.getElementById('approveForm');
    mod.submitBtn = document.getElementById('approveSubmitBtn');
    mod.cancelBtn = document.getElementById('approveCancelBtn');
    mod.refreshBtn = document.getElementById('refresh-desligamento-btn');
    mod.currentUser = desligamento_getCurrentUser();
    if (mod.tbody) {
        mod.tbody.addEventListener('click', desligamento_handleTableClick);
    }
    if (mod.form) {
        mod.form.addEventListener('submit', desligamento_handleApproveSubmit);
    }
    if (mod.cancelBtn) {
        mod.cancelBtn.addEventListener('click', desligamento_closeApproveModal);
    }
    if (mod.refreshBtn) {
        mod.refreshBtn.addEventListener('click', desligamento_fetchPendentes);
    }
    const rhInput = document.getElementById('approveRH');
    if (rhInput) {
        rhInput.addEventListener('input', () => {
            rhInput.value = rhInput.value.toUpperCase();
        });
    }
}

function desligamento_destroy() {
    const mod = state.desligamentoModule;
    console.log('Destruindo módulo de Desligamento...');
    if (mod.tbody) {
        mod.tbody.removeEventListener('click', desligamento_handleTableClick);
        mod.tbody.innerHTML = '';
    }
    if (mod.form) {
        mod.form.removeEventListener('submit', desligamento_handleApproveSubmit);
    }
    if (mod.cancelBtn) {
        mod.cancelBtn.removeEventListener('click', desligamento_closeApproveModal);
    }
    if (mod.refreshBtn) {
        mod.refreshBtn.removeEventListener('click', desligamento_fetchPendentes);
    }
    mod.pendentes = [];
    mod.colaboradorAtual = null;
    mod.tbody = null;
    mod.modal = null;
    mod.form = null;
}

function checkUserRHStatus() {
    try {
        const userDataString = localStorage.getItem('userSession');
        if (userDataString) {
            const user = JSON.parse(userDataString);
            const userType = (user?.Tipo || '').trim().toUpperCase();
            const allowedTypes = ['RH', 'GERENTE', 'MASTER'];
            state.isUserRH = allowedTypes.includes(userType);
            console.log(`Usuário é ${userType}. Permissão de desligamento: ${state.isUserRH}`);
        } else {
            state.isUserRH = false;
        }
    } catch (e) {
        console.warn('Erro ao verificar tipo de usuário (RH/Gerente/Master):', e);
        state.isUserRH = false;
    }
}

export async function init() {
    const host = document.querySelector(HOST_SEL);
    if (!host) {
        console.warn('Host #hc-indice não encontrado.');
        return;
    }
    checkUserRHStatus();
    if (!state.mounted) {
        ensureMounted();
        wireSubtabs();
        wireDesligamentoLogic();
        initControleVagas();
    }
    const desligamentoSubtab = document.querySelector('.efet-subtab-btn[data-view="efet-desligamento"]');
    if (desligamentoSubtab) {
        desligamentoSubtab.style.display = '';
    }
    const activeSubtabBtn = host.querySelector('.efet-subtab-btn.active') || host.querySelector('.efet-subtab-btn[data-view="efet-visao-service"]');
    if (activeSubtabBtn) {
        const viewName = activeSubtabBtn.dataset.view;
        const view = host.querySelector(`#${viewName}`);
        host.querySelectorAll('.efet-view').forEach(v => v.classList.remove('active'));
        if (view) view.classList.add('active');
        activeSubtabBtn.classList.add('active');
        const scrollContainer = document.querySelector('.container');
        if (scrollContainer) {
            if (viewName === 'efet-em-efetivacao' || viewName === 'efet-desligamento') {
                scrollContainer.classList.add('travar-scroll-pagina');
            } else {
                scrollContainer.classList.remove('travar-scroll-pagina');
            }
        }
        await refresh();
    } else {
        await refresh();
    }
}

export function destroy() {
    if (state.mounted) {
        console.log('Destruindo estado de Efetivações.');
        Object.values(state.charts).forEach(chart => chart?.destroy());
        if (_resizeObs) {
            _resizeObs.disconnect();
            _resizeObs = null;
        }
        window.removeEventListener('resize', setResponsiveHeights);
        if (state.isUserRH) {
            desligamento_destroy();
        }
        state.charts = {
            idade: null, genero: null, dsr: null, contrato: null, contratoSvc: null,
            auxPrazoSvc: null, consultoriaSvc: null, idadeRegiao: null, generoRegiao: null, contratoRegiao: null,
            auxPrazoRegiao: null, spamHcEvolucaoSvc: null, spamHcEvolucaoRegiao: null,
            spamHcGerente: null, spamHcVsAux: null
        };
        _filtersPopulated = false;
        state.matriz = '';
        state.gerencia = '';
        state.regiao = '';
        state.colabs = [];
        Object.values(state.interactive).forEach(set => set.clear());
        state.mounted = false;
        state.loading = false;
        state.isUserRH = false;
        document.querySelector('.container')?.classList.remove('travar-scroll-pagina');
    }
}

let vagasData = [];
let matrizesData = [];
let gestoresData = [];
let vagasModal;
let btnGerarVaga;
let btnCancelarVaga;
let formVagas;
let tbodyVagas;
let inputWcBc;
let inputSla;
let inputDataAprovacao;
let inputPrazoRS;
let selectFilial;
let selectGestor;
let inputSvc;
let searchInput;
let filterFilial;
let filterStatus;
let filterGestor;
let filterRecrutadora;
let inputCc;

function initControleVagas() {
    if (!document.getElementById('efet-controle-vagas')) return;
    vagasModal = document.getElementById('vagasModal');
    btnGerarVaga = document.getElementById('btn-gerar-vaga');
    btnCancelarVaga = document.getElementById('btn-cancelar-vaga');
    formVagas = document.getElementById('formVagas');
    tbodyVagas = document.getElementById('vagas-tbody');
    if (btnGerarVaga) {
        if (!state.isUserRH) {
            btnGerarVaga.style.display = 'none';
        } else {
            btnGerarVaga.style.display = '';
            btnGerarVaga.addEventListener('click', () => openVagasModal());
        }
    }
    inputWcBc = formVagas?.querySelector('[name="vagas_wc_bc"]');
    inputSla = formVagas?.querySelector('[name="sla_acordada"]');
    inputDataAprovacao = formVagas?.querySelector('[name="data_aprovacao"]');
    inputPrazoRS = formVagas?.querySelector('[name="prazo_entrega_rs"]');
    selectFilial = formVagas?.querySelector('[name="filial"]');
    selectGestor = formVagas?.querySelector('[name="gestor"]');
    inputSvc = formVagas?.querySelector('[name="svc"]');
    inputCc = formVagas?.querySelector('[name="cc"]');
    searchInput = document.getElementById('vagas-search');
    filterFilial = document.getElementById('filter-vagas-filial');
    filterStatus = document.getElementById('filter-vagas-status');
    filterGestor = document.getElementById('filter-vagas-gestor');
    filterRecrutadora = document.getElementById('filter-vagas-recrutadora');
    fetchMatrizes();
    fetchGestores();
    populateOptionsTamanhos('vaga_sapato', 'vaga_colete');
    if (btnCancelarVaga) btnCancelarVaga.addEventListener('click', closeVagasModal);
    if (formVagas) formVagas.addEventListener('submit', handleVagaSubmit);
    if (selectFilial) {
        selectFilial.addEventListener('change', (e) => {
            const matrizSelecionada = e.target.value;
            atualizarSVC(matrizSelecionada);
            atualizarCC(matrizSelecionada);
            filtrarGestoresPorMatriz(matrizSelecionada);
        });
    }
    if (inputWcBc) inputWcBc.addEventListener('change', calcularSLA);
    if (inputSla) inputSla.addEventListener('change', calcularPrazoEntrega);
    if (inputDataAprovacao) inputDataAprovacao.addEventListener('change', calcularPrazoEntrega);
    if (searchInput) searchInput.addEventListener('input', filtrarVagas);
    if (filterFilial) filterFilial.addEventListener('change', filtrarVagas);
    if (filterStatus) filterStatus.addEventListener('change', filtrarVagas);
    if (filterGestor) filterGestor.addEventListener('change', filtrarVagas);
    if (filterRecrutadora) filterRecrutadora.addEventListener('change', filtrarVagas);
    fetchVagas();
    wireCepVagas();
}

async function fetchMatrizes() {
    const {data, error} = await supabase
        .from('Matrizes')
        .select('MATRIZ, SERVICE, CC, GERENCIA, REGIAO')
        .order('MATRIZ', {ascending: true});
    if (error) {
        console.error('Erro ao buscar matrizes:', error);
        return;
    }
    matrizesData = data || [];
    populateFilialSelect();
}

function atualizarCC(nomeMatriz) {
    if (!inputCc) return;
    if (!nomeMatriz) {
        inputCc.value = '';
        return;
    }
    const encontrada = matrizesData.find(m => m.MATRIZ === nomeMatriz);
    inputCc.value = encontrada ? (encontrada.CC || '-') : '';
}

async function fetchGestores() {
    const {data, error} = await supabase
        .from('Gestores')
        .select('NOME, MATRIZ')
        .order('NOME', {ascending: true});
    if (error) {
        console.error('Erro ao buscar gestores:', error);
        return;
    }
    gestoresData = data || [];
}

function populateFilialSelect() {
    if (!selectFilial) return;
    selectFilial.innerHTML = '<option value="">- Selecione uma Matriz -</option>';
    const matrizesUnicas = [...new Set(matrizesData.map(item => item.MATRIZ).filter(Boolean))].sort();
    matrizesUnicas.forEach(matrizNome => {
        const option = document.createElement('option');
        option.value = matrizNome;
        option.textContent = matrizNome;
        selectFilial.appendChild(option);
    });
}

function atualizarSVC(nomeMatriz) {
    if (!inputSvc) return;
    if (!nomeMatriz) {
        inputSvc.value = '';
        return;
    }
    const encontrada = matrizesData.find(m => m.MATRIZ === nomeMatriz);
    inputSvc.value = encontrada ? (encontrada.SERVICE || '-') : '';
}

function filtrarGestoresPorMatriz(nomeMatriz, gestorPreSelecionado = null) {
    if (!selectGestor) return;
    selectGestor.innerHTML = '<option value="">- Selecione um Gestor -</option>';
    if (!nomeMatriz) return;
    const gestoresFiltrados = gestoresData.filter(g =>
        g.MATRIZ && g.MATRIZ.toUpperCase() === nomeMatriz.toUpperCase()
    );
    gestoresFiltrados.forEach(g => {
        const option = document.createElement('option');
        option.value = g.NOME;
        option.textContent = g.NOME;
        selectGestor.appendChild(option);
    });
    if (gestorPreSelecionado) {
        selectGestor.value = gestorPreSelecionado;
    }
}

function formatCargo(cargo) {
    if (!cargo) return '-';
    return cargo
        .replace('OPERADOR DE EMPILHADEIRA', 'OP. EMPILHADEIRA')
        .replace('OPERAÇÕES LOGÍSTICAS', 'OP. LOG.')
        .replace('RECURSOS HUMANOS', 'RH')
        .replace('MELHORIA CONTÍNUA', 'MELHORIA CONT.')
        .replace('SEGURANÇA DO TRABALHO', 'SEG. TRAB.')
        .replace('ADMINISTRATIVO', 'ADM.')
        .replace('PLANEJAMENTO DE LOGÍSTICA', 'PLAN. LOG.');
}

function calcularSLA() {
    const tipo = inputWcBc.value;
    if (tipo === 'WC') inputSla.value = 17;
    else if (tipo === 'BC') inputSla.value = 12;
    else inputSla.value = 12;
    calcularPrazoEntrega();
}

function calcularPrazoEntrega() {
    const dataAprov = inputDataAprovacao.value;
    const diasSla = parseInt(inputSla.value);
    if (dataAprov && !isNaN(diasSla)) {
        const data = new Date(dataAprov);
        data.setDate(data.getDate() + diasSla + 1);
        const yyyy = data.getFullYear();
        const mm = String(data.getMonth() + 1).padStart(2, '0');
        const dd = String(data.getDate()).padStart(2, '0');
        inputPrazoRS.value = `${yyyy}-${mm}-${dd}`;
    }
}

function openVagasModal(vagaData = null) {
    if (!vagasModal) return;
    vagasModal.classList.remove('hidden');
    formVagas.reset();
    formVagas.querySelectorAll('select').forEach(sel => {
        if (sel.name !== 'filial' && sel.id !== 'vaga_sapato' && sel.id !== 'vaga_colete') {
            sel.value = "";
        }
    });
    selectFilial.value = "";
    selectGestor.innerHTML = '<option value="">- Selecione um Gestor -</option>';
    inputSvc.value = "";
    if (inputCc) inputCc.value = "";
    populateOptionsTamanhos('vaga_sapato', 'vaga_colete');
    if (document.getElementById('div-substituido')) {
        document.getElementById('div-substituido').classList.add('hidden');
    }
    if (vagaData) {
        document.getElementById('modal-title').textContent = `Editar Vaga #${vagaData.ID_Vaga}`;
        formVagas.dataset.mode = 'edit';
        formVagas.dataset.id = vagaData.ID_Vaga;
        const f = formVagas.elements;
        if (f.status) f.status.value = vagaData.Status || '';
        if (f.data_aprovacao) f.data_aprovacao.value = vagaData.DataAprovacao || '';
        if (f.data_inicio_desejado) f.data_inicio_desejado.value = vagaData.DataInicioDesejado || '';
        if (f.fluxo_smart) f.fluxo_smart.value = vagaData.FluxoSmart || '';
        if (f.cargo) f.cargo.value = vagaData.Cargo || '';
        if (f.filial) {
            f.filial.value = vagaData.MATRIZ || '';
            atualizarSVC(vagaData.MATRIZ);
            atualizarCC(vagaData.MATRIZ);
            filtrarGestoresPorMatriz(vagaData.MATRIZ, vagaData.Gestor);
        }
        if (f.cliente) f.cliente.value = vagaData.Cliente || '';
        if (f.setor) f.setor.value = vagaData.Setor || '';
        if (f.tipo_contrato) f.tipo_contrato.value = vagaData.TipoContrato || '';
        if (f.recrutadora) f.recrutadora.value = vagaData.Recrutadora || '';
        if (f.vagas_wc_bc) f.vagas_wc_bc.value = vagaData.Vagas_WC_BC || '';
        if (f.motivo_vaga) f.motivo_vaga.value = vagaData.Motivo || '';
        if (f.pcd) f.pcd.value = vagaData.PCD || 'NÃO';
        if (f.colaborador_substituido) f.colaborador_substituido.value = vagaData.ColaboradorSubstituido || '';
        if (f.fonte_recrutamento) f.fonte_recrutamento.value = vagaData.FonteRecrutamento || '';
        if (f.empresa_contrato) f.empresa_contrato.value = vagaData.EmpresaContratante || '';
        if (f.hora_entrada) f.hora_entrada.value = vagaData.HoraEntrada || '';
        if (f.hora_saida) f.hora_saida.value = vagaData.HoraSaida || '';
        if (f.dias_semana) f.dias_semana.value = vagaData.DiasSemana || '';
        if (f.jornada_tipo) f.jornada_tipo.value = vagaData.JornadaTipo || '';
        if (f.sla_acordada) f.sla_acordada.value = vagaData.SLA_Acordada || '';
        if (f.prazo_entrega_rs) f.prazo_entrega_rs.value = vagaData.PrazoEntregaRS || '';
        if (f.data_encaminhado_admissao) f.data_encaminhado_admissao.value = vagaData.DataEncaminhadoAdmissao || '';
        if (f.data_admissao_real) f.data_admissao_real.value = vagaData.DataAdmissaoReal || '';
        if (f.candidato_aprovado) f.candidato_aprovado.value = vagaData.CandidatoAprovado || '';
        if (f.data_nascimento_candidato) f.data_nascimento_candidato.value = vagaData.DataNascimento || '';
        if (f.cpf_candidato) f.cpf_candidato.value = vagaData.CPFCandidato || '';
        if (f.rg_candidato) f.rg_candidato.value = vagaData.rg || '';
        if (f.telefone_candidato) f.telefone_candidato.value = vagaData.telefone || '';
        if (f.email_candidato) f.email_candidato.value = vagaData.email || '';
        if (f.pis_candidato) f.pis_candidato.value = vagaData.pis || '';
        if (f.cep_candidato) f.cep_candidato.value = vagaData.CEP || '';
        if (f.endereco_candidato) f.endereco_candidato.value = vagaData.endereco_completo || '';
        if (f.numero_candidato) f.numero_candidato.value = vagaData.numero || '';
        if (f.bairro_candidato) f.bairro_candidato.value = vagaData.bairro || '';
        if (f.cidade_candidato) f.cidade_candidato.value = vagaData.cidade || '';
        if (f.vaga_colete) f.vaga_colete.value = vagaData.colete || '';
        if (f.vaga_sapato) f.vaga_sapato.value = vagaData.sapato || '';
        toggleSubstituicao(vagaData.Motivo);
    } else {
        document.getElementById('modal-title').textContent = 'Gerar Nova Vaga';
        formVagas.dataset.mode = 'create';
        delete formVagas.dataset.id;
    }
}

function closeVagasModal() {
    if (vagasModal) vagasModal.classList.add('hidden');
}

window.toggleSubstituicao = function (val) {
    const div = document.getElementById('div-substituido');
    if (div) {
        if (val === 'SUBSTITUIÇÃO') div.classList.remove('hidden');
        else div.classList.add('hidden');
    }
}

async function fetchVagas() {
    if (!tbodyVagas) return;
    tbodyVagas.innerHTML = '<tr><td colspan="12" class="text-center p-4">Carregando vagas...</td></tr>';
    const {data, error} = await supabase
        .from('Vagas')
        .select('*')
        .order('ID_Vaga', {ascending: false});
    if (error) {
        console.error('Erro ao buscar vagas:', error);
        tbodyVagas.innerHTML = `<tr><td colspan="12" class="text-center text-red-500 p-4">Erro: ${error.message}</td></tr>`;
        return;
    }
    vagasData = data || [];
    populateFilterOptions();
    filtrarVagas();
}

async function handleVagaSubmit(e) {
    e.preventDefault();
    const formData = new FormData(formVagas);
    const raw = Object.fromEntries(formData.entries());
    const mode = formVagas.dataset.mode;
    const id = formVagas.dataset.id;
    const payload = {
        Status: raw.status,
        DataAprovacao: raw.data_aprovacao || null,
        DataInicioDesejado: raw.data_inicio_desejado || null,
        FluxoSmart: raw.fluxo_smart ? parseInt(raw.fluxo_smart) : null,
        Cargo: raw.cargo,
        MATRIZ: raw.filial,
        CentroCusto: raw.cc,
        Cliente: raw.cliente,
        Setor: raw.setor,
        TipoContrato: raw.tipo_contrato,
        Recrutadora: raw.recrutadora,
        Vagas_WC_BC: raw.vagas_wc_bc,
        Gestor: raw.gestor,
        Motivo: raw.motivo_vaga,
        PCD: raw.pcd,
        ColaboradorSubstituido: raw.colaborador_substituido || null,
        FonteRecrutamento: raw.fonte_recrutamento,
        EmpresaContratante: raw.empresa_contrato,
        HoraEntrada: raw.hora_entrada || null,
        HoraSaida: raw.hora_saida || null,
        DiasSemana: raw.dias_semana,
        JornadaTipo: raw.jornada_tipo,
        CandidatoAprovado: toUpperTrim(raw.candidato_aprovado),
        DataNascimento: raw.data_nascimento_candidato || null,
        CPFCandidato: normalizeCPF(raw.cpf_candidato),
        rg: raw.rg_candidato || null,
        telefone: raw.telefone_candidato || null,
        email: raw.email_candidato || null,
        pis: raw.pis_candidato || null,
        CEP: raw.cep_candidato ? raw.cep_candidato.replace(/\D/g, '') : null,
        endereco_completo: toUpperTrim(raw.endereco_candidato),
        numero: raw.numero_candidato || null,
        bairro: toUpperTrim(raw.bairro_candidato),
        cidade: toUpperTrim(raw.cidade_candidato),
        colete: raw.vaga_colete || null,
        sapato: raw.vaga_sapato || null,
        SLA_Acordada: raw.sla_acordada ? parseInt(raw.sla_acordada) : null,
        PrazoEntregaRS: raw.prazo_entrega_rs || null,
        DataEncaminhadoAdmissao: raw.data_encaminhado_admissao || null,
        DataAdmissaoReal: raw.data_admissao_real || null
    };
    const btn = formVagas.querySelector('.btn-salvar');
    const txt = btn.textContent;
    btn.textContent = 'Salvando...';
    btn.disabled = true;
    let error;
    if (mode === 'edit' && id) {
        const res = await supabase.from('Vagas').update(payload).eq('ID_Vaga', id);
        error = res.error;
    } else {
        const res = await supabase.from('Vagas').insert([payload]);
        error = res.error;
    }
    if (error) {
        alert('Erro: ' + error.message);
        btn.textContent = txt;
        btn.disabled = false;
        return;
    }
    alert(mode === 'edit' ? 'Vaga atualizada!' : 'Vaga criada!');
    btn.textContent = txt;
    btn.disabled = false;
    closeVagasModal();
    fetchVagas();
}

function populateFilterOptions() {
    const matrizes = [...new Set(vagasData.map(v => v.MATRIZ).filter(Boolean))].sort();
    const gestores = [...new Set(vagasData.map(v => v.Gestor).filter(Boolean))].sort();
    const recrutadoras = [...new Set(vagasData.map(v => v.Recrutadora).filter(Boolean))].sort();
    const populate = (el, list, label) => {
        if (!el) return;
        const valorAtual = el.value;
        el.innerHTML = `<option value="">${label}</option>`;
        list.forEach(i => el.insertAdjacentHTML('beforeend', `<option value="${i}">${i}</option>`));
        if (list.includes(valorAtual) || valorAtual === "") el.value = valorAtual;
    };
    populate(filterFilial, matrizes, 'Todas as Filiais');
    populate(filterGestor, gestores, 'Todos Gestores');
    populate(filterRecrutadora, recrutadoras, 'Todas Recrutadoras');
}

function filtrarVagas() {
    const termo = searchInput.value.toLowerCase();
    const fFilial = filterFilial.value;
    const fStatus = filterStatus.value;
    const fGestor = filterGestor.value;
    const fRecrut = filterRecrutadora.value;
    const filtrados = vagasData.filter(vaga => {
        const txt = (
            (vaga.CandidatoAprovado || '') +
            (vaga.CPFCandidato || '') +
            (vaga.FluxoSmart || '') +
            (vaga.ID_Vaga || '') +
            (vaga.MATRIZ || '')
        ).toLowerCase();
        const matchLocal = txt.includes(termo) &&
            (!fFilial || vaga.MATRIZ === fFilial) &&
            (!fStatus || vaga.Status === fStatus) &&
            (!fGestor || vaga.Gestor === fGestor) &&
            (!fRecrut || vaga.Recrutadora === fRecrut);
        if (!matchLocal) return false;
        if (state.matriz && vaga.MATRIZ !== state.matriz) {
            return false;
        }
        if (state.gerencia || state.regiao) {
            const dadosMatriz = matrizesData.find(m => m.MATRIZ === vaga.MATRIZ);
            if (!dadosMatriz) {
                return false;
            }
            if (state.gerencia && dadosMatriz.GERENCIA !== state.gerencia) return false;
            if (state.regiao && dadosMatriz.REGIAO !== state.regiao) return false;
        }
        return true;
    });
    renderVagasTable(filtrados);
}

function renderVagasTable(lista) {
    if (!tbodyVagas) return;
    tbodyVagas.innerHTML = '';
    if (lista.length === 0) {
        tbodyVagas.innerHTML = '<tr><td colspan="12" class="text-center p-4">Nenhum registro encontrado.</td></tr>';
        return;
    }
    lista.forEach(vaga => {
        const tr = document.createElement('tr');
        let badgeClass = 'badge-default';
        const st = (vaga.Status || '').trim().toUpperCase();
        if (st === 'ABERTA') badgeClass = 'badge-aberta';
        else if (st === 'EM ADMISSÃO') badgeClass = 'badge-admissao';
        else if (st === 'FECHADA') badgeClass = 'badge-fechada';
        else if (st === 'CANCELADA') badgeClass = 'badge-cancelada';
        let actionsHtml = '';
        if (state.isUserRH) {
            actionsHtml = `
                <button class="btn-edit-vaga btn-neutral text-xs !px-2 !py-1" title="Editar">
                     ✏️
                </button>
            `;
        } else {
            actionsHtml = `<span class="text-gray-400" title="Visualização apenas">👁️</span>`;
        }
        tr.innerHTML = `
             <td style="font-weight:bold; color:#555;">#${vaga.ID_Vaga}</td>
             <td><span class="status-badge ${badgeClass}">${vaga.Status}</span></td>
             <td>${formatDateLocal(vaga.DataAprovacao)}</td>
             <td>${formatDateLocal(vaga.DataInicioDesejado)}</td>
             <td style="font-weight:bold; color:#059669;">${vaga.CandidatoAprovado || '-'}</td>
             <td title="${vaga.Cargo}">${formatCargo(vaga.Cargo)}</td>
             <td>${vaga.Recrutadora || '-'}</td>
             <td>${vaga.MATRIZ || '-'}</td> <td>${vaga.Gestor || '-'}</td>
             <td>${vaga.EmpresaContratante || '-'}</td>
             <td style="color:#d97706; font-weight:600;">${formatDateLocal(vaga.PrazoEntregaRS)}</td>
             <td>${actionsHtml}</td>
         `;
        if (state.isUserRH) {
            const editBtn = tr.querySelector('.btn-edit-vaga');
            if (editBtn) {
                editBtn.addEventListener('click', () => openVagasModal(vaga));
            }
        }
        tbodyVagas.appendChild(tr);
    });
}