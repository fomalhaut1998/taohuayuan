import * as THREE from 'three';
import { interactionAllowed, mysteryUiPaused } from './mysteries.js';
import { getBlockerGrid } from './spatial-grid.js';

// 近观：走近人或动物，按 E，她会回头应你一句。
// 目标选择、圆环、提示、台词、镜头轻推都在这里，人物/动物的具体动作交给它们自己。
export function createInteraction(cfg, script, people, fauna, field, player, sound, onPerson, blockers = [], mysteries = null, communityLife = null) {
  const npc = (script && script.npc) || {};
  const roles = npc.roles || {};
  const animalLines = npc.animals || {};

  const promptEl = document.getElementById('prompt');
  const promptTextEl = document.getElementById('prompt-text');
  const reticleEl = document.getElementById('reticle');
  const talkEl = document.getElementById('talk');
  const talkWhoEl = document.getElementById('talk-who');
  const talkLineEl = document.getElementById('talk-line');

  const group = new THREE.Group();
  group.name = 'interaction';
  const ringGeo = new THREE.RingGeometry(cfg.ring.inner, cfg.ring.outer, cfg.ring.segments);
  const ringMat = new THREE.MeshBasicMaterial({
    color: cfg.ring.color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.FrontSide
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.frustumCulled = false;
  ring.renderOrder = 2;
  group.add(ring);

  const infoCache = new Map();
  const cooldowns = new Map();
  const cursors = new Map();

  let talkMetaEl = null;
  let talkRepliesEl = null;
  let dialogueDirector = null;

  function ensureRichTalkDom() {
    if (talkMetaEl || !talkEl || typeof talkEl.appendChild !== 'function' || typeof document?.createElement !== 'function') return;
    const meta = document.createElement('div');
    if (!meta || !meta.classList) return;
    meta.id = 'talk-meta';
    if (talkLineEl?.parentNode === talkEl && typeof talkEl.insertBefore === 'function') {
      talkEl.insertBefore(meta, talkLineEl);
    } else {
      talkEl.appendChild(meta);
    }
    const replies = document.createElement('div');
    replies.id = 'talk-replies';
    talkEl.appendChild(replies);
    talkMetaEl = meta;
    talkRepliesEl = replies;
  }

  let focus = null;
  let focusAlpha = 0;
  let talkTimer = 0;
  let pushT = 0;
  let talkCount = 0;
  let lastTalk = null;
  let disposed = false;

  function infoFor(kind, ref) {
    const isHuman = kind === 'person' || kind === 'community';
    const cacheKey = isHuman ? 'r:' + (ref.role || 'villager') : 'a:' + kind;
    let info = infoCache.get(cacheKey);
    if (!info) {
      const source = isHuman
        ? (roles[ref.role] || roles.villager || {})
        : (animalLines[kind] || {});
      info = {
        name: source.name || (isHuman ? '村人' : kind),
        lines: source.lines || []
      };
      infoCache.set(cacheKey, info);
    }
    return info;
  }

  function keyOfPerson(index) { return 'p' + index; }
  function keyOfAnimal(a) { return 'a' + a.kind + a.index; }

  // Intersect the player-target segment with the same rotated wall boxes used by movement (zero per-frame allocations).
  function hitTallBlocker(b, ax, az, bx, bz) {
    if (Number.isFinite(b.maxY) && Number.isFinite(b.minY) && b.maxY - b.minY < 1.0) return false;
    const rBound = (b.hw || 0) + (b.hd || 0);
    if ((ax < b.x - rBound && bx < b.x - rBound) || (ax > b.x + rBound && bx > b.x + rBound) ||
        (az < b.z - rBound && bz < b.z - rBound) || (az > b.z + rBound && bz > b.z + rBound)) {
      return false;
    }
    const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
    const x = (ax - b.x) * c - (az - b.z) * s;
    const z = (ax - b.x) * s + (az - b.z) * c;
    const dx = (bx - ax) * c - (bz - az) * s;
    const dz = (bx - ax) * s + (bz - az) * c;
    let lo = 0, hi = 1;
    if (Math.abs(dx) < 1e-9) {
      if (Math.abs(x) > b.hw) return false;
    } else {
      const a0 = (-b.hw - x) / dx, q0 = (b.hw - x) / dx;
      lo = Math.max(lo, Math.min(a0, q0));
      hi = Math.min(hi, Math.max(a0, q0));
    }
    if (Math.abs(dz) < 1e-9) {
      if (Math.abs(z) > b.hd) return false;
    } else {
      const a1 = (-b.hd - z) / dz, q1 = (b.hd - z) / dz;
      lo = Math.max(lo, Math.min(a1, q1));
      hi = Math.min(hi, Math.max(a1, q1));
    }
    return lo <= hi && lo <= 1 && hi >= 0;
  }

  function blocked(ax, az, bx, bz) {
    if (!Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) return false;
    if (blockers.length >= 24) {
      const grid = getBlockerGrid(blockers, 8, 2.5);
      if (grid) {
        const hit = grid.testSegment(ax, az, bx, bz, 0, hitTallBlocker);
        if (hit !== null) return hit;
      }
    }
    for (let i = 0; i < blockers.length; i++) {
      if (hitTallBlocker(blockers[i], ax, az, bx, bz)) return true;
    }
    return false;
  }

  let lastCamera = null;
  function pickTarget(camera) {
    if (disposed || player?.state?.godFlight || !interactionAllowed(null)) return null;
    const st = player.state;
    // 第一人称沿用相机眼位；第三人称相机在角色身后，近观判定必须回到角色身上
    const third = st.view === 'third';
    const eyeX = third ? st.x : camera.position.x;
    const eyeY = third ? st.y + st.eyeHeight : camera.position.y;
    const eyeZ = third ? st.z : camera.position.z;
    const cp = Math.cos(st.pitch);
    const fx = -Math.sin(st.yaw) * cp;
    const fy = Math.sin(st.pitch);
    const fz = -Math.cos(st.yaw) * cp;
    let best = null;
    let bestScore = Infinity;

    function consider(kind, ref, index, x, z, groundY, height, key) {
      const dx = x - eyeX;
      const dy = groundY + height - eyeY;
      const dz = z - eyeZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const horiz = Math.sqrt(dx * dx + dz * dz);
      if (horiz > cfg.range || blocked(st.x, st.z, x, z)) return;
      const inv = 1 / (dist || 1);
      const dot = (dx * fx + dy * fy + dz * fz) * inv;
      if (dot < cfg.viewCos) return;
      const score = dist + (1 - dot) * cfg.alignBias;
      if (score >= bestScore) return;
      const info = infoFor(kind, ref);
      bestScore = score;
      best = {
        kind: kind,
        ref: ref,
        index: index,
        key: key,
        x: x,
        z: z,
        y: groundY + height,
        label: info.name,
        name: info.name,
        lines: info.lines,
        dist: dist,
        dot: dot,
        score: score
      };
    }

    for (let i = 0; i < people.list.length; i++) {
      const p = people.list[i];
      consider('person', p, i, p.x, p.z, field.sample(p.x, p.z), cfg.heights.person * p.s, keyOfPerson(i));
    }
    const communityList = communityLife?.getInteractables?.() || [];
    for (let i = 0; i < communityList.length; i++) {
      const c = communityList[i];
      consider('community', c, i, c.x, c.z, c.y, cfg.heights.person * (c.s || 1), c.key);
    }
    for (let i = 0; i < fauna.animals.length; i++) {
      const a = fauna.animals[i];
      const h = cfg.heights[a.kind];
      if (h === undefined) continue;
      consider(a.kind, a, i, a.x, a.z, a.y, h, keyOfAnimal(a));
    }
    const extra = mysteries?.pickTarget(camera, cfg);
    // One ranked candidate, one transaction. NPC wins exact ties.
    if (extra && (!best || extra.score < best.score)) best = extra;
    return best;
  }

  function showPrompt(target) {
    if (!target) {
      promptEl.classList.remove('show');
      reticleEl.classList.remove('near');
      return;
    }
    const isHuman = target.kind === 'person' || target.kind === 'community';
    if (target.prompt) {
      promptTextEl.textContent = target.prompt;
    } else if (isHuman && dialogueDirector) {
      const cont = dialogueDirector.isOpenFor?.(target.key);
      const hint = cont ? null : dialogueDirector.getPromptHint?.(target);
      promptTextEl.textContent = (cont ? '续谈 · ' : '交谈 · ') + target.label + (hint?.tag ? ' · ' + hint.tag : '');
    } else if (target.kind === 'dog') {
      promptTextEl.textContent = '轻抚唤犬 · ' + target.label;
    } else if (target.kind === 'ox') {
      promptTextEl.textContent = '抚牛添草 · ' + target.label;
    } else if (target.kind === 'chicken') {
      promptTextEl.textContent = '撒谷唤鸡 · ' + target.label;
    } else if (target.kind === 'duck') {
      promptTextEl.textContent = '临水看鸭 · ' + target.label;
    } else if (target.kind === 'bird') {
      promptTextEl.textContent = '静看山雀 · ' + target.label;
    } else {
      promptTextEl.textContent = '近观 · ' + target.label;
    }
    promptEl.classList.add('show');
    reticleEl.classList.add('near');
  }

  function clearTalkUi() {
    talkEl.classList.remove('show');
    talkEl.classList.remove('has-replies');
    if (talkMetaEl) {
      talkMetaEl.textContent = '';
      talkMetaEl.hidden = true;
    }
    if (talkRepliesEl) talkRepliesEl.textContent = '';
  }

  function showTalk(name, line, rich = null) {
    ensureRichTalkDom();
    talkWhoEl.textContent = name;
    talkLineEl.textContent = line;
    const hasReplies = Boolean(rich && Array.isArray(rich.replies) && rich.replies.length > 0);
    if (talkMetaEl) {
      talkMetaEl.textContent = rich?.meta || '';
      talkMetaEl.hidden = !rich?.meta;
    }
    if (talkRepliesEl) {
      talkRepliesEl.textContent = '';
      if (hasReplies) {
        for (let i = 0; i < rich.replies.length; i++) {
          const r = rich.replies[i];
          const idx = r.index ?? i;
          const btn = document.createElement('button');
          btn.type = 'button';
          const isQuestChoice = r.topic === '__quest__';
          btn.className = isQuestChoice ? 'talk-reply talk-reply--quest' : 'talk-reply';
          if (btn.dataset) btn.dataset.choice = String(idx);
          const kSpan = document.createElement('span');
          kSpan.className = 'talk-reply__key';
          kSpan.textContent = r.key || String(idx + 1);
          btn.appendChild(kSpan);
          if (isQuestChoice) {
            const qTag = document.createElement('span');
            qTag.className = 'talk-reply__quest-tag';
            qTag.textContent = r.questKind === 'turnIn' ? '结卷' : (r.questKind === 'inProgress' ? '简册' : '托付');
            btn.appendChild(qTag);
          }
          const lblSpan = document.createElement('span');
          lblSpan.textContent = r.label;
          btn.appendChild(lblSpan);
          btn.addEventListener?.('click', (ev) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            submitReplyChoice(idx);
          });
          talkRepliesEl.appendChild(btn);
        }
      }
    }
    if (hasReplies) talkEl.classList.add('has-replies');
    else talkEl.classList.remove('has-replies');
    talkEl.classList.add('show');
    talkTimer = hasReplies ? 11.5 : (cfg.talkDuration / 1000);
  }

  function greetSpeaker(target, line) {
    if (target.kind === 'person') {
      people.greet(target.index, player.state.x, player.state.z, cfg.greetDuration);
      sound.voice(target.ref && target.ref.role, target.x, target.z);
      if (onPerson) onPerson(target.key, target.name, line);
    } else if (target.kind === 'community') {
      communityLife?.greet?.(target.ref.id, player.state.x, player.state.z, cfg.greetDuration);
      sound.voice((target.ref && (target.ref.voiceRole || target.ref.role)) || 'villager', target.x, target.z);
      if (onPerson) onPerson(target.key, target.name, line);
    }
  }

  function submitReplyChoice(choiceIndex) {
    if (disposed || !dialogueDirector) return null;
    const sess = dialogueDirector.getActiveSession?.();
    if (!sess || !sess.hasMore) return null;
    const res = dialogueDirector.chooseReply(choiceIndex);
    if (!res) return null;
    const t = res.target || sess.target;
    if (t) greetSpeaker(t, res.line);
    cooldowns.set(res.key, res.hasMore ? 0.22 : cfg.cooldown);
    const displayName = res.who || t?.name || '村人';
    showTalk(displayName, res.line, res);
    pushT = cfg.camera.duration;
    talkCount += 1;
    lastTalk = { key: res.key, name: displayName, line: res.line, hasMore: res.hasMore };
    if (focus) showPrompt(focus);
    return lastTalk;
  }

  function interact(target) {
    if (disposed || player?.state?.godFlight || !interactionAllowed(null)) return null;
    if (target?.kind === 'mystery') return mysteries?.interact(target) || null;
    if (!target || (cooldowns.get(target.key) || 0) > 0) return null;

    const isHuman = target.kind === 'person' || target.kind === 'community';
    if (isHuman && dialogueDirector) {
      const res = dialogueDirector.beginOrAdvance(target);
      if (res) {
        cooldowns.set(target.key, res.hasMore ? 0.22 : cfg.cooldown);
        greetSpeaker(target, res.line);
        const displayName = res.who || target.name;
        showTalk(displayName, res.line, res);
        pushT = cfg.camera.duration;
        talkCount += 1;
        lastTalk = { key: target.key, name: displayName, line: res.line, hasMore: res.hasMore };
        if (focus && focus.key === target.key) showPrompt(focus);
        return lastTalk;
      }
    }

    if (!target.lines.length) return null;
    const n = cursors.get(target.key) || 0;
    const line = target.lines[n % target.lines.length];
    cursors.set(target.key, n + 1);
    cooldowns.set(target.key, cfg.cooldown);
    if (isHuman) {
      greetSpeaker(target, line);
    } else {
      const call = fauna.react(target.index, player.state.x, player.state.z);
      if (call && typeof sound[call] === 'function') sound[call](target.x, target.z);
    }
    showTalk(target.name, line);
    pushT = cfg.camera.duration;
    talkCount += 1;
    lastTalk = { key: target.key, name: target.name, line: line };
    return lastTalk;
  }

  function onKeyDown(e) {
    if (disposed) return;
    const epilogueOpen = Boolean(document.body?.classList?.contains?.('epilogue-open'));
    if (dialogueDirector && talkEl.classList.contains('show') && !epilogueOpen) {
      const sess = dialogueDirector.getActiveSession?.();
      if (sess && sess.hasMore && sess.replies?.length && interactionAllowed(e)) {
        if (e.code === 'Digit1' || e.code === 'Numpad1') {
          e.preventDefault();
          submitReplyChoice(0);
          return;
        }
        if ((e.code === 'Digit2' || e.code === 'Numpad2') && sess.replies.length >= 2) {
          e.preventDefault();
          submitReplyChoice(1);
          return;
        }
        if ((e.code === 'Digit3' || e.code === 'Numpad3') && sess.replies.length >= 3) {
          e.preventDefault();
          submitReplyChoice(2);
          return;
        }
        if (e.code === cfg.key && sess.target) {
          const d = Math.hypot(sess.target.x - player.state.x, sess.target.z - player.state.z);
          if (d <= (cfg.range || cfg.talkRange || 3.8) + 1.5) {
            e.preventDefault();
            submitReplyChoice(0);
            return;
          }
        }
      }
    }
    if (e.code !== cfg.key || !interactionAllowed(e) || !lastCamera) return;
    const candidate = pickTarget(lastCamera); // Recheck distance, weather and occlusion at the gesture.
    if (!candidate) return;
    e.preventDefault();
    interact(candidate);
  }
  function onPromptClick(e) {
    if (disposed || player?.state?.godFlight || !interactionAllowed(null) || !promptEl?.classList?.contains?.('show')) return;
    e?.preventDefault?.();
    e?.stopPropagation?.();
    sound?.unlock?.();
    const candidate = (lastCamera ? pickTarget(lastCamera) : null) || focus;
    if (candidate) interact(candidate);
  }
  promptEl?.addEventListener?.('click', onPromptClick);
  window.addEventListener('keydown', onKeyDown);

  function updateRing(dt, elapsed) {
    if (focus?.kind === 'mystery') { focusAlpha = 0; ring.visible = false; ringMat.opacity = 0; return; }
    const want = focus ? 1 : 0;
    focusAlpha += (want - focusAlpha) * Math.min(1, cfg.ring.fadeSpeed * dt);
    if (!focus) {
      ringMat.opacity = cfg.ring.opacity * focusAlpha;
      if (focusAlpha < 0.02) {
        ring.visible = false;
        ringMat.opacity = 0;
      }
      return;
    }
    ring.visible = true;
    // 墨环落在目标脚前、略靠玩家的一侧：既避开台阶/门槛，也不会被屏幕中央的提示条盖住
    const isHuman = focus.kind === 'person' || focus.kind === 'community';
    const sit = isHuman && focus.ref && focus.ref.mode === 'sit';
    const isAnimal = !isHuman;
    const off = sit ? cfg.ring.offsetSit : (isAnimal ? cfg.ring.offsetAnimal : cfg.ring.offset);
    let rx = focus.x;
    let rz = focus.z;
    const dx = player.state.x - focus.x;
    const dz = player.state.z - focus.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.01) {
      rx += dx / len * off;
      rz += dz / len * off;
    }
    ring.position.set(rx, field.sample(rx, rz) + cfg.ring.lift, rz);
    const pulse = 1 + Math.sin(elapsed * cfg.ring.pulseSpeed) * cfg.ring.pulse;
    const third = player.state.view === 'third' ? cfg.ring.thirdScale : 1;
    const animalScale = isAnimal ? cfg.ring.animalScale : 1;
    ring.scale.set(pulse * third * animalScale, pulse * third * animalScale, 1);
    ringMat.opacity = cfg.ring.opacity * focusAlpha;
  }

  function suspend() {
    focus = null; focusAlpha = 0; ring.visible = false; ringMat.opacity = 0;
    showPrompt(null); clearTalkUi(); dialogueDirector?.close?.(); mysteries?.hide();
  }
  window.addEventListener('blur', suspend);
  document.addEventListener('visibilitychange', suspend);
  function update(dt, elapsed, camera) {
    if (disposed) return;
    lastCamera = camera;
    if (mysteryUiPaused()) { suspend(); return; }
    if (talkTimer > 0) talkEl.classList.add('show');
    if (cooldowns.size) {
      for (const entry of cooldowns) {
        const left = entry[1] - dt;
        if (left <= 0) cooldowns.delete(entry[0]);
        else cooldowns.set(entry[0], left);
      }
    }
    if (talkTimer > 0) {
      const sess = dialogueDirector?.getActiveSession?.();
      if (sess?.target && Math.hypot(sess.target.x - player.state.x, sess.target.z - player.state.z) > 7.5) {
        talkTimer = 0;
        clearTalkUi();
        dialogueDirector.close?.();
      } else {
        talkTimer -= dt;
        if (talkTimer <= 0) {
          clearTalkUi();
          dialogueDirector?.close?.();
        }
      }
    }

    lastCamera = camera;
    const next = pickTarget(camera);
    const changed = (next ? next.key : null) !== (focus ? focus.key : null);
    focus = next;
    if (changed) showPrompt(focus);
    updateRing(dt, elapsed);
  }

  function applyCamera(camera, dt) {
    if (disposed || player?.state?.godFlight || mysteryUiPaused() || pushT <= 0) return;
    pushT = Math.max(0, pushT - dt);
    const k = Math.sin((1 - pushT / cfg.camera.duration) * Math.PI);
    const cp = Math.cos(player.state.pitch);
    const d = cfg.camera.push * k;
    camera.position.x += -Math.sin(player.state.yaw) * cp * d;
    camera.position.y += Math.sin(player.state.pitch) * d;
    camera.position.z += -Math.cos(player.state.yaw) * cp * d;
  }

  function getFocus(fresh = false) {
    // 注意：这里的 focus 是外层 let focus（每帧由 update 写入）。不要在函数内再声明
    // 同名局部变量——那会让下面这行进入 TDZ，每帧抛错并把渲染循环整个打断。
    const current = fresh && lastCamera ? pickTarget(lastCamera) : focus;
    if (!current) return null;
    return {
      key: current.key,
      kind: current.kind,
      index: current.index,
      name: current.name,
      x: current.x,
      y: current.y,
      z: current.z,
      dist: current.dist,
      dot: current.dot,
      noCameraLock: Boolean(current.noCameraLock)
    };
  }

  function getStats() {
    return {
      talks: talkCount,
      focus: getFocus(),
      lastTalk: lastTalk,
      pushT: pushT
    };
  }

  function dispose() {
    if (disposed) return; disposed = true; suspend();
    promptEl?.removeEventListener?.('click', onPromptClick);
    window.removeEventListener('blur', suspend);
    document.removeEventListener('visibilitychange', suspend);
    window.removeEventListener('keydown', onKeyDown);
    if (group.parent) group.parent.remove(group);
    ringGeo.dispose();
    ringMat.dispose();
  }

  return {
    group: group,
    update: update,
    applyCamera: applyCamera,
    interact: interact,
    setDialogueDirector: function (dir) { dialogueDirector = dir || null; },
    resetDialogue: function () { cursors.clear(); cooldowns.clear(); clearTalkUi(); dialogueDirector?.reset?.(); },
    getFocus: getFocus,
    getStats: getStats,
    dispose: dispose
  };
}
