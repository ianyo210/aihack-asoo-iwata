#!/usr/bin/env node
/* =========================================================
   server.mjs — ローカル開発 & リアルタイム同期サーバー
   Vercel にデプロイする api/analyze.js と同じ解析ロジックを動かしつつ、
   ローカル実演用に SSE (/api/stream) での2端末リアルタイム連携も提供する。
   ========================================================= */

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import analyzeHandler from './api/analyze.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

const sseClients = new Set();

function broadcast(eventObj) {
  const payload = `data: ${JSON.stringify(eventObj)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (e) {
        rejectBody(e);
      }
    });
    req.on('error', rejectBody);
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write('event: connected\ndata: {"ok":true}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // 言い間違い図書館の API（Vercel の関数と同じものを、ローカルでも動かす）
  if (urlPath === '/api/detect' || urlPath === '/api/transcribe') {
    const mod = await import(`./api/${urlPath.slice(5)}.js`);
    await mod.default(req, res);
    return;
  }
  if (urlPath === '/') { res.writeHead(302, { Location: '/museum.html' }); res.end(); return; } // Vercel と同じ入口

  if (urlPath === '/api/analyze') {
    if (req.method === 'POST') {
      try {
        req.body = await readJsonBody(req);
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        return;
      }
      const origEnd = res.end.bind(res);
      res.end = (chunk, ...rest) => {
        try {
          if (res.statusCode === 200 && chunk) {
            const parsed = JSON.parse(String(chunk));
            if (parsed?.ok) broadcast({ type: 'analyzed', payload: parsed });
          }
        } catch {
          // ignore broadcast parse error
        }
        return origEnd(chunk, ...rest);
      };
    }
    await analyzeHandler(req, res);
    return;
  }

  const safeRel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  if (safeRel.includes('..')) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  const filePath = join(ROOT, safeRel);
  if (!existsSync(filePath)) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }

  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`言い間違い図書館 & みまもりママコーチ サーバー起動: http://localhost:${PORT}`);
});
