import http from 'node:http';
import fs from 'node:fs/promises';

const URL = 'http://127.0.0.1:9222';
async function getTabs() {
  return new Promise((resolve, reject) => {
    http.get(URL + '/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}
const tabs = await getTabs();
const tab = tabs.find(t => t.url.includes('Cyco_Engine_4'));
console.log('Tab:', tab.url);

const ws = tab.webSocketDebuggerUrl;
console.log('WS:', ws);

// Use the built-in WebSocket API (Node 22+)
const sock = new WebSocket(ws);
let nextId = 1;
const pending = new Map();
sock.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    sock.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise((r) => sock.once('open', r));
console.log('Connected');

// Get the active dialog element
const r1 = await send('Runtime.evaluate', {
  expression: `
    (() => {
      const dlg = document.querySelector('dialog.ce-fp-dialog');
      if (!dlg) return { error: 'no dialog' };
      const tile = dlg.querySelector('.ce-fp-tile');
      if (!tile) return { error: 'no tile' };
      const rect = tile.getBoundingClientRect();
      const ev = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rect.left + 30, clientY: rect.top + 30,
        button: 2, buttons: 2,
      });
      tile.dispatchEvent(ev);
      return { rect: { x: rect.left + 30, y: rect.top + 30 } };
    })()
  `,
  returnByValue: true,
});
console.log('Dispatch result:', r1.result.result.value);

// Wait a moment
await new Promise(r => setTimeout(r, 100));

const r2 = await send('Runtime.evaluate', {
  expression: `
    (() => {
      const menu = document.querySelector('dialog.ce-fp-dialog [data-role="contextmenu"]');
      if (!menu) return { error: 'no menu' };
      return {
        hidden: menu.hidden,
        left: menu.style.left,
        top: menu.style.top,
        items: Array.from(menu.querySelectorAll('.ce-fp-cm-item')).map(el => el.textContent.trim()),
      };
    })()
  `,
  returnByValue: true,
});
console.log('Menu state:', JSON.stringify(r2.result.result.value, null, 2));

// Take a screenshot
const r3 = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
const data = r3.result.data;
if (data) {
  await fs.writeFile('c:/Users/Cyco Myco/Documents/1_Game_Engines/Cyco_Engine_4/tools/picker-context-menu.jpeg', Buffer.from(data, 'base64'));
  console.log('Screenshot saved to tools/picker-context-menu.jpeg');
}

sock.close();
