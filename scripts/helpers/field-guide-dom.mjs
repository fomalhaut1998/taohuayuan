// Deliberately small DOM fixture: production modules run unchanged, including their real event handlers.
class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, fn, options) { super.addEventListener(type, fn, options); if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn, options) { super.removeEventListener(type, fn, options); this.listeners.get(type)?.delete(fn); }
  listenerCount() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}
export function installDOM() {
  const doc = new TrackedTarget(); doc.nodes = []; doc.hidden = false; doc.hasFocus = () => true;
  class Element extends TrackedTarget {
    constructor(tag) {
      super(); this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.className = ''; this.id = ''; this.style = {}; this.hidden = false; this.open = false; this.textContent = ''; this.attributes = {};
      this.classList = { contains: c => this.className.split(/\s+/).includes(c), add: c => { if (!this.classList.contains(c)) this.className += ' ' + c; }, remove: c => { this.className = this.className.split(/\s+/).filter(x => x !== c).join(' '); } };
      doc.nodes.push(this);
    }
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
    appendChild(node) { this.append(node); return node; }
    remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.parentNode = null; } }
    replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this.append(...nodes); }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    get isConnected() { return this === doc.body || !!this.parentNode?.isConnected; }
    focus() { doc.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 700 }; }
  }
  doc.createElement = tag => new Element(tag); doc.body = new Element('body'); doc.activeElement = doc.body;
  doc.getElementById = id => doc.nodes.find(n => n.id === id && n.isConnected) || null;
  doc.querySelector = selector => selector === 'dialog[open]' ? doc.nodes.find(n => n.tagName === 'DIALOG' && n.open && n.isConnected) || null : null;
  doc.exitPointerLock = () => { doc.pointerLockElement = null; };
  const win = new TrackedTarget(); win.innerWidth = 1000; win.innerHeight = 700; win.confirm = () => true;
  globalThis.document = doc; globalThis.window = win;
  const canvas = new Element('canvas'); doc.body.append(canvas); canvas.focus();
  let saved = null, writes = 0;
  globalThis.localStorage = { getItem: () => saved, setItem: (key, value) => { if (key !== 'taohua.journal.v1') throw Error('storage key changed'); saved = value; writes++; } };
  return { doc, win, canvas, setSaved: s => { saved = s; }, getSaved: () => saved, writes: () => writes,
    key(code, extra = {}) { const event = new Event('keydown', { cancelable: true }); Object.assign(event, { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...extra }); win.dispatchEvent(event); return event; },
    journalMarkup() {
      const dialog = new Element('dialog'); dialog.id = 'journal'; doc.body.append(dialog);
      for (const id of ['journal-open', 'journal-close', 'journal-clear', 'journal-status', 'journal-places', 'journal-people', 'journal-classics', 'journal-plants', 'journal-animals', 'journal-landforms', 'journal-field', 'journal-notes', 'journal-tab-notes', 'journal-tab-field']) { const node = new Element(id.includes('tab') || id.includes('close') || id.includes('clear') || id.includes('open') ? 'button' : 'section'); node.id = id; dialog.append(node); }
    }
  };
}
