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
];

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
        const context = await browser.newContext({ viewport: device, deviceScaleFactor: 2 });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${base}/verify/${hash}`);
        await page.waitForFunction(
          () =>
            document.querySelector('.document')?.getAttribute('aria-busy') === 'false' &&
            !document.querySelector<HTMLCanvasElement>('#certificate')?.hidden,
        );
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
          };
        });
        expect(layout.fits, `${templateId} ${device.name} overflow`).toBe(true);
        expect(layout.fullPageVisible).toBe(true);
        expect(layout.ratio).toBeCloseTo(792 / 612, 2);
        expect(layout.hasContent).toBe(true);
        expect(layout.pluginElements).toBe(0);
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
