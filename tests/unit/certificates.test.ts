import { beforeEach, describe, expect, it } from 'vitest';
import { IssueCertificate } from '../../src/modules/certificates/application/issue-certificate';
import type { CertificateRepository } from '../../src/modules/certificates/application/ports';
import { VerifyCertificate } from '../../src/modules/certificates/application/verify-certificate';
import type { CertificateRecord } from '../../src/modules/certificates/domain/certificate';
import { parseIssueInput } from '../../src/modules/certificates/domain/validation';
import { canonicalJson } from '../../src/shared/canonical-json';
import { createKeys, input, issuer, publicOrigin } from '../fixtures';

class MemoryRepository implements CertificateRepository {
  readonly records = new Map<string, CertificateRecord>();
  async find(hash: string) {
    return this.records.get(hash) ?? null;
  }
  async insert(record: CertificateRecord) {
    const existing = this.records.get(record.hash);
    if (existing) return { record: existing, created: false };
    this.records.set(record.hash, structuredClone(record));
    return { record, created: true };
  }
}

describe('certificate use cases', () => {
  let repository: MemoryRepository;
  let keys: Awaited<ReturnType<typeof createKeys>>;
  let verify: VerifyCertificate;
  let issue: IssueCertificate;

  beforeEach(async () => {
    repository = new MemoryRepository();
    keys = await createKeys();
    verify = new VerifyCertificate(repository, keys.cryptography, publicOrigin, issuer);
    issue = new IssueCertificate(
      repository,
      keys.cryptography,
      { now: () => new Date('2026-09-30T22:00:00.000Z') },
      verify,
      publicOrigin,
      issuer,
    );
  });

  it('issues deterministic authenticated metadata and an independently verifiable credential', async () => {
    const result = await issue.execute(input);
    expect(result.created).toBe(true);
    expect(result.certificate.record.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.certificate.credential.validFrom).toBe('2026-09-30T22:00:00.000Z');
    const hash = result.certificate.record.hash;
    const bytes = Uint8Array.from(hash.match(/../g) ?? [], (value) => Number.parseInt(value, 16));
    const signature = Uint8Array.from(
      atob(result.certificate.record.signature.replace(/-/g, '+').replace(/_/g, '/')),
      (character) => character.charCodeAt(0),
    );
    expect(await crypto.subtle.verify('Ed25519', keys.pair.publicKey, signature, bytes)).toBe(true);
    expect(await verify.execute(hash)).toEqual(result.certificate);
  });

  it('returns the original record for repeated issuance, independently of key order', async () => {
    const first = await issue.execute(input);
    const second = await issue.execute({
      data: {
        completedOn: input.data.completedOn,
        courseName: input.data.courseName,
        recipientName: input.data.recipientName,
        subjectId: input.data.subjectId,
      },
      templateId: input.templateId,
    });
    expect(second.created).toBe(false);
    expect(second.certificate).toEqual(first.certificate);
    expect(repository.records.size).toBe(1);
  });

  it('distinguishes subjects and template versions', async () => {
    const original = await issue.execute(input);
    const talk = await issue.execute({ ...input, templateId: 'talk-v1' });
    const other = await issue.execute({
      ...input,
      data: { ...input.data, subjectId: 'urn:uuid:73dfcaba-e0cd-45fd-98a2-b596fe87c183' },
    });
    expect(
      new Set([original, talk, other].map((result) => result.certificate.record.hash)).size,
    ).toBe(3);
  });

  it.each([
    'data',
    'template',
    'signature',
    'credential',
    'issuedAt',
    'keyId',
    'issuer',
    'version',
    'extra',
    'hash',
  ])('rejects tampered %s', async (field) => {
    const { certificate } = await issue.execute(input);
    const record = structuredClone(certificate.record);
    if (field === 'data') record.payload.data.recipientName = 'Someone Else';
    if (field === 'template') record.payload.templateId = 'talk-v1';
    if (field === 'signature') record.signature = 'A'.repeat(86);
    if (field === 'credential') record.credentialJwt += 'x';
    if (field === 'issuedAt') record.issuedAt = '2026-09-29T22:00:00.000Z';
    if (field === 'keyId') record.keyId = 'unknown';
    if (field === 'issuer') record.payload.issuer.id = 'https://attacker.example';
    if (field === 'version') Object.assign(record.payload, { version: 2 });
    if (field === 'extra') Object.assign(record.payload, { injected: true });
    if (field === 'hash') record.hash = '0'.repeat(64);
    repository.records.set(certificate.record.hash, record);
    await expect(verify.execute(certificate.record.hash)).rejects.toMatchObject({
      code: 'CERTIFICATE_INTEGRITY_FAILED',
    });
    await expect(issue.execute(input)).rejects.toMatchObject({
      code: 'CERTIFICATE_INTEGRITY_FAILED',
    });
  });

  it('rejects missing or malformed identifiers', async () => {
    await expect(verify.execute('invalid')).rejects.toMatchObject({
      code: 'INVALID_CERTIFICATE_HASH',
    });
    await expect(verify.execute('0'.repeat(64))).rejects.toMatchObject({
      code: 'CERTIFICATE_NOT_FOUND',
    });
  });

  it('handles concurrent issuance without overwriting an earlier record', async () => {
    const results = await Promise.all([
      issue.execute(input),
      issue.execute(input),
      issue.execute(input),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(repository.records.size).toBe(1);
    expect(results[0]?.certificate).toEqual(results[2]?.certificate);
  });
});

describe('strict input validation', () => {
  it('accepts the explicit achievement contract', () =>
    expect(parseIssueInput(input)).toEqual(input));
  it.each([
    null,
    [],
    {},
    { ...input, unknown: true },
    { ...input, templateId: '../../secret' },
    { ...input, data: { ...input.data, extra: true } },
    { ...input, data: { ...input.data, subjectId: 'student@example.com' } },
    { ...input, data: { ...input.data, completedOn: '2026-02-30' } },
    { ...input, data: { ...input.data, completedOn: '2026-13-01' } },
    { ...input, data: { ...input.data, completedOn: 'tomorrow' } },
    { ...input, data: { ...input.data, recipientName: '' } },
    { ...input, data: { ...input.data, recipientName: ' A ' } },
    { ...input, data: { ...input.data, recipientName: 'a'.repeat(81) } },
    { ...input, data: { ...input.data, recipientName: 'a\u0000b' } },
    { ...input, data: { ...input.data, recipientName: 'a\u202eb' } },
    { ...input, data: { ...input.data, recipientName: 'Jose\u0301' } },
    { ...input, data: { ...input.data, recipientName: 123 } },
    { ...input, data: { ...input.data, recipientName: '\ud800' } },
  ])('rejects invalid input %#', (value) => expect(() => parseIssueInput(value)).toThrow());
});

describe('canonical JSON', () => {
  it('sorts nested object keys without reordering arrays', () =>
    expect(canonicalJson({ z: true, a: [null, { z: 2, a: 'é' }] })).toBe(
      '{"a":[null,{"a":"é","z":2}],"z":true}',
    ));
  it.each([undefined, NaN, Infinity, new Date(), () => null, '\ud800'])(
    'rejects unsupported value %#',
    (value) => expect(() => canonicalJson(value)).toThrow(),
  );
});
