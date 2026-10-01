import { readFile, writeFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName } from 'pdf-lib';
import { chromium } from 'playwright';

const assetRoot = 'public/certificate-assets/pdf-v1';
const manifest = { fonts: {}, templates: {} };
const fonts = await Promise.all(
  ['atkinson-regular.ttf', 'familjen-bold.ttf'].map(async (name) =>
    (await readFile(`${assetRoot}/${name}`)).toString('base64'),
  ),
);
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
    : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
});
try {
  const page = await browser.newPage();
  for (const templateId of ['program-v1', 'talk-v1']) {
    const source = await readFile(
      `src/modules/certificates/presentation/templates/${templateId}.html`,
      'utf8',
    );
    const assetBytes = Object.fromEntries(
      await Promise.all(
        [...source.matchAll(/src="(\/certificate-assets\/[^"]+)"/g)].map(async (match) => [
          match[1],
          await readFile(`public${match[1]}`),
        ]),
      ),
    );
    const html = source
      .replace(/<link[^>]+>/g, '')
      .replace(/src="(\/certificate-assets\/[^"]+)"/g, (_, path) => {
        const extension = path.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
        return `src="data:${extension};base64,${Buffer.from(assetBytes[path]).toString('base64')}"`;
      })
      .replace(/\{\{recipientFontSize\}\}/g, '85')
      .replace(/\{\{courseFontSize\}\}/g, '38')
      .replace(/\{\{[a-zA-Z]+\}\}/g, '')
      .replace(
        '</style>',
        `@font-face{font-family:'Atkinson Hyperlegible Next';font-weight:400;src:url(data:font/ttf;base64,${fonts[0]})}@font-face{font-family:'Familjen Grotesk';font-weight:700;src:url(data:font/ttf;base64,${fonts[1]})}.verification{height:49px}</style>`,
      );
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const bytes = await page.pdf({
      width: '11in',
      height: '8.5in',
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const pdf = await PDFDocument.load(bytes);
    pdf.registerFontkit(fontkit);
    const pdfPage = pdf.getPages()[0];
    for (const [index, name] of ['Body', 'Heading'].entries()) {
      const font = await pdf.embedFont(Buffer.from(fonts[index], 'base64'));
      pdfPage.node.setFontDictionary(PDFName.of(`Squai${name}`), font.ref);
      manifest.fonts[name] = {
        ascent: font.heightAtSize(1, { descender: false }),
        characters: Object.fromEntries(
          font.getCharacterSet().map((codePoint) => {
            const character = String.fromCodePoint(codePoint);
            return [
              character,
              [font.encodeText(character).asString(), font.widthOfTextAtSize(character, 1)],
            ];
          }),
        ),
      };
    }
    pdf.setTitle('Certificado Squai');
    const prepared = await pdf.save({ useObjectStreams: false });
    const contents = pdfPage.node.get(PDFName.of('Contents')).toString();
    const previousXref = Number(
      Buffer.from(prepared)
        .toString('latin1')
        .match(/startxref\s+(\d+)\s+%%EOF\s*$/)[1],
    );
    manifest.templates[templateId] = {
      byteLength: prepared.length,
      pageId: pdfPage.ref.objectNumber,
      pageDictionary: pdfPage.node
        .toString()
        .replace(contents, `[${contents.slice(1, -1)} {{content}}]`)
        .replace(/\/Annots\s*\[[^\]]*\]/, '/Annots [{{link}}]'),
      nextId: pdf.context.largestObjectNumber + 1,
      root: pdf.context.trailerInfo.Root.toString(),
      previousXref,
    };
    await writeFile(`${assetRoot}/${templateId}.pdf`, prepared);
    console.log(`Exported Letter template: ${templateId}`);
  }
  await writeFile(
    'src/modules/certificates/presentation/templates/pdf-manifest.json',
    JSON.stringify(manifest),
  );
} finally {
  await browser.close();
}
