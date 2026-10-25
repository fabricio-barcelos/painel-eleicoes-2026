// GET /api/diag — diagnóstico: o que o TSE responde às bordas da Cloudflare. Sem cache.
export async function onRequestGet({ request }) {
  const cf = request.cf || {};
  const alvos = [
    'https://resultados.tse.jus.br/oficial/ele2026/6260/dados/es/es-c0003-e006260-u.json',
    'https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json',
    'https://resultados.tse.jus.br/oficial/comum/config/ele-c.json',
  ];
  const res = [];
  for (const url of alvos) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'painel-eleicoes-es/1.0' } });
      const corpo = await r.text();
      res.push({ url, status: r.status, ms: Date.now() - t0, headers: Object.fromEntries(r.headers), inicio: corpo.slice(0, 300) });
    } catch (e) {
      res.push({ url, erro: String(e && e.message ? e.message : e), ms: Date.now() - t0 });
    }
  }
  return new Response(JSON.stringify({ quando: new Date().toISOString(), colo: cf.colo, pais: cf.country, res }, null, 1), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
