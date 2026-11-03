import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, expect, test } from 'vitest';
import { IssueCertificate } from '../../src/modules/certificates/application/issue-certificate';
import { VerifyCertificate } from '../../src/modules/certificates/application/verify-certificate';
import type {
  CertificateRecord,
  VerifiedCertificate,
} from '../../src/modules/certificates/domain/certificate';
import { fitPdfText, textWidth } from '../../src/modules/certificates/presentation/pdf-text';
import {
  escapeHtml,
  renderCertificate,
} from '../../src/modules/certificates/presentation/render-certificate';
import { renderCertificatePdf } from '../../src/modules/certificates/presentation/render-certificate-pdf';
import { renderPdfViewer } from '../../src/modules/certificates/presentation/render-pdf-viewer';
import manifest from '../../src/modules/certificates/presentation/templates/pdf-manifest.json';
import { createKeys, input, issuer, publicOrigin } from '../fixtures';

let certificate: VerifiedCertificate;
const loadAsset = async (path: string) => new Uint8Array(await readFile(`public${path}`)).buffer;

beforeAll(async () => {
  const records = new Map<string, CertificateRecord>();
  const repository = {
    find: async (hash: string) => records.get(hash) ?? null,
    insert: async (record: CertificateRecord) => {
      records.set(record.hash, record);
      return { record, created: true };
    },
  };
  const { cryptography } = await createKeys();
  const verify = new VerifyCertificate(repository, cryptography, publicOrigin, issuer);
  const issue = new IssueCertificate(
    repository,
    cryptography,
    { now: () => new Date('2026-10-01T12:00:00Z') },
    verify,
    publicOrigin,
    issuer,
  );
  certificate = (await issue.execute(input)).certificate;
});

test('PDF embeds the local fonts, contains one Letter page and no editable form fields', async () => {
  const bytes = await renderCertificatePdf(certificate, loadAsset);
  const pdf = await PDFDocument.load(bytes);
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPages()[0]?.getSize()).toEqual({ width: 792, height: 612 });
  expect(pdf.getSubject()).toContain(certificate.verificationUrl);
  expect(pdf.getForm().getFields()).toEqual([]);
  expect(pdf.getCreationDate()?.toISOString()).toBe(certificate.record.issuedAt);
});

test.each(['program-v1', 'talk-v1', 'training-v1'] as const)(
  'PDF %s exposes one clickable link to the verification URL over the printed URL',
  async (templateId) => {
    const target = structuredClone(certificate);
    target.record.payload.templateId = templateId;
    const bytes = await renderCertificatePdf(target, loadAsset);
    const task = getDocument({ data: bytes });
    const document = await task.promise;
    const annotations = (await (await document.getPage(1)).getAnnotations()).filter(
      (annotation) => annotation.subtype === 'Link',
    );
    expect(annotations).toHaveLength(1);
    const [link] = annotations;
    expect(link?.url).toBe(certificate.verificationUrl);
    expect(link?.annotationFlags & 4).toBe(4);
    const [left = 0, bottom = 0, right = 0, top = 0] = link?.rect ?? [];
    expect(left).toBeLessThanOrEqual(543);
    expect(right).toBeGreaterThanOrEqual(738);
    expect(bottom).toBeLessThanOrEqual(25);
    expect(top).toBeGreaterThanOrEqual(58);
    expect(right).toBeLessThanOrEqual(792);
    expect(top).toBeLessThanOrEqual(612);
    await task.destroy();
  },
);

test('PDF link rejects non-ASCII URLs and escapes PDF string delimiters', async () => {
  const target = structuredClone(certificate);
  target.verificationUrl = 'https://squai.io/verify/ñ';
  await expect(renderCertificatePdf(target, loadAsset)).rejects.toThrow('printable ASCII');
  target.verificationUrl = 'https://squai.io/verify/a(b)c\\d';
  const bytes = await renderCertificatePdf(target, loadAsset);
  expect(new TextDecoder('latin1').decode(bytes)).toContain(
    '/URI (https://squai.io/verify/a\\(b\\)c\\\\d)',
  );
});

test('PDF fits long names and course titles without changing signed text', async () => {
  const font = manifest.fonts.Heading;
  for (const value of [
    'José Sebastián Rico',
    'W'.repeat(80),
    'Fundamentos de Inteligencia Artificial '.repeat(2),
    'A'.repeat(100),
  ]) {
    const box = { width: 540, height: 84, maximumSize: 63.75, minimumSize: 18 };
    const result = fitPdfText(value, font, box);
    expect(result.lines.join('').replaceAll(' ', '')).toBe(value.replaceAll(' ', ''));
    expect(result.lines.length * result.lineHeight).toBeLessThanOrEqual(box.height);
    for (const line of result.lines)
      expect(textWidth(line, font, result.size)).toBeLessThanOrEqual(box.width);
  }
});

test('PDF renderer fails rather than silently omitting unsupported glyphs or overflowing text', async () => {
  const font = manifest.fonts.Heading;
  const box = { width: 1, height: 1, maximumSize: 12, minimumSize: 12 };
  expect(() => fitPdfText('Certificate', font, box)).toThrow('exceeds');
  expect(() => fitPdfText('李', font, box)).toThrow('does not support');
});

test('PDF renderer rejects a broken or incorrectly sized template', async () => {
  const invalid = await PDFDocument.create();
  invalid.addPage([612, 792]);
  const bytes = new Uint8Array(await invalid.save()).buffer;
  await expect(
    renderCertificatePdf(certificate, async (path) =>
      path.endsWith('.pdf') ? bytes : loadAsset(path),
    ),
  ).rejects.toThrow('Invalid prepared PDF');
  const broken = new Uint8Array(await loadAsset('/certificate-assets/pdf-v1/program-v1.pdf'));
  broken[0] = 0;
  await expect(renderCertificatePdf(certificate, async () => broken.buffer)).rejects.toThrow(
    'Invalid prepared PDF',
  );
  await expect(
    renderCertificatePdf(certificate, async () => {
      throw new Error('Missing asset');
    }),
  ).rejects.toThrow('Missing asset');
});

test('viewer displays verified metadata and document links without constituent certificate images', () => {
  const html = renderPdfViewer(certificate);
  expect(html).toContain(`/api/v1/certificates/${certificate.record.hash}/pdf?download=1`);
  expect(html).toContain('<meta name="viewport"');
  expect(html).toContain(input.data.recipientName);
  expect(html).toContain(input.data.courseName);
  expect(html).not.toMatch(/<iframe|<input|<form/i);
  expect(html).toContain('src="/brand/mark.svg"');
  expect(html).toContain('src="/certificate-viewer/viewer.js"');
});

test('original versioned HTML templates remain intact and escape dynamic text', () => {
  const original = structuredClone(certificate);
  original.record.payload.data.recipientName = '<script>a&"b\'c</script>';
  expect(renderCertificate(original)).toContain('&lt;script&gt;a&amp;&quot;b&#39;c&lt;/script&gt;');
  original.record.payload.templateId = 'talk-v1';
  expect(renderCertificate(original)).toContain('asistió a la charla');
  expect(escapeHtml('José')).toBe('José');
});
