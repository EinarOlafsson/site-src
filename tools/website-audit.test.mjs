import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { audit, assertContext, inspectReport, lighthouseRunner, LIGHTHOUSE_VERSION, LIMITS, logReport, publicURL, readPublic, REPOSITORY, ROUTES, SAMPLES } from '../src/.github/scripts/website-audit.mjs';

const chrome = '142.0.7444.59';
const report = route => ({ lighthouseVersion: LIGHTHOUSE_VERSION, requestedUrl: publicURL(route), finalDisplayedUrl: publicURL(route),
  configSettings: { formFactor: 'mobile', throttlingMethod: 'simulate', screenEmulation: { mobile: true }, disableStorageReset: false },
  environment: { hostUserAgent: `Mozilla/5.0 HeadlessChrome/${chrome}` }, categories: { performance: { score: .9 }, accessibility: { score: .95 } },
  audits: { 'total-byte-weight': { numericValue: 999999 }, contrast: { score: 0, title: 'Actual finding', displayValue: 'Example' } } });

test('only five fixed public pages and build identity are requested', () => {
  assert.equal(ROUTES.length, 5);
  assert.equal(publicURL('/build.json'), 'https://einarolafsson.github.io/build.json');
  for (const input of ['https://other.test/', '//other.test/', '/projects/timepose/?password=x', '/projects/spacr/#models', '/../secret', '/build.json?x']) {
    assert.throws(() => publicURL(input));
  }
  assert.throws(() => assertContext({ AUDIT_REPOSITORY: 'EinarOlafsson/site-src', AUDIT_REVISION: 'a'.repeat(40) }));
  assert.throws(() => assertContext({ AUDIT_REPOSITORY: REPOSITORY, AUDIT_REVISION: 'main' }));
});

test('actual score boundaries and strict sub-megabyte transfer gate are enforced', () => {
  const good = report('/');
  assert.deepEqual(inspectReport(good, '/', chrome).failures, []);
  good.categories.performance.score = .899;
  good.categories.accessibility.score = .949;
  good.audits['total-byte-weight'].numericValue = 1_000_000;
  assert.deepEqual(inspectReport(good, '/', chrome).failures, ['performance', 'accessibility', 'transferredBytes']);
  assert.equal(inspectReport(good, '/', chrome).failedAudits[0].id, 'contrast');
});

for (const [name, change] of Object.entries({ desktop: r => { r.configSettings.formFactor = 'desktop'; }, warm: r => { r.configSettings.disableStorageReset = true; },
  device: r => { r.configSettings.screenEmulation.mobile = false; }, unthrottled: r => { r.configSettings.throttlingMethod = 'provided'; },
  redirected: r => { r.finalDisplayedUrl += 'elsewhere'; }, wrongRequest: r => { r.requestedUrl = 'https://example.org'; },
  wrongTool: r => { r.lighthouseVersion = '12.0.0'; }, wrongBrowser: r => { r.environment.hostUserAgent = 'Chrome/1.2.3.4'; },
  runtime: r => { r.runtimeError = { code: 'NO_FCP' }; }, nullScore: r => { r.categories.performance.score = null; },
  missingBytes: r => { delete r.audits['total-byte-weight']; } })) {
  test(`invalid measurement refuses ${name}`, () => { const r = report('/'); change(r); assert.throws(() => inspectReport(r, '/', chrome)); });
}

test('complete reports round-trip from bounded log chunks without artifact storage', () => {
  const raw = Buffer.from(JSON.stringify(report('/')));
  const events = [];
  logReport(raw, '0-1', value => events.push(value));
  assert.equal(events[0].chunks, events.length - 1);
  assert(events.slice(1).every(event => event.data.length <= 24000));
  assert.deepEqual(gunzipSync(Buffer.from(events.slice(1).map(event => event.data).join(''), 'base64')), raw);
});

test('Chrome reduced user-agent version is accepted while a different major is refused', () => {
  const r = report('/'); r.environment.hostUserAgent = 'HeadlessChrome/142.0.0.0';
  assert.deepEqual(inspectReport(r, '/', chrome).failures, []);
  r.environment.hostUserAgent = 'HeadlessChrome/141.0.0.0';
  assert.throws(() => inspectReport(r, '/', chrome), /browser major/);
});

test('identity reads require HTTP200, refuse redirects and stop at their byte bound', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url.origin, 'https://einarolafsson.github.io');
      assert.equal(options.redirect, 'error');
      assert(options.signal instanceof AbortSignal);
      return new Response('expected', { status: 200 });
    };
    assert.equal((await readPublic('/')).toString(), 'expected');
    globalThis.fetch = async () => new Response('missing', { status: 404 });
    await assert.rejects(readPublic('/'), /HTTP status/);
    globalThis.fetch = async () => new Response(new Uint8Array(2_000_001), { status: 200 });
    await assert.rejects(readPublic('/'), /bounded identity/);
  } finally { globalThis.fetch = original; }
});

