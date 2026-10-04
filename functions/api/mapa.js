// GET /api/mapa?cargo=presidente|governador&parte=1|2[&fonte=simulado]
// Devolve, para cada município do ES, o líder e os três primeiros colocados do cargo.
// São 78 arquivos do TSE; a Cloudflare limita 50 buscas por chamada, então a lista vem em duas partes.
// Cada parte fica 60 s em cache na borda.
import { MUNICIPIOS, urlArquivo, baixar } from './painel.js';

const TTL = 60;
const CARGOS = { presidente: ['federal', '0001'], governador: ['estadual', '0003'] };

function resumir(j) {
  const cands = [];
  for (const agr of (j.carg && j.carg[0] && j.carg[0].agr) || []) {
    for (const par of agr.par || []) {
      for (const c of par.cand || []) {
        cands.push({ n: c.n, sq: c.sqcand || '', nome: c.nmu || c.nm, partido: par.sg, votos: Number(c.vap || 0), pct: c.pvap || '0,00', seq: Number(c.seq || 0) });
      }
    }
  }
  cands.sort((a, b) => b.votos - a.votos || a.seq - b.seq);
  const s = j.s || {};
  return {
    pctSecoes: s.pst || '0,00',
    votos: Number((j.v && j.v.vv) || 0),
    top: cands.slice(0, 3).map(({ seq, ...r }) => r),
  };
}

export async function montarMapa(fonte, cargo, parte) {
  const [tipo, cod] = CARGOS[cargo];
  const todos = Object.keys(MUNICIPIOS).sort();
  const meio = Math.ceil(todos.length / 2);
  const lista = parte === 2 ? todos.slice(meio) : todos.slice(0, meio);
  const resp = await Promise.all(lista.map((cd) => baixar(urlArquivo(fonte, tipo, 'es' + cd, cod))));
  const municipios = {};
  let falhas = 0;
  lista.forEach((cd, i) => {
    if (resp[i].dados) municipios[cd] = { nome: MUNICIPIOS[cd], ...resumir(resp[i].dados) };
    else falhas++;
  });
  return { fonte, cargo, parte, falhas, municipios };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const cargo = CARGOS[url.searchParams.get('cargo')] ? url.searchParams.get('cargo') : 'governador';
  const parte = url.searchParams.get('parte') === '2' ? 2 : 1;
  const fonte = url.searchParams.get('fonte') === 'simulado' || (env && env.TSE_MODO === 'simulado') ? 'simulado' : 'oficial';

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const chave = new Request(`https://painel.interno/mapa?f=${fonte}&c=${cargo}&p=${parte}`);
  if (cache) { const pronto = await cache.match(chave); if (pronto) return pronto; }

  const corpo = await montarMapa(fonte, cargo, parte);
  const vazio = Object.keys(corpo.municipios).length === 0;
  const r = new Response(JSON.stringify(corpo), {
    status: vazio ? 502 : 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': vazio ? 'no-store' : `public, max-age=${TTL}` },
  });
  if (cache && !vazio) { const p = cache.put(chave, r.clone()); if (waitUntil) waitUntil(p); else await p; }
  return r;
}
