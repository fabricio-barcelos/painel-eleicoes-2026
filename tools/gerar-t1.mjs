// Gera public/t1.json: resultado FINAL do 1º turno (04/10/2026) de Presidente e Governador,
// no Brasil, no ES e em cada município do ES. É a base fixa de comparação do painel do 2º turno.
// Uso: node tools/gerar-t1.mjs   (lê só arquivos oficiais do TSE com totalização final)
import fs from 'node:fs';
import { MUNICIPIOS, urlArquivo, baixar } from '../functions/api/painel.js';

function resumo(j) {
  if (j.tf !== 's') throw new Error('arquivo sem totalização final: ' + j.cdabr);
  const c = {}; let lider = null, max = -1;
  for (const a of j.carg[0].agr) for (const p of a.par) for (const x of p.cand || []) {
    const v = Number(x.vap || 0);
    c[x.n] = { v, pct: x.pvap, nome: x.nmu || x.nm, partido: p.sg };
    if (v > max) { max = v; lider = x.n; }
  }
  const e = j.e, v = j.v;
  return { lider, c, vv: Number(v.vv), tv: Number(v.tv), vb: Number(v.vb), vn: Number(v.tvn), te: Number(e.te), comp: Number(e.c), abst: Number(e.a), pa: e.pa };
}
async function pega(tipo, abr, cargo) {
  const r = await baixar(urlArquivo('oficial', tipo, abr, cargo, 1));
  if (!r.dados) throw new Error(`falha ${abr} ${cargo}: ${r.erro}`);
  return resumo(r.dados);
}
const out = { turno: 1, data: '04/10/2026', geradoEm: new Date().toISOString(), mun: { presidente: {}, governador: {} } };
out.presidenteBR = await pega('federal', 'br', '0001');
out.presidenteES = await pega('federal', 'es', '0001');
out.governador = await pega('estadual', 'es', '0003');
const cds = Object.keys(MUNICIPIOS).sort();
for (let i = 0; i < cds.length; i += 13) {
  await Promise.all(cds.slice(i, i + 13).flatMap((cd) => [
    pega('federal', 'es' + cd, '0001').then((r) => { out.mun.presidente[cd] = r; }),
    pega('estadual', 'es' + cd, '0003').then((r) => { out.mun.governador[cd] = r; }),
  ]));
}
// Nos municípios só interessam os dois finalistas e o líder: enxuga os demais candidatos.
const fin = { presidente: Object.entries(out.presidenteBR.c).sort((a, b) => b[1].v - a[1].v).slice(0, 2).map((x) => x[0]), governador: Object.entries(out.governador.c).sort((a, b) => b[1].v - a[1].v).slice(0, 2).map((x) => x[0]) };
out.finalistas = fin;
for (const cargo of ['presidente', 'governador']) for (const cd of cds) {
  const m = out.mun[cargo][cd]; const c = {};
  for (const n of new Set([...fin[cargo], m.lider])) if (m.c[n]) c[n] = m.c[n];
  m.c = c;
}
fs.writeFileSync(new URL('../public/t1.json', import.meta.url), JSON.stringify(out));
console.log('ok', Object.keys(out.mun.governador).length, Object.keys(out.mun.presidente).length, fin, out.governador.vv, out.presidenteBR.vv);
