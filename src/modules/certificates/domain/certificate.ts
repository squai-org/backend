export const templateIds = ['program-v1', 'talk-v1'] as const;
export type TemplateId = (typeof templateIds)[number];

export interface Achievement {
  subjectId: string;
  recipientName: string;
  courseName: string;
  completedOn: string;
}

export interface IssueCertificateInput {
  templateId: TemplateId;
  data: Achievement;
}

export interface CertificatePayload extends IssueCertificateInput {
  version: 1;
  issuer: { id: string; name: string };
}

export interface CertificateRecord {
  hash: string;
  payload: CertificatePayload;
  signature: string;
  keyId: string;
  issuedAt: string;
  credentialJwt: string;
}

export interface VerifiableCredential {
  '@context': ['https://www.w3.org/ns/credentials/v2', Record<string, unknown>];
  id: string;
  type: ['VerifiableCredential', 'SquaiAchievementCredential'];
  issuer: { id: string; name: string };
  validFrom: string;
  credentialSubject: Omit<Achievement, 'subjectId'> & { id: string };
  templateId: TemplateId;
  certificateHash: string;
}

export interface VerifiedCertificate {
  record: CertificateRecord;
  credential: VerifiableCredential;
  verificationUrl: string;
}
