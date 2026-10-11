// Cloudflare Pages Function: GET /api/painel?mun=57037[&fonte=simulado|oficial]
// Busca os arquivos JSON de divulgação do TSE (EA20), enxuga e devolve um único
// pacote para o painel. O resultado fica 30 s em cache na borda da Cloudflare,
// então o TSE recebe no máximo ~10 requisições a cada 30 s, seja qual for a audiência.

import { projetarProporcional } from '../../lib/proporcional.js';

const FONTES = {
  oficial: {
    base: 'https://resultados.tse.jus.br/oficial/ele2026',
    federal: '6257', // Eleição Geral Federal (Presidente) - 1º turno, 04/10/2026
    estadual: '6259', // Eleições Gerais Estaduais - 1º turno, 04/10/2026
    federal2: '6258', // Presidente - 2º turno, 25/10/2026
    estadual2: '6260', // Governador - 2º turno, 25/10/2026
  },
  simulado: {
    base: 'https://resultados-sim.tse.jus.br/simulado/simulado2026/ele2026',
    federal: '21270',
    estadual: '21272',
  },
};

const UF = 'es';
// Códigos de município do TSE (diferentes do IBGE), todos os 78 municípios do ES, do mun-cm.json oficial de 2026.
export const MUNICIPIOS = {
  '56014': "Afonso Cláudio",
  '56030': "Alegre",
  '56057': "Alfredo Chaves",
  '56065': "Alto Rio Novo",
  '56073': "Anchieta",
  '56090': "Apiacá",
  '56111': "Aracruz",
  '56138': "Atílio Vivácqua",
  '56022': "Água Doce do Norte",
  '57991': "Águia Branca",
  '56154': "Baixo Guandu",
  '56170': "Barra de São Francisco",
  '56197': "Boa Esperança",
  '56219': "Bom Jesus do Norte",
  '56146': "Brejetuba",
  '56235': "Cachoeiro de Itapemirim",
  '56251': "Cariacica",
  '56278': "Castelo",
  '56294': "Colatina",
  '56316': "Conceição da Barra",
  '56332': "Conceição do Castelo",
  '56359': "Divino de São Lourenço",
  '56375': "Domingos Martins",
  '56391': "Dores do Rio Preto",
  '56413': "Ecoporanga",
  '56430': "Fundão",
  '56308': "Governador Lindenberg",
  '56456': "Guaçuí",
  '56472': "Guarapari",
  '57096': "Ibatiba",
  '56499': "Ibiraçu",
  '56502': "Ibitirama",
  '56510': "Iconha",
  '56049': "Irupi",
  '56537': "Itaguaçu",
  '56553': "Itapemirim",
  '56570': "Itarana",
  '56596': "Iúna",
  '57134': "Jaguaré",
  '56618': "Jerônimo Monteiro",
  '56626': "João Neiva",
  '57916': "Laranja da Terra",
  '56634': "Linhares",
  '56650': "Mantenópolis",
  '56120': "Marataízes",
  '56103': "Marechal Floriano",
  '57070': "Marilândia",
  '56677': "Mimoso do Sul",
  '56693': "Montanha",
  '56715': "Mucurici",
  '56731': "Muniz Freire",
  '56758': "Muqui",
  '56774': "Nova Venécia",
  '56790': "Pancas",
  '57150': "Pedro Canário",
  '56812': "Pinheiros",
  '56839': "Piúma",
  '56200': "Ponto Belo",
  '56855': "Presidente Kennedy",
  '57118': "Rio Bananal",
  '56871': "Rio Novo do Sul",
  '56898': "Santa Leopoldina",
  '57932': "Santa Maria de Jetibá",
  '56910': "Santa Teresa",
  '56006': "São Domingos do Norte",
  '56936': "São Gabriel da Palha",
  '56952': "São José do Calçado",
  '56979': "São Mateus",
  '56162': "São Roque do Canaã",
  '56995': "Serra",
  '56189': "Sooretama",
  '57959': "Vargem Alta",
  '57975': "Venda Nova do Imigrante",
  '57010': "Viana",
  '56081': "Vila Pavão",
  '56227': "Vila Valério",
  '57037': "Vila Velha",
  '57053': "Vitória",
};

