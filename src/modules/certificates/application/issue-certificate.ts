import { canonicalJson } from '../../../shared/canonical-json';
import type { CertificatePayload, VerifiedCertificate } from '../domain/certificate';
import { parseIssueInput } from '../domain/validation';
import { createCredential } from './credential';
import type { CertificateRepository, Clock, CredentialCryptography } from './ports';
import type { VerifyCertificate } from './verify-certificate';

export class IssueCertificate {
  constructor(
    private readonly repository: CertificateRepository,
    private readonly cryptography: CredentialCryptography,
    private readonly clock: Clock,
    private readonly verifier: VerifyCertificate,
    private readonly publicOrigin: string,
    private readonly issuer: { id: string; name: string },
  ) {}

  async execute(value: unknown): Promise<{ certificate: VerifiedCertificate; created: boolean }> {
    const input = parseIssueInput(value);
    const payload: CertificatePayload = { version: 1, issuer: this.issuer, ...input };
    const hash = await this.cryptography.digest(canonicalJson(payload));
    const existing = await this.repository.find(hash);
    if (existing)
      return { certificate: await this.verifier.verifyRecord(existing), created: false };
    const unsigned = { hash, payload, issuedAt: this.clock.now().toISOString() };
    const record = {
      ...unsigned,
      signature: await this.cryptography.signHash(hash),
      keyId: this.cryptography.activeKeyId,
      credentialJwt: await this.cryptography.signCredential(
        createCredential(unsigned, `${this.publicOrigin}/verify/${hash}`),
      ),
    };
    const stored = await this.repository.insert(record);
    return {
      certificate: await this.verifier.verifyRecord(stored.record),
      created: stored.created,
    };
  }
}
