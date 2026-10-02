import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { resolveBuildVersion } from '../../scripts/build-version.mjs';
import { productionChecks } from '../../scripts/smoke/checks.mjs';
import { smokeSummary, writeSmokeReport } from '../../scripts/smoke/report.mjs';
import { runSmokeChecks } from '../../scripts/smoke/runner.mjs';

const version = 'a'.repeat(40);
const check = (id = 'health', extra = {}) => ({
  id,
  method: 'GET',
  url: 'https://api.squai.io/health',
  expectedStatus: 200,
  validate: async () => null,
  ...extra,
});
const response = (status = 200, headers = {}) => new Response('safe fixture', { status, headers });
function harness(responses, overrides = {}) {
  let elapsed = 0;
  const sleep = vi.fn(async (delay) => {
    elapsed += delay;
  });
  const log = vi.fn();
  const fetchFn = vi.fn(async () => {
    const value = responses.shift();
    if (value instanceof Error) throw value;
    return value;
  });
  return {
    fetchFn,
    sleep,
    log,
    options: { fetchFn, sleep, log, clock: () => elapsed, random: () => 0.5, ...overrides },
  };
}
const contract = (id) => productionChecks().find((item) => item.id === id);

afterEach(() => vi.unstubAllEnvs());

describe('smoke retry policy', () => {
  test('recovers transient status with backoff and a fresh timeout per attempt', async () => {
    const run = harness([response(503), response(502), response()]);
    const report = await runSmokeChecks([check()], run.options);
    expect(report.passed).toBe(true);
    expect(report.results[0]).toMatchObject({ outcome: 'recovered' });
    expect(report.results[0]).not.toHaveProperty('reason');
    expect(run.sleep.mock.calls).toEqual([[1000], [2000]]);
    const signals = run.fetchFn.mock.calls.map((args) => args[1].signal);
    expect(new Set(signals).size).toBe(3);
    expect(run.fetchFn.mock.calls.every((args) => args[1].redirect === 'manual')).toBe(true);
  });

  test('limits repeated outages to four attempts', async () => {
    const run = harness(Array.from({ length: 4 }, () => response(503)));
    const report = await runSmokeChecks([check()], run.options);
    expect(report.passed).toBe(false);
    expect(run.fetchFn).toHaveBeenCalledTimes(4);
    expect(run.sleep.mock.calls).toEqual([[1000], [2000], [4000]]);
  });

  test.each([429, 503])('honors Retry-After for HTTP %s', async (status) => {
    const run = harness([response(status, { 'Retry-After': '5' }), response()]);
    expect((await runSmokeChecks([check()], run.options)).passed).toBe(true);
    expect(run.sleep).toHaveBeenCalledWith(5000);
  });

  test('does not retry or wait beyond the global budget', async () => {
    const run = harness([response(503, { 'Retry-After': '120' })]);
    const report = await runSmokeChecks([check()], run.options);
    expect(report.passed).toBe(false);
    expect(run.fetchFn).toHaveBeenCalledTimes(1);
    expect(run.sleep).not.toHaveBeenCalled();
  });

  test('retries a temporarily missing new asset but never a missing API route', async () => {
    const run = harness([response(404), response(), response(404)]);
    const report = await runSmokeChecks(
      [check('asset', { retryMissingAsset: true }), check('api')],
      run.options,
    );
    expect(report.results.map((result) => result.outcome)).toEqual(['recovered', 'failed']);
    expect(report.results[1].attempts).toHaveLength(1);
  });

  test('stops asset 404 retries at the propagation window', async () => {
    const run = harness([response(404)], { assetWindowMs: 1000 });
    const report = await runSmokeChecks([check('asset', { retryMissingAsset: true })], run.options);
    expect(report.passed).toBe(false);
    expect(run.fetchFn).toHaveBeenCalledTimes(1);
    expect(run.sleep).not.toHaveBeenCalled();
  });

  test('waits for the expected deployment and skips dependent checks if readiness fails', async () => {
    const run = harness(
      [
        response(200, { 'X-Deployment-Version': 'old' }),
        response(200, { 'X-Deployment-Version': version }),
      ],
      { expectedVersion: version },
    );
    expect((await runSmokeChecks([check('health', { readiness: true })], run.options)).passed).toBe(
      true,
    );
    const failed = harness(
      Array.from({ length: 4 }, () => response()),
      { expectedVersion: version },
    );
    const report = await runSmokeChecks(
      [check('health', { readiness: true }), check('asset')],
      failed.options,
    );
    expect(report.results[0].reason).toBe('VERSION_MISMATCH');
    expect(report.results[1]).toMatchObject({
      outcome: 'skipped',
      reason: 'READINESS_FAILED',
      attempts: [],
    });
  });

  test('checks deployment version on every contract, including assets', async () => {
    const run = harness([response(200, { 'X-Deployment-Version': version }), response()], {
      expectedVersion: version,
      maxAttempts: 1,
    });
    const report = await runSmokeChecks(
      [check('health', { readiness: true }), check('asset')],
      run.options,
    );
    expect(report.results[1].reason).toBe('VERSION_MISMATCH');
    expect(report.passed).toBe(false);
  });

  test('retries reset connections but fails certificate errors without retry', async () => {
    const reset = new TypeError('private details', { cause: { code: 'ECONNRESET' } });
    const tls = new TypeError('private details', { cause: { code: 'CERT_HAS_EXPIRED' } });
    const run = harness([reset, response(), tls]);
    const report = await runSmokeChecks([check('reset'), check('tls')], run.options);
    expect(report.results.map((result) => result.outcome)).toEqual(['recovered', 'failed']);
    expect(report.results[1].attempts).toHaveLength(1);
  });

  test('aborts a slow request and gives the retry its own timeout', async () => {
    const fetchFn = vi.fn(async (_url, { signal }) => {
      if (fetchFn.mock.calls.length === 1) {
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      }
      return response();
    });
    const report = await runSmokeChecks([check()], {
      fetchFn,
      timeoutMs: 10,
      sleep: async () => {},
      log: vi.fn(),
    });
    expect(report.passed).toBe(true);
    expect(report.results[0].attempts[0].error).toBe('TIMEOUT');
    expect(fetchFn.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchFn.mock.calls[1][1].signal.aborted).toBe(false);
  });

  test('stops the suite at its budget and marks unexecuted checks', async () => {
    let elapsed = 0;
    const report = await runSmokeChecks([check('first'), check('second')], {
      clock: () => elapsed,
      budgetMs: 100,
      fetchFn: async () => {
        elapsed = 100;
        return response();
      },
      log: vi.fn(),
    });
    expect(report.passed).toBe(false);
    expect(report.results[1]).toMatchObject({ outcome: 'skipped', reason: 'BUDGET_EXHAUSTED' });
  });

  test('collects independent failures and safe correlation metadata', async () => {
    const run = harness([
      response(400, {
        'X-Request-Id': 'request-123',
        'CF-Ray': 'ray-123',
        'Content-Type': 'application/json',
      }),
      new Error('SECRET_TOKEN person@example.com'),
    ]);
    const report = await runSmokeChecks([check('http'), check('network')], run.options);
    expect(report.results).toHaveLength(2);
    expect(report.results[0].attempts[0]).toMatchObject({
      requestId: 'request-123',
      cfRay: 'ray-123',
      status: 400,
    });
    const logs = JSON.stringify(run.log.mock.calls);
    expect(logs).not.toContain('SECRET_TOKEN');
    expect(logs).not.toContain('safe fixture');
    expect(logs).not.toContain('person@example.com');
  });
});

