/**
 * Coordinates WebGL renderer pixel-ratio and viewport size updates so drawing
 * buffers are never reallocated after rendering or cleared on no-op resize events.
 */
export function createRendererSurface(renderer, canvas = renderer?.domElement) {
  let appliedW = 0;
  let appliedH = 0;
  let appliedDpr = 0;
  let pendingDpr = null;

  function sync(w, h, dpr) {
    const width = Math.max(1, Number.isFinite(w) && w > 0 ? w : (appliedW || 1));
    const height = Math.max(1, Number.isFinite(h) && h > 0 ? h : (appliedH || 1));
    const nextDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : (appliedDpr || 1);
    const targetBufW = Math.floor(width * nextDpr);
    const targetBufH = Math.floor(height * nextDpr);
    const hasCanvasDims = Boolean(canvas && Number.isFinite(canvas.width) && Number.isFinite(canvas.height));
    const dprChanged = nextDpr !== appliedDpr;
    const sizeChanged = width !== appliedW || height !== appliedH;
    const bufMismatch = hasCanvasDims && (canvas.width !== targetBufW || canvas.height !== targetBufH);

    if (!dprChanged && !sizeChanged && !bufMismatch) return false;

    if (dprChanged) {
      renderer.setPixelRatio(nextDpr);
      appliedDpr = nextDpr;
    }

    const stillMismatch = hasCanvasDims && (canvas.width !== targetBufW || canvas.height !== targetBufH);
    if (sizeChanged || stillMismatch) {
      renderer.setSize(width, height, false);
      appliedW = width;
      appliedH = height;
    }

    return true;
  }

  function scheduleDpr(dpr) {
    if (Number.isFinite(dpr) && dpr > 0) pendingDpr = dpr;
  }

  function clearPending() {
    pendingDpr = null;
  }

  function flush(w, h) {
    if (pendingDpr === null) return false;
    const nextDpr = pendingDpr;
    pendingDpr = null;
    return sync(w, h, nextDpr);
  }

  function getState() {
    return {
      width: appliedW,
      height: appliedH,
      dpr: appliedDpr,
      pendingDpr
    };
  }

  return { sync, scheduleDpr, clearPending, flush, getState };
}
