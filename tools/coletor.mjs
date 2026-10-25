// Coletor: baixa os arquivos do TSE fora da Cloudflare e os espelha no KV (binding TSE do Pages).
// Uso: CF_ACCOUNT_ID, CF_KV_NS, CF_API_TOKEN no ambiente.  node tools/coletor.mjs [segundos de duração] [intervalo s]
// Motivo: desde 25/10/2026 o TSE responde 403 às bordas da Cloudflare; as Functions leem o KV primeiro.
import { MUNICIPIOS } from '../functions/api/painel.js';

const { CF_ACCOUNT_ID, CF_KV_NS, CF_API_TOKEN } = process.env;
if (!CF_ACCOUNT_ID || !CF_KV_NS || !CF_API_TOKEN) { console.error('faltam CF_ACCOUNT_ID, CF_KV_NS ou CF_API_TOKEN'); process.exit(1); }
const DURACAO = Number(process.argv[2] || 20400); // 5h40 (teto do GitHub Actions é 6h)
const INTERVALO = Number(process.argv[3] || 30);
const BASE = 'https://resultados.tse.jus.br/';
const API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NS}/bulk`;
const cds = Object.keys(MUNICIPIOS);
const pad6 = (n) => String(n).padStart(6, '0');
const arq = (ele, abr, cargo) => `oficial/ele2026/${ele}/dados/${abr.slice(0, 2)}/${abr}-c${cargo}-e${pad6(ele)}-u.json`;

// 2º turno (muda a cada 30 s): 3 arquivos estaduais + 156 municipais.
const T2 = [arq('6258', 'br', '0001'), arq('6258', 'es', '0001'), arq('6260', 'es', '0003')]
  .concat(cds.flatMap((cd) => [arq('6258', 'es' + cd, '0001'), arq('6260', 'es' + cd, '0003')]));
// 1º turno (resultado final, não muda): sobe uma vez por execução.
const T1 = [arq('6257', 'br', '0001'), arq('6257', 'es', '0001'), arq('6259', 'es', '0003'), arq('6259', 'es', '0005'), arq('6259', 'es', '0006'), arq('6259', 'es', '0007')]
  .concat(cds.flatMap((cd) => [arq('6257', 'es' + cd, '0001'), arq('6259', 'es' + cd, '0003')]));

async function baixar(chave) {
  const r = await fetch(BASE + chave, { headers: { accept: 'application/json', 'user-agent': 'painel-eleicoes-es/1.0 (coletor)' } });
  if (!r.ok) return null;
  return r.text();
}
async function lote(chaves, paralelo = 12) {
  const pares = []; let falhas = 0;
  for (let i = 0; i < chaves.length; i += paralelo) {
    await Promise.all(chaves.slice(i, i + paralelo).map(async (k) => {
      try { const v = await baixar(k); if (v) pares.push({ key: k, value: v }); else falhas++; } catch (e) { falhas++; }
    }));
  }
  return { pares, falhas };
}
async function gravar(pares) {
  for (let i = 0; i < pares.length; i += 500) {
    const r = await fetch(API, { method: 'PUT', headers: { authorization: `Bearer ${CF_API_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(pares.slice(i, i + 500)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) throw new Error('KV: ' + r.status + ' ' + JSON.stringify(j.errors || j).slice(0, 300));
  }
}
// Fotos dos candidatos citados nos arquivos (uma vez por execução), em base64.
async function fotos(pares) {
  const alvo = new Set();
  for (const { key, value } of pares) {
    const m = key.match(/ele2026\/(\d+)\/dados\/(\w\w)\/(?:br|es)-c/); if (!m) continue; // só arquivos estaduais/nacionais
    const j = JSON.parse(value);
    for (const a of j.carg[0].agr) for (const p of a.par) for (const c of (p.cand || []).slice(0, 45)) if (c.sqcand) alvo.add(`oficial/ele2026/${m[1]}/fotos/${m[2]}/${c.sqcand}.jpeg`);
  }
  const out = []; let falhas = 0;
  for (const k of alvo) {
    try { const r = await fetch(BASE + k); if (!r.ok) { falhas++; continue; } out.push({ key: k, value: Buffer.from(await r.arrayBuffer()).toString('base64'), base64: true }); } catch (e) { falhas++; }
  }
  return { pares: out, falhas, total: alvo.size };
}

const hora = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const fim = Date.now() + DURACAO * 1000;
let primeira = true;
while (Date.now() < fim) {
  const t0 = Date.now();
  try {
    const { pares, falhas } = await lote(T2);
    await gravar(pares);
    const es = pares.find((p) => p.key === T2[2]); const j = es && JSON.parse(es.value);
    console.log(`${hora()} 2º turno: ${pares.length}/${T2.length} arquivos gravados, ${falhas} falhas, ${Date.now() - t0} ms` + (j ? ` · ES ${j.s.pst}% seções, ${j.and}` : ''));
    if (primeira) {
      const r1 = await lote(T1); await gravar(r1.pares); console.log(`${hora()} 1º turno: ${r1.pares.length}/${T1.length} gravados, ${r1.falhas} falhas`);
      const f = await fotos(pares.concat(r1.pares).filter((p) => /\/(br|es)-c/.test(p.key))); await gravar(f.pares); console.log(`${hora()} fotos: ${f.pares.length}/${f.total} gravadas, ${f.falhas} falhas`);
      primeira = false;
    }
  } catch (e) { console.error(hora(), 'erro:', e.message); }
  const espera = INTERVALO * 1000 - (Date.now() - t0);
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
}
console.log(hora(), 'fim da execução');
