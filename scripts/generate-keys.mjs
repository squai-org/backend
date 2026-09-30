import { webcrypto } from 'node:crypto';

const pair = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
const publicKey = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
const privateKey = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
const kid = `squai-${new Date().toISOString().slice(0, 10)}-${webcrypto.randomUUID()}`;
console.log(
  JSON.stringify(
    {
      SIGNING_KEY_ID: kid,
      SIGNING_PRIVATE_KEY_JWK: JSON.stringify(privateKey),
      VERIFICATION_KEYS_JWKS: JSON.stringify({
        keys: [{ ...publicKey, kid, alg: 'EdDSA', use: 'sig' }],
      }),
      CERTIFICATE_ISSUANCE_TOKEN: Buffer.from(
        webcrypto.getRandomValues(new Uint8Array(32)),
      ).toString('base64url'),
    },
    null,
    2,
  ),
);
