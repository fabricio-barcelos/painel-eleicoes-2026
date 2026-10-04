// GET /api/candidato?n=1234[&fonte=simulado]
// Procura o número entre os candidatos a senador, deputado federal e deputado estadual do ES e devolve os votos de cada candidato encontrado.
import { urlArquivo, baixar } from './painel.js';

const TTL = 30;
const BUSCAS = [
  ['Senador', 'Espírito Santo', 'estadual', 'es', '0005'],
  ['Deputado Federal', 'Espírito Santo', 'estadual', 'es', '0006'],
  ['Deputado Estadual', 'Espírito Santo', 'estadual', 'es', '0007'],
];

function achar(j, numero) {
  const todos = [];
  for (const agr of (j.carg && j.carg[0] && j.carg[0].agr) || []) {
    for (const par of agr.par || []) {
      for (const c of par.cand || []) {
        todos.push({ n: String(c.n), nome: c.nmu || c.nm, nomeCompleto: c.nm, partido: par.sg, legenda: agr.tp === 'i' ? '' : agr.nm, votos: Number(c.vap || 0), pct: c.pvap || '0,00', st: c.st || '', dvt: c.dvt || '', seq: Number(c.seq || 0) });
      }
    }
  }
  todos.sort((a, b) => b.votos - a.votos || a.seq - b.seq);
  const i = todos.findIndex((c) => c.n === numero);
  if (i < 0) return null;
  const { seq, ...c } = todos[i];
  const s = j.s || {};
  return { ...c, posicao: i + 1, concorrentes: todos.length, pctSecoes: s.pst || '0,00', andamento: j.and, totalizacaoFinal: j.tf === 's' };
}

export async function consultar(fonte, numero) {
  const resp = await Promise.all(BUSCAS.map((b) => baixar(urlArquivo(fonte, b[2], b[3], b[4]))));
  const achados = [];
  let falhas = 0;
  BUSCAS.forEach((b, i) => {
    if (!resp[i].dados) { falhas++; return; }
    const c = achar(resp[i].dados, numero);
    if (c) achados.push({ cargo: b[0], abrangencia: b[1], ...c });
  });
  return { fonte, numero, falhas, achados };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const numero = (url.searchParams.get('n') || '').replace(/\D/g, '').slice(0, 5);
  if (numero.length < 3) {
    return new Response(JSON.stringify({ erro: 'Informe o número do candidato (de 3 a 5 dígitos).' }), { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  const fonte = url.searchParams.get('fonte') === 'simulado' || (env && env.TSE_MODO === 'simulado') ? 'simulado' : 'oficial';
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const chave = new Request(`https://painel.interno/candidato?f=${fonte}&n=${numero}`);
  if (cache) { const pronto = await cache.match(chave); if (pronto) return pronto; }
  const corpo = await consultar(fonte, numero);
  const ruim = corpo.falhas === BUSCAS.length;
  const r = new Response(JSON.stringify(corpo), { status: ruim ? 502 : 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': ruim ? 'no-store' : `public, max-age=${TTL}` } });
  if (cache && !ruim) { const p = cache.put(chave, r.clone()); if (waitUntil) waitUntil(p); else await p; }
  return r;
}
