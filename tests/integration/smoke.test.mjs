import { expect, test, vi } from 'vitest';
import { productionChecks } from '../../scripts/smoke/checks.mjs';
import { runSmokeChecks } from '../../scripts/smoke/runner.mjs';
import { createTestRuntime } from '../runtime.ts';

test('runs every smoke contract against the built Worker without issuing certificates', async () => {
  const { runtime, database } = await createTestRuntime('https://api.squai.io');
  try {
    const health = await runtime.dispatchFetch('https://api.squai.io/health');
    expect(await health.json()).toEqual({ status: 'ok' });
    const version = health.headers.get('X-Deployment-Version');
    expect(version).toMatch(/^[a-f0-9]{40}$/);
    const report = await runSmokeChecks(productionChecks(), {
      expectedVersion: version,
      fetchFn: (url, options) => runtime.dispatchFetch(url, options),
      log: vi.fn(),
      maxAttempts: 1,
    });
    expect(
      report.results.map((result) => ({ check: result.check, reason: result.reason })),
    ).toEqual(productionChecks().map((check) => ({ check: check.id, reason: undefined })));
    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(16);
    expect(report.results.every((result) => result.attempts[0].actualVersion === version)).toBe(
      true,
    );
    expect(
      await database.prepare('SELECT COUNT(*) AS count FROM certificates').first('count'),
    ).toBe(0);
  } finally {
    await runtime.dispose();
  }
});
