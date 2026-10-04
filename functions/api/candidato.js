// GET /api/candidato?n=1234[&fonte=simulado]
// Procura o número entre os candidatos a senador, deputado federal e deputado estadual do ES e devolve os votos de cada candidato encontrado.
import { urlArquivo, baixar } from './painel.js';
import { projetarProporcional } from '../../lib/proporcional.js';

const fmt = (n) => Number(n).toLocaleString('pt-BR');

// Situação do candidato na distribuição das cadeiras (deputados), com o motivo.
function situacaoProporcional(j, c) {
  if (c.dvt && c.dvt !== 'Válido') return { rotulo: 'Fora da distribuição', tipo: 'fora', motivo: `Votos com destinação "${c.dvt}": não entram no cálculo das vagas.` };
  const pr = projetarProporcional(j);
  if (!pr) return { rotulo: 'Aguardando votos', tipo: 'aguarda', motivo: 'Ainda não há votos apurados para calcular o quociente eleitoral.' };
  const d = pr._det;
  const leg = d.legendas.find((l) => l.cands.some((x) => x.n === c.n));
  const e = d.eleitos.find((x) => x.n === c.n);
  const qe = pr.qe;
  if (e && e.via === 'QP') {
    return { rotulo: 'Eleito pelo quociente partidário', tipo: 'eleito', vaga: e.vaga, motivo: `Ocupa a ${e.vaga}ª vaga. ${leg.nome} somou ${fmt(leg.votos)} votos, o que dá ${Math.floor(leg.votos / qe)} quociente(s) de ${fmt(qe)}, e ele está entre os mais votados da legenda, com mais de 10% do quociente.` };
  }
  if (e) {
    return { rotulo: `Eleito pela ${e.sobra}ª sobra`, tipo: 'eleito', vaga: e.vaga, motivo: `Ocupa a ${e.vaga}ª vaga. ${leg.nome} teve a maior média (${fmt(e.media)}) na distribuição dessa sobra, e ele era o próximo mais votado da legenda.` };
  }
  const idx = leg.cands.findIndex((x) => x.n === c.n);
  if (leg.vagas > 0) {
    const ordem = idx - leg.usados + 1;
    const ultimo = leg.cands[leg.usados - 1];
    return { rotulo: `${ordem}º suplente`, tipo: 'suplente', motivo: `${leg.nome} tem ${leg.vagas} vaga(s) e ele é o ${idx + 1}º mais votado dela. Está a ${fmt(Math.max(0, ultimo.votos - c.votos))} votos do último eleito da legenda.` };
  }
  return { rotulo: 'Não eleito', tipo: 'nao', motivo: `${leg.nome} não alcançou vaga: tem ${fmt(leg.votos)} votos e o quociente eleitoral é ${fmt(qe)}. Sem vaga, a legenda não forma suplência.` };
}

// Senador: eleição majoritária com 2 vagas; os suplentes são os da própria chapa.
function situacaoSenador(j, c, todos) {
  const validos = Number((j.v && j.v.vv) || 0);
  if (!validos) return { rotulo: 'Aguardando votos', tipo: 'aguarda', motivo: 'Ainda não há votos apurados.' };
  if (c.dvt && c.dvt !== 'Válido') return { rotulo: 'Fora da disputa das vagas', tipo: 'fora', motivo: `Votos com destinação "${c.dvt}": não contam para a eleição enquanto essa situação durar.` };
  const vagas = Number((j.carg && j.carg[0] && j.carg[0].nv) || 2);
  const geral = todos.findIndex((x) => x.n === c.n) + 1; // posição contando também os votos sub judice
  todos = todos.filter((x) => !x.dvt || x.dvt === 'Válido');
  const pos = todos.findIndex((x) => x.n === c.n) + 1;
  if (geral <= vagas) return { rotulo: `Eleito na ${pos}ª vaga`, tipo: 'eleito', vaga: pos, motivo: `Eleição majoritária: entram os ${vagas} mais votados, e ele é o ${pos}º entre os votos válidos.` };
  if (pos <= vagas) return { rotulo: 'Vaga pendente de decisão judicial', tipo: 'suplente', motivo: `É o ${pos}º entre os votos válidos, mas há candidato com votação maior anulada sub judice. Nessa situação o TSE não atribui a vaga até a decisão da Justiça.` };
  const corte = todos[vagas - 1];
  return { rotulo: 'Não eleito', tipo: 'nao', motivo: `É o ${pos}º mais votado e entram os ${vagas} primeiros. Faltam ${fmt(corte.votos - c.votos)} votos para alcançar a ${vagas}ª vaga. No Senado não há suplência entre candidatos: os suplentes são os da chapa de cada eleito.` };
}

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
  const cargo = Number(j.carg && j.carg[0] && j.carg[0].cd);
  const situacao = cargo === 5 ? situacaoSenador(j, c, todos) : situacaoProporcional(j, c);
  situacao.projecao = j.tf !== 's';
  return { ...c, posicao: i + 1, concorrentes: todos.length, pctSecoes: s.pst || '0,00', andamento: j.and, totalizacaoFinal: j.tf === 's', situacao };
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
