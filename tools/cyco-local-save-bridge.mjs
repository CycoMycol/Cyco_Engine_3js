#!/usr/bin/env node
/**
 * Local save bridge for folder export from sandboxed browsers/webviews.
 * Listens on http://127.0.0.1:47623 by default.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HOST = '127.0.0.1';
const PORT = 47623;

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function sanitizeName(name) {
  const safe = String(name || 'project').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  return safe || 'project';
}

function isFileNode(node) {
  return !!node && typeof node === 'object' && node._cycoType === 'file';
}

async function openNativeDirectoryPicker() {
  const script = [
    '$shell = New-Object -ComObject Shell.Application',
    '$folder = $shell.BrowseForFolder(0, "Choose where to save the Cyco project", 0, 0)',
    'if ($folder -and $folder.Self -and $folder.Self.Path) { Write-Output $folder.Self.Path }',
  ].join('; ');

  return await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Folder picker exited with code ${code}`));
        return;
      }
      resolve(stdout.trim() || null);
    });
  });
}

async function ensureFolderTree(rootPath, tree, currentParts = []) {
  if (!tree || typeof tree !== 'object') return;
  for (const [name, child] of Object.entries(tree)) {
    const safeName = sanitizeName(name);
    const nextParts = [...currentParts, safeName];
    const targetPath = path.join(rootPath, ...nextParts);
    if (isFileNode(child)) {
      const content = child?.data != null
        ? (typeof child.data === 'string' ? child.data : JSON.stringify(child.data, null, 2))
        : '';
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, 'utf8');
      continue;
    }
    await fs.mkdir(targetPath, { recursive: true });
    await ensureFolderTree(rootPath, child, nextParts);
  }
}

async function exportProjectFolder(snapshot) {
  const selectedPath = await openNativeDirectoryPicker();
  if (!selectedPath) return { cancelled: true };

  const projectName = sanitizeName(snapshot?.name || 'project');
  const projectRoot = path.join(selectedPath, projectName);
  await fs.mkdir(projectRoot, { recursive: true });

  const projectFileName = `${projectName}.cyco`;
  await fs.writeFile(path.join(projectRoot, projectFileName), JSON.stringify(snapshot, null, 2), 'utf8');

  const assetsRoot = path.join(projectRoot, 'assets');
  await fs.mkdir(assetsRoot, { recursive: true });
  const tree = snapshot?.tree && typeof snapshot.tree === 'object' ? snapshot.tree : {};
  const assetTree = Object.fromEntries(Object.entries(tree).filter(([name]) => name !== 'engine'));
  await ensureFolderTree(assetsRoot, assetTree);

  const engineState = snapshot?.engineState || null;
  if (engineState) {
    const engineDir = path.join(projectRoot, 'engine');
    await fs.mkdir(engineDir, { recursive: true });
    await fs.writeFile(path.join(engineDir, 'cyco-engine.json'), JSON.stringify(engineState, null, 2), 'utf8');
  }

  return {
    cancelled: false,
    selectedPath,
    projectRoot,
    projectFileName,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      send(res, 204, '', {});
      return;
    }

    if (req.method === 'POST' && req.url === '/api/export-project-folder') {
      const body = await readJson(req);
      const result = await exportProjectFolder(body?.snapshot || null);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
  } catch (err) {
    sendJson(res, 500, { error: err?.message || String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[CycoLocalSaveBridge] listening on http://${HOST}:${PORT}`);
});
