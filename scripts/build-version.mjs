import { execFileSync } from 'node:child_process';

export function resolveBuildVersion() {
  const version =
    process.env.GITHUB_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(version)) throw new Error('Invalid build revision');
  return version;
}
