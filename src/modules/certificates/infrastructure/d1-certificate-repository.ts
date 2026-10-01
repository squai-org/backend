import { canonicalJson } from '../../../shared/canonical-json';
import { ApplicationError } from '../../../shared/errors';
import type { CertificateRepository } from '../application/ports';
import type { CertificatePayload, CertificateRecord } from '../domain/certificate';

interface CertificateRow {
  hash: string;
  payload_json: string;
  signature: string;
  key_id: string;
  issued_at: string;
  credential_jwt: string;
  template_id: string;
}

function toRecord(row: CertificateRow): CertificateRecord {
  let payload: CertificatePayload;
  try {
    payload = JSON.parse(row.payload_json) as CertificatePayload;
    if (row.template_id !== payload?.templateId) throw new Error('Template metadata mismatch');
  } catch {
    throw new ApplicationError('CERTIFICATE_INTEGRITY_FAILED');
  }
  return {
    hash: row.hash,
    payload,
    signature: row.signature,
    keyId: row.key_id,
    issuedAt: row.issued_at,
    credentialJwt: row.credential_jwt,
  };
}

export class D1CertificateRepository implements CertificateRepository {
  constructor(private readonly database: D1Database) {}

  async find(hash: string): Promise<CertificateRecord | null> {
    const row = await this.database
      .prepare(
        'SELECT hash, payload_json, signature, key_id, issued_at, credential_jwt, template_id FROM certificates WHERE hash = ?',
      )
      .bind(hash)
      .first<CertificateRow>();
    return row ? toRecord(row) : null;
  }

  async insert(
    record: CertificateRecord,
  ): Promise<{ record: CertificateRecord; created: boolean }> {
    const results = await this.database.batch([
      this.database
        .prepare(
          'INSERT INTO certificates (hash, payload_json, signature, key_id, issued_at, credential_jwt, template_id) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(hash) DO NOTHING',
        )
        .bind(
          record.hash,
          canonicalJson(record.payload),
          record.signature,
          record.keyId,
          record.issuedAt,
          record.credentialJwt,
          record.payload.templateId,
        ),
      this.database
        .prepare(
          'SELECT hash, payload_json, signature, key_id, issued_at, credential_jwt, template_id FROM certificates WHERE hash = ?',
        )
        .bind(record.hash),
    ]);
    const row = results[1]?.results[0] as CertificateRow | undefined;
    if (!row) throw new Error('Certificate insert failed');
    return { record: toRecord(row), created: results[0]?.meta.changes === 1 };
  }
}
