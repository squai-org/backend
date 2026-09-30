export type ApplicationErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_TEMPLATE'
  | 'INVALID_SUBJECT_ID'
  | 'INVALID_COMPLETION_DATE'
  | 'INVALID_CERTIFICATE_HASH'
  | 'CERTIFICATE_NOT_FOUND'
  | 'CERTIFICATE_INTEGRITY_FAILED'
  | 'ISSUANCE_UNAVAILABLE'
  | 'UNAUTHORIZED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INVALID_JSON';

export class ApplicationError extends Error {
  constructor(public readonly code: ApplicationErrorCode) {
    super(code);
  }
}
