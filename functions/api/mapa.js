// GET /api/mapa?cargo=presidente|governador&parte=1|2[&turno=1|2][&fonte=simulado]
// Devolve, para cada município do ES, o líder e os três primeiros colocados do cargo.
// São 78 arquivos do TSE; a Cloudflare limita 50 buscas por chamada, então a lista vem em duas partes.
// Cada parte fica 60 s em cache na borda.
import { MUNICIPIOS, urlArquivo, baixar, resolverTurno } from './painel.js';

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
  const e = j.e || {};
  const v = j.v || {};
  return {
    pctSecoes: s.pst || '0,00',
    votos: Number(v.vv || 0),
    total: Number(v.tv || 0),
    brancosNulos: Number(v.vb || 0) + Number(v.tvn || 0),
    pctAbstencao: e.pa || '0,00',
    top: cands.slice(0, 3).map(({ seq, ...r }) => r),
  };
}

export async function montarMapa(fonte, cargo, parte, turno) {
  const [tipo, cod] = CARGOS[cargo];
  const todos = Object.keys(MUNICIPIOS).sort();
  const meio = Math.ceil(todos.length / 2);
  const lista = parte === 2 ? todos.slice(meio) : todos.slice(0, meio);
  const resp = await Promise.all(lista.map((cd) => baixar(urlArquivo(fonte, tipo, 'es' + cd, cod, turno))));
  const municipios = {};
  let falhas = 0;
  lista.forEach((cd, i) => {
    if (resp[i].dados) municipios[cd] = { nome: MUNICIPIOS[cd], ...resumir(resp[i].dados) };
    else falhas++;
  });
  return { fonte, turno: turno === 2 ? 2 : 1, cargo, parte, falhas, municipios };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const cargo = CARGOS[url.searchParams.get('cargo')] ? url.searchParams.get('cargo') : 'governador';
  const parte = url.searchParams.get('parte') === '2' ? 2 : 1;
  const fonte = url.searchParams.get('fonte') === 'simulado' || (env && env.TSE_MODO === 'simulado') ? 'simulado' : 'oficial';

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const turno = resolverTurno(url, fonte);
  const chave = new Request(`https://painel.interno/mapa?f=${fonte}&c=${cargo}&p=${parte}&t=${turno}`);
  if (cache) { const pronto = await cache.match(chave); if (pronto) return pronto; }

  const corpo = await montarMapa(fonte, cargo, parte, turno);
  const vazio = Object.keys(corpo.municipios).length === 0;
  const r = new Response(JSON.stringify(corpo), {
    status: vazio ? 502 : 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': vazio ? 'no-store' : `public, max-age=${TTL}` },
  });
  if (cache && !vazio) { const p = cache.put(chave, r.clone()); if (waitUntil) waitUntil(p); else await p; }
  return r;
}
