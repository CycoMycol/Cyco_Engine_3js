# Publishing Platform Optimization Plan
## Desktop, Mobile, and Steam — Settings, Controls, and Build Strategy

---

## Overview

This document defines the publishing strategy for Cyco Engine games across three primary targets: **Web (browser)**, **Mobile (iOS/Android)**, and **Steam (desktop PC)**. Each platform has different hardware constraints, GPU architectures, input models, and distribution requirements. The publishing system should allow per-platform quality profiles that can be configured in the editor and baked into the exported build.

---

## Platform Summary

| Platform | Renderer | Input | GPU Architecture | Distribution |
|---|---|---|---|---|
| Web (Desktop) | WebGL2 / WebGPU | Keyboard + Mouse | Discrete or integrated GPU | Browser, itch.io, Newgrounds |
| Web (Mobile) | WebGL2 | Touch | TBDR mobile GPU | Browser PWA |
| Steam | Electron + WebGPU | Keyboard + Mouse + Controller | Discrete GPU (usually) | Steam, direct download |
| Mobile Native (future) | Capacitor/Tauri | Touch + Gyro | TBDR mobile GPU | App Store, Google Play |

---

## Platform Profiles

The publishing system should expose **three quality profiles** per target platform, selectable in the publish dialog. These map directly to the GPU capability tiers defined in the Post-Processing Architecture Plan.

### Profile: `ultra` (Steam / High-end Desktop Web)
Full feature set. No compromises.

### Profile: `balanced` (Mid-range Desktop / High-end Mobile)
Reduced resolution post-processing, same feature set.

### Profile: `performance` (Low-end / Mobile Browser)
Minimal post-processing, reduced shadow quality, simplified shaders.

---

## 1. Steam (Desktop via Electron)

### Overview
Steam builds package the editor runtime in Electron, which runs a full Chromium WebGPU context. This is effectively equivalent to running in a high-end desktop browser but with no browser chrome and full OS access (file system, gamepads, etc.).

### Rendering Settings

| Setting | Ultra | Balanced | Performance |
|---|---|---|---|
| Renderer | WebGPU | WebGPU / WebGL2 | WebGL2 |
| Resolution | Native | Native | 75% native |
| Shadow map size | 4096 | 2048 | 1024 |
| Shadow type | `PCFSoftShadowMap` | `PCFShadowMap` | `BasicShadowMap` |
| Post-processing tier | Tier 3 (Full MRT) | Tier 3 | Tier 2 |
| Bloom resolution | 1/2 native | 1/4 native | Off |
| Outline resolution | Full | 1/2 native | Off |
| Anti-aliasing | TAA or MSAA×4 | MSAA×2 | FXAA |
| Pixel ratio cap | `devicePixelRatio` | `min(dpr, 2)` | 1.0 |
| Anisotropic filtering | 16× | 8× | 4× |

### Input Controls (Steam)

| Control | Action |
|---|---|
| Keyboard + Mouse | Primary input — full support |
| Xbox / PS Controller | Via Gamepad API — map axes and buttons |
| Steam Input API | Overlay-level input remapping (user handles this) |

**Implementation notes:**
- Use the **Gamepad API** (`navigator.getGamepads()`) polled each frame
- Dead zone: 0.15 on analog sticks by default
- Trigger axes: map to 0.0–1.0 range
- Expose a **controller binding config** in game settings (not editor settings)
- Electron gives access to `app.getPath('userData')` for saving control configs locally

### Distribution
- Electron builder produces `.exe` installer and/or portable `.zip`
- Steam SDK integration: Achievements, Cloud Save, Leaderboards via `greenworks` or `steamworks.js`
- Minimum Electron version: match Chromium version that supports WebGPU (`navigator.gpu` available)

---

## 2. Web (Desktop Browser)

### Overview
Web builds run directly in the browser. No install required. Fastest path to players. Constraints: VRAM limits, no file system access (use IndexedDB for saves), browser tab memory pressure.

### Rendering Settings

| Setting | Ultra | Balanced | Performance |
|---|---|---|---|
| Renderer | WebGPU (if available), fallback WebGL2 | WebGL2 | WebGL2 |
| Resolution | `min(dpr, 2)` | `min(dpr, 1.5)` | 1.0 |
| Shadow map size | 2048 | 1024 | 512 |
| Shadow type | `PCFSoftShadowMap` | `PCFShadowMap` | `BasicShadowMap` |
| Post-processing tier | Tier 3 if WebGPU, Tier 2 if WebGL2 | Tier 2 | Tier 1 |
| Bloom resolution | 1/4 native | 1/4 native | Off |
| Anti-aliasing | MSAA×2 or FXAA | FXAA | Off |
| Texture compression | KTX2 + Basis | KTX2 + Basis | JPG fallback |

