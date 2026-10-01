import { ApplicationError } from '../../../shared/errors';
import {
  type Achievement,
  type IssueCertificateInput,
  type TemplateId,
  templateIds,
} from './certificate';

function objectWithKeys(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApplicationError('INVALID_INPUT');
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(object, key))
  ) {
    throw new ApplicationError('INVALID_INPUT');
  }
  return object;
}

function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.isWellFormed() ||
    value !== value.trim() ||
    value !== value.normalize('NFC') ||
    value.length < 1 ||
    [...value].length > max ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
  ) {
    throw new ApplicationError('INVALID_INPUT');
  }
  return value;
}

export function parseIssueInput(value: unknown): IssueCertificateInput {
  const input = objectWithKeys(value, ['templateId', 'data']);
  if (!templateIds.includes(input.templateId as TemplateId))
    throw new ApplicationError('INVALID_TEMPLATE');
  const data = objectWithKeys(input.data, [
    'subjectId',
    'recipientName',
    'courseName',
    'completedOn',
  ]);
  const subjectId = text(data.subjectId, 45);
  if (
    !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      subjectId,
    )
  )
    throw new ApplicationError('INVALID_SUBJECT_ID');
  const completedOn = text(data.completedOn, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(completedOn) ||
    !Number.isFinite(Date.parse(`${completedOn}T00:00:00Z`)) ||
    new Date(`${completedOn}T00:00:00Z`).toISOString().slice(0, 10) !== completedOn
  ) {
    throw new ApplicationError('INVALID_COMPLETION_DATE');
  }
  const achievement: Achievement = {
    subjectId,
    recipientName: text(data.recipientName, 80),
    courseName: text(data.courseName, 100),
    completedOn,
  };
  return { templateId: input.templateId as TemplateId, data: achievement };
}
