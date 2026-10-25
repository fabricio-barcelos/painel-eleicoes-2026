// Coletor do exterior: soma os boletins de urna (BU) já publicados pelo TSE das 2.715 seções do exterior,
// por cidade e país, e grava t2/exterior.json no R2. Roda a cada ~10 min (workflow exterior.yml).
// Motivo: o TSE só totaliza o exterior depois das 17h, mas publica os BUs assim que cada seção encerra.
import { lerBU } from './lib/bu.mjs';
import { createHash } from 'node:crypto';

const { CF_ACCOUNT_ID, CF_API_TOKEN } = process.env;
const BUCKET = process.env.CF_R2_BUCKET || 'tse-eleicoes-2026';
const SO_LER = process.argv.includes('--so-ler');
if (!SO_LER && (!CF_ACCOUNT_ID || !CF_API_TOKEN)) { console.error('faltam CF_ACCOUNT_ID ou CF_API_TOKEN'); process.exit(1); }
const PLEITO = '3221', ELE = '6258';
const B = `https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/${PLEITO}`;
const API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/`;
const DURACAO = Number(process.argv[2] || 20400), INTERVALO = Number(process.argv[3] || 600);
const hora = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });

const cs = await (await fetch(`${B}/config/zz/zz-p00${PLEITO}-cs.json`)).json();
const cidades = cs.abr[0].mu;
// nomes dos candidatos a partir do arquivo de divulgação do exterior
const div = await (await fetch(`https://resultados.tse.jus.br/oficial/ele2026/${ELE}/dados/zz/zz-c0001-e00${ELE}-u.json`)).json();
const cands = {}; for (const a of div.carg[0].agr) for (const p of a.par) for (const c of p.cand) cands[c.n] = { nome: c.nmu, partido: p.sg, sq: c.sqcand };
// país de cada cidade: do cadastro de locais de votação não há; usa a tabela do TSE embutida no nome quando houver, senão fica "—"
const secoes = {}; // chave -> dados lidos (cache entre ciclos: BU não muda depois de recebido)
let hashAnt = '';
async function lerSecao(m, z, s) {
  const k = `${m}-${z}-${s}`; if (secoes[k]) return secoes[k];
  const a = await fetch(`${B}/dados/zz/${m}/${z}/${s}/p00${PLEITO}-zz-m${m}-z${z}-s${s}-aux.json`); if (!a.ok) return null;
  const j = await a.json(); const h = (j.hashes || []).find((x) => x.arq && x.arq.some((f) => f.tp === 'bu')); if (!h) return null;
  const f = h.arq.find((x) => x.tp === 'bu');
  const r = await fetch(`${B}/dados/zz/${m}/${z}/${s}/${h.hash}/${f.nm}`); if (!r.ok) return null;
  try { secoes[k] = lerBU(new Uint8Array(await r.arrayBuffer())); return secoes[k]; } catch (e) { return null; }
}
async function passada() {
  const jobs = []; for (const m of cidades) for (const z of m.zon) for (const s of z.sec) if (!s.nsp) jobs.push([m, z.cd, s.ns]); // seções agregadas (nsp) votam na urna da principal
  let lidas = 0;
  for (let i = 0; i < jobs.length; i += 16) await Promise.all(jobs.slice(i, i + 16).map(async ([m, z, s]) => { if (await lerSecao(m.cd, z, s)) lidas++; }));
  const porCidade = {};
  for (const m of cidades) {
    const c = { nome: m.nm, secoes: 0, recebidas: 0, aptos: 0, comp: 0, br: 0, nu: 0, v: {} };
    for (const z of m.zon) for (const s of z.sec) { if (s.nsp) continue; c.secoes++; const d = secoes[`${m.cd}-${z.cd}-${s.ns}`]; if (!d) continue; c.recebidas++; c.aptos += d.aptos; c.comp += d.comp; c.br += d.br; c.nu += d.nu; for (const [n, q] of Object.entries(d.v)) c.v[n] = (c.v[n] || 0) + q; }
    porCidade[m.cd] = c;
  }
  const tot = { secoes: jobs.length, recebidas: lidas, aptos: 0, comp: 0, br: 0, nu: 0, v: {} };
  for (const c of Object.values(porCidade)) { tot.aptos += c.aptos; tot.comp += c.comp; tot.br += c.br; tot.nu += c.nu; for (const [n, q] of Object.entries(c.v)) tot.v[n] = (tot.v[n] || 0) + q; }
  return { atualizado: new Date().toISOString(), fonte: 'boletins de urna (parcial, antes da totalização do TSE)', cands, total: tot, cidades: porCidade };
}
const fim = Date.now() + DURACAO * 1000;
do {
  const t0 = Date.now();
  try {
    const r = await passada(); const corpo = JSON.stringify(r); const h = createHash('sha1').update(corpo).digest('hex');
    console.log(`${hora()} exterior: ${r.total.recebidas}/${r.total.secoes} seções com BU · comp ${r.total.comp} · ` + Object.entries(r.total.v).map(([n, q]) => `${cands[n] ? cands[n].nome : n} ${q}`).join(' · ') + ` · ${Date.now() - t0} ms`);
    if (SO_LER) { if (process.argv.includes('--json')) { console.log('JSON' + corpo); break; } console.log(JSON.stringify(Object.values(r.cidades).filter((c) => c.recebidas).sort((a, b) => b.comp - a.comp).slice(0, 12))); break; }
    if (h !== hashAnt) { const p = await fetch(API + 't2/exterior.json', { method: 'PUT', headers: { authorization: `Bearer ${CF_API_TOKEN}`, 'content-type': 'application/json' }, body: corpo }); if (!p.ok) throw new Error('R2 ' + p.status); hashAnt = h; console.log(hora(), 'gravado t2/exterior.json'); }
  } catch (e) { console.error(hora(), 'erro:', e.message); }
  const espera = INTERVALO * 1000 - (Date.now() - t0); if (espera > 0 && Date.now() < fim) await new Promise((r) => setTimeout(r, espera));
} while (Date.now() < fim);
