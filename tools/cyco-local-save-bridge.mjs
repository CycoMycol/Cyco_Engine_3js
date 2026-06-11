#!/usr/bin/env node
/**
 * Local save bridge for Cyco Engine.
 * Run with: node tools/cyco-local-save-bridge.mjs
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const HOST = '127.0.0.1';
const PORT = 47623;
const execFileAsync = promisify(execFile);
let isPickingFolder = false;

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(text);
}

function sanitizeName(name) {
  const safe = String(name || 'project').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  return safe || 'project';
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 25 * 1024 * 1024) throw new Error('Request body is too large.');
  }
  return body ? JSON.parse(body) : {};
}

async function ensureFolderTree(rootPath, tree) {
  if (!tree || typeof tree !== 'object') return;
  for (const [name, child] of Object.entries(tree)) {
    const safeName = sanitizeName(name);
    const childPath = path.join(rootPath, safeName);
    await fs.mkdir(childPath, { recursive: true });
    if (child && typeof child === 'object') {
      await ensureFolderTree(childPath, child);
    }
  }
}

async function createProject(payload) {
  const safeProjectName = sanitizeName(payload.name);
  const location = String(payload.location || '').trim();
  if (!location) throw new Error('No project location was provided.');

  const rootPath = path.resolve(location);
  const parsedRoot = path.parse(rootPath).root;
  if (rootPath === parsedRoot) {
    throw new Error(`Refusing to create a project directly in the drive root: ${rootPath}`);
  }
  const projectPath = payload.createFolder ? path.join(rootPath, safeProjectName) : rootPath;
  const fileName = `${safeProjectName}.cyco`;
  const filePath = path.join(projectPath, fileName);

  await fs.mkdir(projectPath, { recursive: true });
  await ensureFolderTree(projectPath, payload.tree);
  await fs.writeFile(filePath, JSON.stringify(payload.snapshot || {}, null, 2), 'utf8');

  return {
    ok: true,
    rootPath,
    projectPath,
    filePath,
    fileName,
    folders: Object.keys(payload.tree || {}),
  };
}

async function pickFolder() {
  if (isPickingFolder) {
    return { ok: false, busy: true, error: 'A folder picker is already open.' };
  }
  isPickingFolder = true;
  console.info('[CycoLocalSaveBridge] opening folder picker');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.Application]::EnableVisualStyles()',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.Text = "Cyco Folder Picker"',
    '$owner.Width = 1',
    '$owner.Height = 1',
    '$owner.StartPosition = "CenterScreen"',
    '$owner.ShowInTaskbar = $false',
    '$owner.TopMost = $true',
    '$owner.Opacity = 0',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$dialog.Description = "Select Cyco project location"',
    '$dialog.ShowNewFolderButton = $true',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$owner.Show()',
    '$owner.Activate()',
    '$result = $dialog.ShowDialog($owner)',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }',
    '$dialog.Dispose()',
    '$owner.Close()',
    '$owner.Dispose()',
  ].join('; ');

  try {
    const { stdout, stderr } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], { windowsHide: false, timeout: 10 * 60 * 1000 });

    const selectedPath = stdout.trim();
    console.info('[CycoLocalSaveBridge] folder picker returned', { selectedPath, stderr: stderr?.trim() || '' });
    if (!selectedPath) return { ok: true, cancelled: true, path: '' };
    return { ok: true, path: selectedPath };
  } finally {
    isPickingFolder = false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      return sendJson(res, 204, {});
    }

    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true, name: 'cyco-local-save-bridge' });
    }

    if (req.method === 'POST' && req.url === '/pick-folder') {
      const result = await pickFolder();
      console.info('[CycoLocalSaveBridge] pick folder', result);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && req.url === '/create-project') {
      const payload = await readJson(req);
      const result = await createProject(payload);
      console.info('[CycoLocalSaveBridge] created project', result);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { ok: false, error: 'Not found.' });
  } catch (err) {
    console.error('[CycoLocalSaveBridge] error', err);
    return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.info(`[CycoLocalSaveBridge] listening on http://${HOST}:${PORT}`);
});

export { server };
