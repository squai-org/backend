import { expect, test } from 'vitest';
import { input, publicOrigin } from '../fixtures';
import { createTestRuntime, token } from '../runtime';

test('production issues only on the API origin while retaining public verification links and PDFs', async () => {
  const apiOrigin = 'https://api.squai.io';
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
      expect(await rejected.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
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
    const duplicate = await runtime.dispatchFetch(`${apiOrigin}/api/v1/certificates`, options);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ hash, credentialJwt, verificationUrl });
    const viewer = await runtime.dispatchFetch(verificationUrl);
    expect(viewer.status).toBe(200);
    expect(await viewer.text()).toContain('Descargar PDF');
    expect(
      (await runtime.dispatchFetch(`${publicOrigin}/api/v1/certificates/${hash}/pdf`)).status,
    ).toBe(200);
    expect((await runtime.dispatchFetch(`${apiOrigin}/api/v1/certificates/${hash}`)).status).toBe(
      200,
    );
  } finally {
    await runtime.dispose();
  }
});
