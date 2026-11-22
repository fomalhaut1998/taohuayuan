import assert from 'node:assert/strict';
import { createJournal } from '../src/systems/journal.js';
const nodes = new Map();
function node(id) { if (!nodes.has(id)) nodes.set(id, { addEventListener() {}, setAttribute() {}, focus() {}, replaceChildren() {}, appendChild() {}, open: false, textContent: '' }); return nodes.get(id); }
globalThis.document = { getElementById: node, body: { classList: { contains: () => false } }, activeElement: null };
globalThis.window = { addEventListener() {} };
let saved = JSON.stringify({ places: ['p'], classics: [], people: [], guide: ['peach', 'bogus'] });
globalThis.localStorage = { getItem: () => saved, setItem: (key, value) => { saved = value; } };
const original = Object.hasOwn;
try {
  Object.hasOwn = undefined;
  const journal = createJournal([{ id: 'p' }], [], {}, { clearInput() {} });
  assert.deepEqual(journal.visited(), ['p'], '旧环境必须保留原游记');
  assert.equal(journal.observe('peach'), false, '图鉴已有记录必须保留');
  assert.equal(journal.observe('chicken'), true, '旧环境仍可记录动物');
  assert.deepEqual(JSON.parse(saved).guide, ['peach', 'chicken']);
} finally { Object.hasOwn = original; }
console.log('journal compatibility checks passed');
