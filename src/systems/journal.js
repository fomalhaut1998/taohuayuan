// 游记仅记录已经发生的相遇，不承担任务或引导。
const KEY = 'taohua.journal.v1';
const TIMES_KEY = 'taohua.journal.times.v1';
import { CATALOGUE as GUIDE, CATALOGUE_GROUPS } from './catalogue.js';
import { getSolarTerm } from './world-clock.js';
import { isModalBusy } from './modal-state.js';
import mapExpansion from '../data/map-expansion.json' with { type: 'json' };
import wildsEggsCfg from '../data/wilds-easter-eggs.json' with { type: 'json' };

const HANZI_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七'];

function solarTermFromStamp(stamp) {
  if (typeof stamp !== 'string' || !stamp) return null;
  const m = stamp.match(/(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return getSolarTerm(Number(m[1]), Number(m[2]));
}

export function createJournal(pois, points, canvas, player) {
  const allPois = Array.isArray(pois) && pois.some(function (p) { return p && p.id === 'wuling'; })
    ? pois.concat(mapExpansion.pois || [])
    : pois;
  const dialog = document.getElementById('journal');
  const openButton = document.getElementById('journal-open');
  const closeButton = document.getElementById('journal-close');
  const clearButton = document.getElementById('journal-clear');
  const status = document.getElementById('journal-status');
  const lists = ['places', 'people', 'classics'].map(function (name) { return document.getElementById('journal-' + name); });
  const validPlaces = new Set(allPois.map(function (p) { return p.id; }));
  const validPoints = new Set(points.map(function (p) { return p.id; }));
  let data = { places: [], people: [], classics: [], guide: [] };
  let times = { places: Object.create(null), people: Object.create(null), classics: Object.create(null) };
  let getClock = null;
  let storageOK = true;
  let returnFocus = null;
  let returnToRoaming = false;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      data.places = Array.isArray(saved.places) ? [...new Set(saved.places.filter(function (id) { return validPlaces.has(id); }))] : [];
      data.classics = Array.isArray(saved.classics) ? [...new Set(saved.classics.filter(function (id) { return validPoints.has(id); }))] : [];
      data.guide = Array.isArray(saved.guide) ? [...new Set(saved.guide.filter(function (id) { return Object.prototype.hasOwnProperty.call(GUIDE, id); }))] : [];
      data.people = Array.isArray(saved.people) ? saved.people.filter(function (p) { return p && /^(?:p\d+|c_[\w-]+)$/.test(p.id) && typeof p.name === 'string' && typeof p.line === 'string'; }).slice(0, 200) : [];
    }
  } catch (err) { storageOK = false; }
  try {
    const savedTimes = JSON.parse(localStorage.getItem(TIMES_KEY) || 'null');
    if (savedTimes && typeof savedTimes === 'object') {
      ['places', 'people', 'classics'].forEach(function (sec) {
        const src = savedTimes[sec];
        if (!src || typeof src !== 'object') return;
        Object.keys(src).forEach(function (k) {
          if (typeof src[k] === 'string' && src[k].trim()) times[sec][k] = src[k].trim().slice(0, 36);
        });
      });
    }
  } catch (err) { /* 旧版无时间戳存档静默兼容 */ }
  function currentModernTime() {
    if (!getClock) return '';
    try {
      const wc = typeof getClock === 'function' ? getClock() : getClock;
      const txt = wc?.getState?.()?.modernText;
      return typeof txt === 'string' ? txt.trim() : '';
    } catch (err) { return ''; }
  }
  function saveTimes() {
    try {
      const out = { places: { ...times.places }, people: { ...times.people }, classics: { ...times.classics } };
      localStorage.setItem(TIMES_KEY, JSON.stringify(out));
    } catch (err) { /* 存储空间受限时不影响主游记 */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); storageOK = true; }
    catch (err) { storageOK = false; }
    status.textContent = storageOK ? '' : '浏览器存储不可用，本次记录可能无法保留。';
  }
  function add(kind, value, id) {
    if (kind === 'people' ? data.people.some(function (p) { return p.id === id && p.line === value.line; }) : data[kind].includes(value)) return;
    data[kind].push(value);
    const stamp = currentModernTime();
    if (stamp && (kind === 'places' || kind === 'people' || kind === 'classics')) {
      const key = kind === 'people' ? (id + '|' + value.line) : String(value);
      if (!times[kind][key]) {
        times[kind][key] = stamp;
        saveTimes();
      }
    }
    save();
    api.onEvent?.(kind, value, id);
  }
  function drawList(el, values, empty) {
    el.replaceChildren();
    if (!values.length) { const li = document.createElement('li'); li.className = 'journal__empty'; li.textContent = empty; el.appendChild(li); return; }
    values.forEach(function (value) {
      const li = document.createElement('li');
      if (value && typeof value === 'object') {
        li.textContent = value.text;
        if (value.time) {
          const span = document.createElement('span');
          span.className = 'journal__time';
          span.textContent = value.time;
          li.appendChild(span);
          const term = solarTermFromStamp(value.time);
          if (term && term.name) {
            const badge = document.createElement('span');
            badge.className = 'journal__term';
            badge.textContent = term.name;
            if (term.whisper) badge.setAttribute?.('title', term.name + ' · ' + term.whisper);
            li.appendChild(badge);
          }
        }
      } else {
        li.textContent = value;
      }
      el.appendChild(li);
    });
  }
  const isMainJournal = Array.isArray(pois) && pois.some(function (p) { return p && p.id === 'wuling'; });
  function renderWildsWonders() {
    const notesEl = document.getElementById('journal-notes');
    if (!notesEl || typeof document.createElement !== 'function') return;
    const eggSites = wildsEggsCfg.sites || [];
    const foundEggs = eggSites.filter(function (s) { return data.guide.includes(s.id); });
    if (!isMainJournal && foundEggs.length === 0) return;

    let section = document.getElementById('journal-wilds-wonders');
    if (!section) {
      section = document.createElement('section');
      section.id = 'journal-wilds-wonders';
      const heading = document.createElement('h3');
      const titleSpan = document.createElement('span');
      titleSpan.textContent = '山野奇遇';
      const progSpan = document.createElement('span');
      progSpan.id = 'journal-wonders-progress';
      progSpan.className = 'journal__wonders-progress';
      heading.appendChild(titleSpan);
      heading.appendChild(progSpan);
      const bodyDiv = document.createElement('div');
      bodyDiv.id = 'journal-wonders-body';
      bodyDiv.className = 'journal__wonders-body';
      section.appendChild(heading);
      section.appendChild(bodyDiv);
      notesEl.appendChild(section);
    }

    const total = eggSites.length;
    const progEl = document.getElementById('journal-wonders-progress');
    if (progEl) {
      progEl.textContent = (HANZI_DIGITS[foundEggs.length] || String(foundEggs.length)) + ' / ' + (HANZI_DIGITS[total] || String(total));
    }

    const bodyEl = document.getElementById('journal-wonders-body');
    if (!bodyEl) return;
    const ul = document.createElement('ul');
    ul.id = 'journal-wonders-list';
    if (!foundEggs.length) {
      const li = document.createElement('li');
      li.className = 'journal__empty';
      li.textContent = '拓展山野尚有七处隐奇，展卷放大可循「觅」印寻幽';
      ul.appendChild(li);
      bodyEl.replaceChildren(ul);
      return;
    }

    foundEggs.forEach(function (site) {
      const li = document.createElement('li');
      const badge = document.createElement('span');
      badge.className = 'journal__egg-badge';
      badge.textContent = '奇';
      const txt = document.createElement('span');
      txt.textContent = site.name + (site.poem ? ' · ' + site.poem : '');
      li.appendChild(badge);
      li.appendChild(txt);
      ul.appendChild(li);
    });

    if (foundEggs.length < total) {
      const hint = document.createElement('p');
      hint.className = 'journal__wonders-note';
      hint.textContent = '尚余 ' + (HANZI_DIGITS[total - foundEggs.length] || String(total - foundEggs.length)) + ' 处秘踪隐于外山深涧，行近时可闻隐约山声';
      bodyEl.replaceChildren(ul, hint);
    } else {
      const doneBox = document.createElement('div');
      doneBox.className = 'journal__wonders-complete';
      const seal = document.createElement('span');
      seal.className = 'journal__wonders-seal';
      seal.textContent = '山野秘藏';
      const note = document.createElement('span');
      note.className = 'journal__wonders-note';
      note.textContent = '七奇尽览 · 丹青入画（L）已解「山野秘藏」藏书朱印';
      doneBox.appendChild(seal);
      doneBox.appendChild(note);
      bodyEl.replaceChildren(ul, doneBox);
    }
  }
  function render() {
    drawList(lists[0], data.places.map(function (id) { return allPois.find(function (p) { return p.id === id; }); }).filter(Boolean).map(function (p) {
      const t = times.places[p.id];
      return t ? { text: p.name, time: t } : p.name;
    }), '尚未留下行迹');
    drawList(lists[1], data.people.map(function (p) {
      const t = times.people[p.id + '|' + p.line];
      const text = p.name + ' · ' + p.line;
      return t ? { text: text, time: t } : text;
    }), '尚未与村人交谈');
    CATALOGUE_GROUPS.forEach(function (group) {
      let list = document.getElementById('journal-' + group);
      if (!list && group === 'life') {
        const section = document.createElement('section');
        const heading = document.createElement('h3'); heading.textContent = '村中器用';
        list = document.createElement('ul'); list.id = 'journal-life';
        section.appendChild(heading); section.appendChild(list);
        document.getElementById('journal-field').appendChild(section);
      }
      if (!list) return;
      drawList(list, data.guide.filter(function (id) { return GUIDE[id].group === group; }).map(function (id) { return GUIDE[id].name + ' · ' + GUIDE[id].text; }), '尚未记下所见');
    });
    drawList(lists[2], data.classics.map(function (id) { return points.find(function (p) { return p.id === id; }); }).filter(Boolean).map(function (p) {
      const t = times.classics[p.id];
      const text = '「' + p.classic + '」 ' + p.plain;
      return t ? { text: text, time: t } : text;
    }), '尚未听见原文');
    renderWildsWonders();
    status.textContent = storageOK ? '' : '浏览器存储不可用，本次记录可能无法保留。';
  }
  function selectPage(field) {
    document.getElementById('journal-notes').hidden = field;
    document.getElementById('journal-field').hidden = !field;
    document.getElementById('journal-tab-notes').setAttribute('aria-pressed', String(!field));
    document.getElementById('journal-tab-field').setAttribute('aria-pressed', String(field));
  }
  document.getElementById('journal-tab-notes').addEventListener('click', function () { selectPage(false); });
  document.getElementById('journal-tab-field').addEventListener('click', function () { selectPage(true); });
  let wasLocked = false;
  function open(fromKeyboard = false) {
    if (dialog.open || isModalBusy(document, { ignore: 'journal' })) return;
    returnFocus = document.activeElement;
    returnToRoaming = fromKeyboard === true && (returnFocus === document.body || returnFocus === canvas);
    wasLocked = document.pointerLockElement === canvas;
    player.clearInput();
    if (document.pointerLockElement) document.exitPointerLock();
    render();
    dialog.showModal();
    closeButton.focus();
  }
  function close() { if (dialog.open) { player.clearInput(); dialog.close(); } }
  openButton.addEventListener('click', function () { open(false); });
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', function () {
    player.clearInput();
    const relock = wasLocked;
    wasLocked = false;
    if (returnToRoaming) {
      canvas.focus({ preventScroll: true });
    } else if (returnFocus && returnFocus !== canvas && returnFocus.focus) returnFocus.focus();
    else openButton.focus();
    if (relock) {
      canvas.focus({ preventScroll: true });
      try { Promise.resolve(canvas.requestPointerLock?.()).catch?.(() => {}); } catch {}
    }
  });
  dialog.addEventListener('click', function (event) { if (event.target === dialog) close(); });
  window.addEventListener('keydown', function (event) {
    if (dialog.open) {
      if (event.code === 'KeyJ' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); close(); }
      // 禁止游戏快捷键透过弹窗，保留原生 Tab、按钮及 Esc。
      event.stopImmediatePropagation();
      return;
    }
    if (event.code === 'KeyJ' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) && !event.target.isContentEditable) { event.preventDefault(); open(true); }
  }, true);
  clearButton.addEventListener('click', function () {
    if (!window.confirm('确定清除本浏览器的游记与图鉴？行迹、相遇和图鉴都会清除，此操作无法撤销。')) return;
    data = { places: [], people: [], classics: [], guide: [] };
    times = { places: Object.create(null), people: Object.create(null), classics: Object.create(null) };
    try { localStorage.removeItem(TIMES_KEY); } catch (err) {}
    save();
    if (api.onClear) api.onClear();
    render();
    if (storageOK) status.textContent = '游记记录已清除。';
  });
  const api = {
    visited: function () { return data.places.slice(); },
    visit: function (poi) { add('places', poi.id); },
    person: function (id, name, line) { add('people', { id: id, name: name, line: line }, id); },
    classic: function (point) { add('classics', point.id); },
    classics: function () { return data.classics.slice(); },
    observe: function (id) { if (!Object.prototype.hasOwnProperty.call(GUIDE, id)) return false; const fresh = !data.guide.includes(id); add('guide', id); return fresh; },
    setClock: function (clockProvider) { getClock = clockProvider || null; },
    getTimestamps: function () { return { places: { ...times.places }, people: { ...times.people }, classics: { ...times.classics } }; },
    isOpen: function () { return dialog.open; },
    close: close,
    onClear: null,
    onEvent: null
  };
  return api;
}
