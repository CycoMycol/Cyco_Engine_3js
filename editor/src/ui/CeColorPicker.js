/**
 * CeColorPicker.js — floating HSV color picker popup.
 * Singleton. Call CeColorPicker.open(anchor, color, onChange, onCommit).
 * - anchor  : HTMLElement to position near
 * - color   : current color string (hex or rgba)
 * - onChange : called live with new color as user drags
 * - onCommit: called once when the picker is dismissed (optional)
 */

const RECENT_KEY = 'cyco-recent-colors';
const MAX_RECENT = 8;

// ── Color math ────────────────────────────────────────────────────────────────

function hexToHsv(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  const v = max;
  const s = max === 0 ? 0 : (max - min) / max;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0)) / 6; break;
      case g: h = ((b-r)/d + 2) / 6; break;
      case b: h = ((r-g)/d + 4) / 6; break;
    }
  }
  return [h*360, s*100, v*100];
}

function hsvToRgb(h, s, v) {
  h = ((h%360)+360)%360; s/=100; v/=100;
  const i = Math.floor(h/60);
  const f = h/60 - i;
  const p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
  let r,g,b;
  switch(i%6){
    case 0: r=v;g=t;b=p; break; case 1: r=q;g=v;b=p; break;
    case 2: r=p;g=v;b=t; break; case 3: r=p;g=q;b=v; break;
    case 4: r=t;g=p;b=v; break; default:r=v;g=p;b=q;
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

function hsvToHex(h, s, v) {
  const [r,g,b] = hsvToRgb(h,s,v);
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}

function colorToOutput(h, s, v, a) {
  if (a >= 0.999) return hsvToHex(h,s,v);
  const [r,g,b] = hsvToRgb(h,s,v);
  return `rgba(${r},${g},${b},${Math.round(a*1000)/1000})`;
}

function parseColor(color) {
  if (!color) return {h:0,s:100,v:100,a:1};
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.length===4
      ? '#'+c[1]+c[1]+c[2]+c[2]+c[3]+c[3]
      : c.slice(0,7);
    const [h,s,v] = hexToHsv(hex);
    return {h,s,v,a:1};
  }
  const mRgba = c.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
  if (mRgba) {
    const hex = '#'+[mRgba[1],mRgba[2],mRgba[3]].map(x=>parseInt(x).toString(16).padStart(2,'0')).join('');
    const [h,s,v] = hexToHsv(hex);
    return {h,s,v,a:parseFloat(mRgba[4])};
  }
  const mRgb = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (mRgb) {
    const hex = '#'+[mRgb[1],mRgb[2],mRgb[3]].map(x=>parseInt(x).toString(16).padStart(2,'0')).join('');
    const [h,s,v] = hexToHsv(hex);
    return {h,s,v,a:1};
  }
  return {h:0,s:100,v:100,a:1};
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const CeColorPicker = {
  _popup: null,
  _h: 0, _s: 100, _v: 100, _a: 1,
  _onChange: null,
  _onCommit: null,
  _originalColor: '#888888',
  _dragging: null,
  _cleanup: null,

  open(anchor, currentColor, onChange, onCommit) {
    this.close();
    this._onChange      = onChange  || null;
    this._onCommit      = onCommit  || null;
    this._originalColor = currentColor || '#888888';

    const p = parseColor(this._originalColor);
    this._h = p.h; this._s = p.s; this._v = p.v; this._a = p.a;

    const popup = document.createElement('div');
    popup.className = 'ce-color-picker';
    popup.innerHTML = `
      <div class="ce-cp-drag-handle">⠿ Color Picker</div>
      <div class="ce-cp-sv-wrap">
        <canvas class="ce-cp-sv-canvas" width="232" height="140"></canvas>
        <div class="ce-cp-sv-thumb"></div>
      </div>
      <div class="ce-cp-sliders">
        <div class="ce-cp-hue-bar"><div class="ce-cp-slider-thumb ce-cp-hue-thumb"></div></div>
        <div class="ce-cp-brightness-bar">
          <canvas class="ce-cp-brightness-canvas" height="12"></canvas>
          <div class="ce-cp-slider-thumb ce-cp-brightness-thumb"></div>
        </div>
        <div class="ce-cp-alpha-bar">
          <canvas class="ce-cp-alpha-canvas" height="12"></canvas>
          <div class="ce-cp-slider-thumb ce-cp-alpha-thumb"></div>
        </div>
      </div>
      <div class="ce-cp-preview-row">
        <div class="ce-cp-preview-old" title="Click to revert"></div>
        <div class="ce-cp-preview-new"></div>
      </div>
      <div class="ce-cp-inputs-row">
        <button class="ce-cp-eyedropper-btn" title="Pick color from screen">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M13.09 2.91a2.07 2.07 0 0 0-2.93 0L8.84 4.23 7.77 3.16l-.7.7 1.06 1.06L2.5 10.55A2 2 0 0 0 2 11.97V14h2.03a2 2 0 0 0 1.41-.59l5.63-5.62 1.07 1.07.7-.71-1.07-1.07 1.32-1.32a2.07 2.07 0 0 0 0-2.85z"/>
          </svg>
        </button>
        <span class="ce-cp-label">HEX</span>
        <input class="ce-cp-hex-input" maxlength="7" spellcheck="false" autocomplete="off"/>
        <span class="ce-cp-label">A</span>
        <input class="ce-cp-alpha-input" type="number" min="0" max="100" step="1"/>
        <span class="ce-cp-label">%</span>
      </div>
      <div class="ce-cp-section-label">Recent</div>
      <div class="ce-cp-recent-row"></div>
    `;
    // Append inside the dialog ancestor (if any) so we're in the same top
    // layer and render above the showModal() overlay.
    const dialogHost = anchor.closest('dialog') || document.body;
    dialogHost.appendChild(popup);
    this._popup = popup;

    this._bindEvents(popup, anchor);

    // Draw and position in next frame (after layout)
    requestAnimationFrame(() => {
      this._renderSvCanvas();
      this._updateSvThumb();
      this._updateHueThumb();
      this._updateBrightnessBar();
      this._updateBrightnessThumb();
      this._updateAlphaBar();
      this._updateAlphaThumb();
      this._updateHexInput();
      this._updateAlphaInput();
      this._updatePreview();
      this._renderRecentColors();
      this._positionPopup(popup, anchor);
    });
  },

  close() {
    if (this._cleanup) { this._cleanup(); this._cleanup = null; }
    if (this._popup)   { this._popup.remove(); this._popup = null; }
    this._dragging = null;
  },

  // ── layout ──────────────────────────────────────────────────────────────────

  _positionPopup(popup, anchor) {
    popup.style.position = 'fixed';
    const pw = popup.offsetWidth  || 256;
    const ph = popup.offsetHeight || 380;
    const r  = anchor.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let top  = r.bottom + 6;
    let left = r.left;
    if (left + pw > vw - 8) left = vw - pw - 8;
    if (top  + ph > vh - 8) top  = r.top - ph - 6;
    if (left < 8) left = 8;
    if (top  < 8) top  = 8;
    popup.style.left = left + 'px';
    popup.style.top  = top  + 'px';
  },

  // ── events ───────────────────────────────────────────────────────────────────

  _bindEvents(popup, anchor) {
    const svCanvas   = popup.querySelector('.ce-cp-sv-canvas');
    const hueBar     = popup.querySelector('.ce-cp-hue-bar');
    const alphaBar   = popup.querySelector('.ce-cp-alpha-bar');
    const hexInput   = popup.querySelector('.ce-cp-hex-input');
    const alphaInput = popup.querySelector('.ce-cp-alpha-input');
    const oldPreview = popup.querySelector('.ce-cp-preview-old');

    // Drag handle — move the picker anywhere on screen
    const dragHandle = popup.querySelector('.ce-cp-drag-handle');
    if (dragHandle) {
      dragHandle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = popup.getBoundingClientRect();
        const ox = e.clientX - rect.left;
        const oy = e.clientY - rect.top;
        dragHandle.style.cursor = 'grabbing';
        const onDragMove = (me) => {
          popup.style.left = (me.clientX - ox) + 'px';
          popup.style.top  = (me.clientY - oy) + 'px';
        };
        const onDragUp = () => {
          dragHandle.style.cursor = 'grab';
          document.removeEventListener('mousemove', onDragMove);
          document.removeEventListener('mouseup',   onDragUp);
        };
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup',   onDragUp);
      });
    }

    // Revert to original on old-preview click
    oldPreview.addEventListener('click', () => {
      const p = parseColor(this._originalColor);
      this._h=p.h; this._s=p.s; this._v=p.v; this._a=p.a;
      this._renderSvCanvas();
      this._updateSvThumb(); this._updateHueThumb();
      this._updateBrightnessBar(); this._updateBrightnessThumb();
      this._updateAlphaBar(); this._updateAlphaThumb();
      this._updateHexInput(); this._updateAlphaInput();
      this._updatePreview();
      this._fireChange();
    });

    // Eyedropper
    const eyedropperBtn = popup.querySelector('.ce-cp-eyedropper-btn');
    if (window.EyeDropper) {
      eyedropperBtn.addEventListener('click', async () => {
        try {
          const result = await new EyeDropper().open();
          const hex = result.sRGBHex;
          const [h,s,v] = hexToHsv(hex);
          this._h=h; this._s=s; this._v=v;
          this._renderSvCanvas();
          this._updateSvThumb(); this._updateHueThumb();
          this._updateBrightnessBar(); this._updateBrightnessThumb();
          this._updateAlphaBar(); this._updateAlphaThumb();
          this._updateHexInput(); this._updatePreview();
          this._fireChange();
        } catch { /* cancelled */ }
      });
    } else {
      eyedropperBtn.disabled = true;
      eyedropperBtn.title = 'EyeDropper not supported in this browser';
    }

    const brightnessBar = popup.querySelector('.ce-cp-brightness-bar');
    svCanvas.addEventListener('mousedown',     e => { this._dragging='sv';         this._handleSv(e);         e.preventDefault(); });
    hueBar.addEventListener('mousedown',       e => { this._dragging='hue';        this._handleHue(e);        e.preventDefault(); });
    brightnessBar.addEventListener('mousedown',e => { this._dragging='brightness'; this._handleBrightness(e); e.preventDefault(); });
    alphaBar.addEventListener('mousedown',     e => { this._dragging='alpha';      this._handleAlpha(e);      e.preventDefault(); });

    const onMove = e => {
      if (!this._dragging) return;
      if (this._dragging==='sv')         this._handleSv(e);
      if (this._dragging==='hue')        this._handleHue(e);
      if (this._dragging==='brightness') this._handleBrightness(e);
      if (this._dragging==='alpha')      this._handleAlpha(e);
    };
    const onUp   = () => { this._dragging = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);

    // Close on outside click (delayed so the opening click doesn't count)
    const onOutside = e => {
      if (this._popup && !this._popup.contains(e.target) && !anchor.contains(e.target)) {
        this._commit();
      }
    };
    const outsideTimer = setTimeout(() => document.addEventListener('mousedown', onOutside), 120);

    hexInput.addEventListener('change', () => {
      let val = hexInput.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        const [h,s,v] = hexToHsv(val);
        this._h=h; this._s=s; this._v=v;
        this._renderSvCanvas();
        this._updateSvThumb(); this._updateHueThumb();
        this._updateBrightnessBar(); this._updateBrightnessThumb();
        this._updateAlphaBar(); this._updateAlphaThumb();
        this._updatePreview();
        this._fireChange();
      }
      this._updateHexInput();
    });

    alphaInput.addEventListener('change', () => {
      const a = Math.max(0, Math.min(100, parseInt(alphaInput.value)||0));
      this._a = a / 100;
      alphaInput.value = a;
      this._updateAlphaBar(); this._updateAlphaThumb();
      this._updatePreview();
      this._fireChange();
    });

    this._cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      document.removeEventListener('mousedown', onOutside);
      clearTimeout(outsideTimer);
    };
  },

  // ── drag handlers ────────────────────────────────────────────────────────────

  _handleSv(e) {
    const canvas = this._popup?.querySelector('.ce-cp-sv-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this._s = Math.max(0,Math.min(100, ((e.clientX-rect.left)/rect.width)*100));
    this._v = Math.max(0,Math.min(100, (1-(e.clientY-rect.top)/rect.height)*100));
    this._updateSvThumb();
    this._updateBrightnessBar(); this._updateBrightnessThumb();
    this._updateAlphaBar(); this._updateAlphaThumb();
    this._updateHexInput(); this._updatePreview();
    this._fireChange();
  },

  _handleHue(e) {
    const bar = this._popup?.querySelector('.ce-cp-hue-bar');
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    this._h = Math.max(0,Math.min(360, ((e.clientX-rect.left)/rect.width)*360));
    this._renderSvCanvas();
    this._updateSvThumb(); this._updateHueThumb();
    this._updateBrightnessBar(); this._updateBrightnessThumb();
    this._updateAlphaBar(); this._updateAlphaThumb();
    this._updateHexInput(); this._updatePreview();
    this._fireChange();
  },

  _handleBrightness(e) {
    const bar = this._popup?.querySelector('.ce-cp-brightness-bar');
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    this._v = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    this._updateSvThumb();
    this._updateBrightnessThumb();
    this._updateAlphaBar(); this._updateAlphaThumb();
    this._updateHexInput(); this._updatePreview();
    this._fireChange();
  },

  _handleAlpha(e) {
    const bar = this._popup?.querySelector('.ce-cp-alpha-bar');
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    this._a = Math.max(0,Math.min(1, (e.clientX-rect.left)/rect.width));
    this._updateAlphaBar(); this._updateAlphaThumb();
    this._updateAlphaInput(); this._updatePreview();
    this._fireChange();
  },

  // ── canvas / thumb renders ───────────────────────────────────────────────────

  _renderSvCanvas() {
    const canvas = this._popup?.querySelector('.ce-cp-sv-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const [r,g,b] = hsvToRgb(this._h,100,100);
    const gx = ctx.createLinearGradient(0,0,w,0);
    gx.addColorStop(0,'#fff');
    gx.addColorStop(1,`rgb(${r},${g},${b})`);
    ctx.fillStyle = gx; ctx.fillRect(0,0,w,h);
    const gy = ctx.createLinearGradient(0,0,0,h);
    gy.addColorStop(0,'rgba(0,0,0,0)');
    gy.addColorStop(1,'rgba(0,0,0,1)');
    ctx.fillStyle = gy; ctx.fillRect(0,0,w,h);
  },

  _updateSvThumb() {
    const popup = this._popup; if (!popup) return;
    const thumb  = popup.querySelector('.ce-cp-sv-thumb');
    const canvas = popup.querySelector('.ce-cp-sv-canvas');
    const rect   = canvas.getBoundingClientRect();
    thumb.style.left = (this._s/100)*rect.width  + 'px';
    thumb.style.top  = (1-this._v/100)*rect.height + 'px';
    thumb.style.background = hsvToHex(this._h,this._s,this._v);
  },

  _updateHueThumb() {
    const popup = this._popup; if (!popup) return;
    const thumb = popup.querySelector('.ce-cp-hue-thumb');
    const bar   = popup.querySelector('.ce-cp-hue-bar');
    const rect  = bar.getBoundingClientRect();
    thumb.style.left = (this._h/360)*rect.width + 'px';
    thumb.style.background = hsvToHex(this._h,100,100);
  },

  _updateAlphaBar() {
    const popup = this._popup; if (!popup) return;
    const bar    = popup.querySelector('.ce-cp-alpha-bar');
    const canvas = popup.querySelector('.ce-cp-alpha-canvas');
    const w = bar.getBoundingClientRect().width || 232;
    if (canvas.width !== Math.round(w)) canvas.width = Math.round(w);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,12);
    const [r,g,b] = hsvToRgb(this._h,this._s,this._v);
    const grad = ctx.createLinearGradient(0,0,canvas.width,0);
    grad.addColorStop(0,`rgba(${r},${g},${b},0)`);
    grad.addColorStop(1,`rgba(${r},${g},${b},1)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,canvas.width,12);
  },

  _updateAlphaThumb() {
    const popup = this._popup; if (!popup) return;
    const thumb = popup.querySelector('.ce-cp-alpha-thumb');
    const bar   = popup.querySelector('.ce-cp-alpha-bar');
    const rect  = bar.getBoundingClientRect();
    thumb.style.left = this._a * rect.width + 'px';
    const [r,g,b] = hsvToRgb(this._h,this._s,this._v);
    thumb.style.background = `rgba(${r},${g},${b},${this._a})`;
  },

  _updateBrightnessBar() {
    const popup = this._popup; if (!popup) return;
    const bar    = popup.querySelector('.ce-cp-brightness-bar');
    const canvas = popup.querySelector('.ce-cp-brightness-canvas');
    if (!bar || !canvas) return;
    const w = bar.getBoundingClientRect().width || 232;
    if (canvas.width !== Math.round(w)) canvas.width = Math.round(w);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, 12);
    const [r,g,b] = hsvToRgb(this._h, this._s, 100);
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    grad.addColorStop(0, 'rgb(0,0,0)');
    grad.addColorStop(1, `rgb(${r},${g},${b})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, 12);
  },

  _updateBrightnessThumb() {
    const popup = this._popup; if (!popup) return;
    const thumb = popup.querySelector('.ce-cp-brightness-thumb');
    const bar   = popup.querySelector('.ce-cp-brightness-bar');
    if (!thumb || !bar) return;
    const rect  = bar.getBoundingClientRect();
    thumb.style.left = (this._v / 100) * rect.width + 'px';
    const [r,g,b] = hsvToRgb(this._h, this._s, this._v);
    thumb.style.background = `rgb(${r},${g},${b})`;
  },

  _updateHexInput() {
    const i = this._popup?.querySelector('.ce-cp-hex-input');
    if (i) i.value = hsvToHex(this._h,this._s,this._v);
  },

  _updateAlphaInput() {
    const i = this._popup?.querySelector('.ce-cp-alpha-input');
    if (i) i.value = Math.round(this._a*100);
  },

  _updatePreview() {
    const popup = this._popup; if (!popup) return;
    const color = colorToOutput(this._h,this._s,this._v,this._a);
    popup.querySelector('.ce-cp-preview-old').style.background = this._originalColor;
    popup.querySelector('.ce-cp-preview-new').style.background = color;
  },

  // ── helpers ───────────────────────────────────────────────────────────────────

  _fireChange() {
    if (this._onChange) this._onChange(colorToOutput(this._h,this._s,this._v,this._a));
  },

  _commit() {
    const color = colorToOutput(this._h,this._s,this._v,this._a);
    if (color.startsWith('#')) this._addToRecent(color);
    if (this._onCommit) this._onCommit(color);
    this.close();
  },

  _addToRecent(hex) {
    try {
      let r = JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');
      r = [hex, ...r.filter(c=>c!==hex)].slice(0,MAX_RECENT);
      localStorage.setItem(RECENT_KEY, JSON.stringify(r));
    } catch {}
  },

  _renderRecentColors() {
    const popup = this._popup; if (!popup) return;
    const row = popup.querySelector('.ce-cp-recent-row');
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem(RECENT_KEY)||'[]'); } catch {}
    row.innerHTML = '';
    if (!recent.length) {
      const e = document.createElement('span');
      e.className = 'ce-cp-recent-empty';
      e.textContent = 'None yet';
      row.appendChild(e);
      return;
    }
    recent.forEach(color => {
      const sw = document.createElement('button');
      sw.className = 'ce-cp-recent-swatch';
      sw.style.background = color;
      sw.title = color;
      sw.addEventListener('click', () => {
        const p = parseColor(color);
        this._h=p.h; this._s=p.s; this._v=p.v; this._a=p.a;
        this._renderSvCanvas();
        this._updateSvThumb(); this._updateHueThumb();
        this._updateBrightnessBar(); this._updateBrightnessThumb();
        this._updateAlphaBar(); this._updateAlphaThumb();
        this._updateHexInput(); this._updateAlphaInput();
        this._updatePreview();
        this._fireChange();
      });
      row.appendChild(sw);
    });
  },
};

export default CeColorPicker;
