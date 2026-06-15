#!/usr/bin/env node
/**
 * Local save bridge for Cyco Engine.
 * Run with: node tools/cyco-local-save-bridge.mjs
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import { watch as fsWatcher, existsSync as fsExistsSync, statSync as fsStatSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// A synchronous fs facade used by the clipboard op (need to check existence
// before naming the disambiguated target).
const fsSync = { existsSync: fsExistsSync, statSync: fsStatSync };

const HOST = '127.0.0.1';
const PORT = 47623;
const execFileAsync = promisify(execFile);
let isPickingFolder = false;

// In-process filesystem watcher state. Tracks the most recent watch target so
// the editor can poll for changes between scans.
let activeWatcher = null;          // fs.FSWatcher handle
let activeWatchTarget = null;      // absolute path being watched
let pendingWatchEvents = [];       // queue of { kind, path, time } events
let lastWatchEventAt = 0;

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

/**
 * Folder picker support: list drives, list a folder, create a folder.
 * These back the in-page custom folder panel so the editor can offer a
 * modern, browser-style picker without leaving the page or invoking a
 * system dialog.
 */

const HIDDEN_PREFIXES_WIN = ['.', '$'];     // Windows hidden files start with .
const RESERVED_WIN = /[\\/:*?"<>|]/g;

async function listDrives() {
  const out = [];
  const home = os.homedir();

  // Common quick-access roots. Best-effort — missing directories are dropped.
  const quick = [
    { kind: 'home',       label: 'Home',        path: home },
    { kind: 'desktop',    label: 'Desktop',     path: path.join(home, 'Desktop') },
    { kind: 'documents',  label: 'Documents',   path: path.join(home, 'Documents') },
    { kind: 'downloads',  label: 'Downloads',   path: path.join(home, 'Downloads') },
    { kind: 'pictures',   label: 'Pictures',    path: path.join(home, 'Pictures') },
    { kind: 'music',      label: 'Music',       path: path.join(home, 'Music') },
    { kind: 'videos',     label: 'Videos',      path: path.join(home, 'Videos') },
  ];
  for (const q of quick) {
    try {
      const st = await fs.stat(q.path);
      if (st.isDirectory()) out.push({ ...q, exists: true });
    } catch { /* skip missing */ }
  }

  // Drive letters on Windows, "/" + home on POSIX.
  if (process.platform === 'win32') {
    for (let code = 65; code <= 90; code += 1) {
      const letter = String.fromCharCode(code);
      const drive = `${letter}:\\`;
      try {
        await fs.readdir(drive);
        out.push({ kind: 'drive', label: `${letter}:`, path: drive });
      } catch { /* not mounted */ }
    }
  } else {
    out.push({ kind: 'drive', label: '/', path: '/' });
    out.push({ kind: 'home',  label: '~', path: home });
  }

  return out;
}

async function listFolder(folderPath, { showHidden = false } = {}) {
  const resolved = path.resolve(String(folderPath || ''));
  if (!resolved) throw new Error('No folder path was provided.');

  let entries;
  try {
    entries = await fs.readdir(resolved, { withFileTypes: true });
  } catch (err) {
    const e = new Error(`Cannot read folder: ${err?.message || err}`);
    e.status = 404;
    throw e;
  }

  const items = [];
  for (const entry of entries) {
    const name = entry.name;
    const isHidden = HIDDEN_PREFIXES_WIN.some((p) => name.startsWith(p));
    if (isHidden && !showHidden) continue;

    const full = path.join(resolved, name);
    let stat;
    try { stat = await fs.stat(full); } catch { continue; }

    items.push({
      name,
      type: entry.isDirectory() ? 'dir' : 'file',
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
      hidden: isHidden,
    });
  }

  // Folders first, then files. Both groups sorted by name.
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  let parent = null;
  if (path.dirname(resolved) !== resolved) {
    parent = path.dirname(resolved);
  }

  return {
    ok: true,
    path: resolved,
    parent,
    items,
    hidden: !!showHidden,
  };
}

async function mkdirPath(parent, name) {
  const safe = String(name || '').trim().replace(RESERVED_WIN, '-').replace(/^\.+/, '');
  if (!safe) throw new Error('Folder name is empty or contains only invalid characters.');
  const resolved = path.resolve(String(parent || ''));
  if (!resolved) throw new Error('No parent path was provided.');
  const target = path.join(resolved, safe);
  try {
    await fs.mkdir(target, { recursive: false });
  } catch (err) {
    if (err?.code === 'EEXIST') {
      const e = new Error(`A folder named "${safe}" already exists.`);
      e.status = 409;
      throw e;
    }
    throw err;
  }
  return { ok: true, path: target, name: safe };
}

async function renamePath(srcPath, newName) {
  const safe = String(newName || '').trim().replace(RESERVED_WIN, '-').replace(/^\.+/, '');
  if (!safe) throw new Error('New name is empty or contains only invalid characters.');
  const resolved = path.resolve(String(srcPath || ''));
  if (!resolved) throw new Error('No source path was provided.');
  if (resolved === path.parse(resolved).root) throw new Error('Refusing to rename a drive root.');
  const target = path.join(path.dirname(resolved), safe);
  if (target === resolved) return { ok: true, path: resolved, name: safe, noop: true };
  if (fsSync.existsSync(target)) {
    const e = new Error(`A folder named "${safe}" already exists.`);
    e.status = 409;
    throw e;
  }
  try {
    await fs.rename(resolved, target);
  } catch (err) {
    if (err?.code === 'EPERM' && fsSync.existsSync(target)) {
      const e = new Error(`A folder named "${safe}" already exists.`);
      e.status = 409;
      throw e;
    }
    throw err;
  }
  return { ok: true, path: target, name: safe };
}

async function deletePath(targetPath) {
  const resolved = path.resolve(String(targetPath || ''));
  if (!resolved) throw new Error('No path was provided.');
  if (resolved === path.parse(resolved).root) throw new Error('Refusing to delete a drive root.');
  const st = await fs.stat(resolved);
  if (st.isDirectory()) {
    await fs.rm(resolved, { recursive: true, force: false });
  } else {
    await fs.unlink(resolved);
  }
  return { ok: true, path: resolved, name: path.basename(resolved) };
}

async function clipboardOp(op, srcPath, destDir) {
  if (!srcPath) throw new Error('No source path was provided.');
  if (!destDir) throw new Error('No destination path was provided.');
  if (op !== 'copy' && op !== 'cut' && op !== 'duplicate') {
    throw new Error(`Unsupported clipboard op: ${op}`);
  }
  const src = path.resolve(String(srcPath));
  const dest = path.resolve(String(destDir));
  if (!fsSync.existsSync(src)) throw new Error(`Source does not exist: ${src}`);
  if (src === dest) throw new Error('Source and destination are the same.');

  const baseName = path.basename(src);
  let target = path.join(dest, baseName);
  if (src.toLowerCase() === target.toLowerCase() || fsSync.existsSync(target)) {
    // Auto-disambiguate: name (2), name (3), …
    const ext = path.extname(baseName);
    const stem = baseName.slice(0, baseName.length - ext.length);
    let i = 2;
    while (fsSync.existsSync(path.join(dest, `${stem} (${i})${ext}`))) i += 1;
    target = path.join(dest, `${stem} (${i})${ext}`);
  }

  // Use copy+remove for 'cut' to handle cross-volume cases robustly.
  const effective = (op === 'cut') ? 'copy-then-remove' : op;
  if (effective === 'duplicate' || effective === 'copy' || effective === 'copy-then-remove') {
    await copyRecursive(src, target);
  }
  if (effective === 'copy-then-remove') {
    await fs.rm(src, { recursive: true, force: false });
  }
  return { ok: true, path: target, name: path.basename(target), op };
}

async function copyRecursive(src, dest) {
  const st = await fs.stat(src);
  if (st.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyRecursive(path.join(src, entry.name), path.join(dest, entry.name));
    }
  } else {
    await fs.copyFile(src, dest);
  }
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
    if (child && typeof child === 'object' && child._cycoType === 'file') continue;
    const safeName = sanitizeName(name);
    const childPath = path.join(rootPath, safeName);
    await fs.mkdir(childPath, { recursive: true });
    if (child && typeof child === 'object') {
      await ensureFolderTree(childPath, child);
    }
  }
}