### Input Controls (Web Desktop)
- Full keyboard + mouse support
- Pointer Lock API for FPS-style mouse look (`canvas.requestPointerLock()`)
- Gamepad API — same as Steam, but no Steam overlay
- Expose an in-game keybinding screen (reuse engine `PreferencesPanel` keybindings section)
- Save settings to `localStorage`

### Asset Loading Strategy
- Use **KTX2 / Basis Universal** compressed textures — 4–6× smaller than PNG, GPU-native
- Lazy-load assets not visible in the starting scene
- Service Worker for offline caching (PWA mode)
- Preload critical assets with `<link rel="preload">` in the HTML shell

### Saving / Persistence
| Data | Storage |
|---|---|
| Game saves | IndexedDB (via `idb` or similar) |
| Settings | `localStorage` |
| Large assets | Cache API (Service Worker) |

---

## 3. Mobile (Browser / PWA)

### Overview
Mobile targets the browser on iOS and Android via a PWA (Progressive Web App). This gives access to the home screen icon, offline play, and fullscreen mode without an App Store submission. For App Store / Google Play distribution, the PWA can be wrapped in **Capacitor** (recommended) or **Cordova**.

Mobile GPU architecture is fundamentally different from desktop: **Tile-Based Deferred Rendering (TBDR)** (Apple A-series, ARM Mali, Qualcomm Adreno). Bandwidth is the bottleneck. Every additional render target, framebuffer read, and full-screen pass costs battery and frames.

### Rendering Settings

| Setting | High Mobile | Mid Mobile | Low Mobile |
|---|---|---|---|
| Renderer | WebGL2 | WebGL2 | WebGL2 |
| Resolution | `min(dpr, 2)` | 1.0 | 0.75 |
| Shadow map size | 1024 | 512 | Off |
| Shadow type | `PCFShadowMap` | `BasicShadowMap` | Off |
| Post-processing tier | Tier 1 (binary Layers) | Tier 0 | Tier 0 |
| Bloom | Off or 1/8 res | Off | Off |
| Outline | Stencil-only, full res | Off | Off |
| Anti-aliasing | FXAA | Off | Off |
| Pixel ratio cap | `min(dpr, 2)` | 1.5 | 1.0 |
| Anisotropic filtering | 4× | 2× | 1× |
| `powerPreference` | `"high-performance"` | `"default"` | `"low-power"` |

**`powerPreference`** is a WebGL context creation hint. On mobile it directly affects which GPU core is used (efficiency vs. performance cluster). Always expose this as a user setting.

### GPU Tier Detection

At startup, detect the device tier automatically:

```javascript
// Heuristics for mobile tier detection:
const gl = renderer.getContext();
const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
const gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
// Parse gpuRenderer string: 'Adreno 730', 'Apple GPU', 'Mali-G710', etc.
// Or use the 'detect-gpu' npm package for scored tiers
```

### Input Controls (Mobile)

| Control | Implementation |
|---|---|
| Touch joystick (movement) | Virtual joystick — left side of screen |
| Touch joystick (camera) | Virtual joystick — right side of screen |
| Tap | Interact / select |
| Pinch | Zoom (if applicable) |
| Device orientation / gyro | Optional: `DeviceOrientationEvent` for camera tilt |
| On-screen buttons | Context-sensitive action buttons |

**Implementation notes:**
- Use `pointer events` (not `touch events`) — works for both touch and mouse
- Virtual joystick: lightweight custom implementation or `nipplejs` library
- Button layout should be user-adjustable (position + size)
- Hide virtual controls when a gamepad is connected (`gamepadconnected` event)
- Safe area insets: `env(safe-area-inset-*)` CSS for notch/home bar avoidance
- Prevent default touch behaviors on the canvas (`touch-action: none`)

### Battery / Thermal Management
- **Frame rate cap**: Default 30fps on mobile unless device is high-end. Expose as setting.
- **Background throttle**: When page is hidden (`visibilitychange`), pause render loop entirely
- **Thermal detection**: Monitor frame times; if consistently dropping below target, step down quality tier automatically
- **`requestAnimationFrame` vs fixed tick**: Use `requestAnimationFrame` (browser handles tab throttling automatically)

### App Store Wrapping (Capacitor)
For native App Store / Google Play distribution:

```
Web build output → Capacitor → native iOS/Android shell
```

- Capacitor provides native APIs: file system, haptics, status bar, notifications
- The web game code is unchanged — Capacitor is just a native WebView wrapper
- Use `@capacitor/filesystem` instead of IndexedDB for save data on native
- Configure `config.xml` / `capacitor.config.json` with app ID, version, icons

---

## Publishing System: Editor Controls

The publishing system panel should expose the following per-build:

### Target Platform
- [ ] Web (Desktop)
- [ ] Web (Mobile / PWA)
- [ ] Steam (Electron)
- [ ] Mobile Native (Capacitor — future)

### Quality Profile (per platform)
Dropdown: `Ultra` / `Balanced` / `Performance` / `Auto-detect`

`Auto-detect` runs the GPU tier heuristic at runtime and selects the appropriate profile dynamically.

### Output Settings
| Setting | Notes |
|---|---|
| Build output folder | Relative to project root |
| Asset compression | None / KTX2+Basis / JPEG |
| Bundle code | Minify JS (Vite/Rollup) |
| Include source maps | Debug builds only |
| Electron version | Pin to LTS version |
| App icon | PNG, 512×512 minimum |
| Splash screen | PNG, platform-specific sizes |
| PWA manifest | Auto-generated from project settings |

### Per-Platform Quality Overrides
Expose a table of overrides so the game developer can fine-tune without editing code:

| Setting | Web Ultra | Web Balanced | Mobile High | Mobile Mid | Steam Ultra |
|---|---|---|---|---|---|
| Shadow map size | 2048 | 1024 | 1024 | 512 | 4096 |
| Pixel ratio | 2.0 | 1.5 | 2.0 | 1.0 | native |
| Post-processing tier | 2 | 2 | 1 | 0 | 3 |
| Target FPS | 60 | 60 | 60 | 30 | 60 |
| … | … | … | … | … | … |

These override tables are serialized into the game's published `config.json` and read at runtime.

---

## Runtime Config Loading (Published Game)

The published game loads a `publish-config.json` at startup:

```json
{
  "platform": "web",
  "qualityProfiles": {
    "ultra":       { "shadowMapSize": 2048, "pixelRatio": 2.0, "postProcessingTier": 2, "targetFPS": 60 },
    "balanced":    { "shadowMapSize": 1024, "pixelRatio": 1.5, "postProcessingTier": 2, "targetFPS": 60 },
    "performance": { "shadowMapSize": 512,  "pixelRatio": 1.0, "postProcessingTier": 0, "targetFPS": 30 }
  },
  "defaultProfile": "auto"
}
```

---

## File and Folder Plan

```
engine/
  src/
    publishing/
      PublishManager.js        — orchestrates build pipeline
      PlatformProfiles.js      — default quality profiles per platform
      GPUTierDetector.js       — runtime GPU scoring / tier assignment
      ElectronBuilder.js       — Electron-specific packaging hooks
      CapacitorBridge.js       — Capacitor native API abstraction (future)
      publish-config.schema.json — JSON schema for publish-config.json

editor/
  src/
    ui/
      PublishWindow.js         — Publishing UI panel (target, profiles, output)
```

---

## Dependency Checklist (External)

| Tool | Purpose | Platform |
|---|---|---|
| Electron | Desktop app shell | Steam |
| Electron Builder | Packaging / installer creation | Steam |
| `steamworks.js` | Steam SDK (achievements, cloud save) | Steam |
| Capacitor | Native mobile app shell | Mobile Native |
| `detect-gpu` | GPU tier scoring | All |
| `nipplejs` | Virtual joystick | Mobile |
| `idb` | IndexedDB wrapper for saves | Web / Mobile |
| KTX2 / `basisu` CLI | Texture compression | All |
| Vite | JS bundler for published builds | All |

---

## Open Questions / Future Work

- **WebXR (VR/AR)**: Separate publishing target. Requires `xr: { enabled: true }` in renderer config and platform-specific manifests.
- **Desktop native (non-Electron)**: Tauri is a lighter alternative to Electron (~10MB vs ~100MB) using the OS WebView. Investigate for Steam as a size reduction.
- **Console (Xbox/PS)**: WebAssembly + WebGPU path could theoretically run on console browsers, but platform certification is a separate process.
- **Auto-update system**: Electron supports `electron-updater` for auto-patching Steam builds between Steam updates.
- **Crash reporting**: Integrate Sentry or similar for published builds to catch runtime errors.

---

*Last Updated: May 2026*
