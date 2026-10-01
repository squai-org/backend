import type { Bindings } from '../../platform/bindings';
import { IssueCertificate } from './application/issue-certificate';
import { VerifyCertificate } from './application/verify-certificate';
import { D1CertificateRepository } from './infrastructure/d1-certificate-repository';
import { WebCryptoCredentials } from './infrastructure/web-crypto-credentials';

function httpsOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password)
    throw new Error('Invalid public origin');
  return value;
}

function composeModule(bindings: Bindings) {
  const publicOrigin = httpsOrigin(bindings.PUBLIC_ORIGIN);
  const issuer = { id: httpsOrigin(bindings.ISSUER_ID), name: bindings.ISSUER_NAME };
  if (!issuer.name || issuer.name.length > 100) throw new Error('Invalid issuer name');
  const repository = new D1CertificateRepository(bindings.DB);
  const cryptography = new WebCryptoCredentials(
    bindings.SIGNING_KEY_ID,
    bindings.SIGNING_PRIVATE_KEY_JWK,
    bindings.VERIFICATION_KEYS_JWKS,
    publicOrigin,
  );
  const verify = new VerifyCertificate(repository, cryptography, publicOrigin, issuer);
  const issue = new IssueCertificate(
    repository,
    cryptography,
    { now: () => new Date() },
    verify,
    publicOrigin,
    issuer,
  );
  return { issue, verify, jwks: cryptography.jwks };
}

const modules = new WeakMap<Bindings, ReturnType<typeof composeModule>>();

export function certificatesModule(bindings: Bindings) {
  let module = modules.get(bindings);
  if (!module) {
    module = composeModule(bindings);
    modules.set(bindings, module);
  }
  return module;
}
