/** ProjectSaveLog.js - small bounded log for New Project save diagnostics */

const MAX_ENTRIES = 40;

const ProjectSaveLog = {
  _entries: [],
  _listeners: new Set(),

  add(source, step, payload = {}) {
    const entry = { source, step, payload, time: new Date().toLocaleTimeString() };
    this._entries.push(entry);
    if (this._entries.length > MAX_ENTRIES) this._entries.shift();
    for (const listener of this._listeners) listener(this.entries());
  },

  clear() {
    this._entries = [];
    for (const listener of this._listeners) listener(this.entries());
  },

  entries() {
    return this._entries.slice();
  },

  subscribe(listener) {
    this._listeners.add(listener);
    listener(this.entries());
    return () => this._listeners.delete(listener);
  },

  format(entries = this._entries) {
    if (!entries.length) return 'No save log entries yet.';
    return entries.map(entry => {
      const payloadText = Object.entries(entry.payload || {})
        .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
        .join(' | ');
      return `${entry.time} ${entry.source}:${entry.step}${payloadText ? ` | ${payloadText}` : ''}`;
    }).join('\n');
  },
};

export default ProjectSaveLog;
