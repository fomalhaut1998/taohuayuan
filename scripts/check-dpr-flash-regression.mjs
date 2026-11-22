import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRendererSurface } from '../src/systems/renderer-surface.js';

let checks = 0;
function check(cond, msg) {
  assert(cond, msg);
  checks++;
}

function extractBlock(source, marker) {
  const startIdx = source.indexOf(marker);
  assert(startIdx >= 0, `missing marker: ${marker}`);
  const openBrace = source.indexOf('{', startIdx);
  assert(openBrace >= 0, `missing opening brace for: ${marker}`);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') { i++; continue; }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') inTemplate = false;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openBrace + 1, i);
    }
  }
  throw new Error(`unclosed block for: ${marker}`);
}

// --------------------------------------------------------------------------
// 1. Behavioral tests for createRendererSurface (Three.js-faithful mock)
// --------------------------------------------------------------------------
function createMockRenderer() {
  const canvas = { width: 300, height: 150 };
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let setPixelRatioCalls = 0;
  let setSizeCalls = 0;
  let bufferCleared = false;

  const renderer = {
    domElement: canvas,
    getPixelRatio() {
      return pixelRatio;
    },
    setPixelRatio(value) {
      setPixelRatioCalls++;
      if (value === undefined) return;
      pixelRatio = value;
      // Three.js WebGLRenderer.setPixelRatio delegates to setSize(_width, _height, false)
      renderer.setSize(width, height, false);
    },
    setSize(w, h, _updateStyle = true) {
      setSizeCalls++;
      width = w;
      height = h;
      // Assigning canvas.width/height reallocates and clears the WebGL drawing buffer
      canvas.width = Math.floor(w * pixelRatio);
      canvas.height = Math.floor(h * pixelRatio);
      bufferCleared = true;
    },
    renderFrame() {
      bufferCleared = false;
    },
    resetCounters() {
      setPixelRatioCalls = 0;
      setSizeCalls = 0;
    },
    getMetrics() {
      return {
        width,
        height,
        pixelRatio,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        setPixelRatioCalls,
        setSizeCalls,
        bufferCleared
      };
    }
  };

  return { renderer, canvas };
}

{
  const { renderer, canvas } = createMockRenderer();
  const surface = createRendererSurface(renderer, canvas);

  // Initial sync
  const initChanged = surface.sync(1280, 720, 1.5);
  check(initChanged === true, 'initial sync returns true');
  let m = renderer.getMetrics();
  check(m.canvasWidth === 1920 && m.canvasHeight === 1080, 'initial sync sets canvas backing buffer to 1920x1080');
  check(m.pixelRatio === 1.5, 'initial sync sets pixelRatio to 1.5');
  renderer.renderFrame();
  renderer.resetCounters();

  // No-op sync (spurious visualViewport resize / redundant orientationchange timer)
  const noopChanged = surface.sync(1280, 720, 1.5);
  check(noopChanged === false, 'no-op sync returns false');
  m = renderer.getMetrics();
  check(m.setPixelRatioCalls === 0 && m.setSizeCalls === 0, 'no-op sync makes zero setPixelRatio/setSize calls');
  check(m.bufferCleared === false, 'no-op sync does not clear the WebGL drawing buffer');

  // Post-render scheduleDpr must not resize or clear buffer
  surface.scheduleDpr(1.25);
  m = renderer.getMetrics();
  check(m.setPixelRatioCalls === 0 && m.setSizeCalls === 0, 'scheduleDpr defers resize without immediate calls');
  check(m.bufferCleared === false, 'scheduleDpr leaves rendered drawing buffer intact (zero post-render flash)');
  check(surface.getState().pendingDpr === 1.25, 'getState reports pendingDpr');

  // Pre-render flush applies DPR once with zero redundant setSize
  const flushed = surface.flush(1280, 720);
  check(flushed === true, 'flush applies pending DPR and returns true');
  m = renderer.getMetrics();
  check(m.setPixelRatioCalls === 1, 'flush calls setPixelRatio exactly once');
  check(m.setSizeCalls === 1, 'exactly one backbuffer reallocation occurs via setPixelRatio -> setSize (zero double-reallocation)');
  check(m.canvasWidth === 1600 && m.canvasHeight === 900, 'flush updates canvas dimensions to 1600x900');
  check(surface.getState().pendingDpr === null, 'flush clears pendingDpr');
  renderer.renderFrame();
  renderer.resetCounters();

  // Subsequent flush with no pending DPR is a no-op
  const emptyFlush = surface.flush(1280, 720);
  check(emptyFlush === false, 'subsequent flush without pending DPR returns false');
  m = renderer.getMetrics();
  check(m.setPixelRatioCalls === 0 && m.setSizeCalls === 0 && m.bufferCleared === false, 'empty flush performs zero calls and no buffer clear');

  // Size-only sync makes 0 setPixelRatio calls and 1 setSize call
  const sizeChanged = surface.sync(1440, 900, 1.25);
  check(sizeChanged === true, 'size-only sync returns true');
  m = renderer.getMetrics();
  check(m.setPixelRatioCalls === 0 && m.setSizeCalls === 1, 'size-only sync calls setSize once and skips setPixelRatio');
  check(m.canvasWidth === 1800 && m.canvasHeight === 1125, 'size-only sync updates canvas dimensions to 1800x1125');
  renderer.renderFrame();
  renderer.resetCounters();

  // External canvas buffer mismatch triggers recovery setSize
  canvas.width = 100;
  const recovered = surface.sync(1440, 900, 1.25);
  check(recovered === true, 'external canvas mismatch triggers recovery sync');
  m = renderer.getMetrics();
  check(m.setPixelRatioCalls === 0 && m.setSizeCalls === 1, 'recovery sync invokes setSize once without setPixelRatio');
  check(m.canvasWidth === 1800 && m.canvasHeight === 1125, 'recovery sync restores expected canvas dimensions');
  renderer.renderFrame();
  renderer.resetCounters();

  // clearPending cancels scheduled DPR change
  surface.scheduleDpr(1.0);
  surface.clearPending();
  check(surface.getState().pendingDpr === null, 'clearPending clears pendingDpr');
  check(surface.flush(1440, 900) === false, 'flush after clearPending returns false');
  m = renderer.getMetrics();
  check(m.setPixelRatioCalls === 0 && m.setSizeCalls === 0 && m.bufferCleared === false, 'clearPending + flush causes zero calls and zero clears');
}

