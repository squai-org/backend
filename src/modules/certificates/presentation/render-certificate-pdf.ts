import type { VerifiedCertificate } from '../domain/certificate';
import { appendPdfContent } from './pdf-document';
import { fitPdfText, type PdfFont, type PdfTextBox, textWidth } from './pdf-text';
import manifest from './templates/pdf-manifest.json';

export type PdfAssetLoader = (path: string) => Promise<ArrayBuffer>;
const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function drawTextBox(
  content: string[],
  fontName: 'Body' | 'Heading',
  value: string,
  box: PdfTextBox & { x: number; top: number; centered: boolean },
  color: string,
) {
  const font: PdfFont = manifest.fonts[fontName];
  const { lines, size, lineHeight } = fitPdfText(value, font, box);
  const blockHeight = lines.length * lineHeight;
  const ascent = font.ascent * size;
  for (const [index, line] of lines.entries()) {
    const offset = box.centered ? (box.width - textWidth(line, font, size)) / 2 : 0;
    const glyphs = [...line].map((character) => font.characters[character]?.[0]).join('');
    const y = box.top - (box.height - blockHeight) / 2 - ascent - index * lineHeight;
    content.push(
      `BT /Squai${fontName} ${size} Tf ${color} rg 1 0 0 1 ${(box.x + offset).toFixed(3)} ${y.toFixed(3)} Tm <${glyphs}> Tj ET`,
    );
  }
}

export async function renderCertificatePdf(
  certificate: VerifiedCertificate,
  loadAsset: PdfAssetLoader,
): Promise<Uint8Array> {
  const assetRoot = '/certificate-assets/pdf-v1';
  const templateId = certificate.record.payload.templateId;
  const template = await loadAsset(`${assetRoot}/${templateId}.pdf`);
  const content: string[] = ['q'];
  const data = certificate.record.payload.data;
  const ink = '0.03922 0.04706 0.10196';
  const muted = '0.37255 0.39608 0.47843';
  drawTextBox(
    content,
    'Heading',
    data.recipientName,
    {
      x: 126,
      top: 424.5,
      width: 540,
      height: 84,
      maximumSize: 63.75,
      minimumSize: 18,
      centered: true,
    },
    ink,
  );
  drawTextBox(
    content,
    'Heading',
    data.courseName,
    {
      x: 126,
      top: 303,
      width: 540,
      height: 72,
      maximumSize: 28.5,
      minimumSize: 16.5,
      centered: true,
    },
    ink,
  );
  const date = dateFormatter.format(new Date(`${data.completedOn}T00:00:00Z`));
  drawTextBox(
    content,
    'Body',
    date,
    { x: 126, top: 219, width: 540, height: 18, maximumSize: 12, minimumSize: 12, centered: true },
    muted,
  );
  drawTextBox(
    content,
    'Body',
    certificate.verificationUrl,
    { x: 543, top: 47, width: 195, height: 29, maximumSize: 7.5, minimumSize: 5, centered: false },
    muted,
  );
  content.push('Q');
  return appendPdfContent(
    new Uint8Array(template),
    manifest.templates[templateId],
    content.join('\n'),
    certificate.verificationUrl,
    certificate.record.issuedAt,
  );
}