/**
 * Scan a project folder and return a tree compatible with ProjectManager.
 * Folders become plain objects, files become `{ _cycoType: 'file', type, mimeType, size, data }`.
 * The .cyco project file itself is excluded (it is the project document, not an asset).
 */
async function scanFolderAsTree(folderPath, depth = 0) {
  if (depth > 8) return {};
  let entries;
  try {
    entries = await fs.readdir(folderPath, { withFileTypes: true });
  } catch {
    return {};
  }
  const tree = {};
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.toLowerCase().endsWith('.cyco')) continue;
    const full = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      tree[entry.name] = await scanFolderAsTree(full, depth + 1);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(full);
        // Read small text/asset files inline so they round-trip in the project
        // snapshot. Skip anything > 4 MB to keep the snapshot reasonable.
        let data = '';
        let mimeType = '';
        if (stat.size <= 4 * 1024 * 1024) {
          const buf = await fs.readFile(full);
          data = `data:${mimeType};base64,${buf.toString('base64')}`;
        }
        tree[entry.name] = {
          _cycoType: 'file',
          type: guessAssetType(entry.name),
          mimeType,
          size: stat.size,
          data,
          metadata: { source: 'disk-scan', scannedAt: Date.now() },
        };
      } catch {
        // skip files we can't read
      }
    }
  }
  return tree;
}