// --------------------------------------------------------------------------
// 2. Static integration contracts on src/main.js
// --------------------------------------------------------------------------
{
  const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

  check(
    mainSrc.includes("import { createRendererSurface } from './systems/renderer-surface.js';"),
    'main.js imports createRendererSurface'
  );

  const loopBody = extractBlock(mainSrc, 'renderer.setAnimationLoop(function ()');
  const renderCall = 'staticVisibility.render(renderer, camera);';
  const renderCalls = loopBody.split(renderCall);
  check(renderCalls.length === 3, 'setAnimationLoop renders in paused recovery branch and main render path');

  // Split at the main render call (the last occurrence inside setAnimationLoop)
  const mainRenderIdx = loopBody.lastIndexOf(renderCall);
  const beforeMainRender = loopBody.slice(0, mainRenderIdx);
  const afterMainRender = loopBody.slice(mainRenderIdx + renderCall.length);

  const flushIdx = beforeMainRender.indexOf('renderSurface.flush(');
  const skyUpdateIdx = beforeMainRender.indexOf('sky.update(dt, camera)');
  check(flushIdx >= 0, 'renderSurface.flush is called before main staticVisibility.render');
  check(skyUpdateIdx > flushIdx, 'renderSurface.flush runs before sky.update(dt, camera) so sky sees live DPR');

  for (const forbidden of ['renderer.setPixelRatio(', 'renderer.setSize(', 'renderSurface.sync(', 'renderSurface.flush(']) {
    check(!afterMainRender.includes(forbidden), `post-render block must not call ${forbidden}`);
  }
  check(
    afterMainRender.includes('renderSurface.scheduleDpr(currentDpr)'),
    'post-render FPS block queues DPR updates via renderSurface.scheduleDpr(currentDpr)'
  );

  // Check handleViewportResize contract
  const resizeBody = extractBlock(mainSrc, 'function handleViewportResize()');
  check(resizeBody.includes('renderSurface.clearPending()'), 'handleViewportResize calls renderSurface.clearPending()');
  check(resizeBody.includes('renderSurface.sync('), 'handleViewportResize calls renderSurface.sync(...)');
  check(!resizeBody.includes('renderer.setPixelRatio('), 'handleViewportResize does not call renderer.setPixelRatio directly');
  check(!resizeBody.includes('renderer.setSize('), 'handleViewportResize does not call renderer.setSize directly');
  check(
    resizeBody.includes('if (!document.hidden)') &&
      resizeBody.includes('staticVisibility.render(renderer, camera)') &&
      resizeBody.includes('needsPostResizeRender = true'),
    'handleViewportResize immediately re-renders when visible or marks needsPostResizeRender when hidden'
  );
}

console.log(`PASS check-dpr-flash-regression (${checks} checks)`);
