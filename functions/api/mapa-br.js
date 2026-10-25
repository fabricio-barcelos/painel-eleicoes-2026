// GET /api/mapa-br?parte=1|2 — Presidente por estado (27 UFs + exterior), líder e os dois primeiros.
// Lê o R2 (coletor) como as demais; 60 s em cache na borda.
import { urlArquivo, baixar, usarKV, resolverTurno } from './painel.js';

const TTL = 60;
const UFS = 'ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to zz'.split(' ');
const NOMES = { ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal', es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul', mt: 'Mato Grosso', pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco', pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', ro: 'Rondônia', rr: 'Roraima', rs: 'Rio Grande do Sul', sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins', zz: 'Exterior' };

function resumir(j) {
  const cands = [];
  for (const agr of (j.carg && j.carg[0] && j.carg[0].agr) || []) for (const par of agr.par || []) for (const c of par.cand || [])
    cands.push({ n: c.n, sq: c.sqcand || '', nome: c.nmu || c.nm, partido: par.sg, votos: Number(c.vap || 0), pct: c.pvap || '0,00' });
  cands.sort((a, b) => b.votos - a.votos);
  const s = j.s || {}, v = j.v || {}, e = j.e || {};
  return { pctSecoes: s.pst || '0,00', votos: Number(v.vv || 0), total: Number(v.tv || 0), brancosNulos: Number(v.vb || 0) + Number(v.tvn || 0), pctAbstencao: e.pa || '0,00', aptos: Number(e.te || 0), abstencao: Number(e.a || 0), top: cands.slice(0, 3) };
}

export async function onRequestGet({ request, env, waitUntil }) {
  usarKV(env);
  const url = new URL(request.url);
  const parte = url.searchParams.get('parte') === '2' ? 2 : 1;
  const fonte = 'oficial';
  const turno = resolverTurno(url, fonte);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const chave = new Request(`https://painel.interno/mapa-br?p=${parte}&t=${turno}`);
  if (cache) { const pronto = await cache.match(chave); if (pronto) return pronto; }
  const lista = parte === 2 ? UFS.slice(14) : UFS.slice(0, 14);
  const resp = await Promise.all(lista.map((uf) => baixar(urlArquivo(fonte, 'federal', uf, '0001', turno))));
  const estados = {}; let falhas = 0;
  lista.forEach((uf, i) => { if (resp[i].dados) estados[uf] = { nome: NOMES[uf], ...resumir(resp[i].dados) }; else falhas++; });
  const vazio = Object.keys(estados).length === 0;
  const r = new Response(JSON.stringify({ turno, parte, falhas, estados }), { status: vazio ? 502 : 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': vazio ? 'no-store' : `public, max-age=${TTL}` } });
  if (cache && !vazio) { const p = cache.put(chave, r.clone()); if (waitUntil) waitUntil(p); else await p; }
  return r;
}
