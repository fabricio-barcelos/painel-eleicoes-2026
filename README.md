# Painel de apuração 2026 · Presidente e Espírito Santo

Painel web que acompanha a apuração em tempo real com os arquivos oficiais de divulgação do TSE.

- `public/index.html`: o painel (atualiza sozinho a cada 30 s).
- `functions/api/painel.js`: Cloudflare Pages Function que busca os JSONs do TSE, enxuga e guarda 30 s em cache na borda.
- `dev.mjs`: servidor local de teste (`node dev.mjs` e abrir http://localhost:8788).

## Publicar (Cloudflare Pages + GitHub)

1. Crie um repositório no GitHub e envie esta pasta (`git remote add origin ...`, `git push -u origin main`).
2. No painel da Cloudflare: Workers & Pages > Create > Pages > Connect to Git, e escolha o repositório.
3. Build settings: Framework preset `None`, Build command vazio, Build output directory `public`.
4. Save and Deploy. Cada `git push` republica sozinho.

## Fonte dos dados

- Oficial: `https://resultados.tse.jus.br/oficial/ele2026/{eleição}/dados/...`, eleições 6257 (Presidente) e 6259 (estaduais), 1º turno.
- `?fonte=simulado` na URL do painel mostra o simulado do TSE (candidatos fictícios, 100% apurado), útil para ver a tela cheia.
- Variável de ambiente opcional `TSE_MODO` = `auto` (padrão), `oficial` ou `simulado`.

## 2º turno (25/10)

Trocar os códigos `federal` e `estadual` em `FONTES.oficial` pelos do 2º turno, publicados pelo TSE em
https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados
