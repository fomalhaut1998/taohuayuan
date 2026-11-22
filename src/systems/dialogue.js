// 3 个可采对话点：靠近自动触发，触发后不再重复。
export function createDialogue(script, onTrigger, initialFired = []) {
  const classicEl = document.getElementById('classic');
  const plainEl = document.getElementById('plain');
  const points = script.points || [];
  const fired = Object.create(null);
  for (const id of initialFired) if (typeof id === 'string' && id) fired[id] = true;
  const waitForExit = new Set();
  let timer = 0;
  let visible = false;
  const queue = [];

  function show(p) {
    if (classicEl) classicEl.textContent = p.classic;
    if (plainEl) plainEl.textContent = p.plain;
    visible = true;
    timer = (script.hold || 5200) / 1000;
    if (classicEl) classicEl.classList.add('show');
    if (plainEl) plainEl.classList.add('show');
  }

  function hide() {
    visible = false;
    if (classicEl) classicEl.classList.remove('show');
    if (plainEl) plainEl.classList.remove('show');
  }

  function update(pos, dt) {
    if (document.hidden || document.body.classList.contains('ui-hidden')) return null;
    if (visible) {
      timer -= dt;
      if (timer <= 0) hide();
    }
    if (!visible && queue.length) show(queue.shift());
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.manual) continue;
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      if (waitForExit.has(p.id)) {
        if (dx * dx + dz * dz >= p.radius * p.radius) waitForExit.delete(p.id);
        continue;
      }
      if (fired[p.id]) continue;
      if (dx * dx + dz * dz < p.radius * p.radius) {
        fired[p.id] = true;
        if (visible) queue.push(p); else show(p);
        if (onTrigger) onTrigger(p);
        return p.id;
      }
    }
    return null;
  }

  function trigger(id) {
    const p = points.find(function (pt) { return pt.id === id; });
    if (!p || fired[p.id]) return false;
    fired[p.id] = true;
    if (visible) queue.push(p); else show(p);
    if (onTrigger) onTrigger(p);
    return true;
  }

  return {
    update: update,
    trigger: trigger,
    hasFired: function (id) { return !!fired[id]; },
    firedCount: function () { return Object.keys(fired).length; },
    total: points.length,
    reset: function (pos) {
      for (const k in fired) delete fired[k];
      waitForExit.clear();
      queue.length = 0;
      if (pos) points.forEach(function (p) {
        if ((pos.x - p.x) ** 2 + (pos.z - p.z) ** 2 < p.radius ** 2) waitForExit.add(p.id);
      });
      hide();
    }
  };
}
