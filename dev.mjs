// Servidor local para testar sem a Cloudflare:  node dev.mjs  ->  http://localhost:8788
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { onRequestGet } from './functions/api/painel.js';
import { onRequestGet as mapaGet } from './functions/api/mapa.js';
import { onRequestGet as mapaBrGet } from './functions/api/mapa-br.js';
import { onRequestGet as extGet } from './functions/api/exterior.js';
import { onRequestGet as candGet } from './functions/api/candidato.js';
import { onRequestGet as fotoGet } from './functions/api/foto.js';

const PORTA = process.env.PORT || 8788;

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORTA}`);
    if (url.pathname === '/api/painel') {
      const r = await onRequestGet({ request: new Request(url), env: process.env });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(await r.text());
      return;
    }
    if (url.pathname === '/api/candidato') { const r = await candGet({ request: new Request(url), env: process.env }); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return; }
    if (url.pathname === '/api/foto') { const r = await fotoGet({ request: new Request(url) }); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return; }
    if (url.pathname === '/api/exterior') { const r = await extGet({ env: globalThis.ENV_DEV || process.env }); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return; }
    if (url.pathname === '/api/mapa-br') { const r = await mapaBrGet({ request: new Request(url), env: process.env }); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return; }
    if (url.pathname === '/api/mapa') { const r = await mapaGet({ request: new Request(url), env: process.env }); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return; }
    try {
      if (url.pathname === '/es-mapa.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(await readFile(new URL('./public/es-mapa.json', import.meta.url))); return; }
      if (url.pathname === '/t1.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(await readFile(new URL('./public/t1.json', import.meta.url))); return; }
      if (url.pathname === '/br-mapa.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(await readFile(new URL('./public/br-mapa.json', import.meta.url))); return; }
      if (url.pathname === '/logo.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(await readFile(new URL('./public/logo.png', import.meta.url))); return; }
      const html = await readFile(new URL('./public/index.html', import.meta.url));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(404).end('not found');
    }
  })
  .listen(PORTA, () => console.log(`Painel em http://localhost:${PORTA}`));
