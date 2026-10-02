import { appendFile } from 'node:fs/promises';
import { productionChecks } from './smoke/checks.mjs';
import { smokeSummary, writeSmokeReport } from './smoke/report.mjs';
import { runSmokeChecks } from './smoke/runner.mjs';

const expectedVersion = process.env.SMOKE_EXPECTED_VERSION ?? null;
let report;
let failureCategory = 'SMOKE_EXECUTION_FAILED';
try {
  if (expectedVersion !== null && !/^[a-f0-9]{40}$/.test(expectedVersion)) {
    failureCategory = 'INVALID_EXPECTED_VERSION';
    throw new Error('INVALID_EXPECTED_VERSION');
  }
  report = await runSmokeChecks(productionChecks(), { expectedVersion });
} catch {
  report = {
    passed: false,
    expectedVersion: null,
    durationMs: 0,
    results: [],
    error: failureCategory,
  };
}
await writeSmokeReport(report);
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(process.env.GITHUB_STEP_SUMMARY, smokeSummary(report));
console.log(
  report.passed
    ? 'Production smoke tests passed'
    : 'Production smoke tests failed; see smoke-results/report.json',
);
if (!report.passed) process.exitCode = 1;
