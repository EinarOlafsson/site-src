import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(process.env.FX_CONTEXT_SOURCE || new URL('../src/assets/js/fx.js', import.meta.url), 'utf8');
const start = source.indexOf('  function makeField(canvas) {');
const end = source.indexOf('\n  function syncFxMenu()', start);
assert(start >= 0 && end > start);

function harness({ mode = null, software = false, unavailable = false, legacy = false, throws = false, ignoresCaveat = false } = {}) {
  const requests = [], frames = [], calls = [];
  const gl = new Proxy({}, { get(_target, key) {
    if (key === 'getExtension') return name => name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 'RENDERER' } : null;
    if (key === 'getParameter') return parameter => parameter === 'RENDERER' ? (software ? 'ANGLE SwiftShader' : 'native driver') : parameter === 'MAX_VERTEX_ATTRIBS' ? 2 : 1;
    if (key === 'isContextLost') return () => false;
    if (key.toUpperCase() === key) return key;
    return (...args) => { calls.push([key, args]); };
  } });
  const canvas = {
    width: 0, height: 0, addEventListener() {},
    getContext(kind, options) {
      requests.push({ kind, options: { ...options } });
      if (throws) throw new Error('WebGL unavailable');
      if (unavailable || (legacy && kind === 'webgl') || (software && !ignoresCaveat && options.failIfMajorPerformanceCaveat)) return null;
      return gl;
    }
  };
  const context = {
    store: { get: key => key === 'fx-motion' ? mode : null },
    window: { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, addEventListener() {} },
    document: { hidden: false, addEventListener() {} }, navigator: { hardwareConcurrency: 8 },
    root: { classList: { add() {}, remove() {} } },
    PALETTE: [], hexToRgb: value => value, mulberry32: () => () => 0.5,
    currentTheme: () => 'dark', motionAllowed: () => true, awake: false,
    performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    fxWanted: 'field', INLINE_FX: 'advection',
    loadTheme: (_slug, adopt) => adopt(() => ({ frame: (...args) => frames.push(args) }))
  };
  const makeField = vm.runInNewContext(`(${source.slice(start, end)})`, context);
  return { field: makeField(canvas), requests, frames, calls };
}

test('default software-only context uses the existing CSS fallback before theme work', () => {
  const result = harness({ software: true });
  assert.equal(result.field, null);
  assert.deepEqual(result.requests.map(x => x.kind), ['webgl', 'experimental-webgl']);
  assert(result.requests.every(x => x.options.failIfMajorPerformanceCaveat === true));
  assert.deepEqual(result.calls, []);
  assert.deepEqual(result.frames, []);
});

test('accelerated contexts retain low-power settings and draw the selected theme', () => {
  const result = harness();
  assert(result.field);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].options.failIfMajorPerformanceCaveat, true);
  assert.equal(result.requests[0].options.powerPreference, 'low-power');
  assert.equal(result.requests[0].options.preserveDrawingBuffer, false);
  result.field.boot('field');
  assert.equal(result.field.current(), 'field');
  assert.equal(result.frames.length, 1);
});

test('the existing explicit always-effects override still permits software contexts', () => {
  const result = harness({ software: true, mode: 'always' });
  assert(result.field);
  assert.equal(result.requests[0].options.failIfMajorPerformanceCaveat, false);
  result.field.boot('field');
  assert.equal(result.frames.length, 1);
});

test('legacy WebGL context receives the same caveat policy', () => {
  const result = harness({ legacy: true });
  assert(result.field);
  assert.equal(result.requests.length, 2);
  assert.deepEqual(result.requests[0].options, result.requests[1].options);
  assert.equal(result.requests[1].options.failIfMajorPerformanceCaveat, true);
});

test('unavailable or throwing context creation retains the existing null fallback', () => {
  for (const options of [{ unavailable: true }, { throws: true }]) {
    const result = harness(options);
    assert.equal(result.field, null);
    assert.deepEqual(result.calls, []);
  }
});

test('an accepted software context falls back before shader or theme work', () => {
  const result = harness({ software: true, ignoresCaveat: true });
  assert.equal(result.field, null);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].options.failIfMajorPerformanceCaveat, true);
  assert.deepEqual(result.calls, []);
  assert.deepEqual(result.frames, []);
});
