import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function smokeSummary(report) {
  const lines = [
    '## Production smoke test',
    '',
    `Result: ${report.passed ? 'passed' : 'failed'} · Version: ${report.expectedVersion ?? 'not enforced'} · Duration: ${report.durationMs} ms`,
    '',
    '| Check | Result | Attempts | HTTP | Reason |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const result of report.results) {
    const last = result.attempts.at(-1);
    lines.push(
      `| ${result.check} | ${result.outcome} | ${result.attempts.length} | ${last?.status ?? '—'} | ${result.reason ?? '—'} |`,
    );
  }
  if (report.error) lines.push('', `Error: ${report.error}`);
  return `${lines.join('\n')}\n`;
}

export async function writeSmokeReport(report, directory = 'smoke-results') {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(directory, 'summary.md'), smokeSummary(report));
}
