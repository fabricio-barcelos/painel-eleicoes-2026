// Leitura mínima do boletim de urna (BU, ASN.1/DER) do TSE: aptos, comparecimento, brancos, nulos e votos por candidato
// da eleição majoritária presente no arquivo. Usado pelo coletor do exterior, onde não há totalização antes das 17h.
function tlv(b, i) {
  let t = b[i++];
  if ((t & 0x1f) === 0x1f) { while (b[i] & 0x80) i++; i++; }
  let l = b[i++];
  if (l & 0x80) { const n = l & 0x7f; l = 0; for (let k = 0; k < n; k++) l = l * 256 + b[i++]; }
  return [t, i, l];
}
function parse(b, i = 0, end = b.length) {
  const out = [];
  while (i < end) { const [t, s, l] = tlv(b, i); out.push([t, t & 0x20 ? parse(b, s, s + l) : b.subarray(s, s + l)]); i = s + l; }
  return out;
}
const I = (b) => { let n = 0; for (const x of b) n = n * 256 + x; return n; };
function big(n) { for (const [t, v] of n) { if (Array.isArray(v)) { const r = big(v); if (r) return r; } else if (t === 4 && v.length > 300) return v; } return null; }
export function lerBU(buf) {
  const top = parse(big(parse(buf)))[0][1];
  const ids = top.find((x) => x[0] === 0x30 && Array.isArray(x[1]) && x[1].length === 3 && Array.isArray(x[1][0][1]))[1];
  const d = { mun: I(ids[0][1][0][1]), zona: I(ids[0][1][1][1]), sec: I(ids[2][1]) };
  const els = top.find((x) => x[0] === 0x30 && Array.isArray(x[1]) && x[1].length && Array.isArray(x[1][0][1]) && x[1][0][1].length >= 5 && !Array.isArray(x[1][0][1][0][1]) && [6257, 6258, 6259, 6260].includes(I(x[1][0][1][0][1])))[1];
  for (const [, e] of els) {
    d.aptos = I(e[1][1]);
    for (const [, r] of e.find((r) => Array.isArray(r[1]))[1]) {
      d.comp = I(r[1][1]);
      for (const [, tc] of r[2][1]) {
        const v = {}; let br = 0, nu = 0;
        for (const [, x] of tc[2][1]) { const tp = I(x[0][1]), q = I(x[1][1]); if (tp === 2) br += q; else if (tp === 3) nu += q; else if (tp === 1) v[String(I(x[2][1][1][1]))] = q; }
        Object.assign(d, { br, nu, v });
      }
    }
  }
  return d;
}