const TTL_DADOS = 30; // segundos em cache na borda
const TTL_SONDA = 300; // segundos entre checagens do ambiente oficial
const TOP_PROPORCIONAL = 40;

const pad6 = (n) => String(n).padStart(6, '0');

// turno: 1 (padrão) ou 2. O 2º turno só existe no ambiente oficial.
export function urlArquivo(fonte, tipo, abr, cargo, turno) {
  const f = FONTES[fonte];
  const chave = tipo === 'federal' ? 'federal' : 'estadual';
  const ele = (turno === 2 && f[chave + '2']) || f[chave];
  return `${f.base}/${ele}/dados/${abr.slice(0, 2)}/${abr}-c${cargo}-e${pad6(ele)}-u.json`;
}

export async function baixar(url) {
  try {
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'painel-eleicoes-es/1.0' },
    });
    if (!r.ok) return { erro: r.status };
    return { dados: await r.json() };
  } catch (e) {
    return { erro: String(e && e.message ? e.message : e) };
  }
}

// O painel abre no 2º turno; ?turno=1 mostra o resultado final de 04/10. O simulado só tem 1º turno.
export function resolverTurno(url, fonte) {
  if (fonte !== 'oficial') return 1;
  return url.searchParams.get('turno') === '1' ? 1 : 2;
}

// Reduz o arquivo EA20 ao que o painel usa.
export function enxugar(j, limite) {
  const carg = (j.carg && j.carg[0]) || {};
  const cands = [];
  const partidos = [];
  for (const agr of carg.agr || []) {
    for (const par of agr.par || []) {
      if (agr.tp === 'i' || agr.tp === 'f') {
        // totais por partido só interessam no proporcional
      }
      partidos.push({
        sg: par.sg,
        votos: Number(par.tvtn || 0) + Number(par.tvtl || 0),
      });
      for (const c of par.cand || []) {
        const vice = (c.vs || []).map((v) => v.nmu).filter(Boolean);
        cands.push({
          n: c.n,
          sq: c.sqcand || '',
          nome: c.nmu || c.nm,
          partido: par.sg,
          colig: agr.tp === 'i' ? '' : agr.nm,
          vice,
          seq: Number(c.seq || 0),
          votos: Number(c.vap || 0),
          pct: c.pvap || '0,00',
          eleito: c.e === 's',
          st: c.st || '',
          dvt: c.dvt || '',
        });
      }
    }
  }
  cands.sort((a, b) => b.votos - a.votos || a.seq - b.seq);
  partidos.sort((a, b) => b.votos - a.votos);
  const s = j.s || {};
  const e = j.e || {};
  const v = j.v || {};
  return {
    cargo: carg.nmn || '',
    vagas: Number(carg.nv || 1),
    totalCandidatos: cands.length,
    cands: limite ? cands.slice(0, limite) : cands,
    partidos: limite ? partidos.filter((p) => p.votos > 0).slice(0, 12) : undefined,
    fase: j.f, // s = simulado, o = oficial
    turno: j.t,
    andamento: j.and, // n = não iniciada, p = em andamento, f = finalizada
    totalizacaoFinal: j.tf === 's',
    matDefinido: j.md || '', // e = eleito, s = segundo turno
    podeDivulgar: j.dv !== 'n',
    semEleito: j.esae === 's',
    atualizado: j.dt && j.ht ? `${j.dt} ${j.ht}` : '',
    gerado: j.dg && j.hg ? `${j.dg} ${j.hg}` : '',
    secoes: { total: Number(s.ts || 0), totalizadas: Number(s.st || 0), pct: s.pst || '0,00' },
    eleitorado: {
      total: Number(e.te || 0),
      comparecimento: Number(e.c || 0),
      pctComparecimento: e.pc || '0,00',
      abstencao: Number(e.a || 0),
      pctAbstencao: e.pa || '0,00',
      naoApurado: Number(e.esnt || 0), // eleitores das seções ainda não totalizadas
    },
    votos: {
      total: Number(v.tv || 0),
      validos: Number(v.vv || 0),
      brancos: Number(v.vb || 0),
      pctBrancos: v.pvb || '0,00',
      nulos: Number(v.tvn || 0),
      pctNulos: v.ptvn || '0,00',
    },
  };
}

