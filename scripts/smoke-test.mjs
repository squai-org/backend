const origin = 'https://www.verify.squai.io';
const apiOrigin = 'https://api.squai.io';
const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(10000) });
if (!health.ok || (await health.json()).status !== 'ok') throw new Error('Health check failed');
const keys = await fetch(`${origin}/.well-known/jwks.json`, { signal: AbortSignal.timeout(10000) });
if (!keys.ok || !(await keys.json()).keys?.length) throw new Error('Public key discovery failed');
const lookup = await fetch(`${origin}/api/v1/certificates/${'0'.repeat(64)}`, {
  signal: AbortSignal.timeout(10000),
});
if (lookup.status !== 404) throw new Error('D1 verification read failed');
const unauthorized = await fetch(`${apiOrigin}/api/v1/certificates`, {
  method: 'POST',
  signal: AbortSignal.timeout(10000),
});
if (unauthorized.status !== 401) throw new Error('Issuance authentication failed');
const frontendIssuance = await fetch(`${origin}/api/v1/certificates`, {
  method: 'POST',
  signal: AbortSignal.timeout(10000),
});
if (frontendIssuance.status !== 404) throw new Error('Issuance must use the API domain');
const missingPdf = await fetch(`${origin}/api/v1/certificates/${'0'.repeat(64)}/pdf`, {
  signal: AbortSignal.timeout(10000),
});
if (missingPdf.status !== 404) throw new Error('PDF verification read failed');
console.log('Production smoke tests passed');
