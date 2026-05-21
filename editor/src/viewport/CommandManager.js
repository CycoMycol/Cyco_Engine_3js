/**
 * CommandManager.js
 * Undo / Redo / History stack.
 * Every destructive action in the editor wraps its effect in a command object
 * implementing { name:string, do(), undo() } and calls CommandManager.execute().
 *
 * Events dispatched:
 *   cyco-history-change  { history, currentIndex }  — fired after every mutation
 *
 * Events consumed:
 *   cyco-command-execute { name, do, undo }  — convenience event from other modules
 *   cyco-undo            {}                  — trigger undo
 *   cyco-redo            {}                  — trigger redo
 */

export class CommandManager {
  constructor() {
    /** @type {Array<{name:string, do:()=>void, undo:()=>void}>} */
    this._stack   = [];
    this._pointer = -1; // index of last executed command

    this._onExecuteEvent = this._onExecuteEvent.bind(this);
    this._onUndo         = this._onUndo.bind(this);
    this._onRedo         = this._onRedo.bind(this);

    window.addEventListener('cyco-command-execute', this._onExecuteEvent);
    window.addEventListener('cyco-undo',            this._onUndo);
    window.addEventListener('cyco-redo',            this._onRedo);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Execute a command and push it to the history stack.
   * Clears any future (redo) branch beyond current pointer.
   * @param {{ name:string, do:()=>void, undo:()=>void }} command
   */
  execute(command) {
    // Trim redo branch
    this._stack.splice(this._pointer + 1);
    this._stack.push(command);
    this._pointer = this._stack.length - 1;
    command.do();
    this._notify();
  }

  undo() {
    if (this._pointer < 0) return;
    this._stack[this._pointer].undo();
    this._pointer--;
    this._notify();
  }

  redo() {
    if (this._pointer >= this._stack.length - 1) return;
    this._pointer++;
    this._stack[this._pointer].do();
    this._notify();
  }

  /**
   * Jump to a specific history index (Photoshop-style).
   * Calls undo/redo repeatedly until the target is reached.
   * @param {number} targetIndex  0-based index into history array
   */
  jumpTo(targetIndex) {
    const clamped = Math.max(-1, Math.min(this._stack.length - 1, targetIndex));
    while (this._pointer > clamped) this.undo();
    while (this._pointer < clamped) this.redo();
  }

  /** @returns {{ name:string, timestamp:number }[]} */
  get history() {
    return this._stack.map((cmd, i) => ({
      name:      cmd.name ?? '(unnamed)',
      index:     i,
      active:    i === this._pointer,
      timestamp: cmd._timestamp ?? 0,
    }));
  }

  get currentIndex() { return this._pointer; }
  get canUndo()      { return this._pointer >= 0; }
  get canRedo()      { return this._pointer < this._stack.length - 1; }

  // ─── Event handlers ───────────────────────────────────────────────────────

  _onExecuteEvent(event) {
    const cmd = event.detail;
    if (!cmd || typeof cmd.do !== 'function' || typeof cmd.undo !== 'function') return;
    cmd._timestamp = Date.now();
    this.execute(cmd);
  }

  _onUndo() { this.undo(); }
  _onRedo() { this.redo(); }

  _notify() {
    window.dispatchEvent(new CustomEvent('cyco-history-change', {
      detail: { history: this.history, currentIndex: this._pointer }
    }));
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    window.removeEventListener('cyco-command-execute', this._onExecuteEvent);
    window.removeEventListener('cyco-undo',            this._onUndo);
    window.removeEventListener('cyco-redo',            this._onRedo);
    this._stack = [];
  }
}
