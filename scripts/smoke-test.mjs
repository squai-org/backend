const origin = 'https://www.verify.squai.io';
const apiOrigin = 'https://api.squai.io';
const options = { signal: AbortSignal.timeout(10000), redirect: 'manual' };
const health = await fetch(`${apiOrigin}/health`, options);
if (!health.ok || (await health.json()).status !== 'ok') throw new Error('Health check failed');
const keys = await fetch(`${apiOrigin}/.well-known/jwks.json`, options);
if (!keys.ok || !(await keys.json()).keys?.length) throw new Error('Public key discovery failed');
const lookup = await fetch(`${apiOrigin}/api/v1/certificates/${'0'.repeat(64)}`, options);
if (lookup.status !== 404) throw new Error('D1 verification read failed');
const unauthorized = await fetch(`${apiOrigin}/api/v1/certificates`, {
  ...options,
  method: 'POST',
});
if (unauthorized.status !== 401) throw new Error('Issuance authentication failed');
for (const path of ['/health', '/api/v1/certificates', `/api/v1/certificates/${'0'.repeat(64)}`]) {
  const response = await fetch(`${origin}${path}`, options);
  if (response.status !== 404) throw new Error('Backend routes must use the API domain');
}
const oldKeys = await fetch(`${origin}/.well-known/jwks.json`, options);
if (
  oldKeys.status !== 308 ||
  oldKeys.headers.get('Location') !== `${apiOrigin}/.well-known/jwks.json`
)
  throw new Error('Historical key discovery redirect failed');
const missingPdf = await fetch(`${apiOrigin}/api/v1/certificates/${'0'.repeat(64)}/pdf`, options);
if (missingPdf.status !== 404) throw new Error('PDF verification read failed');
for (const path of [
  '/certificate-viewer/viewer.js',
  '/certificate-viewer/viewer.css',
  '/brand/mark.svg',
  '/brand/gloria-hallelujah-latin.woff2',
]) {
  const asset = await fetch(`${origin}${path}`, options);
  if (!asset.ok) throw new Error('Certificate viewer asset unavailable');
}
console.log('Production smoke tests passed');
