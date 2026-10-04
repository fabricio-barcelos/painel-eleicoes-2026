// Projeção da distribuição de cadeiras no sistema proporcional (Código Eleitoral, arts. 106 a 109,
// com a Lei 14.211/2021 e o entendimento do STF nas ADIs 7228, 7263 e 7325).
// Roda a cada atualização sobre os votos já totalizados: é uma PROJEÇÃO, não o resultado oficial.
//
// 1) Quociente eleitoral (QE) = votos válidos / vagas (fração até 0,5 desprezada; acima, arredonda para cima).
// 2) Quociente partidário (QP) = parte inteira de votos do partido ou federação / QE.
//    As vagas do QP vão aos mais votados da legenda que tenham ao menos 10% do QE.
// 3) Sobras, pela maior média = votos / (vagas já obtidas + 1), entre legendas com ao menos 80% do QE
//    e candidatos com ao menos 20% do QE.
// 4) Se ainda restarem vagas, maior média entre todas as legendas, sem as exigências de 80% e 20%.

export function projetarProporcional(j) {
  const carg = (j.carg && j.carg[0]) || {};
  const vagas = Number(carg.nv || 0);
  const validos = Number((j.v && j.v.vv) || 0);
  if (!vagas || !validos) return null;

  const bruto = validos / vagas;
  const qe = bruto - Math.floor(bruto) > 0.5 ? Math.ceil(bruto) : Math.floor(bruto);
  if (!qe) return null;

  const legendas = [];
  for (const agr of carg.agr || []) {
    let votos = 0;
    const cands = [];
    const siglas = [];
    for (const par of agr.par || []) {
      votos += Number(par.tvtn || 0) + Number(par.tvtl || 0);
      siglas.push(par.sg);
      for (const c of par.cand || []) {
        if (c.dvt && c.dvt !== 'Válido') continue; // anulados e sub judice não concorrem às vagas
        cands.push({ nome: c.nmu || c.nm, n: c.n, partido: par.sg, votos: Number(c.vap || 0), seq: Number(c.seq || 0), pct: c.pvap || '0,00', stTSE: c.st || '' });
      }
    }
    cands.sort((a, b) => b.votos - a.votos || a.seq - b.seq);
    legendas.push({
      nome: agr.tp === 'f' ? agr.nm : siglas[0],
      federacao: agr.tp === 'f',
      composicao: agr.tp === 'f' ? (agr.com || siglas.join(' / ')) : '',
      votos, cands, qp: 0, sobras: 0, usados: 0, vagTSE: Number(agr.vag || 0),
    });
  }

  const eleitos = [];
  const dar = (l, via, minimo) => {
    const c = l.cands[l.usados];
    if (!c || c.votos < minimo || c.votos <= 0) return false;
    l.usados++;
    eleitos.push({ ...c, legenda: l.nome, via, votosLegenda: l.votos, media: via === 'QP' ? 0 : Math.round(l.votos / (l.qp + l.sobras + 1)) });
    return true;
  };

  // QP, com a cláusula de desempenho individual de 10% do QE
  let restam = vagas;
  for (const l of legendas) {
    const direito = Math.floor(l.votos / qe);
    for (let i = 0; i < direito && restam > 0; i++) {
      if (!dar(l, 'QP', 0.1 * qe)) break;
      l.qp++; restam--;
    }
  }

  // Sobras por maior média
  const rodada = (minLegenda, minCand, via) => {
    while (restam > 0) {
      let melhor = null, media = -1;
      for (const l of legendas) {
        if (l.votos < minLegenda) continue;
        const c = l.cands[l.usados];
        if (!c || c.votos < minCand || c.votos <= 0) continue;
        const m = l.votos / (l.qp + l.sobras + 1);
        if (m > media) { media = m; melhor = l; }
      }
      if (!melhor) break;
      dar(melhor, via, minCand);
      melhor.sobras++; restam--;
    }
  };
  rodada(0.8 * qe, 0.2 * qe, 'média');
  rodada(0, 0, 'média');

  // Quem está mais perto de entrar: o próximo de cada legenda, pela média que ela teria
  const naFila = legendas
    .map((l) => ({ l, c: l.cands[l.usados], m: l.votos / (l.qp + l.sobras + 1) }))
    .filter((x) => x.c && x.c.votos > 0)
    .sort((a, b) => b.m - a.m)
    .slice(0, 5)
    .map((x) => ({ nome: x.c.nome, partido: x.c.partido, legenda: x.l.nome, votos: x.c.votos }));

  // Ordem de distribuição: primeiro as vagas do QP (legenda mais votada primeiro, e nela o mais votado),
  // depois as sobras, na sequência em que foram atribuídas.
  const doQP = eleitos.filter((e) => e.via === 'QP').sort((a, b) => b.votosLegenda - a.votosLegenda || a.legenda.localeCompare(b.legenda) || b.votos - a.votos);
  const dasSobras = eleitos.filter((e) => e.via !== 'QP');
  dasSobras.forEach((e, i) => { e.sobra = i + 1; });
  eleitos.length = 0;
  eleitos.push(...doQP, ...dasSobras);
  eleitos.forEach((e, i) => { e.vaga = i + 1; });
  const filaMedia = legendas
    .map((l) => ({ l, c: l.cands[l.usados], m: l.votos / (l.qp + l.sobras + 1) }))
    .filter((x) => x.c && x.c.votos > 0)
    .sort((a, b) => b.m - a.m)[0];
  return {
    vagas, validos, qe,
    preenchidas: eleitos.length,
    eleitos: eleitos.map(({ seq, stTSE, n, votosLegenda, ...r }) => r),
    proximaMedia: filaMedia ? { legenda: filaMedia.l.nome, media: Math.round(filaMedia.m), nome: filaMedia.c.nome } : null,
    naFila,
    bancadas: legendas
      .filter((l) => l.qp + l.sobras > 0 || l.votos >= 0.5 * qe)
      .sort((a, b) => b.qp + b.sobras - (a.qp + a.sobras) || b.votos - a.votos)
      .map((l) => ({ nome: l.nome, composicao: l.composicao, votos: l.votos, qp: l.qp, sobras: l.sobras, total: l.qp + l.sobras, atinge80: l.votos >= 0.8 * qe })),
    _confere: legendas.map((l) => ({ nome: l.nome, meu: l.qp + l.sobras, tse: l.vagTSE })),
    _eleitosN: eleitos.map((e) => e.n),
    _det: {
      eleitos: eleitos.map((e) => ({ n: String(e.n), vaga: e.vaga, via: e.via, sobra: e.sobra || 0, media: e.media })),
      legendas: legendas.map((l) => ({ nome: l.nome, votos: l.votos, vagas: l.qp + l.sobras, usados: l.usados, cands: l.cands.map((c) => ({ n: String(c.n), votos: c.votos })) })),
    },
  };
}
