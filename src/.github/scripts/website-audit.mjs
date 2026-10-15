import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const ORIGIN = 'https://einarolafsson.github.io';
export const REPOSITORY = 'EinarOlafsson/EinarOlafsson.github.io';
export const LIGHTHOUSE_VERSION = '13.0.1';
export const ROUTES = Object.freeze(['/', '/projects/spacr/', '/projects/parascape/', '/projects/timepose/', '/projects/cellect/']);
export const SAMPLES = 3;
export const LIMITS = Object.freeze({ performance: 0.90, accessibility: 0.95, transferredBytes: 1_000_000 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function publicURL(route) {
  assert(ROUTES.includes(route) || route === '/build.json', 'Only the fixed public routes may be requested');
  return ORIGIN + route;
}

export function assertContext(env) {
  assert.equal(env.AUDIT_REPOSITORY, REPOSITORY, 'Audit must run in the existing public output repository');
  assert.match(env.AUDIT_REVISION || '', /^[0-9a-f]{40}$/, 'An immutable checked-out revision is required');
}

export async function readPublic(route) {
  const url = new URL(publicURL(route));
  url.searchParams.set('audit', `${Date.now()}-${process.pid}`);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
  assert.equal(response.status, 200, `Unexpected HTTP status for ${route}`);
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.byteLength;
    assert(size <= 2_000_000, `Response exceeded the bounded identity read for ${route}`);
    parts.push(part);
  }
  return Buffer.concat(parts);
}

export function assertSameBytes(expected, actual, label) {
  assert(Buffer.from(expected).equals(Buffer.from(actual)), `Published artifact drift: ${label}`);
}

export function inspectReport(report, route, chromeVersion) {
  assert.equal(report.lighthouseVersion, LIGHTHOUSE_VERSION, 'Unexpected Lighthouse version');
  assert(!report.runtimeError, `Lighthouse runtime error: ${JSON.stringify(report.runtimeError)}`);
  assert.equal(report.requestedUrl, publicURL(route));
  assert.equal(report.finalDisplayedUrl, publicURL(route), 'Redirected or unexpected audited page');
  assert.equal(report.configSettings?.formFactor, 'mobile');
  assert.equal(report.configSettings?.throttlingMethod, 'simulate');
  assert.equal(report.configSettings?.screenEmulation?.mobile, true);
  assert.notEqual(report.configSettings?.disableStorageReset, true, 'Cold storage reset must stay enabled');
  const actualChrome = report.environment?.hostUserAgent?.match(/(?:Headless)?Chrome\/([0-9.]+)/)?.[1];
  assert.equal(actualChrome?.split('.')[0], chromeVersion.split('.')[0], 'Unexpected browser major version in report');
  const performance = report.categories?.performance?.score;
  const accessibility = report.categories?.accessibility?.score;
  const transferredBytes = report.audits?.['total-byte-weight']?.numericValue;
  for (const value of [performance, accessibility]) assert(Number.isFinite(value) && value >= 0 && value <= 1, 'Missing/invalid category score');
  assert(Number.isFinite(transferredBytes) && transferredBytes > 0, 'Missing/invalid cold transfer measurement');
  const failures = [];
  if (performance < LIMITS.performance) failures.push('performance');
  if (accessibility < LIMITS.accessibility) failures.push('accessibility');
  if (transferredBytes >= LIMITS.transferredBytes) failures.push('transferredBytes');
  return { performance, accessibility, transferredBytes, failures, failedAudits: Object.entries(report.audits || {})
    .filter(([, audit]) => typeof audit.score === 'number' && audit.score < 1)
    .map(([id, audit]) => ({ id, score: audit.score, title: audit.title, displayValue: audit.displayValue })) };
}

export function logReport(bytes, id, emit) {
  const compressed = gzipSync(bytes);
  const encoded = compressed.toString('base64');
  const chunks = encoded.match(/.{1,24000}/g) || [];
  emit({ type: 'report', id, encoding: 'gzip+base64', sha256: sha(bytes), gzip_sha256: sha(compressed), bytes: bytes.length, chunks: chunks.length });
  chunks.forEach((data, index) => emit({ type: 'report-chunk', id, index, data }));
}

export function lighthouseRunner(env) {
  assert(env.LIGHTHOUSE_CLI && env.CHROME_PATH && env.AUDIT_TEMP, 'Runner tool paths are required');
  fs.mkdirSync(env.AUDIT_TEMP, { recursive: true });
  const chromeOutput = execFileSync(env.CHROME_PATH, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  const chromeVersion = chromeOutput.match(/\b(\d+\.\d+\.\d+\.\d+)\b/)?.[1];
  assert(chromeVersion, 'Cannot identify the installed Chrome version');
  return { chromeVersion, chromeOutput, run(route, sample) {
    assert.equal(execFileSync(env.CHROME_PATH, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim(), chromeOutput, 'Installed Chrome changed before sample');
    const output = path.join(env.AUDIT_TEMP, `${ROUTES.indexOf(route)}-${sample}.json`);
    execFileSync(process.execPath, [env.LIGHTHOUSE_CLI, publicURL(route), '--quiet', '--output=json', `--output-path=${output}`,
      '--only-categories=performance,accessibility', '--form-factor=mobile', '--throttling-method=simulate', '--no-enable-error-reporting',
      '--max-wait-for-load=45000', '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage'],
    { env, timeout: 90000, maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(execFileSync(env.CHROME_PATH, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim(), chromeOutput, 'Installed Chrome changed after sample');
    return fs.readFileSync(output);
  } };
}

export async function audit({ env = process.env, fetchBytes = readPublic, runner, emit = value => console.log(JSON.stringify(value)) } = {}) {
  assertContext(env);
  const root = env.AUDIT_ROOT;
  assert(root, 'Checked-out public artifact root is required');
  const expected = new Map(['/build.json', ...ROUTES].map(route => [route, fs.readFileSync(path.join(root, route === '/build.json' ? 'build.json' : `${route.slice(1)}index.html`))]));
  const build = JSON.parse(expected.get('/build.json'));
  assert(typeof build.built === 'string' && build.spacr?.version, 'Missing deployed build identity');
  for (const [route, bytes] of expected) assertSameBytes(bytes, await fetchBytes(route), `before ${route}`);
  const tools = runner || lighthouseRunner(env);
  emit({ type: 'context', revision: env.AUDIT_REVISION, repository: REPOSITORY, build,
    node: process.version, lighthouse: LIGHTHOUSE_VERSION, chrome: tools.chromeOutput || tools.chromeVersion,
    samplesPerPage: SAMPLES, thresholds: LIMITS, artifactHashes: Object.fromEntries([...expected].map(([route, bytes]) => [route, sha(bytes)])),
    scope: 'Cold mobile Lighthouse navigation; protected pages remain locked. No physical frame-rate, human usability or whole-item claim.' });
  const samples = [];
  for (const route of ROUTES) for (let sample = 1; sample <= SAMPLES; sample++) {
    assertSameBytes(expected.get('/build.json'), await fetchBytes('/build.json'), `before sample ${route} ${sample}`);
    const id = `${ROUTES.indexOf(route)}-${sample}`;
    try {
      const bytes = await tools.run(route, sample);
      logReport(bytes, id, emit);
      const result = { route, sample, ...inspectReport(JSON.parse(bytes), route, tools.chromeVersion) };
      samples.push(result);
      emit({ type: 'sample', ...result });
    } catch (error) {
      const result = { route, sample, failures: ['invalidMeasurement'], error: String(error.message) };
      emit({ type: 'sample', ...result });
      throw new Error(`Aborting after invalid measurement ${id}: ${error.message}`);
    }
  }
  for (const [route, bytes] of expected) assertSameBytes(bytes, await fetchBytes(route), `after ${route}`);
  const result = { type: 'result', pass: samples.every(sample => sample.failures.length === 0), samples, revision: env.AUDIT_REVISION,
    policy: 'All three cold samples on every fixed public page must pass; no selection of the best sample.' };
  emit(result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  audit().then(result => { if (!result.pass) process.exitCode = 1; }).catch(error => {
    console.error(JSON.stringify({ type: 'refused', error: String(error.message) }));
    process.exitCode = 1;
  });
}