describe('production contracts', () => {
  test.each([
    ['missing_certificate', 404, 'CERTIFICATE_NOT_FOUND'],
    ['issuance_authentication', 401, 'UNAUTHORIZED'],
  ])('accepts expected negative response %s', async (id, status, code) => {
    const run = harness([
      new Response(JSON.stringify({ error: { code } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]);
    expect((await runSmokeChecks([contract(id)], run.options)).passed).toBe(true);
    expect(run.fetchFn).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['viewer_script', 'text/html', '<html>fallback</html>', 'CONTENT_TYPE'],
    ['viewer_script', 'text/javascript', '<!doctype html><html>', 'INVALID_BODY'],
    ['viewer_styles', 'text/css', '', 'EMPTY_BODY'],
    ['familjen_font', 'font/woff2', 'invalid-font', 'INVALID_BODY'],
    ['brand_mark', 'image/svg+xml', 'invalid-svg', 'INVALID_BODY'],
    ['api_health', 'application/json', '{broken', 'INVALID_BODY'],
    ['api_health', 'application/json', '{"status":"error"}', 'INVALID_BODY'],
    [
      'public_keys',
      'application/json',
      '{"keys":[{"kty":"OKP","crv":"Ed25519","x":"public","d":"private"}]}',
      'INVALID_BODY',
    ],
    ['public_keys', 'application/json', '{"keys":[null]}', 'INVALID_BODY'],
  ])('rejects a broken %s contract without retry', async (id, type, body, reason) => {
    const run = harness([new Response(body, { headers: { 'Content-Type': type } })]);
    const report = await runSmokeChecks([contract(id)], run.options);
    expect(report.results[0].reason).toBe(reason);
    expect(run.fetchFn).toHaveBeenCalledTimes(1);
  });

  test('accepts valid asset signatures split across network chunks', async () => {
    const chunks = ['w', 'OF', '2font-data'];
    const body = new ReadableStream({
      pull(controller) {
        if (chunks.length) controller.enqueue(new TextEncoder().encode(chunks.shift()));
        else controller.close();
      },
    });
    const run = harness([new Response(body, { headers: { 'Content-Type': 'font/woff2' } })]);
    expect((await runSmokeChecks([contract('familjen_font')], run.options)).passed).toBe(true);
  });

  test('validates redirect target without following it', async () => {
    const run = harness([response(308, { Location: 'https://wrong.example' })]);
    const report = await runSmokeChecks([contract('historical_key_redirect')], run.options);
    expect(report.results[0].reason).toBe('REDIRECT_LOCATION');
  });

  test('contains no authorized requests or real certificate identifiers', () => {
    const checks = productionChecks();
    expect(checks).toHaveLength(16);
    expect(checks.filter((item) => item.method !== 'GET')).toMatchObject([
      { id: 'issuance_authentication', method: 'POST' },
    ]);
    expect(checks.every((item) => !item.headers && !item.body)).toBe(true);
  });
});

test('writes JSON diagnostics and readable summaries for failed and recovered checks', async () => {
  const run = harness([response(503), response(), response(400)]);
  const report = await runSmokeChecks([check('recovered'), check('failed')], run.options);
  const directory = await mkdtemp(join(tmpdir(), 'squai-smoke-'));
  try {
    await writeSmokeReport(report, directory);
    expect(JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'))).toEqual(report);
    const summary = await readFile(join(directory, 'summary.md'), 'utf8');
    expect(summary).toBe(smokeSummary(report));
    expect(summary).toContain('| recovered | recovered | 2 | 200 |');
    expect(summary).toContain('| failed | failed | 1 | 400 | HTTP_STATUS |');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('build revision uses a validated CI SHA', () => {
  vi.stubEnv('GITHUB_SHA', version);
  expect(resolveBuildVersion()).toBe(version);
  vi.stubEnv('GITHUB_SHA', 'invalid-value');
  expect(resolveBuildVersion).toThrow('Invalid build revision');
});

test('CLI preserves diagnostics and exits nonzero on invalid configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'squai-smoke-cli-'));
  const summaryPath = join(directory, 'github-summary.md');
  try {
    let exitStatus;
    try {
      execFileSync(process.execPath, [resolve('scripts/smoke-test.mjs')], {
        cwd: directory,
        env: {
          ...process.env,
          SMOKE_EXPECTED_VERSION: 'invalid-secret',
          GITHUB_STEP_SUMMARY: summaryPath,
        },
        stdio: 'pipe',
      });
    } catch (error) {
      exitStatus = error.status;
    }
    expect(exitStatus).toBe(1);
    const saved = await readFile(join(directory, 'smoke-results/report.json'), 'utf8');
    expect(JSON.parse(saved)).toMatchObject({ passed: false, error: 'INVALID_EXPECTED_VERSION' });
    expect(saved).not.toContain('invalid-secret');
    expect(await readFile(summaryPath, 'utf8')).toContain('INVALID_EXPECTED_VERSION');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
