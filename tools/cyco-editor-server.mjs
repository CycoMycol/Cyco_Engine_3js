#!/usr/bin/env node
/**
 * Static localhost server for the Cyco editor.
 * Serves the editor directory from http://127.0.0.1:4173 by default.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'editor');
const HOST = process.env.CYCO_EDITOR_HOST || '127.0.0.1';
const PORT = Number(process.env.CYCO_EDITOR_PORT || 4173);

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.map', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function contentTypeFor(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

async function resolvePath(requestPath) {
  const rawPath = decodeURIComponent(requestPath.split('?')[0] || '/');
  const normalized = path.normalize(rawPath).replace(/^([/\\])+/, '');
  let target = path.join(ROOT, normalized);
  let stat = null;

  try {
    stat = await fs.stat(target);
  } catch {
    return null;
  }

  if (stat.isDirectory()) {
    const indexPath = path.join(target, 'index.html');
    try {
      await fs.stat(indexPath);
      target = indexPath;
    } catch {
      return null;
    }
  }

  const resolved = path.resolve(target);
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    const filePath = await resolvePath(req.url === '/' ? '/index.html' : req.url);
    if (!filePath) {
      send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    const data = await fs.readFile(filePath);
    send(res, 200, data, { 'Content-Type': contentTypeFor(filePath) });
  } catch (err) {
    send(res, 500, `Server error: ${err?.message || String(err)}`, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[CycoEditorServer] listening on http://${HOST}:${PORT}/`);
  console.log(`[CycoEditorServer] serving ${ROOT}`);
});