// Decide a fonte: usa o ambiente oficial assim que o TSE publicar os arquivos;
// até lá, cai no simulado. A sondagem é lembrada por 5 min para não gerar 404 em série
// (o TSE bloqueia IPs que acumulam 404).
// Fonte dos dados: SEMPRE o ambiente oficial do TSE. O simulado (candidatos fictícios) só aparece
// quando pedido explicitamente com ?fonte=simulado. Não há mais troca automática para o simulado:
// se o TSE falhar, o painel mostra indisponibilidade, nunca dados de teste.
async function resolverFonte(pedido, env) {
  if (pedido === 'simulado') return 'simulado';
  if (env && env.TSE_MODO === 'simulado' && pedido !== 'oficial') return 'simulado';
  return 'oficial';
}

export async function montarPainel(fonte, mun, turno) {
  const m = `${UF}${mun}`;
  const pedidos = {
    presidenteBR: ['federal', 'br', '0001'],
    presidenteES: ['federal', UF, '0001'],
    governador: ['estadual', UF, '0003'],
    senador: ['estadual', UF, '0005'],
    depFederal: ['estadual', UF, '0006', TOP_PROPORCIONAL],
    depEstadual: ['estadual', UF, '0007', TOP_PROPORCIONAL],
  };
  // No 2º turno só há disputa para Presidente e Governador.
  if (turno === 2) for (const k of ['senador', 'depFederal', 'depEstadual']) delete pedidos[k];
  const chaves = Object.keys(pedidos);
  const respostas = await Promise.all(
    chaves.map((k) => baixar(urlArquivo(fonte, pedidos[k][0], pedidos[k][1], pedidos[k][2], turno))),
  );
  const blocos = {};
  const erros = {};
  chaves.forEach((k, i) => {
    const r = respostas[i];
    if (r.dados) {
      blocos[k] = enxugar(r.dados, pedidos[k][3]);
      if (pedidos[k][3]) {
        const pr = projetarProporcional(r.dados);
        if (pr) { delete pr._confere; delete pr._eleitosN; delete pr._det; blocos[k].projecao = pr; }
      }
    }
    else erros[k] = r.erro;
  });
  return {
    fonte,
    turno: turno === 2 ? 2 : 1,
    municipio: { cd: mun, nome: MUNICIPIOS[mun] },
    municipios: MUNICIPIOS,
    consultadoEm: new Date().toISOString(),
    blocos,
    erros,
  };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  let mun = url.searchParams.get('mun') || '57037';
  if (!MUNICIPIOS[mun]) mun = '57037';
  const pedido = url.searchParams.get('fonte') || '';

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const fonte = await resolverFonte(pedido, env, cache);

  const turno = resolverTurno(url, fonte);
  const chave = new Request(`https://painel.interno/painel?fonte=${fonte}&mun=${mun}&turno=${turno}`);
  if (cache) {
    const pronto = await cache.match(chave);
    if (pronto) return pronto;
  }

  const corpo = await montarPainel(fonte, mun, turno);
  const tudoFalhou = Object.keys(corpo.blocos).length === 0;
  const resp = new Response(JSON.stringify(corpo), {
    status: tudoFalhou ? 502 : 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': tudoFalhou ? 'no-store' : `public, max-age=${TTL_DADOS}`,
    },
  });
  if (cache && !tudoFalhou) {
    const p = cache.put(chave, resp.clone());
    if (waitUntil) waitUntil(p);
    else await p;
  }
  return resp;
}
