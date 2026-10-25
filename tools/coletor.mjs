// Coletor: baixa os arquivos do TSE fora da Cloudflare e os espelha no R2 (binding R2 do Pages), em pacotes.
// Uso: CF_ACCOUNT_ID, CF_R2_BUCKET, CF_API_TOKEN no ambiente.  node tools/coletor.mjs [duração s] [intervalo s]
// Motivo: o TSE responde 403 às bordas da Cloudflare (25/10/2026) e o KV gratuito limita 1.000 gravações/dia.
// No R2, cada ciclo grava só 3 objetos (pacotes), e só os que mudaram.
import { createHash } from 'node:crypto';
import { MUNICIPIOS } from '../functions/api/painel.js';

const { CF_ACCOUNT_ID, CF_API_TOKEN } = process.env;
const BUCKET = process.env.CF_R2_BUCKET || 'tse-eleicoes-2026';
if (!CF_ACCOUNT_ID || !CF_API_TOKEN) { console.error('faltam CF_ACCOUNT_ID ou CF_API_TOKEN'); process.exit(1); }
const DURACAO = Number(process.argv[2] || 20400);
const INTERVALO = Number(process.argv[3] || 30);
const BASE = 'https://resultados.tse.jus.br/';
const API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/`;
const cds = Object.keys(MUNICIPIOS);
const UFS = 'ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to zz'.split(' ');
const pad6 = (n) => String(n).padStart(6, '0');
const arq = (ele, abr, cargo) => `oficial/ele2026/${ele}/dados/${abr.slice(0, 2)}/${abr}-c${cargo}-e${pad6(ele)}-u.json`;

// Pacotes: nome do objeto no R2 -> lista de arquivos do TSE que ele contém (chave = caminho no TSE).
const PACOTES = {
  't2/estaduais.json': [arq('6258', 'br', '0001'), arq('6260', 'es', '0003')].concat(UFS.map((uf) => arq('6258', uf, '0001'))),
  't2/mun-presidente.json': cds.map((cd) => arq('6258', 'es' + cd, '0001')),
  't2/mun-governador.json': cds.map((cd) => arq('6260', 'es' + cd, '0003')),
};
const PACOTES_T1 = {
  't1/estaduais.json': [arq('6257', 'br', '0001'), arq('6259', 'es', '0003'), arq('6259', 'es', '0005'), arq('6259', 'es', '0006'), arq('6259', 'es', '0007')].concat(UFS.map((uf) => arq('6257', uf, '0001'))),
  't1/mun-presidente.json': cds.map((cd) => arq('6257', 'es' + cd, '0001')),
  't1/mun-governador.json': cds.map((cd) => arq('6259', 'es' + cd, '0003')),
};

async function baixar(chave) {
  const r = await fetch(BASE + chave, { headers: { accept: 'application/json', 'user-agent': 'painel-eleicoes-es/1.0 (coletor)' } });
  return r.ok ? r.text() : null;
}
async function lote(chaves, paralelo = 12) {
  const out = {}; let falhas = 0;
  for (let i = 0; i < chaves.length; i += paralelo) {
    await Promise.all(chaves.slice(i, i + paralelo).map(async (k) => {
      try { const v = await baixar(k); if (v) out[k] = JSON.parse(v); else falhas++; } catch (e) { falhas++; }
    }));
  }
  return { out, falhas };
}
const hashes = {};
async function gravar(nome, corpo, tipo = 'application/json') {
  const h = createHash('sha1').update(corpo).digest('hex');
  if (hashes[nome] === h) return false; // nada mudou: não gasta gravação
  const r = await fetch(API + nome, { method: 'PUT', headers: { authorization: `Bearer ${CF_API_TOKEN}`, 'content-type': tipo }, body: corpo });
  if (!r.ok) throw new Error(`R2 ${nome}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  hashes[nome] = h; return true;
}
async function pacotes(defs) {
  let gravados = 0, falhas = 0, total = 0, mudou = [];
  for (const [nome, chaves] of Object.entries(defs)) {
    const { out, falhas: f } = await lote(chaves); falhas += f; total += chaves.length;
    if (Object.keys(out).length) { if (await gravar(nome, JSON.stringify(out))) mudou.push(nome); gravados += Object.keys(out).length; }
  }
  return { gravados, total, falhas, mudou };
}
// Fotos (uma vez por execução, só as que ainda não estão no bucket): objetos individuais, sem pressa.
async function fotos(defs) {
  const alvo = new Set();
  for (const [nome, chaves] of Object.entries(defs)) {
    if (!nome.includes('estaduais')) continue;
    const { out } = await lote(chaves);
    for (const [k, j] of Object.entries(out)) {
      const m = k.match(/ele2026\/(\d+)\/dados\/(\w\w)\//);
      for (const a of j.carg[0].agr) for (const p of a.par) for (const c of (p.cand || []).slice(0, 45)) if (c.sqcand) alvo.add(`oficial/ele2026/${m[1]}/fotos/${m[2]}/${c.sqcand}.jpeg`);
    }
  }
  let ok = 0, falhas = 0, jaTinha = 0;
  for (const k of alvo) {
    try {
      const h = await fetch(API + k, { method: 'HEAD', headers: { authorization: `Bearer ${CF_API_TOKEN}` } });
      if (h.ok) { jaTinha++; continue; }
      const r = await fetch(BASE + k); if (!r.ok) { falhas++; continue; }
      await gravar(k, Buffer.from(await r.arrayBuffer()), 'image/jpeg'); ok++;
      await new Promise((s) => setTimeout(s, 350)); // ~3/s, bem abaixo do limite da API
    } catch (e) { falhas++; }
  }
  return { ok, falhas, jaTinha, total: alvo.size };
}

const hora = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const fim = Date.now() + DURACAO * 1000;
let primeira = true;
while (Date.now() < fim) {
  const t0 = Date.now();
  try {
    const r = await pacotes(PACOTES);
    console.log(`${hora()} 2º turno: ${r.gravados}/${r.total} arquivos, ${r.falhas} falhas, pacotes gravados: ${r.mudou.length ? r.mudou.join(' ') : 'nenhum (sem mudança)'}, ${Date.now() - t0} ms`);
    if (primeira) {
      primeira = false;
      const r1 = await pacotes(PACOTES_T1); console.log(`${hora()} 1º turno: ${r1.gravados}/${r1.total} arquivos, ${r1.falhas} falhas, pacotes: ${r1.mudou.join(' ')}`);
      fotos({ ...PACOTES, ...PACOTES_T1 }).then((f) => console.log(`${hora()} fotos: ${f.ok} gravadas, ${f.jaTinha} já existiam, ${f.falhas} falhas, de ${f.total}`)).catch((e) => console.error(hora(), 'fotos:', e.message));
    }
  } catch (e) { console.error(hora(), 'erro:', e.message); }
  const espera = INTERVALO * 1000 - (Date.now() - t0);
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
}
console.log(hora(), 'fim da execução');
