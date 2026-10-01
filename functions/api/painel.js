// Cloudflare Pages Function: GET /api/painel?mun=57037[&fonte=simulado|oficial]
// Busca os arquivos JSON de divulgação do TSE (EA20), enxuga e devolve um único
// pacote para o painel. O resultado fica 30 s em cache na borda da Cloudflare,
// então o TSE recebe no máximo ~10 requisições a cada 30 s, seja qual for a audiência.

const FONTES = {
  oficial: {
    base: 'https://resultados.tse.jus.br/oficial/ele2026',
    federal: '6257', // Eleição Geral Federal (Presidente) - 1º turno, 04/10/2026
    estadual: '6259', // Eleições Gerais Estaduais - 1º turno, 04/10/2026
  },
  simulado: {
    base: 'https://resultados-sim.tse.jus.br/simulado/simulado2026/ele2026',
    federal: '21270',
    estadual: '21272',
  },
};

const UF = 'es';
// Códigos de município do TSE (diferentes do IBGE), conferidos no mun-cm.json de 2026.
export const MUNICIPIOS = {
  '57053': 'Vitória',
  '57037': 'Vila Velha',
  '56995': 'Serra',
  '56251': 'Cariacica',
  '56472': 'Guarapari',
  '57010': 'Viana',
  '56235': 'Cachoeiro de Itapemirim',
  '56634': 'Linhares',
  '56294': 'Colatina',
  '56979': 'São Mateus',
  '56111': 'Aracruz',
};

const TTL_DADOS = 30; // segundos em cache na borda
const TTL_SONDA = 300; // segundos entre checagens do ambiente oficial
const TOP_PROPORCIONAL = 40;

const pad6 = (n) => String(n).padStart(6, '0');

function urlArquivo(fonte, tipo, abr, cargo) {
  const f = FONTES[fonte];
  const ele = tipo === 'federal' ? f.federal : f.estadual;
  return `${f.base}/${ele}/dados/${abr.slice(0, 2)}/${abr}-c${cargo}-e${pad6(ele)}-u.json`;
}

async function baixar(url) {
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
async function resolverFonte(pedido, env, cache) {
  if (pedido === 'oficial' || pedido === 'simulado') return pedido;
  const modo = (env && env.TSE_MODO) || 'auto';
  if (modo === 'oficial' || modo === 'simulado') return modo;

  const chave = new Request('https://painel.interno/sonda-oficial');
  const lembrado = cache && (await cache.match(chave));
  if (lembrado) return (await lembrado.text()) === 'ok' ? 'oficial' : 'simulado';

  const r = await baixar(urlArquivo('oficial', 'federal', 'br', '0001'));
  const ok = !!r.dados;
  if (cache) {
    await cache.put(
      chave,
      new Response(ok ? 'ok' : 'nao', { headers: { 'cache-control': `max-age=${TTL_SONDA}` } }),
    );
  }
  return ok ? 'oficial' : 'simulado';
}

export async function montarPainel(fonte, mun) {
  const m = `${UF}${mun}`;
  const pedidos = {
    presidenteBR: ['federal', 'br', '0001'],
    presidenteES: ['federal', UF, '0001'],
    governador: ['estadual', UF, '0003'],
    senador: ['estadual', UF, '0005'],
    depFederal: ['estadual', UF, '0006', TOP_PROPORCIONAL],
    depEstadual: ['estadual', UF, '0007', TOP_PROPORCIONAL],
    munPresidente: ['federal', m, '0001'],
    munGovernador: ['estadual', m, '0003'],
    munSenador: ['estadual', m, '0005'],
  };
  const chaves = Object.keys(pedidos);
  const respostas = await Promise.all(
    chaves.map((k) => baixar(urlArquivo(fonte, pedidos[k][0], pedidos[k][1], pedidos[k][2]))),
  );
  const blocos = {};
  const erros = {};
  chaves.forEach((k, i) => {
    const r = respostas[i];
    if (r.dados) blocos[k] = enxugar(r.dados, pedidos[k][3]);
    else erros[k] = r.erro;
  });
  return {
    fonte,
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

  const chave = new Request(`https://painel.interno/painel?fonte=${fonte}&mun=${mun}`);
  if (cache) {
    const pronto = await cache.match(chave);
    if (pronto) return pronto;
  }

  const corpo = await montarPainel(fonte, mun);
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
