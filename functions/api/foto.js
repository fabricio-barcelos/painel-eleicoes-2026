// GET /api/foto?t=f|e&uf=br|es&sq=<sequencial do candidato>
// Repassa a foto oficial do candidato (TSE) e guarda 7 dias em cache na borda,
// para o painel não bater no TSE a cada visitante.
const ELE = { f: '6257', e: '6259' };

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const t = url.searchParams.get('t');
  const uf = (url.searchParams.get('uf') || '').toLowerCase();
  const sq = url.searchParams.get('sq') || '';
  if (!ELE[t] || !/^[a-z]{2}$/.test(uf) || !/^\d{6,15}$/.test(sq)) return new Response('parametros invalidos', { status: 400 });

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const chave = new Request(`https://painel.interno/foto/${t}/${uf}/${sq}`);
  if (cache) { const pronto = await cache.match(chave); if (pronto) return pronto; }

  // Foto espelhada no KV pelo coletor (chave oficial/ele2026/<ele>/fotos/<uf>/<sq>.jpeg, em base64).
  if (env && env.TSE) {
    try {
      // O coletor grava a foto em binário (bulk com base64:true decodifica ao gravar); lê-se como arrayBuffer.
      const bin = await env.TSE.get(`oficial/ele2026/${ELE[t]}/fotos/${uf}/${sq}.jpeg`, 'arrayBuffer');
      if (bin && bin.byteLength > 0) {
        const resp = new Response(bin, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=604800' } });
        if (cache) { const p = cache.put(chave, resp.clone()); if (waitUntil) waitUntil(p); else await p; }
        return resp;
      }
    } catch (e) { /* cai na busca direta */ }
  }
  let r;
  try { r = await fetch(`https://resultados.tse.jus.br/oficial/ele2026/${ELE[t]}/fotos/${uf}/${sq}.jpeg`); } catch (e) { return new Response('indisponivel', { status: 502 }); }
  if (!r.ok) return new Response('sem foto', { status: 404, headers: { 'cache-control': 'public, max-age=600' } });
  const resp = new Response(r.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=604800' } });
  if (cache) { const p = cache.put(chave, resp.clone()); if (waitUntil) waitUntil(p); else await p; }
  return resp;
}
