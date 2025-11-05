import {getMatrizesPermitidas} from '../session.js';
import {supabase} from '../supabaseClient.js';async function fetchAllWithPagination(queryBuilder) {
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
}const norm = (v) => String(v ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const root = () => document.documentElement;
const css = (el, name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;function parseRGB(str) {
    if (!str) return {r: 0, g: 0, b: 0};
    const s = String(str).trim();
    if (s.startsWith('#')) {
        const hex = s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
        return {r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16)};
    }
    const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
    return m ? {r: +m[1], g: +m[2], b: +m[3]} : {r: 30, g: 64, b: 124};
}const lum = ({r, g, b}) => 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
const bestLabel = (bg) => lum(parseRGB(bg)) < 0.45 ? '#fff' : css(root(), '--hcidx-primary', '#003369');
const AGE_BUCKETS = ['<20', '20-29', '30-39', '40-49', '50-59', '60+', 'N/D'];function parseDateMaybe(s) {
}function daysBetween(d1, d2) {
}function daysSinceAdmission(c) {
}function calcAgeFromStr(s) {
}function ageBucket(a) {
}function getNascimento(c) {
}function mapGeneroLabel(raw) {
}function palette() {
}const REGIONAL_HOST_SEL = '#efet-visao-regional';
const GLOBAL_LOADING_SEL = '#hcidx-busy';
const regionalState = {
    mounted: false,
    loading: false,
    charts: {
        regIdadeRegiao: null,
        regGeneroRegiao: null,
        regContratoRegiao: null,
        regAuxPrazoRegiao: null
    }, matriz: '',
    svc: '', colabs: [],
    filteredColabs: []
};
let _regionalResizeObs = null;function setRegionalResponsiveHeights() {
    if (window.Chart && Chart.instances) {
        Chart.defaults.devicePixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.6);
        Object.values(regionalState.charts).forEach(ch => {
            if (ch && ch.canvas) {
                try {
                    forceLegendBottom(ch);
                    ch.resize();
                } catch (e) {
                }
            }
        });
    }
}function wireRegionalResizeObserver() {
    if (_regionalResizeObs) return;
    const rootEl = document.querySelector('#hc-indice .hcidx-root');
    if (!rootEl) return;
    _regionalResizeObs = new ResizeObserver(() => {
        requestAnimationFrame(setRegionalResponsiveHeights);
    });
    _regionalResizeObs.observe(rootEl);
    window.addEventListener('resize', setRegionalResponsiveHeights);
}async function ensureChartLib() {
}function loadJs(src) {
}function showBusyRegional(f) {
    const el = document.getElementById(GLOBAL_LOADING_SEL.substring(1));
    if (el) el.style.display = f ? 'flex' : 'none';
}const uniqueNonEmptySorted = (v) => Array.from(new Set((v || []).map(x => String(x ?? '')).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR', {sensitivity: 'base'}));
const escapeHtml = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');function readGlobalFilters() {
    const selM = document.getElementById('efet-filter-matriz');
    const selS = document.getElementById('efet-filter-svc');
    regionalState.matriz = selM ? selM.value : '';
    regionalState.svc = selS ? selS.value : '';
    console.log(`Visão Regional lendo filtros: Matriz=${regionalState.matriz}, SVC=${regionalState.svc}`);
}function applyRegionalFiltersAndUpdateCharts() {
    readGlobalFilters();
    console.log("Aplicando filtros da UI (Regional)...");
    regionalState.filteredColabs = regionalState.colabs.filter(c => {
        if (norm(c?.Ativo || 'SIM') !== 'SIM') return false;
        if (regionalState.matriz && c?.MATRIZ !== regionalState.matriz) return false;
        if (regionalState.svc && c?.SVC !== regionalState.svc) return false;
        return true;
    });
    console.log(`Dados filtrados (Regional): ${regionalState.filteredColabs.length} colaboradores.`);
    updateRegionalCharts();
}async function refreshRegional() {
    const regionalViewActive = document.querySelector(`${REGIONAL_HOST_SEL}.active`);
    if (!regionalState.mounted || regionalState.loading || !regionalViewActive) {
        if (regionalState.loading) console.warn("RefreshRegional chamado enquanto já estava carregando.");
        if (!regionalViewActive) console.log("RefreshRegional pulado, view não ativa.");
        return;
    }
    regionalState.loading = true;
    showBusyRegional(true);
    console.log("Iniciando refreshRegional...");
    try {
        await ensureChartLib();
        if (regionalState.colabs.length === 0) {
            console.log("Cache Regional vazio. Buscando do Supabase...");
            const matrizesPermitidas = getMatrizesPermitidas();
            let query = supabase.from('Colaboradores').select('Nome, "Data de Nascimento", Genero, Contrato, Cargo, SVC, "Data de admissão", MATRIZ, Ativo, REGIAO');
            if (matrizesPermitidas !== null) {
                query = query.in('MATRIZ', matrizesPermitidas);
            }
            const data = await fetchAllWithPagination(query);
            regionalState.colabs = Array.isArray(data) ? data : [];
            regionalState.colabs.sort((a, b) => String(a?.Nome || '').localeCompare(String(b?.Nome || ''), 'pt-BR'));
            console.log(`Dados crus carregados (Regional): ${regionalState.colabs.length} colaboradores.`);
        } else {
            console.log("Usando dados cacheados (Regional).");
        }
        ensureRegionalChartsCreated();
        applyRegionalFiltersAndUpdateCharts();
    } catch (e) {
        console.error('Visão Regional - Erro no refresh:', e);
        alert('Falha ao carregar ou atualizar os dados da Visão Regional.');
    } finally {
        regionalState.loading = false;
        showBusyRegional(false);
        console.log("RefreshRegional concluído.");
    }
}function ensureRegionalChartsCreated() {
    if (regionalState.charts.regIdadeRegiao) {
        return;
    }
    console.log("Criando instâncias dos gráficos regionais...");
    const createStackedRegional = (id, axis = 'x') => {
        const canvas = document.getElementById(id);
        if (!canvas) {
            console.warn(`Canvas regional com ID '${id}' não encontrado.`);
            return null;
        }
        const context = canvas.getContext('2d');
        if (!context) {
            console.error(`Falha ao obter contexto 2D para o canvas regional '${id}'.`);
            return null;
        }
        if (typeof Chart === 'undefined' || typeof ChartDataLabels === 'undefined') {
            console.error('Chart.js ou ChartDataLabels não carregados ao criar gráfico regional.');
            return null;
        }
        const options = baseOpts(canvas, null, axis);
        try {
            const chart = new Chart(context, {
                type: 'bar',
                data: {labels: [], datasets: []},
                options,
                plugins: [ChartDataLabels]
            });
            forceLegendBottom(chart);
            return chart;
        } catch (error) {
            console.error(`Erro ao criar gráfico regional '${id}':`, error);
            return null;
        }
    };
    regionalState.charts.regIdadeRegiao = createStackedRegional('reg-idade-regiao-bar', 'x');
    regionalState.charts.regGeneroRegiao = createStackedRegional('reg-genero-regiao-bar', 'x');
    regionalState.charts.regContratoRegiao = createStackedRegional('reg-contrato-regiao-bar', 'y');
    regionalState.charts.regAuxPrazoRegiao = createStackedRegional('reg-aux-prazo-regiao-bar', 'y');
    console.log("Gráficos regionais criados (instâncias não nulas):", JSON.stringify(Object.keys(regionalState.charts).filter(k => regionalState.charts[k])));
}function updateRegionalCharts() {
    const anyRegionalChartExists = Object.values(regionalState.charts).some(chart => chart !== null);
    if (!anyRegionalChartExists) {
        console.warn("Tentando atualizar gráficos regionais, mas nenhuma instância foi criada.");
        ensureRegionalChartsCreated();
        if (!Object.values(regionalState.charts).some(chart => chart !== null)) {
            console.error("Falha crítica ao criar gráficos regionais.");
            return;
        }
    }
    const baseColabs = regionalState.filteredColabs;
    const pal = palette();
    const createOpacity = (color, opacity) => color + Math.round(opacity * 255).toString(16).padStart(2, '0');
    const colabsAuxiliaresRegional = baseColabs.filter(c => norm(c?.Cargo) === 'AUXILIAR' && norm(c?.Ativo || 'SIM') === 'SIM');
    console.log(`Atualizando gráficos regionais com ${colabsAuxiliaresRegional.length} auxiliares filtrados.`);
    if (regionalState.charts.regContratoRegiao) {
        const byRegiao = new Map();
        colabsAuxiliaresRegional.forEach(c => {
            const k = String(c?.REGIAO || 'N/D');
            if (!byRegiao.has(k)) byRegiao.set(k, []);
            byRegiao.get(k).push(c);
        });
        const rows = [...byRegiao.entries()].map(([regiao, arr]) => {
            const c = {e: 0, t: 0, p: 0};
            arr.forEach(c => {
                if (norm(c.Contrato).includes('KN')) c.e++; else {
                    (daysSinceAdmission(c) > 90) ? c.p++ : c.t++;
                }
            });
            const tot = arr.length || 1;
            return {
                label: regiao,
                pE: (c.e * 100) / tot,
                pT: (c.t * 100) / tot,
                pP: (c.p * 100) / tot,
                rE: c.e,
                rT: c.t,
                rP: c.p,
                tot
            };
        });
        rows.sort((a, b) => b.pE - a.pE || a.label.localeCompare(b.label));
        const totG = colabsAuxiliaresRegional.length || 1;
        const cG = colabsAuxiliaresRegional.reduce((a, c) => {
            if (norm(c.Contrato).includes('KN')) a.e++; else (daysSinceAdmission(c) > 90) ? a.p++ : a.t++;
            return a;
        }, {e: 0, t: 0, p: 0});
        const lbls = rows.map(r => r.label);
        const ds = {
            e: {p: rows.map(r => r.pE), r: rows.map(r => r.rE)},
            t: {p: rows.map(r => r.pT), r: rows.map(r => r.rT)},
            p: {p: rows.map(r => r.pP), r: rows.map(r => r.rP)}
        };
        lbls.push('GERAL');
        ds.e.p.push((cG.e * 100) / totG);
        ds.e.r.push(cG.e);
        ds.t.p.push((cG.t * 100) / totG);
        ds.t.r.push(cG.t);
        ds.p.p.push((cG.p * 100) / totG);
        ds.p.r.push(cG.p);
        const colors = [css(root(), '--hcidx-p-2', '#003369'), css(root(), '--hcidx-p-success', '#28a745'), css(root(), '--hcidx-p-3', '#69D4FF')];
        const ch = regionalState.charts.regContratoRegiao;
        setDynamicChartHeight(ch, lbls);
        ch.data.labels = lbls;
        ch.data.datasets = [{
            label: 'Efetivo',
            data: ds.e.p,
            backgroundColor: colors[0],
            _rawCounts: ds.e.r,
            borderWidth: 0
        }, {
            label: 'Potencial (>90d)',
            data: ds.p.p,
            backgroundColor: colors[1],
            _rawCounts: ds.p.r,
            borderWidth: 0
        }, {label: 'Temporário (≤90d)', data: ds.t.p, backgroundColor: colors[2], _rawCounts: ds.t.r, borderWidth: 0}];
        ch.update();
    } else {
        console.warn("Gráfico 'regContratoRegiao' não encontrado/criado para atualizar.");
    }
    if (regionalState.charts.regAuxPrazoRegiao) {
        const colabsAuxNaoKNRegional = colabsAuxiliaresRegional.filter(c => !norm(c?.Contrato).includes('KN'));
        const byRegiao = new Map();
        colabsAuxNaoKNRegional.forEach(c => {
            const k = String(c?.REGIAO || 'N/D');
            if (!byRegiao.has(k)) byRegiao.set(k, []);
            byRegiao.get(k).push(c);
        });
        const rows = [...byRegiao.entries()].map(([regiao, arr]) => {
            const c = {b30: 0, b60: 0, b90: 0, bM: 0};
            arr.forEach(c => {
                const d = daysSinceAdmission(c);
                if (d == null) return;
                if (d <= 30) c.b30++; else if (d <= 60) c.b60++; else if (d <= 90) c.b90++; else c.bM++;
            });
            const t = arr.length || 1;
            return {
                label: regiao,
                p30: (c.b30 * 100) / t,
                p60: (c.b60 * 100) / t,
                p90: (c.b90 * 100) / t,
                pM: (c.bM * 100) / t,
                r30: c.b30,
                r60: c.b60,
                r90: c.b90,
                rM: c.bM,
                t
            };
        });
        rows.sort((a, b) => b.t - a.t || a.label.localeCompare(b.label));
        const cG = colabsAuxNaoKNRegional.reduce((a, c) => {
            const d = daysSinceAdmission(c);
            if (d != null) {
                if (d <= 30) a.g30++; else if (d <= 60) a.g60++; else if (d <= 90) a.g90++; else a.gM++;
            }
            return a;
        }, {g30: 0, g60: 0, g90: 0, gM: 0});
        const totG = colabsAuxNaoKNRegional.length || 1;
        const lbls = rows.map(r => r.label);
        const ds = {
            '≤30d': {p: rows.map(r => r.p30), r: rows.map(r => r.r30)},
            '31–60d': {p: rows.map(r => r.p60), r: rows.map(r => r.r60)},
            '61–90d': {p: rows.map(r => r.p90), r: rows.map(r => r.r90)},
            '>90d': {p: rows.map(r => r.pM), r: rows.map(r => r.rM)}
        };
        lbls.push('GERAL');
        ds['≤30d'].p.push((cG.g30 * 100) / totG);
        ds['≤30d'].r.push(cG.g30);
        ds['31–60d'].p.push((cG.g60 * 100) / totG);
        ds['31–60d'].r.push(cG.g60);
        ds['61–90d'].p.push((cG.g90 * 100) / totG);
        ds['61–90d'].r.push(cG.g90);
        ds['>90d'].p.push((cG.gM * 100) / totG);
        ds['>90d'].r.push(cG.gM);
        const colors = {
            '≤30d': css(root(), '--hcidx-p-2', '#003369'),
            '31–60d': css(root(), '--hcidx-p-3', '#69D4FF'),
            '61–90d': '#0CC494',
            '>90d': '#C00000'
        };
        const ch = regionalState.charts.regAuxPrazoRegiao;
        setDynamicChartHeight(ch, lbls);
        ch.data.labels = lbls;
        ch.data.datasets = Object.keys(ds).map(k => ({
            label: k,
            data: ds[k].p,
            backgroundColor: colors[k],
            _rawCounts: ds[k].r,
            borderWidth: 0
        }));
        ch.update();
    } else {
        console.warn("Gráfico 'regAuxPrazoRegiao' não encontrado/criado para atualizar.");
    }
    if (regionalState.charts.regGeneroRegiao) {
        const byRegiao = new Map();
        colabsAuxiliaresRegional.forEach(c => {
            const k = String(c?.REGIAO || 'N/D');
            if (!byRegiao.has(k)) byRegiao.set(k, []);
            byRegiao.get(k).push(c);
        });
        const regions = Array.from(byRegiao.keys()).sort((a, b) => a.localeCompare(b));
        const groups = regions.map(r => byRegiao.get(r));
        const cats = ['Masculino', 'Feminino', 'Outros', 'N/D'];
        const counts = groups.map(g => {
            const m = new Map(cats.map(k => [k, 0]));
            g.forEach(c => m.set(mapGeneroLabel(c?.Genero), (m.get(mapGeneroLabel(c?.Genero)) || 0) + 1));
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = cats.map((cat, i) => {
            const raw = counts.map(m => m.get(cat) || 0);
            const data = raw.map((v, x) => (v * 100) / totals[x]);
            let color = pal[i % pal.length];
            if (cat === 'Masculino') color = css(root(), '--hcidx-gender-male', '#02B1EE');
            if (cat === 'Feminino') color = css(root(), '--hcidx-gender-female', '#FF5C8A');
            return {label: cat, data, backgroundColor: color, _rawCounts: raw, borderWidth: 0};
        });
        const ch = regionalState.charts.regGeneroRegiao;
        ch.data.labels = regions;
        ch.data.datasets = datasets;
        ch.update('none');
    } else {
        console.warn("Gráfico 'regGeneroRegiao' não encontrado/criado para atualizar.");
    }
    if (regionalState.charts.regIdadeRegiao) {
        const byRegiao = new Map();
        colabsAuxiliaresRegional.forEach(c => {
            const k = String(c?.REGIAO || 'N/D');
            if (!byRegiao.has(k)) byRegiao.set(k, []);
            byRegiao.get(k).push(c);
        });
        const regions = Array.from(byRegiao.keys()).sort((a, b) => a.localeCompare(b));
        const groups = regions.map(r => byRegiao.get(r));
        const counts = groups.map(g => {
            const m = new Map(AGE_BUCKETS.map(k => [k, 0]));
            g.forEach(c => m.set(ageBucket(calcAgeFromStr(getNascimento(c))), (m.get(ageBucket(calcAgeFromStr(getNascimento(c)))) || 0) + 1));
            return m;
        });
        const totals = counts.map(m => [...m.values()].reduce((a, b) => a + b, 0) || 1);
        const datasets = AGE_BUCKETS.map((b, i) => {
            const raw = counts.map(m => m.get(b) || 0);
            const data = raw.map((v, x) => (v * 100) / totals[x]);
            const bg = pal[i % pal.length];
            return {label: b, data, backgroundColor: bg, _rawCounts: raw, borderWidth: 0};
        });
        const ch = regionalState.charts.regIdadeRegiao;
        ch.data.labels = regions;
        ch.data.datasets = datasets;
        ch.update('none');
    } else {
        console.warn("Gráfico 'regIdadeRegiao' não encontrado/criado para atualizar.");
    }
}export async function init() {
    console.log("Inicializando Visão Regional...");
    const host = document.querySelector(REGIONAL_HOST_SEL);
    if (!host) {
        console.error('Host da Visão Regional (#efet-visao-regional) não encontrado.');
        return;
    }
    await ensureChartLib();
    if (!regionalState.mounted) {
        wireRegionalResizeObserver();
        regionalState.mounted = true;
        console.log("Visão Regional montada (listeners de resize).");
    }
    ensureRegionalChartsCreated();
    await refreshRegional();
    console.log("Visão Regional inicializada.");
}export function destroy() {
    if (regionalState.mounted) {
        console.log('Destruindo estado da Visão Regional...');
        Object.keys(regionalState.charts).forEach(key => {
            const chart = regionalState.charts[key];
            if (chart && typeof chart.destroy === 'function') {
                try {
                    chart.destroy();
                } catch (e) {
                    console.error(`Erro ao destruir gráfico regional ${key}:`, e);
                }
                regionalState.charts[key] = null;
            }
        });
        if (_regionalResizeObs) {
            _regionalResizeObs.disconnect();
            _regionalResizeObs = null;
        }
        window.removeEventListener('resize', setRegionalResponsiveHeights);
        regionalState.colabs = [];
        regionalState.filteredColabs = [];
        regionalState.matriz = '';
        regionalState.svc = '';
        regionalState.mounted = false;
        console.log('Estado da Visão Regional destruído.');
    }
}export function handleGlobalFilterChange() {
    console.log("Visão Regional notificada sobre mudança de filtro global.");
    const regionalViewActive = document.querySelector(`${REGIONAL_HOST_SEL}.active`);
    if (regionalState.mounted && regionalViewActive) {
        console.log("View Regional está ativa, aplicando filtros...");
        applyRegionalFiltersAndUpdateCharts();
    } else if (regionalState.mounted) {
        console.log("View Regional montada, mas não ativa. Filtros lidos, mas gráficos não atualizados.");
        readGlobalFilters();
        regionalState.filteredColabs = [];
    }
}