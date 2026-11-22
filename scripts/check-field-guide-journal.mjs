import assert from 'node:assert/strict';
import { CATALOGUE, catalogueEntry } from '../src/systems/catalogue.js';
import { createJournal } from '../src/systems/journal.js';
import { illustrationSVG } from '../src/systems/field-guide.js';
import { installDOM } from './helpers/field-guide-dom.mjs';
const dom = installDOM(); dom.journalMarkup();
const original = ['peach', 'chicken', 'dog', 'bird', 'ox', 'duck', 'stream', 'cave', 'pond'];
const extra = ['fern', 'shrub', 'fallen-branch', 'bank-stone', 'water-grass', 'grain-crop', 'well', 'stone-mill', 'boat'];
for (const id of [...original, ...extra]) {
  assert(catalogueEntry(id), id + ' has stable catalogue metadata');
  assert(CATALOGUE[id].text.length > 10); assert.match(illustrationSVG(CATALOGUE[id].icon), /<svg/);
}
assert.equal(catalogueEntry('__proto__'), null); assert.equal(catalogueEntry('constructor'), null);
dom.setSaved(JSON.stringify({ places: ['old'], people: [{ id: 'p1', name: '村人', line: '旧话' }], classics: ['text'], guide: [...original, 'well', 'bogus', 'peach', '__proto__'] }));
const journal = createJournal([{ id: 'old', name: '旧地' }], [{ id: 'text', classic: '原文', plain: '白话' }], dom.canvas, { clearInput() {} });
assert.deepEqual(journal.visited(), ['old']);
for (const id of original) assert.equal(journal.observe(id), false);
assert.equal(journal.observe('well'), false); assert.equal(journal.observe('bogus'), false);
assert.equal(journal.observe('fern'), true); assert.equal(journal.observe('fern'), false);
let saved = JSON.parse(dom.getSaved()); assert.deepEqual(saved.guide, [...original, 'well', 'fern']);
assert.deepEqual(saved.people, [{ id: 'p1', name: '村人', line: '旧话' }]); assert.deepEqual(saved.classics, ['text']);
dom.key('KeyJ'); assert(journal.isOpen());
assert(dom.doc.getElementById('journal-life'), 'new category is created only on actual render');
assert(dom.doc.getElementById('journal-life').children.some(node => node.textContent.includes('水井')));
journal.close();
dom.doc.body.classList.add('field-guide-open'); dom.key('KeyJ'); assert(!journal.isOpen(), 'J cannot open a competing dialog over a guide'); dom.doc.body.classList.remove('field-guide-open');
const editable = dom.doc.createElement('div'); editable.isContentEditable = true; dom.doc.body.append(editable); editable.focus();
// Dispatch on an editable target so the production journal listener sees the real event target.
// Node EventTarget has no bubbling, therefore invoke the captured listener with a target descriptor.
for (const listener of dom.win.listeners.get('keydown')) listener({ code: 'KeyJ', target: editable, preventDefault() { throw Error('editable J must not be captured'); } });
assert(!journal.isOpen());
dom.doc.getElementById('journal-clear').dispatchEvent(new Event('click'));
saved = JSON.parse(dom.getSaved()); assert.deepEqual(saved, { places: [], people: [], classics: [], guide: [] });
console.log('field guide journal checks passed: original ids, extended ids, old save filtering, rendering, modal guard, editable guard, clear');
