import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { app } from '../../src/app';
import type { Bindings } from '../../src/platform/bindings';
import { input } from '../fixtures';
import { createTestRuntime, token } from '../runtime';

let resources: Awaited<ReturnType<typeof createTestRuntime>>;
let bindings: Bindings;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

beforeAll(async () => {
  resources = await createTestRuntime();
  const workerBindings = await resources.runtime.getBindings();
  bindings = {
    ...resources.values,
    DB: resources.database as unknown as D1Database,
    ASSETS: workerBindings.ASSETS as Fetcher,
  };
});

afterAll(async () => {
  await resources?.runtime.dispose();
});

test.each(['program-v1', 'talk-v1'])(
  'HTTP adapter persists and renders %s against D1',
  async (templateId) => {
    const payload = {
      ...input,
      templateId,
      data: { ...input.data, subjectId: `urn:uuid:${crypto.randomUUID()}` },
    };
    const response = await app.request(
      '/api/v1/certificates',
      { method: 'POST', headers, body: JSON.stringify(payload) },
      bindings,
    );
    expect(response.status).toBe(201);
    const certificate = (await response.json()) as { hash: string; credentialJwt: string };
    expect((await app.request(`/verify/${certificate.hash}`, undefined, bindings)).status).toBe(
      200,
    );
    expect(
      (await app.request(`/api/v1/certificates/${certificate.hash}`, undefined, bindings)).status,
    ).toBe(200);
    expect(
      await (
        await app.request(
          `/api/v1/certificates/${certificate.hash}/credential`,
          undefined,
          bindings,
        )
      ).text(),
    ).toBe(certificate.credentialJwt);
    expect(
      (
        await app.request(
          '/api/v1/certificates',
          { method: 'POST', headers, body: JSON.stringify(payload) },
          bindings,
        )
      ).status,
    ).toBe(200);
    const asset = await app.request(
      '/certificate-assets/program-v1/14751d993442b054e9e31acd0cd7799e.png',
      undefined,
      bindings,
    );
    expect(asset.status).toBe(200);
    const pdf = await app.request(
      `/api/v1/certificates/${certificate.hash}/pdf`,
      undefined,
      bindings,
    );
    expect(pdf.status).toBe(200);
    expect((await PDFDocument.load(await pdf.arrayBuffer())).getPageCount()).toBe(1);
    const download = await app.request(
      `/api/v1/certificates/${certificate.hash}/pdf?download=1`,
      undefined,
      bindings,
    );
    expect(download.headers.get('Content-Disposition')).toContain('attachment;');
  },
);

