import { canonicalJson } from '../../../shared/canonical-json';
import { ApplicationError } from '../../../shared/errors';
import type { CertificateRecord, VerifiedCertificate } from '../domain/certificate';
import { parseIssueInput } from '../domain/validation';
import { createCredential } from './credential';
import type { CertificateRepository, CredentialCryptography } from './ports';

export class VerifyCertificate {
  constructor(
    private readonly repository: CertificateRepository,
    private readonly cryptography: CredentialCryptography,
    private readonly publicOrigin: string,
    private readonly issuer: { id: string; name: string },
  ) {}

  async execute(hash: string): Promise<VerifiedCertificate> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new ApplicationError('INVALID_CERTIFICATE_HASH');
    const record = await this.repository.find(hash);
    if (!record) throw new ApplicationError('CERTIFICATE_NOT_FOUND');
    return this.verifyRecord(record, hash);
  }

  async verifyRecord(
    record: CertificateRecord,
    requestedHash = record.hash,
  ): Promise<VerifiedCertificate> {
    try {
      if (
        record.hash !== requestedHash ||
        record.payload.version !== 1 ||
        canonicalJson(record.payload.issuer) !== canonicalJson(this.issuer)
      )
        throw new Error('Invalid metadata');
      const input = parseIssueInput({
        templateId: record.payload.templateId,
        data: record.payload.data,
      });
      const expectedPayload = { version: 1, issuer: this.issuer, ...input };
      if (canonicalJson(expectedPayload) !== canonicalJson(record.payload))
        throw new Error('Invalid payload');
      const hash = await this.cryptography.digest(canonicalJson(record.payload));
      if (
        hash !== requestedHash ||
        !(await this.cryptography.verifyHash(hash, record.signature, record.keyId))
      )
        throw new Error('Invalid signature');
      if (
        !Number.isFinite(Date.parse(record.issuedAt)) ||
        new Date(record.issuedAt).toISOString() !== record.issuedAt
      )
        throw new Error('Invalid issuance date');
      const verificationUrl = `${this.publicOrigin}/verify/${hash}`;
      const credential = createCredential(record, verificationUrl);
      const signedCredential = await this.cryptography.verifyCredential(
        record.credentialJwt,
        record.keyId,
      );
      if (canonicalJson(signedCredential) !== canonicalJson(credential))
        throw new Error('Invalid credential');
      return { record, credential, verificationUrl };
    } catch {
      throw new ApplicationError('CERTIFICATE_INTEGRITY_FAILED');
    }
  }
}
