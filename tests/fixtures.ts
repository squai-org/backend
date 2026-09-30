import type { IssueCertificateInput } from '../src/modules/certificates/domain/certificate';
import { WebCryptoCredentials } from '../src/modules/certificates/infrastructure/web-crypto-credentials';

export const publicOrigin = 'https://www.verify.squai.io';
export const issuer = { id: 'https://squai.io', name: 'Squai S.A.S.' };
export const input: IssueCertificateInput = {
  templateId: 'program-v1',
  data: {
    subjectId: 'urn:uuid:63dfcaba-e0cd-45fd-98a2-b596fe87c183',
    recipientName: 'José Sebastián Rico',
    courseName: 'Fundamentos de Inteligencia Artificial',
    completedOn: '2026-09-30',
  },
};

export async function createKeys(kid = 'test-key') {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const jwks = JSON.stringify({ keys: [{ ...publicJwk, kid }] });
  return {
    pair,
    privateJwk,
    jwks,
    kid,
    cryptography: new WebCryptoCredentials(kid, privateJwk, jwks, publicOrigin),
  };
}
