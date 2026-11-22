import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeExportScale, createScrollStudio } from '../src/systems/scroll-studio.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));

function createMockIndexedDb(backingMap = new Map()) {
  const stores = new Set();
  function fireAsync(fn) {
    queueMicrotask(() => {
      try { fn?.(); } catch {}
    });
  }
  const dbObj = {
    objectStoreNames: {
      contains: name => stores.has(name)
    },
    createObjectStore(name) {
      stores.add(name);
      return {};
    },
    close() {},
    transaction(_storeName, _mode) {
      const tx = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore() {
          return {
            put(record) {
              const req = { onsuccess: null, onerror: null, result: record.id };
              fireAsync(() => {
                backingMap.set(record.id, record);
                req.onsuccess?.({ target: req });
                tx.oncomplete?.();
              });
              return req;
            },
            get(id) {
              const req = { onsuccess: null, onerror: null, result: undefined };
              fireAsync(() => {
                req.result = backingMap.get(id);
                req.onsuccess?.({ target: req });
                tx.oncomplete?.();
              });
              return req;
            },
            delete(id) {
              const req = { onsuccess: null, onerror: null };
              fireAsync(() => {
                backingMap.delete(id);
                req.onsuccess?.({ target: req });
                tx.oncomplete?.();
              });
              return req;
            },
            clear() {
              const req = { onsuccess: null, onerror: null };
              fireAsync(() => {
                backingMap.clear();
                req.onsuccess?.({ target: req });
                tx.oncomplete?.();
              });
              return req;
            },
            getAllKeys() {
              const req = { onsuccess: null, onerror: null, result: [] };
              fireAsync(() => {
                req.result = Array.from(backingMap.keys());
                req.onsuccess?.({ target: req });
                setTimeout(() => tx.oncomplete?.(), 0);
              });
              return req;
            }
          };
        }
      };
      return tx;
    }
  };

  return {
    backingMap,
    open(_name, _version) {
      const req = {
        result: dbObj,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null
      };
      fireAsync(() => {
        if (!stores.has('originals')) {
          req.onupgradeneeded?.({ target: req });
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    }
  };
}

function createMockDomEnv({ deferToBlob = false } = {}) {
  const byId = new Map();
  const downloads = [];
  const blobUrls = new Map();
  const revokedUrls = [];
  const imageDataCalls = [];
  const panDrawCalls = [];
  const pendingToBlobResolvers = [];
  let blobUrlSeq = 0;

  class MockBlob {
    constructor(parts, opts = {}) {
      this.parts = parts;
      this.type = opts.type || 'image/png';
      this.meta = opts.meta || {};
      this.size = 128;
    }
    async arrayBuffer() {
      const text = this.parts.join('');
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      return bytes.buffer;
    }
  }

  function makeClassList() {
    const s = new Set();
    return {
      add: (...xs) => xs.forEach(x => s.add(x)),
      remove: (...xs) => xs.forEach(x => s.delete(x)),
      contains: x => s.has(x)
    };
  }

  function makeElement(tagName) {
    const listeners = new Map();
    const attrs = new Map();
    const el = {
      tagName: String(tagName || 'DIV').toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      title: '',
      disabled: false,
      hidden: false,
      open: false,
      href: '',
      download: '',
      src: '',
      alt: '',
      value: '',
      style: {},
      children: [],
      parentNode: null,
      classList: makeClassList(),
      _texts: [],
      _scaleCalls: [],
      _smoothingQualities: [],
      set idValue(v) {
        this.id = v;
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'id') {
          this.id = String(v);
          byId.set(this.id, this);
        }
      },
      getAttribute(k) {
        return attrs.get(k) ?? null;
      },
      appendChild(child) {
        if (!child) return child;
        child.parentNode = this;
        this.children.push(child);
        if (child.id) byId.set(child.id, child);
        return child;
      },
      insertBefore(node, refNode) {
        if (!node) return node;
        node.parentNode = this;
        const idx = this.children.indexOf(refNode);
        if (idx >= 0) this.children.splice(idx, 0, node);
        else this.children.push(node);
        if (node.id) byId.set(node.id, node);
        return node;
      },
      remove() {
        if (!this.parentNode) return;
        const idx = this.parentNode.children.indexOf(this);
        if (idx >= 0) this.parentNode.children.splice(idx, 1);
        this.parentNode = null;
      },
      replaceChildren(...nodes) {
        this.children.length = 0;
        for (const n of nodes) this.appendChild(n);
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const list = listeners.get(type);
        if (!list) return;
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      },
      async click() {
        if (this.tagName === 'A' && this.download) {
          const mappedBlob = blobUrls.get(this.href) || null;
          downloads.push({
            href: this.href,
            download: this.download,
            blob: mappedBlob
          });
        }
        const list = listeners.get('click') || [];
        for (const fn of list) {
          await fn({ target: this, preventDefault() {} });
        }
      },
      focus() {},
      showModal() { this.open = true; },
      close() {
        this.open = false;
        const list = listeners.get('close') || [];
        for (const fn of list) fn({ target: this });
      },
      querySelector(sel) {
        if (sel === 'footer') {
          return this.children.find(c => c.tagName === 'FOOTER') || null;
        }
        return null;
      }
    };

    if (el.tagName === 'CANVAS') {
      el.width = 300;
      el.height = 150;
      el.getContext = () => ({
        canvas: el,
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        font: '12px serif',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        save() {},
        restore() {},
        setTransform() {},
        scale(sx, sy) { el._scaleCalls.push([sx, sy]); },
        clearRect() {},
        fillRect() {},
        strokeRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        rect() {},
        clip() {},
        stroke() {},
        fillText(t) { el._texts.push(String(t)); },
        drawImage(src, ...args) {
          el._smoothingQualities.push(this.imageSmoothingQuality);
          if (src && src.isDecodedMock && args.length >= 4) {
            panDrawCalls.push({
              dx: args[0],
              dy: args[1],
              dw: args[2],
              dh: args[3],
              natW: src.naturalWidth,
              natH: src.naturalHeight
            });
          }
        },
        getImageData(x, y, w, h) {
          imageDataCalls.push({ canvasW: el.width, canvasH: el.height, x, y, w, h });
          return { data: new Uint8ClampedArray(Math.max(4, w * h * 4)) };
        },
        putImageData() {},
        createLinearGradient() { return { addColorStop() {} }; },
        createRadialGradient() { return { addColorStop() {} }; }
      });
      el.toDataURL = (mime = 'image/png', quality) => {
        return `data:${mime};base64,` + Buffer.from(JSON.stringify({ w: el.width, h: el.height, mime, quality })).toString('base64');
      };
      el.toBlob = (cb, mime = 'image/png') => {
        const snapshotW = el.width;
        const snapshotH = el.height;
        const emit = () => {
          cb(new MockBlob([`mock-${snapshotW}x${snapshotH}`], {
            type: mime,
            meta: { w: snapshotW, h: snapshotH, mime }
          }));
        };
        if (deferToBlob) {
          pendingToBlobResolvers.push(emit);
        } else {
          queueMicrotask(emit);
        }
      };
    }

    const proxy = new Proxy(el, {
      set(target, prop, value) {
        target[prop] = value;
        if (prop === 'id' && value) byId.set(String(value), proxy);
        return true;
      }
    });
    return proxy;
  }

  // Re-bind proxy self reference cleanly via factory
  function createElementProxy(tag) {
    const node = makeElement(tag);
    return node;
  }

  const body = createElementProxy('body');
  const head = createElementProxy('head');
  const journal = createElementProxy('dialog');
  journal.id = 'journal';
  byId.set('journal', journal);
  const journalTabs = createElementProxy('div');
  journalTabs.id = 'journal-tabs';
  journalTabs.className = 'journal__tabs';
  const tabNotes = createElementProxy('button');
  tabNotes.id = 'journal-tab-notes';
  const tabField = createElementProxy('button');
  tabField.id = 'journal-tab-field';
  journalTabs.appendChild(tabNotes);
  journalTabs.appendChild(tabField);
  const journalFooter = createElementProxy('footer');
  journal.appendChild(journalTabs);
  journal.appendChild(journalFooter);
  body.appendChild(journal);

  const doc = {
    body,
    head,
    documentElement: body,
    activeElement: body,
    createElement: tag => createElementProxy(tag),
    getElementById: id => byId.get(id) || null
  };

  const urlApi = {
    createObjectURL(blob) {
      const u = `blob:taohua/${++blobUrlSeq}`;
      blobUrls.set(u, blob);
      return u;
    },
    revokeObjectURL(u) {
      revokedUrls.push(u);
      blobUrls.delete(u);
    }
  };

  class MockImage {
    constructor() {
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.width = 0;
      this.height = 0;
      this.complete = false;
      this.onload = null;
      this.onerror = null;
      this.isDecodedMock = true;
    }
    set src(val) {
      this._src = val;
      if (val.startsWith('blob:')) {
        const b = blobUrls.get(val);
        if (b?.meta) {
          this.naturalWidth = b.meta.w;
          this.naturalHeight = b.meta.h;
        }
      } else if (val.startsWith('data:')) {
        const b64 = val.split(',')[1] || '';
        try {
          const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
          this.naturalWidth = parsed.w || 680;
          this.naturalHeight = parsed.h || 410;
        } catch {
          this.naturalWidth = 680;
          this.naturalHeight = 410;
        }
      }
      this.width = this.naturalWidth;
      this.height = this.naturalHeight;
      this.complete = true;
      queueMicrotask(() => this.onload?.());
    }
  }

  const win = {
    URL: urlApi,
    Image: MockImage,
    addEventListener() {},
    removeEventListener() {},
    confirm: () => true
  };

  const storeMap = new Map();
  const storage = {
    getItem: k => storeMap.get(k) ?? null,
    setItem: (k, v) => storeMap.set(k, String(v)),
    removeItem: k => storeMap.delete(k)
  };

  return {
    doc,
    win,
    storage,
    storeMap,
    byId,
    downloads,
    blobUrls,
    revokedUrls,
    imageDataCalls,
    panDrawCalls,
    flushPendingToBlob() {
      while (pendingToBlobResolvers.length) {
        pendingToBlobResolvers.shift()();
      }
    }
  };
}

function findButtonsByText(root, text) {
  const out = [];
  if (!root || !Array.isArray(root.children)) return out;
  for (const ch of root.children) {
    if (ch.tagName === 'BUTTON' && ch.textContent === text) out.push(ch);
    out.push(...findButtonsByText(ch, text));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Native resolution scaling & scaled brush-style pixel coordinates
// ---------------------------------------------------------------------------
{
  const s1080Hand = computeExportScale({ width: 1920, height: 1080 }, 'handscroll');
  assert.equal(Math.round(1360 * s1080Hand), 2133, '1920x1080 handscroll width scales to 2133');
  assert.equal(Math.round(820 * s1080Hand), 1286, '1920x1080 handscroll height scales to 1286');
  assert.equal(Math.round(1224 * s1080Hand), 1920, '1920x1080 handscroll heart maps 1:1 to 1920px');

  const s1080Hang = computeExportScale({ width: 1920, height: 1080 }, 'hanging');
  assert.equal(Math.round(1280 * s1080Hang), 2160, '1920x1080 hanging width scales to 2160');
  assert.equal(Math.round(860 * s1080Hang), 1451, '1920x1080 hanging height scales to 1451');
  assert.equal(Math.round(640 * s1080Hang), 1080, '1920x1080 hanging heart height maps 1:1 to 1080px');

  const s1440Hand = computeExportScale({ width: 2560, height: 1440 }, 'handscroll');
  assert.equal(Math.round(1360 * s1440Hand), 2844, '2560x1440 handscroll width scales to 2844');
  assert.equal(Math.round(820 * s1440Hand), 1715, '2560x1440 handscroll height scales to 1715');

  const s5kHand = computeExportScale({ width: 5120, height: 2880 }, 'handscroll');
  assert.equal(s5kHand, 2.5, '5120x2880 export scale clamps safely to 2.5x');
  assert.equal(Math.round(1360 * s5kHand), 3400);
  assert.equal(Math.round(820 * s5kHand), 2050);

  const sSmall = computeExportScale({ width: 640, height: 360 }, 'handscroll');
  assert.equal(sSmall, 1, 'small/mock canvas stays at 1x');

  // Verify qianjiang & shuimo brush style coordinates scale cleanly to device backing pixels
  const env = createMockDomEnv();
  const src1080 = env.doc.createElement('canvas');
  src1080.width = 1920;
  src1080.height = 1080;
  const studio = createScrollStudio({
    canvas: src1080,
    player: { state: { x: 40, y: 2, z: -120, yaw: 0 } },
    journal: { isOpen: () => false },
    map: { isOpen: () => false, getStats: () => ({ region: '桃源村' }) },
    sky: { timeId: 'day', weatherId: 'clear' },
    getPhenology: () => ({ getStats: () => ({ phenologyId: 'summer' }) }),
    world,
    doc: env.doc,
    win: env.win,
    storage: env.storage,
    idbFactory: null
  });
  for (const style of ['qianjiang', 'shuimo']) {
    env.imageDataCalls.length = 0;
    const url = studio.captureScrollDataUrl({ style, mode: 'handscroll', mimeType: 'image/png' });
    const meta = JSON.parse(Buffer.from(url.split(',')[1], 'base64').toString('utf8'));
    assert.equal(meta.w, 2133);
    assert.equal(meta.h, 1286);
    assert.equal(env.imageDataCalls.length, 1, `${style} runs single scaled getImageData pass`);
    const call = env.imageDataCalls[0];
    assert.equal(call.canvasW, 2133);
    assert.equal(call.canvasH, 1286);
    assert.ok(call.x === Math.floor(68 * (2133 / 1360)), `${style} x matches scaled heartX`);
    assert.ok(call.w >= 1918 && call.w <= 1922, `${style} width covers full 1920px heart (${call.w})`);
    assert.ok(call.h >= 924 && call.h <= 927, `${style} height covers scaled 925px heart (${call.h})`);
  }
  studio.dispose();
}

// ---------------------------------------------------------------------------
// 2. Dual-tier persistence (IndexedDB + localStorage) & cross-reload 展卷下载
// ---------------------------------------------------------------------------
{
  const env = createMockDomEnv();
  const idb = createMockIndexedDb();
  const journalSeed = JSON.stringify({ places: ['wuling'], people: [], classics: [], guide: [] });
  env.storage.setItem('taohua.journal.v1', journalSeed);

  const srcCanvas = env.doc.createElement('canvas');
  srcCanvas.width = 1920;
  srcCanvas.height = 1080;

  const studio1 = createScrollStudio({
    canvas: srcCanvas,
    player: { state: { x: 64, y: 2, z: -140, yaw: 0.25 }, clearInput() {} },
    journal: { isOpen: () => false },
    map: { isOpen: () => false, getStats: () => ({ region: '六博亭林' }) },
    sky: { timeId: 'day', weatherId: 'clear' },
    getPhenology: () => ({ getStats: () => ({ phenologyId: 'summer' }) }),
    world,
    doc: env.doc,
    win: env.win,
    storage: env.storage,
    idbFactory: idb
  });

  studio1.openCapture(false);
  await env.byId.get('scroll-save-box').click();
  // Wait for async toBlob + IDB put microtasks
  await new Promise(r => setTimeout(r, 25));

  const saved1 = studio1.getSavedScrolls();
  assert.equal(saved1.length, 1);
  assert.equal(saved1[0].hasOriginal, true);
  assert.equal(saved1[0].originalWidth, 2133);
  assert.equal(saved1[0].originalHeight, 1286);
  assert.equal(saved1[0].originalMime, 'image/png');
  assert.ok(saved1[0].dataUrl.startsWith('data:image/jpeg'), 'localStorage thumbnail stays compact JPEG');
  const thumbMeta = JSON.parse(Buffer.from(saved1[0].dataUrl.split(',')[1], 'base64').toString('utf8'));
  assert.equal(thumbMeta.w, 800, 'localStorage thumbnail uses sharper 800px preview width');
  assert.equal(env.storage.getItem('taohua.journal.v1'), journalSeed, 'taohua.journal.v1 stays completely untouched');
  assert.equal(idb.backingMap.size, 1, 'IndexedDB stores 1 lossless PNG original');
  const storedOrig = idb.backingMap.get(saved1[0].id);
  assert.equal(storedOrig.width, 2133);
  assert.equal(storedOrig.height, 1286);
  assert.equal(storedOrig.mimeType, 'image/png');
  assert.ok(storedOrig.blob && storedOrig.blob.type === 'image/png');

  // Test dialog 展卷珍藏（下载 PNG） downloads full-res 2133x1286 PNG
  await env.byId.get('scroll-download-png').click();
  assert.equal(env.downloads.length, 1);
  assert.ok(env.downloads[0].download.endsWith('.png'));
  assert.equal(env.downloads[0].blob.meta.w, 2133);
  assert.equal(env.downloads[0].blob.meta.h, 1286);
  assert.ok(env.byId.get('scroll-status').textContent.includes('2133×1286'));

  studio1.close();
  studio1.dispose();

  // Simulate full page reload with fresh DOM + studio2 sharing storage & idb
  const env2 = createMockDomEnv();
  env2.storage.setItem('taohua.scrolls.v1', env.storage.getItem('taohua.scrolls.v1'));
  const studio2 = createScrollStudio({
    canvas: env2.doc.createElement('canvas'),
    player: { state: { x: 0, y: 0, z: 0, yaw: 0 } },
    journal: { isOpen: () => false },
    map: { isOpen: () => false },
    sky: { timeId: 'day', weatherId: 'clear' },
    world,
    doc: env2.doc,
    win: env2.win,
    storage: env2.storage,
    idbFactory: idb
  });

  const dlRes = await studio2.downloadSavedScroll(saved1[0].id);
  assert.equal(dlRes.isOriginal, true, 'reloaded studio retrieves original PNG from IndexedDB');
  assert.equal(dlRes.width, 2133);
  assert.equal(dlRes.height, 1286);
  assert.ok(dlRes.filename.endsWith('.png'));

  // Also click the rendered 展卷下载 button in 画匣 gallery
  const dlBtns = findButtonsByText(env2.byId.get('journal-scrolls-list'), '展卷下载');
  assert.equal(dlBtns.length, 1, 'renders 展卷下载 button in gallery');
  assert.ok(dlBtns[0].title.includes('2133×1286'), 'button tooltip advertises original PNG dimensions');
  await dlBtns[0].click();
  assert.equal(env2.downloads.length, 2);
  assert.ok(env2.downloads[1].href.startsWith('blob:'));
  assert.ok(env2.downloads[1].download.endsWith('.png'));
  assert.equal(env2.downloads[1].blob.meta.w, 2133);
  assert.equal(env2.downloads[1].blob.meta.h, 1286);

  studio2.dispose();
}

// ---------------------------------------------------------------------------
// 3. In-memory session cache fallback when IndexedDB is unavailable
// ---------------------------------------------------------------------------
{
  const env = createMockDomEnv();
  const srcCanvas = env.doc.createElement('canvas');
  srcCanvas.width = 1920;
  srcCanvas.height = 1080;

  const studio = createScrollStudio({
    canvas: srcCanvas,
    player: { state: { x: 10, y: 1, z: 10, yaw: 0 }, clearInput() {} },
    journal: { isOpen: () => false },
    map: { isOpen: () => false, getStats: () => ({ region: '桃源村' }) },
    sky: { timeId: 'day', weatherId: 'clear' },
    world,
    doc: env.doc,
    win: env.win,
    storage: env.storage,
    idbFactory: null
  });

  studio.openCapture(false);
  await env.byId.get('scroll-save-box').click();
  const saved = studio.getSavedScrolls()[0];
  const dlRes = await studio.downloadSavedScroll(saved.id);
  assert.equal(dlRes.isOriginal, true, 'delivers lossless original PNG from session cache even when IndexedDB is unavailable');
  assert.equal(dlRes.width, 2133);
  assert.equal(dlRes.height, 1286);
  assert.ok(dlRes.filename.endsWith('.png'));
  studio.dispose();
}

// ---------------------------------------------------------------------------
// 4. Legacy entry fallback + helpful tooltip
// ---------------------------------------------------------------------------
{
  const env = createMockDomEnv();
  const idb = createMockIndexedDb();
  const legacyUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  env.storage.setItem('taohua.scrolls.v1', JSON.stringify([{
    id: 'legacy-scroll-1',
    title: '桃源行纪 · 春深 · 晴昼 · 桃源村',
    verse: '阡陌交通，鸡犬相闻。',
    seal: '怡然自乐',
    mount: 'handscroll',
    style: 'qinglv',
    region: '桃源村',
    timeLabel: '晴昼',
    createdAt: 1000,
    dataUrl: legacyUrl
  }]));

  const studio = createScrollStudio({
    canvas: env.doc.createElement('canvas'),
    player: { state: { x: 0, y: 0, z: 0, yaw: 0 } },
    journal: { isOpen: () => false },
    map: { isOpen: () => false },
    sky: { timeId: 'day', weatherId: 'clear' },
    world,
    doc: env.doc,
    win: env.win,
    storage: env.storage,
    idbFactory: idb
  });

  const dlBtns = findButtonsByText(env.byId.get('journal-scrolls-list'), '展卷下载');
  assert.equal(dlBtns.length, 1);
  assert.ok(dlBtns[0].title.includes('旧版缩略存档'), 'legacy scroll button explains how to capture high-res original');

  const res = await studio.downloadSavedScroll('legacy-scroll-1');
  assert.equal(res.isOriginal, false);
  assert.ok(res.filename.endsWith('.jpg'));
  assert.equal(env.downloads[0].href, legacyUrl);
  studio.dispose();
}

// ---------------------------------------------------------------------------
// 5. Removal, LRU eviction (> MAX_SAVED_SCROLLS), clear & pending-save race safety
// ---------------------------------------------------------------------------
{
  const env = createMockDomEnv({ deferToBlob: true });
  const idb = createMockIndexedDb();
  const srcCanvas = env.doc.createElement('canvas');
  srcCanvas.width = 1920;
  srcCanvas.height = 1080;

  const studio = createScrollStudio({
    canvas: srcCanvas,
    player: { state: { x: 20, y: 1, z: -80, yaw: 0 }, clearInput() {} },
    journal: { isOpen: () => false },
    map: { isOpen: () => false, getStats: () => ({ region: '桃源村' }) },
    sky: { timeId: 'day', weatherId: 'clear' },
    world,
    doc: env.doc,
    win: env.win,
    storage: env.storage,
    idbFactory: idb
  });

  studio.openCapture(false);
  // Race condition check: save then remove IMMEDIATELY before toBlob completes
  await env.byId.get('scroll-save-box').click();
  const racingId = studio.getSavedScrolls()[0].id;
  assert.equal(studio.removeSavedScroll(racingId), true);
  env.flushPendingToBlob();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(idb.backingMap.has(racingId), false, 'removing while async toBlob is pending leaves zero orphan records in IndexedDB');

  // Save 9 scrolls (> MAX_SAVED_SCROLLS=8) -> oldest evicted from IDB too
  const savedIds = [];
  for (let i = 0; i < 9; i++) {
    await env.byId.get('scroll-save-box').click();
    savedIds.push(studio.getSavedScrolls()[0].id);
    env.flushPendingToBlob();
    await new Promise(r => setTimeout(r, 20));
  }
  const keptIds = studio.getSavedScrolls().map(s => s.id);
  assert.equal(keptIds.length, 8);
  assert.equal(keptIds.includes(savedIds[0]), false, 'oldest scroll evicted from saved list');
  assert.equal(idb.backingMap.has(savedIds[0]), false, 'evicted oldest scroll original pruned from IndexedDB');
  assert.equal(idb.backingMap.size, 8, 'IndexedDB retains exactly 8 originals matching saved scrolls');

  // Remove one scroll
  const victimId = keptIds[2];
  studio.removeSavedScroll(victimId);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(idb.backingMap.has(victimId), false, 'removeSavedScroll deletes original from IndexedDB');
  assert.equal(idb.backingMap.size, 7);

  // Clear all scrolls
  studio.clearSavedScrolls();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(idb.backingMap.size, 0, 'clearSavedScrolls empties IndexedDB');

  studio.dispose();
}

// ---------------------------------------------------------------------------
// 6. Panoramic scroll export uses full-res originals & preserves aspect ratio
// ---------------------------------------------------------------------------
{
  const env = createMockDomEnv();
  const idb = createMockIndexedDb();
  const srcCanvas = env.doc.createElement('canvas');
  srcCanvas.width = 1920;
  srcCanvas.height = 1080;

  const studio = createScrollStudio({
    canvas: srcCanvas,
    player: { state: { x: 20, y: 1, z: -80, yaw: 0 }, clearInput() {} },
    journal: { isOpen: () => false },
    map: { isOpen: () => false, getStats: () => ({ region: '美池' }) },
    sky: { timeId: 'day', weatherId: 'clear' },
    world,
    doc: env.doc,
    win: env.win,
    storage: env.storage,
    idbFactory: idb
  });

  studio.openCapture(false);
  await env.byId.get('scroll-save-box').click();
  // Second scroll in hanging mode (different aspect ratio: 2160x1451)
  await env.byId.get('scroll-mount-toggle').click();
  await env.byId.get('scroll-save-box').click();
  await new Promise(r => setTimeout(r, 30));

  const panRes = await studio.exportPanoramicScroll();
  assert.ok(panRes && panRes.filename.endsWith('.png'));
  assert.equal(panRes.count, 2);
  assert.ok(panRes.width > 2056, `panoramic canvas scales up for high-res originals (got ${panRes.width})`);
  assert.equal(env.panDrawCalls.length, 2, 'panoramic scroll drew both decoded originals');
  for (const call of env.panDrawCalls) {
    const srcAspect = call.natW / call.natH;
    const dstAspect = call.dw / call.dh;
    assert.ok(Math.abs(srcAspect - dstAspect) < 0.01, `panoramic panel preserves aspect ratio (${srcAspect.toFixed(3)} vs ${dstAspect.toFixed(3)})`);
  }
  assert.ok(env.revokedUrls.length >= 2, 'temporary object URLs created for panoramic decoding are revoked cleanly');

  studio.dispose();
}

console.log('PASS check-scroll-original-download: high-res scaling, IndexedDB/session-cache PNG persistence, legacy fallback, eviction/race safety & panoramic export verified');
