import type { CertificateRecord, VerifiableCredential } from '../domain/certificate';

export function createCredential(
  record: Pick<CertificateRecord, 'hash' | 'payload' | 'issuedAt'>,
  verificationUrl: string,
): VerifiableCredential {
  return {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      {
        '@protected': true,
        SquaiAchievementCredential: 'https://squai.io/credentials#SquaiAchievementCredential',
        recipientName: 'https://schema.org/name',
        courseName: 'https://squai.io/credentials#courseName',
        completedOn: {
          '@id': 'https://squai.io/credentials#completedOn',
          '@type': 'http://www.w3.org/2001/XMLSchema#date',
        },
        templateId: 'https://squai.io/credentials#templateId',
        certificateHash: 'https://squai.io/credentials#certificateHash',
      },
    ],
    id: verificationUrl,
    type: ['VerifiableCredential', 'SquaiAchievementCredential'],
    issuer: record.payload.issuer,
    validFrom: record.issuedAt,
    credentialSubject: {
      id: record.payload.data.subjectId,
      recipientName: record.payload.data.recipientName,
      courseName: record.payload.data.courseName,
      completedOn: record.payload.data.completedOn,
    },
    templateId: record.payload.templateId,
    certificateHash: record.hash,
  };
}
