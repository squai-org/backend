import { decodeProtectedHeader } from 'jose';
import { expect, test } from 'vitest';
import { input, publicOrigin } from '../fixtures';
import { createTestRuntime, token } from '../runtime';

const apiOrigin = 'https://api.squai.io';

test('separates all API endpoints from the canonical frontend and rejects other hosts', async () => {
  const { runtime } = await createTestRuntime(apiOrigin);
  const options = {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  };
  try {
    for (const origin of [publicOrigin, 'https://verify.squai.io', 'https://preview.workers.dev']) {
      const rejected = await runtime.dispatchFetch(`${origin}/api/v1/certificates`, options);
      expect(rejected.status).toBe(404);
      for (const path of ['/health', `/api/v1/certificates/${'0'.repeat(64)}/pdf`])
        expect((await runtime.dispatchFetch(`${origin}${path}`)).status).toBe(404);
    }
    expect((await runtime.dispatchFetch(`${apiOrigin}/health`)).status).toBe(200);
    const unauthorized = await runtime.dispatchFetch(`${apiOrigin}/api/v1/certificates`, {
      method: 'POST',
    });
    expect(unauthorized.status).toBe(401);
    const issued = await runtime.dispatchFetch(`${apiOrigin}/api/v1/certificates`, options);
    expect(issued.status).toBe(201);
    const { hash, verificationUrl, credentialJwt } = (await issued.json()) as {
      hash: string;
      verificationUrl: string;
      credentialJwt: string;
    };
    expect(verificationUrl).toBe(`${publicOrigin}/verify/${hash}`);
    expect(decodeProtectedHeader(credentialJwt).kid).toContain(`${apiOrigin}/.well-known/`);
    const duplicate = await runtime.dispatchFetch(`${apiOrigin}/api/v1/certificates`, options);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ hash, credentialJwt, verificationUrl });
    const viewer = await runtime.dispatchFetch(verificationUrl);
    expect(viewer.status).toBe(200);
    expect(await viewer.text()).toContain(`${apiOrigin}/api/v1/certificates/${hash}/pdf`);
    for (const path of [
      `/api/v1/certificates/${hash}`,
      `/api/v1/certificates/${hash}/credential`,
      `/api/v1/certificates/${hash}/pdf`,
      `/api/v1/certificates/${hash}/pdf?download=1`,
    ]) {
      expect((await runtime.dispatchFetch(`${publicOrigin}${path}`)).status).toBe(404);
      const response = await runtime.dispatchFetch(`${apiOrigin}${path}`, {
        headers: { Origin: publicOrigin },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(publicOrigin);
    }
    const attacker = await runtime.dispatchFetch(`${apiOrigin}/api/v1/certificates/${hash}`, {
      headers: { Origin: 'https://attacker.example' },
    });
    expect(attacker.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const oldKeys = await runtime.dispatchFetch(`${publicOrigin}/.well-known/jwks.json`, {
      redirect: 'manual',
    });
    expect(oldKeys.status).toBe(308);
    expect(oldKeys.headers.get('Location')).toBe(`${apiOrigin}/.well-known/jwks.json`);
    const misplacedViewer = await runtime.dispatchFetch(`${apiOrigin}/verify/${hash}?test=1`, {
      redirect: 'manual',
    });
    expect(misplacedViewer.status).toBe(308);
    expect(misplacedViewer.headers.get('Location')).toBe(`${verificationUrl}?test=1`);
    expect((await runtime.dispatchFetch(`${apiOrigin}/certificate-viewer/viewer.js`)).status).toBe(
      404,
    );
  } finally {
    await runtime.dispose();
  }
});
