// GET /api/exterior — votos do exterior somados dos boletins de urna (tools/exterior.mjs), antes da totalização do TSE.
const TTL = 60;
export async function onRequestGet({ env, waitUntil }) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const chave = new Request('https://painel.interno/exterior');
  if (cache) { const pronto = await cache.match(chave); if (pronto) return pronto; }
  let corpo = null;
  try { const o = env && env.R2 && (await env.R2.get('t2/exterior.json')); if (o) corpo = await o.text(); } catch (e) { /* indisponível */ }
  if (!corpo) return new Response('{"erro":"sem dados"}', { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  const r = new Response(corpo, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${TTL}` } });
  if (cache) { const p = cache.put(chave, r.clone()); if (waitUntil) waitUntil(p); else await p; }
  return r;
}
