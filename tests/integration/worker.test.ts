import { compactVerify, importJWK } from 'jose';
import type { Miniflare } from 'miniflare';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { input, issuer, publicOrigin } from '../fixtures';

import { createTestRuntime, schema, token } from '../runtime';

let runtime: Miniflare;
let database: Awaited<ReturnType<Miniflare['getD1Database']>>;

async function issue(templateId = 'program-v1', recipientName = input.data.recipientName) {
  const payload = {
    templateId,
    data: { ...input.data, recipientName, subjectId: `urn:uuid:${crypto.randomUUID()}` },
  };
  const response = await runtime.dispatchFetch(`${publicOrigin}/api/v1/certificates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as {
    hash: string;
    verificationUrl: string;
    credentialJwt: string;
    templateId: string;
  };
  return { response, body, payload };
}

beforeAll(async () => {
  ({ runtime, database } = await createTestRuntime());
});

afterAll(async () => {
  await runtime?.dispose();
});

describe('Workers HTTP and D1 integration', () => {
  it('serves health with security headers and a correlation id', async () => {
    const response = await runtime.dispatchFetch(`${publicOrigin}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Request-Id')).toMatch(/^[a-f0-9-]{36}$/);
  });

  it.each(['program-v1', 'talk-v1'])(
    'issues and displays a downloadable Letter PDF for %s',
    async (templateId) => {
      const result = await issue(templateId);
      expect(result.response.status).toBe(201);
      expect(result.response.headers.get('Location')).toBe(result.body.verificationUrl);
      expect(result.body.hash).toMatch(/^[a-f0-9]{64}$/);
      const response = await runtime.dispatchFetch(result.body.verificationUrl);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');
      const html = await response.text();
      expect(html).not.toContain(input.data.recipientName);
      expect(html).not.toContain(input.data.courseName);
      expect(html).not.toContain('/certificate-assets/');
      expect(html).toContain('Descargar PDF');
      expect(html).toContain(`<iframe class="viewer"`);
      expect(html).toContain(`/api/v1/certificates/${result.body.hash}/pdf`);
      expect(response.headers.get('Content-Security-Policy')).toContain("frame-src 'self'");
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(html).not.toMatch(/<script|<input|<form|\{\{/i);
      const paths = [...html.matchAll(/src="([^"]+)"/g)].map((match) => match[1]);
      expect(paths).toHaveLength(1);
      const pdfResponse = await runtime.dispatchFetch(
        `${publicOrigin}/api/v1/certificates/${result.body.hash}/pdf`,
      );
      expect(pdfResponse.status).toBe(200);
      expect(pdfResponse.headers.get('Content-Type')).toBe('application/pdf');
      expect(pdfResponse.headers.get('Content-Disposition')).toContain('inline;');
      expect(pdfResponse.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
      expect(pdfResponse.headers.get('Content-Security-Policy')).toContain(
        "frame-ancestors 'self'",
      );
      expect(pdfResponse.headers.get('Cache-Control')).toBe('no-store');
      const pdf = await PDFDocument.load(await pdfResponse.arrayBuffer());
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPages()[0]?.getSize()).toEqual({ width: 792, height: 612 });
      expect(pdf.getForm().getFields()).toHaveLength(0);
      const download = await runtime.dispatchFetch(
        `${publicOrigin}/api/v1/certificates/${result.body.hash}/pdf?download=1`,
      );
      expect(download.status).toBe(200);
      expect(download.headers.get('Content-Disposition')).toBe(
        `attachment; filename="squai-${result.body.hash}.pdf"`,
      );
    },
  );

  it('returns machine-readable validation and an independently verifiable VC JWT', async () => {
    const { body } = await issue();
    const response = await runtime.dispatchFetch(
      `${publicOrigin}/api/v1/certificates/${body.hash}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      valid: true,
      verificationUrl: body.verificationUrl,
    });
    const jwtResponse = await runtime.dispatchFetch(
      `${publicOrigin}/api/v1/certificates/${body.hash}/credential`,
    );
    expect(jwtResponse.headers.get('Content-Type')).toBe('application/vc+jwt');
    const jwt = await jwtResponse.text();
    const jwksResponse = await runtime.dispatchFetch(`${publicOrigin}/.well-known/jwks.json`);
    const jwks = (await jwksResponse.json()) as {
      keys: { kid: string; kty: string; crv: string; x: string }[];
    };
    const key = jwks.keys[0];
    if (!key) throw new Error('Missing public key');
    expect(key).not.toHaveProperty('d');
    const result = await compactVerify(jwt, await importJWK(key, 'EdDSA'), {
      algorithms: ['EdDSA'],
    });
    expect(result.protectedHeader.kid).toBe(key.kid);
    expect(JSON.parse(new TextDecoder().decode(result.payload))).toMatchObject({
      '@context': ['https://www.w3.org/ns/credentials/v2', expect.any(Object)],
      type: ['VerifiableCredential', 'SquaiAchievementCredential'],
      certificateHash: body.hash,
      issuer,
    });
  });

  it('persists one immutable row across duplicate and concurrent requests', async () => {
    const { body, payload } = await issue();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        runtime.dispatchFetch(`${publicOrigin}/api/v1/certificates`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        hash: body.hash,
        credentialJwt: body.credentialJwt,
      });
    }
    expect(
      await database
        .prepare('SELECT COUNT(*) AS count FROM certificates WHERE hash = ?')
        .bind(body.hash)
        .first('count'),
    ).toBe(1);
    await expect(
      database
        .prepare('UPDATE certificates SET issued_at = ? WHERE hash = ?')
        .bind('tampered', body.hash)
        .run(),
    ).rejects.toThrow('immutable');
    await expect(
      database.prepare('DELETE FROM certificates WHERE hash = ?').bind(body.hash).run(),
    ).rejects.toThrow('immutable');
  });

  it.each([undefined, 'Bearer wrong', 'Basic test', `Bearer ${token}extra`])(
    'rejects unauthorized issuance %#',
    async (authorization) => {
      const response = await runtime.dispatchFetch(`${publicOrigin}/api/v1/certificates`, {
        method: 'POST',
        headers: {
          ...(authorization ? { Authorization: authorization } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer');
    },
  );

  it.each([
    { contentType: 'text/plain', body: '{}', status: 415 },
    { contentType: 'application/json', body: '{', status: 400 },
    { contentType: 'application/json', body: '{}', status: 400 },
    {
      contentType: 'application/json',
      body: JSON.stringify({ ...input, templateId: 'unknown' }),
      status: 400,
    },
    { contentType: 'application/json', body: 'x'.repeat(8193), status: 413 },
  ])('rejects malformed requests %#', async (test) => {
    const response = await runtime.dispatchFetch(`${publicOrigin}/api/v1/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': test.contentType },
      body: test.body,
    });
    expect(response.status).toBe(test.status);
    expect(await response.json()).toHaveProperty('error.requestId');
  });

  it('keeps recipient text out of the viewer HTML and preserves the original credential', async () => {
    const { body } = await issue('talk-v1', '<img src=x onerror=alert(1)>');
    const html = await (await runtime.dispatchFetch(body.verificationUrl)).text();
    expect(html).not.toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    const response = await runtime.dispatchFetch(
      `${publicOrigin}/api/v1/certificates/${body.hash}`,
    );
    expect(await response.json()).toMatchObject({
      credential: { credentialSubject: { recipientName: '<img src=x onerror=alert(1)>' } },
    });
  });

  it('rejects malformed and absent hashes and exposes no mutation route', async () => {
    expect((await runtime.dispatchFetch(`${publicOrigin}/verify/bad`)).status).toBe(400);
    expect((await runtime.dispatchFetch(`${publicOrigin}/verify/${'0'.repeat(64)}`)).status).toBe(
      404,
    );
    expect(
      (
        await runtime.dispatchFetch(`${publicOrigin}/api/v1/certificates/${'0'.repeat(64)}`, {
          method: 'PUT',
        })
      ).status,
    ).toBe(404);
    expect((await runtime.dispatchFetch(`${publicOrigin}/missing`)).status).toBe(404);
    expect(
      (await runtime.dispatchFetch(`${publicOrigin}/api/v1/certificates/bad/pdf`)).status,
    ).toBe(400);
    expect(
      (await runtime.dispatchFetch(`${publicOrigin}/api/v1/certificates/${'0'.repeat(64)}/pdf`))
        .status,
    ).toBe(404);
  });

  it('denies rendering when an administrator bypasses immutability and corrupts metadata', async () => {
    const { body, payload } = await issue();
    await database.prepare('DROP TRIGGER certificates_prevent_update').run();
    try {
      await database
        .prepare(
          'UPDATE certificates SET payload_json = json_set(payload_json, ?, ?) WHERE hash = ?',
        )
        .bind('$.data.recipientName', 'Database attacker', body.hash)
        .run();
      for (const path of [
        `/verify/${body.hash}`,
        `/api/v1/certificates/${body.hash}`,
        `/api/v1/certificates/${body.hash}/credential`,
        `/api/v1/certificates/${body.hash}/pdf`,
        `/api/v1/certificates/${body.hash}/pdf?download=1`,
      ]) {
        const response = await runtime.dispatchFetch(`${publicOrigin}${path}`);
        expect(response.status).toBe(409);
        expect(await response.text()).not.toContain('Database attacker');
      }
      const duplicate = await runtime.dispatchFetch(`${publicOrigin}/api/v1/certificates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(duplicate.status).toBe(409);
    } finally {
      await database
        .prepare(
          schema.slice(
            schema.indexOf('CREATE TRIGGER certificates_prevent_update'),
            schema.indexOf('CREATE TRIGGER certificates_prevent_delete'),
          ),
        )
        .run();
    }
  });
});