test('actual child-process invocation uses pinned tool path, mobile categories and disabled telemetry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'website-audit-command-'));
  try {
    const chromePath = path.join(root, 'chrome');
    const cli = path.join(root, 'lighthouse.mjs');
    fs.writeFileSync(chromePath, `#!/bin/sh\nprintf 'Google Chrome ${chrome}\\n'\n`, { mode: 0o700 });
    fs.writeFileSync(cli, `import fs from 'node:fs'; import assert from 'node:assert/strict';
      const args=process.argv.slice(2);
      for(const required of ['--only-categories=performance,accessibility','--form-factor=mobile','--throttling-method=simulate','--no-enable-error-reporting']) assert(args.includes(required));
      assert(!args.some(a=>a.includes('disable-storage-reset') || a.includes('user-data-dir')));
      assert.equal(args[0],${JSON.stringify(publicURL('/'))});
      fs.writeFileSync(args.find(a=>a.startsWith('--output-path=')).slice(14),${JSON.stringify(JSON.stringify(report('/')))});`);
    const runner = lighthouseRunner({ ...process.env, LIGHTHOUSE_CLI: cli, CHROME_PATH: chromePath, AUDIT_TEMP: root });
    assert.equal(runner.chromeVersion, chrome);
    assert.deepEqual(inspectReport(JSON.parse(runner.run('/', 1)), '/', chrome).failures, []);
    fs.writeFileSync(chromePath, '#!/bin/sh\nprintf "Google Chrome 1.2.3.4\\n"\n', { mode: 0o700 });
    assert.throws(() => runner.run('/', 2), /Chrome changed before/);
  } finally { fs.rmSync(root, { recursive: true }); }
});

async function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'website-audit-test-'));
  const expected = new Map([['/build.json', Buffer.from(JSON.stringify({ built: '2026-10-15T00:00:00Z', spacr: { version: '1.5.1.4' } }))]]);
  for (const route of ROUTES) expected.set(route, Buffer.from(`<html><head></head><body>${route}</body></html>`));
  for (const [route, bytes] of expected) {
    const target = path.join(root, route === '/build.json' ? 'build.json' : `${route.slice(1)}index.html`);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  }
  const calls = [], events = [];
  const config = { env: { AUDIT_ROOT: root, AUDIT_REPOSITORY: REPOSITORY, AUDIT_REVISION: 'b'.repeat(40) },
    fetchBytes: async route => expected.get(route), emit: value => events.push(value),
    runner: { chromeVersion: chrome, run: async (route, sample) => { calls.push([route, sample]); return Buffer.from(JSON.stringify(report(route))); } } };
  try { return await fn({ config, expected, calls, events }); } finally { fs.rmSync(root, { recursive: true }); }
}

test('all fifteen samples run against exact deployed bytes; no best-sample selection', () => fixture(async ({ config, calls }) => {
  const original = config.runner.run;
  config.runner.run = async (route, sample) => { const raw = await original(route, sample); const r = JSON.parse(raw); if (route === '/' && sample === 2) r.categories.performance.score = .89; return Buffer.from(JSON.stringify(r)); };
  const result = await audit(config);
  assert.equal(calls.length, ROUTES.length * SAMPLES);
  assert.equal(result.pass, false);
  assert.equal(result.samples.filter(s => s.failures.length).length, 1);
}));

test('before-page drift refuses before any Chrome run', () => fixture(async ({ config, calls, expected }) => {
  config.fetchBytes = async route => route === '/projects/spacr/' ? Buffer.from('stale page') : expected.get(route);
  await assert.rejects(audit(config), /before \/projects\/spacr\//);
  assert.equal(calls.length, 0);
}));

test('build drift between samples aborts instead of mixing deployments', () => fixture(async ({ config, calls, expected }) => {
  config.fetchBytes = async route => route === '/build.json' && calls.length === 1 ? Buffer.from('changed') : expected.get(route);
  await assert.rejects(audit(config), /before sample/);
  assert.equal(calls.length, 1);
}));

test('after-page drift refuses an otherwise passing set', () => fixture(async ({ config, calls, expected }) => {
  config.fetchBytes = async route => route === '/projects/cellect/' && calls.length === 15 ? Buffer.from('changed') : expected.get(route);
  await assert.rejects(audit(config), /after \/projects\/cellect\//);
}));

test('manual hosted workflow has bounded public-only read access and no build/deploy or billed upload', () => {
  const workflow = fs.readFileSync(new URL('../src/.github/workflows/website-audit.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /timeout-minutes: 25/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /lighthouse@13\.0\.1/);
  assert.match(workflow, /node-version: '22\.19\.0'/);
  assert(!/secrets\.|upload-artifact|staticrypt|build\.mjs|deploy-pages|git push|pull_request|schedule:|push:/.test(workflow));
  assert.deepEqual(LIMITS, { performance: .9, accessibility: .95, transferredBytes: 1_000_000 });
});