function guessAssetType(name) {
  const ext = String(name).split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'hdr', 'exr', 'ktx2', 'basis'].includes(ext)) return 'texture';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(ext)) return 'audio';
  if (['glb', 'gltf', 'fbx', 'obj'].includes(ext)) return 'model';
  if (['js', 'ts', 'mjs', 'cjs'].includes(ext)) return 'script';
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'font';
  if (['mtl', 'mat'].includes(ext)) return 'material';
  if (['cyco', 'json'].includes(ext)) return 'engine-state';
  return 'file';
}

/**
 * Default project bootstrap script.
 * Runs once when the project is opened. Use it to pre-create scene objects,
 * register asset factories, set up physics, etc.
 *
 *   cyco.sceneManager  - SceneManager (addObject, switchScene, …)
 *   cyco.objectFactory - ObjectFactory (create, loadFile, …)
 *   projectManager     - ProjectManager (refreshFromDisk, saveProjectFile, …)
 *   project            - the loaded project snapshot
 */
const DEFAULT_BOOTSTRAP = `// Cyco Engine — Project Bootstrap
// Runs once when this project is opened. Use this file to:
//   • pre-populate the scene with starter objects,
//   • register custom asset factories,
//   • set up physics / lighting defaults.
// Available globals: cyco, projectManager, project, sceneManager, objectFactory

(function bootstrap() {
  try {
    // Example: log a friendly message so the author knows the script ran.
    console.info('[Cyco Bootstrap] Running bootstrap for', project && project.name);
  } catch (err) {
    console.warn('[Cyco Bootstrap] failed:', err);
  }
})();
`;

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

  // Always create the engine/ folder with a default bootstrap.js the
  // first time a project is created. The bootstrap is referenced by
  // the .cyco file and runs every time the project is opened.
  const engineDir = path.join(projectPath, 'engine');
  await fs.mkdir(engineDir, { recursive: true });
  const bootstrapPath = path.join(engineDir, 'bootstrap.js');
  try {
    await fs.stat(bootstrapPath);
  } catch {
    await fs.writeFile(bootstrapPath, DEFAULT_BOOTSTRAP, 'utf8');
  }

  // Persist the engineBootstrap reference into the snapshot if not provided.
  const snapshot = { ...(payload.snapshot || {}) };
  if (!snapshot.engineBootstrap) {
    snapshot.engineBootstrap = {
      source: DEFAULT_BOOTSTRAP,
      scriptPath: 'engine/bootstrap.js',
    };
  } else if (typeof snapshot.engineBootstrap === 'string') {
    snapshot.engineBootstrap = {
      source: snapshot.engineBootstrap,
      scriptPath: 'engine/bootstrap.js',
    };
  }

  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  if (snapshot.engineState) {
    await fs.writeFile(
      path.join(engineDir, 'cyco-engine.json'),
      JSON.stringify(snapshot.engineState, null, 2),
      'utf8',
    );
  }

  return {
    ok: true,
    rootPath,
    projectPath,
    filePath,
    fileName,
    folders: Object.keys(payload.tree || {}),
    bootstrapPath: 'engine/bootstrap.js',
  };
}

