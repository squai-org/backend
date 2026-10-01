export interface PreparedPdfTemplate {
  byteLength: number;
  pageId: number;
  pageDictionary: string;
  nextId: number;
  root: string;
  previousXref: number;
}

function pdfString(value: string): string {
  let hex = 'feff';
  for (let index = 0; index < value.length; index++)
    hex += value.charCodeAt(index).toString(16).padStart(4, '0');
  return `<${hex}>`;
}

export function appendPdfContent(
  template: Uint8Array,
  manifest: PreparedPdfTemplate,
  content: string,
  verificationUrl: string,
  issuedAt: string,
): Uint8Array {
  if (
    template.length !== manifest.byteLength ||
    new TextDecoder().decode(template.subarray(0, 5)) !== '%PDF-'
  )
    throw new Error('Invalid prepared PDF template');
  const contentId = manifest.nextId;
  const linkId = contentId + 1;
  const infoId = contentId + 2;
  const pageDictionary = manifest.pageDictionary
    .replace('{{content}}', `${contentId} 0 R`)
    .replace('{{link}}', `${linkId} 0 R`);
  const creationDate = `D:${issuedAt.slice(0, 19).replace(/[-:T]/g, '')}Z`;
  const objects = [
    [manifest.pageId, pageDictionary],
    [contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    [
      linkId,
      `<< /Type /Annot /Subtype /Link /Rect [543 18 738 47] /Border [0 0 0] /A << /S /URI /URI ${pdfString(verificationUrl)} >> >>`,
    ],
    [
      infoId,
      `<< /Title ${pdfString('Certificado Squai')} /Subject ${pdfString(`Verificación: ${verificationUrl}`)} /CreationDate ${pdfString(creationDate)} /ModDate ${pdfString(creationDate)} >>`,
    ],
  ] as const;
  let appended = '\n';
  const offsets: number[] = [];
  for (const [id, body] of objects) {
    offsets.push(template.length + appended.length);
    appended += `${id} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = template.length + appended.length;
  const entries = offsets.map((offset) => `${offset.toString().padStart(10, '0')} 00000 n \n`);
  appended += `xref\n${manifest.pageId} 1\n${entries[0]}${contentId} 3\n${entries.slice(1).join('')}`;
  appended += `trailer\n<< /Size ${infoId + 1} /Root ${manifest.root} /Info ${infoId} 0 R /Prev ${manifest.previousXref} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const extra = new TextEncoder().encode(appended);
  const output = new Uint8Array(template.length + extra.length);
  output.set(template);
  output.set(extra, template.length);
  return output;
}
