import type { CertificateRecord, VerifiableCredential } from '../domain/certificate';

export interface CertificateRepository {
  find(hash: string): Promise<CertificateRecord | null>;
  insert(record: CertificateRecord): Promise<{ record: CertificateRecord; created: boolean }>;
}

export interface CredentialCryptography {
  readonly activeKeyId: string;
  digest(value: string): Promise<string>;
  signHash(hash: string): Promise<string>;
  verifyHash(hash: string, signature: string, keyId: string): Promise<boolean>;
  signCredential(credential: VerifiableCredential): Promise<string>;
  verifyCredential(jwt: string, keyId: string): Promise<unknown>;
}

export interface Clock {
  now(): Date;
}