test('HTTP errors reject invalid authentication, transport, size and JSON safely', async () => {
  for (const authorization of ['', 'Basic token', 'Bearer wrong', `Bearer ${'x'.repeat(600)}`]) {
    const response = await app.request(
      '/api/v1/certificates',
      { method: 'POST', headers: { Authorization: authorization } },
      bindings,
    );
    expect(response.status).toBe(401);
  }
  for (const missingToken of [undefined, 'short']) {
    const env = { ...bindings };
    if (missingToken === undefined) delete env.CERTIFICATE_ISSUANCE_TOKEN;
    else env.CERTIFICATE_ISSUANCE_TOKEN = missingToken;
    expect((await app.request('/api/v1/certificates', { method: 'POST' }, env)).status).toBe(503);
  }
  expect(
    (await app.request('/api/v1/certificates', { method: 'POST', headers, body: '{' }, bindings))
      .status,
  ).toBe(400);
  expect(
    (
      await app.request(
        '/api/v1/certificates',
        { method: 'POST', headers, body: 'x'.repeat(8193) },
        bindings,
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await app.request(
        '/api/v1/certificates',
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' },
        bindings,
      )
    ).status,
  ).toBe(415);
  expect((await app.request('/verify/invalid', undefined, bindings)).status).toBe(400);
  expect((await app.request(`/verify/${'0'.repeat(64)}`, undefined, bindings)).status).toBe(404);
  expect((await app.request('/missing', undefined, bindings)).status).toBe(404);
  expect((await app.request('/health', undefined, bindings)).status).toBe(200);
  expect((await app.request('/.well-known/jwks.json', undefined, bindings)).status).toBe(200);
});

test('PDF viewer escapes verified recipient metadata and preserves signed values in the API', async () => {
  const recipientName = '<script>a&"b\'c</script>';
  const payload = {
    ...input,
    data: { ...input.data, subjectId: `urn:uuid:${crypto.randomUUID()}`, recipientName },
  };
  const response = await app.request(
    '/api/v1/certificates',
    { method: 'POST', headers, body: JSON.stringify(payload) },
    bindings,
  );
  const { hash } = (await response.json()) as { hash: string };
  const html = await (await app.request(`/verify/${hash}`, undefined, bindings)).text();
  expect(html).toContain('&lt;script&gt;a&amp;&quot;b&#39;c&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  const json = await (
    await app.request(`/api/v1/certificates/${hash}`, undefined, bindings)
  ).json();
  expect(json).toMatchObject({ credential: { credentialSubject: { recipientName } } });
});

test('API origin enforcement preserves authentication and blocks issuance on the verification host', async () => {
  const env = { ...bindings, API_ORIGIN: 'https://api.squai.io' };
  const options = { method: 'POST', headers, body: JSON.stringify(input) };
  expect(
    (await app.request('https://www.verify.squai.io/api/v1/certificates', options, env)).status,
  ).toBe(404);
  expect((await app.request('https://api.squai.io/api/v1/certificates', options, env)).status).toBe(
    201,
  );
  expect(
    (await app.request('https://api.squai.io/api/v1/certificates', { method: 'POST' }, env)).status,
  ).toBe(401);
});

test.each([
  { PUBLIC_ORIGIN: 'http://invalid.example' },
  { ISSUER_NAME: '' },
  { VERIFICATION_KEYS_JWKS: 'private-secret-invalid-json' },
])('configuration failures never expose internal details %#', async (overrides) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await app.request('/.well-known/jwks.json', undefined, {
      ...bindings,
      ...overrides,
    });
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('private-secret');
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.join('')).not.toContain('private-secret');
  } finally {
    log.mockRestore();
  }
});

test('enforces canonical host routing before running a business handler', async () => {
  const api = 'https://api.squai.io';
  const frontend = bindings.PUBLIC_ORIGIN;
  const productionBindings = { ...bindings, API_ORIGIN: api };
  expect((await app.request(`${api}/health`, undefined, productionBindings)).status).toBe(200);
  expect((await app.request(`${frontend}/health`, undefined, productionBindings)).status).toBe(404);
  expect(
    (await app.request('https://unknown.example/health', undefined, productionBindings)).status,
  ).toBe(404);
  const oldKeys = await app.request(
    `${frontend}/.well-known/jwks.json`,
    undefined,
    productionBindings,
  );
  expect(oldKeys.status).toBe(308);
  expect(oldKeys.headers.get('Location')).toBe(`${api}/.well-known/jwks.json`);
  const misplaced = await app.request(
    `${api}/verify/${'0'.repeat(64)}`,
    undefined,
    productionBindings,
  );
  expect(misplaced.status).toBe(308);
  expect(misplaced.headers.get('Location')).toBe(`${frontend}/verify/${'0'.repeat(64)}`);
  const missing = await app.request(
    `${frontend}/verify/${'0'.repeat(64)}`,
    undefined,
    productionBindings,
  );
  expect(missing.status).toBe(404);
  const keys = await app.request(
    `${api}/.well-known/jwks.json`,
    { headers: { Origin: frontend } },
    productionBindings,
  );
  expect(keys.headers.get('Access-Control-Allow-Origin')).toBe(frontend);
  const untrusted = await app.request(
    `${api}/health`,
    { headers: { Origin: 'https://unknown.example' } },
    productionBindings,
  );
  expect(untrusted.headers.get('Access-Control-Allow-Origin')).toBeNull();
  const script = await app.request(
    `${frontend}/certificate-viewer/viewer.js`,
    undefined,
    productionBindings,
  );
  expect(script.status).toBe(200);
  for (const path of [
    '/certificate-viewer/viewer.css',
    '/brand/mark.svg',
    '/brand/gloria-hallelujah-latin.woff2',
  ]) {
    expect((await app.request(`${frontend}${path}`, undefined, productionBindings)).status).toBe(
      200,
    );
    expect((await app.request(`${api}${path}`, undefined, productionBindings)).status).toBe(404);
  }
});
