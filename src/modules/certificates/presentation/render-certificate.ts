import type { TemplateId, VerifiedCertificate } from '../domain/certificate';
import program from './templates/program-v1.html';
import talk from './templates/talk-v1.html';

const templates: Record<TemplateId, string> = { 'program-v1': program, 'talk-v1': talk };

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

function fontSize(value: string, maximum: number, minimum: number, lines: number): string {
  const width = [...value].reduce((total, character) => {
    if (/\s|[ilI.,'!]/u.test(character)) return total + 0.35;
    if (/[MWmw@#%&]/u.test(character)) return total + 1.05;
    if (/[A-Z]/u.test(character)) return total + 0.85;
    if (/\p{Script=Latin}/u.test(character)) return total + 0.65;
    return total + 1.2;
  }, 0);
  return Math.max(minimum, Math.min(maximum, Math.floor((680 * lines) / width))).toString();
}

export function renderCertificate(certificate: VerifiedCertificate): string {
  const data = certificate.record.payload.data;
  const values: Record<string, string> = {
    recipientName: data.recipientName,
    courseName: data.courseName,
    completedOn: new Intl.DateTimeFormat('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${data.completedOn}T00:00:00Z`)),
    verificationUrl: certificate.verificationUrl,
    recipientFontSize: fontSize(data.recipientName, 85, 24, 1),
    courseFontSize: fontSize(data.courseName, 38, 22, 2),
  };
  return templates[certificate.record.payload.templateId].replace(
    /\{\{([a-zA-Z]+)\}\}/g,
    (_, name: string) => {
      const value = values[name];
      if (value === undefined) throw new Error('Unknown template placeholder');
      return escapeHtml(value);
    },
  );
}