async function writeProject(payload) {
  const filePath = path.resolve(String(payload.filePath || '').trim());
  if (!filePath || !filePath.toLowerCase().endsWith('.cyco')) {
    throw new Error('No valid .cyco project file path was provided.');
  }

  const projectPath = payload.projectPath
    ? path.resolve(String(payload.projectPath))
    : path.dirname(filePath);
  if (!filePath.startsWith(projectPath)) {
    throw new Error('Refusing to write a project outside its project folder.');
  }

  // Ensure the engine/ folder exists so the bootstrap can be re-saved.
  const engineDir = path.join(projectPath, 'engine');
  await fs.mkdir(engineDir, { recursive: true });

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload.snapshot || {}, null, 2), 'utf8');

  if (payload.snapshot?.engineState) {
    await fs.writeFile(
      path.join(engineDir, 'cyco-engine.json'),
      JSON.stringify(payload.snapshot.engineState, null, 2),
      'utf8',
    );
  }

  // If the snapshot references a bootstrap script by relative path, mirror
  // the latest source to disk so the bridge file picker round-trip stays
  // in sync with whatever the editor most recently ran.
  const bootstrap = payload.snapshot?.engineBootstrap;
  if (bootstrap && bootstrap.scriptPath && typeof bootstrap.source === 'string') {
    const safeRel = String(bootstrap.scriptPath).replace(/\\+/g, '/').replace(/^[/]+/, '');
    if (!safeRel.includes('..')) {
      const target = path.join(projectPath, safeRel);
      if (target.startsWith(projectPath)) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bootstrap.source, 'utf8');
      }
    }
  }

  return {
    ok: true,
    projectPath,
    filePath,
    fileName: path.basename(filePath),
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

    if (req.method === 'GET' && req.url === '/list-drives') {
      const drives = await listDrives();
      return sendJson(res, 200, { ok: true, drives });
    }

    if (req.method === 'POST' && req.url === '/list-folder') {
      const payload = await readJson(req);
      const result = await listFolder(payload.path, { showHidden: !!payload.showHidden });
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && req.url === '/mkdir') {
      const payload = await readJson(req);
      const result = await mkdirPath(payload.parent, payload.name);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && req.url === '/rename') {
      const payload = await readJson(req);
      const result = await renamePath(payload.path, payload.newName);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && req.url === '/delete') {
      const payload = await readJson(req);
      const result = await deletePath(payload.path);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && req.url === '/clipboard-op') {
      const payload = await readJson(req);
      const result = await clipboardOp(payload.op, payload.src, payload.dest);
      return sendJson(res, 200, result);
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

    if (req.method === 'POST' && req.url === '/write-project') {
      const payload = await readJson(req);
      const result = await writeProject(payload);
      console.info('[CycoLocalSaveBridge] wrote project', result);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && req.url === '/read-project') {
      const payload = await readJson(req);
      const filePath = path.resolve(String(payload.filePath || '').trim());
      if (!filePath || !filePath.toLowerCase().endsWith('.cyco')) {
        return sendJson(res, 400, { ok: false, error: 'No valid .cyco project file path was provided.' });
      }
      try {
        const text = await fs.readFile(filePath, 'utf8');
        return sendJson(res, 200, {
          ok: true,
          filePath,
          projectPath: path.dirname(filePath),
          text,
        });
      } catch (err) {
        return sendJson(res, 404, { ok: false, error: err?.message || String(err) });
      }
    }

    if (req.method === 'POST' && req.url === '/read-bootstrap') {
      const payload = await readJson(req);
      const projectPath = String(payload.projectPath || '').trim();
      const scriptPath = String(payload.scriptPath || 'engine/bootstrap.js').trim();
      if (!projectPath) {
        return sendJson(res, 400, { ok: false, error: 'No projectPath was provided.' });
      }
      const resolvedProject = path.resolve(projectPath);
      const safeRel = scriptPath.replace(/\\+/g, '/').replace(/^[/]+/, '');
      if (safeRel.includes('..')) {
        return sendJson(res, 400, { ok: false, error: 'scriptPath must stay inside the project folder.' });
      }
      const target = path.join(resolvedProject, safeRel);
      if (!target.startsWith(resolvedProject)) {
        return sendJson(res, 400, { ok: false, error: 'scriptPath must stay inside the project folder.' });
      }
      try {
        const source = await fs.readFile(target, 'utf8');
        return sendJson(res, 200, {
          ok: true,
          projectPath: resolvedProject,
          scriptPath: safeRel,
          source,
        });
      } catch (err) {
        return sendJson(res, 200, {
          ok: true,
          projectPath: resolvedProject,
          scriptPath: safeRel,
          source: '',
          missing: true,
        });
      }
    }

    if (req.method === 'POST' && req.url === '/scan-project') {
      const payload = await readJson(req);
      const targetPath = String(payload.projectPath || payload.path || '').trim();
      if (!targetPath) {
        return sendJson(res, 400, { ok: false, error: 'No projectPath was provided.' });
      }
      const resolved = path.resolve(targetPath);
      const tree = await scanFolderAsTree(resolved);
      return sendJson(res, 200, {
        ok: true,
        projectPath: resolved,
        tree,
        lastWatchEventAt,
      });
    }

    if (req.method === 'POST' && req.url === '/watch-project') {
      const payload = await readJson(req);
      const targetPath = String(payload.projectPath || payload.path || '').trim();
      if (!targetPath) {
        return sendJson(res, 400, { ok: false, error: 'No projectPath was provided.' });
      }
      const resolved = path.resolve(targetPath);
      stopWatcher();
      try {
        // recursive: true is supported on Windows + macOS; on Linux it is a
        // no-op but the editor polls /watch-poll as a fallback.
        activeWatcher = fsWatcher(resolved, { recursive: true, persistent: false });
        activeWatchTarget = resolved;
        pendingWatchEvents = [];
        activeWatcher.on('change', (kind, filename) => {
          const evt = { kind, path: filename ? String(filename) : '', time: Date.now() };
          pendingWatchEvents.push(evt);
          lastWatchEventAt = evt.time;
          if (pendingWatchEvents.length > 100) pendingWatchEvents.shift();
        });
        activeWatcher.on('error', (err) => {
          console.warn('[CycoLocalSaveBridge] watcher error', err);
        });
      } catch (err) {
        console.warn('[CycoLocalSaveBridge] could not start watcher', err);
      }
      return sendJson(res, 200, {
        ok: true,
        projectPath: resolved,
        watching: !!activeWatcher,
      });
    }

    if (req.method === 'GET' && req.url === '/watch-poll') {
      const events = pendingWatchEvents.splice(0, pendingWatchEvents.length);
      return sendJson(res, 200, {
        ok: true,
        projectPath: activeWatchTarget,
        watching: !!activeWatcher,
        events,
        lastWatchEventAt,
      });
    }

    if (req.method === 'POST' && req.url === '/unwatch-project') {
      stopWatcher();
      return sendJson(res, 200, { ok: true, watching: false });
    }

    return sendJson(res, 404, { ok: false, error: 'Not found.' });
  } catch (err) {
    console.error('[CycoLocalSaveBridge] error', err);
    return sendJson(res, err?.status || 500, { ok: false, error: err?.message || String(err) });
  }
});

function stopWatcher() {
  if (activeWatcher) {
    try { activeWatcher.close(); } catch (_) { /* noop */ }
  }
  activeWatcher = null;
  activeWatchTarget = null;
  pendingWatchEvents = [];
}

process.on('SIGINT', () => { stopWatcher(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { stopWatcher(); server.close(() => process.exit(0)); });

server.listen(PORT, HOST, () => {
  console.info(`[CycoLocalSaveBridge] listening on http://${HOST}:${PORT}`);
});

export { server };
