import { CompactSign, compactVerify, importJWK } from 'jose';
import { describe, expect, it } from 'vitest';
import { createCredential } from '../../src/modules/certificates/application/credential';
import { WebCryptoCredentials } from '../../src/modules/certificates/infrastructure/web-crypto-credentials';
import { createKeys, input, issuer, publicOrigin } from '../fixtures';

describe('Web Crypto adapter', () => {
  it('matches a known SHA-256 test vector', async () => {
    const { cryptography } = await createKeys();
    expect(await cryptography.digest('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('verifies issued credentials with a separate JOSE verifier and public JWK', async () => {
    const keys = await createKeys();
    const credential = createCredential(
      {
        hash: '0'.repeat(64),
        payload: { ...input, version: 1, issuer },
        issuedAt: '2026-09-30T22:00:00.000Z',
      },
      `${publicOrigin}/verify/${'0'.repeat(64)}`,
    );
    const jwt = await keys.cryptography.signCredential(credential);
    const publicJwk = keys.cryptography.jwks.keys[0];
    if (!publicJwk) throw new Error('Missing test key');
    const result = await compactVerify(jwt, await importJWK(publicJwk, 'EdDSA'), {
      algorithms: ['EdDSA'],
    });
    expect(JSON.parse(new TextDecoder().decode(result.payload))).toEqual(credential);
    expect(result.protectedHeader).toMatchObject({
      alg: 'EdDSA',
      typ: 'vc+jwt',
      kid: `${publicOrigin}/.well-known/jwks.json#test-key`,
    });
    expect(publicJwk).not.toHaveProperty('d');
  });

  it('keeps historical public keys across rotation', async () => {
    const old = await createKeys('old');
    const current = await createKeys('current');
    const jwks = JSON.stringify({
      keys: [...JSON.parse(old.jwks).keys, ...JSON.parse(current.jwks).keys],
    });
    const rotated = new WebCryptoCredentials('current', current.privateJwk, jwks, publicOrigin);
    const hash = await old.cryptography.digest('original');
    expect(await rotated.verifyHash(hash, await old.cryptography.signHash(hash), 'old')).toBe(true);
    expect(await rotated.verifyHash(hash, await rotated.signHash(hash), 'current')).toBe(true);
  });

  it('supports public verification without a private key', async () => {
    const keys = await createKeys();
    const publicOnly = new WebCryptoCredentials(keys.kid, undefined, keys.jwks, publicOrigin);
    const hash = await keys.cryptography.digest('test');
    expect(
      await publicOnly.verifyHash(hash, await keys.cryptography.signHash(hash), keys.kid),
    ).toBe(true);
    await expect(publicOnly.signHash(hash)).rejects.toThrow('Signing key missing');
  });

  it('rejects unknown keys, malformed signatures and incorrect digest signatures', async () => {
    const keys = await createKeys();
    const hash = await keys.cryptography.digest('test');
    expect(await keys.cryptography.verifyHash(hash, '???', keys.kid)).toBe(false);
    expect(await keys.cryptography.verifyHash(hash, 'A'.repeat(86), 'unknown')).toBe(false);
    expect(await keys.cryptography.verifyHash('bad', 'A'.repeat(86), keys.kid)).toBe(false);
    expect(await keys.cryptography.verifyHash(hash, 'A'.repeat(86), keys.kid)).toBe(false);
    await expect(keys.cryptography.verifyCredential('bad', 'unknown')).rejects.toThrow();
    await expect(keys.cryptography.signHash('bad')).rejects.toThrow();
  });

  it('rejects valid JWS signatures with the wrong profile', async () => {
    const keys = await createKeys();
    for (const header of [
      { alg: 'EdDSA', typ: 'JWT', kid: `${publicOrigin}/.well-known/jwks.json#test-key` },
      { alg: 'EdDSA', typ: 'vc+jwt', kid: 'https://attacker.example/key' },
    ]) {
      const jwt = await new CompactSign(new TextEncoder().encode('{}'))
        .setProtectedHeader(header)
        .sign(keys.pair.privateKey);
      await expect(keys.cryptography.verifyCredential(jwt, keys.kid)).rejects.toThrow(
        'Invalid credential header',
      );
    }
  });

  it('rejects private material in public configuration and mismatched signing keys', async () => {
    const keys = await createKeys();
    const other = await createKeys();
    const mismatched = new WebCryptoCredentials(
      keys.kid,
      other.privateJwk,
      keys.jwks,
      publicOrigin,
    );
    await expect(mismatched.signHash('0'.repeat(64))).rejects.toThrow('Signing key does not match');
    expect(
      () =>
        new WebCryptoCredentials(
          keys.kid,
          keys.privateJwk,
          JSON.stringify({ keys: [{ ...JSON.parse(keys.privateJwk), kid: keys.kid }] }),
          publicOrigin,
        ),
    ).toThrow();
    expect(
      () => new WebCryptoCredentials('absent', keys.privateJwk, keys.jwks, publicOrigin),
    ).toThrow();
    expect(
      () => new WebCryptoCredentials(keys.kid, keys.privateJwk, '{"keys":[]}', publicOrigin),
    ).toThrow();
    expect(
      () =>
        new WebCryptoCredentials(
          keys.kid,
          keys.privateJwk,
          JSON.stringify({ keys: [...JSON.parse(keys.jwks).keys, ...JSON.parse(keys.jwks).keys] }),
          publicOrigin,
        ),
    ).toThrow();
  });
});
