import { chromium } from 'playwright';
import { expect, test } from 'vitest';
import { input } from '../fixtures';
import { createTestRuntime, token } from '../runtime';

const devices = [
  { name: 'small-phone', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'phone-landscape', width: 844, height: 390 },
] as const;

test('renders both complete PDFs without plugin controls or scrolling across devices', async () => {
  const { runtime } = await createTestRuntime();
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  try {
    const base = (await runtime.ready).origin;
    for (const templateId of ['program-v1', 'talk-v1']) {
      const issued = await runtime.dispatchFetch(`${base}/api/v1/certificates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, templateId }),
      });
      const { hash } = (await issued.json()) as { hash: string };
      for (const device of devices) {
        const context = await browser.newContext({
          viewport: device,
          deviceScaleFactor: 2,
          permissions: ['clipboard-read', 'clipboard-write'],
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        await page.goto(`${base}/verify/${hash}`);
        await page.waitForFunction(
          () =>
            document.querySelector('.document')?.getAttribute('aria-busy') === 'false' &&
            !document.querySelector<HTMLCanvasElement>('#certificate')?.hidden,
        );
        await page.evaluate(() => document.fonts.ready);
        expect(await page.locator('.person h2').textContent()).toBe(input.data.recipientName);
        expect(await page.locator('.course p').textContent()).toBe(input.data.courseName);
        expect(await page.locator('.course .label').textContent()).toBe(
          templateId === 'program-v1' ? 'Programa completado' : 'Charla acreditada',
        );
        expect(await page.locator('.cta').getAttribute('href')).toBe('https://squai.io');
        expect(await page.locator('.cta').textContent()).toContain('Sigue aprendiendo');
        await page
          .getByRole('button', { name: 'Copiar el código completo de verificación' })
          .click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(hash);
        const layout = await page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('#certificate');
          if (!canvas) throw new Error('Missing certificate');
          const rectangle = canvas.getBoundingClientRect();
          const pixels = canvas
            .getContext('2d')
            ?.getImageData(0, 0, canvas.width, canvas.height).data;
          return {
            fits:
              document.documentElement.scrollWidth <= innerWidth &&
              document.documentElement.scrollHeight <= innerHeight + 1,
            ratio: rectangle.width / rectangle.height,
            fullPageVisible:
              rectangle.top >= 0 &&
              rectangle.bottom <= innerHeight &&
              rectangle.left >= 0 &&
              rectangle.right <= innerWidth,
            hasContent: pixels?.some((value) => value !== 0),
            pluginElements: document.querySelectorAll('iframe,object,embed').length,
            metadataVisible: [
              ...document.querySelectorAll<HTMLElement>('.tile > p,.tile > h2,.tile > .label'),
            ].every((element) => {
              const bounds = element.getBoundingClientRect();
              const tile = element.closest('.tile')?.getBoundingClientRect();
              return (
                tile &&
                bounds.top >= tile.top - 1 &&
                bounds.bottom <= tile.bottom + 1 &&
                bounds.left >= tile.left - 1 &&
                bounds.right <= tile.right + 1
              );
            }),
            brandFontsLoaded:
              document.fonts.check('16px Familjen') &&
              document.fonts.check('16px Atkinson') &&
              document.fonts.check('16px Gloria'),
          };
        });
        expect(layout.fits, `${templateId} ${device.name} overflow`).toBe(true);
        expect(layout.fullPageVisible).toBe(true);
        expect(layout.ratio).toBeCloseTo(792 / 612, 2);
        expect(layout.hasContent).toBe(true);
        expect(layout.pluginElements).toBe(0);
        expect(layout.metadataVisible, `${templateId} ${device.name} metadata overflow`).toBe(true);
        expect(layout.brandFontsLoaded).toBe(true);
        expect(errors).toEqual([]);
        await page.screenshot({ path: `test-results/${templateId}-${device.name}.png` });
        const download = await page.request.get(
          `${base}/api/v1/certificates/${hash}/pdf?download=1`,
        );
        expect(download.headers()['content-disposition']).toContain('attachment;');
        expect((await download.body()).subarray(0, 5).toString()).toBe('%PDF-');
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await runtime.dispose();
  }
});

test('keeps long verified names and course titles within the mobile metadata cards', async () => {
  const { runtime } = await createTestRuntime();
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  try {
    const base = (await runtime.ready).origin;
    const data = {
      ...input.data,
      recipientName: 'María Alejandra Rodríguez Fernández de la Torre López y Martínez',
      courseName:
        'Fundamentos de Inteligencia Artificial y Aprendizaje Automático para la Innovación Empresarial',
    };
    const issued = await runtime.dispatchFetch(`${base}/api/v1/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, data }),
    });
    expect(issued.status).toBe(201);
    const { hash } = (await issued.json()) as { hash: string };
    const page = await browser.newPage({ viewport: devices[0] });
    await page.goto(`${base}/verify/${hash}`);
    await page.waitForFunction(
      () => !document.querySelector<HTMLCanvasElement>('#certificate')?.hidden,
    );
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => ({
      fits:
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight + 1,
      metadataVisible: [...document.querySelectorAll<HTMLElement>('.person h2,.course p')].every(
        (element) => {
          const bounds = element.getBoundingClientRect();
          const tile = element.closest('.tile')?.getBoundingClientRect();
          return tile && bounds.top >= tile.top && bounds.bottom <= tile.bottom;
        },
      ),
    }));
    expect(result.fits).toBe(true);
    expect(result.metadataVisible).toBe(true);
    expect(await page.locator('.person h2').textContent()).toBe(data.recipientName);
    expect(await page.locator('.course p').textContent()).toBe(data.courseName);
    await page.screenshot({ path: 'test-results/long-metadata-small-phone.png' });
  } finally {
    await browser.close();
    await runtime.dispose();
  }
});
