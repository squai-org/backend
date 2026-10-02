import { beforeEach, expect, test, vi } from 'vitest';

const pdf = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.mjs', () => pdf);
let canvas;
let container;
let status;
let render;

beforeEach(() => {
  vi.resetModules();
  canvas = { hidden: true, style: {}, dataset: { pdfUrl: 'https://api.squai.io/example.pdf' } };
  container = { clientWidth: 792, clientHeight: 612, setAttribute: vi.fn() };
  status = { hidden: false, textContent: '', setAttribute: vi.fn() };
  render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  vi.stubGlobal('window', { devicePixelRatio: 3 });
  vi.stubGlobal('getComputedStyle', () => ({
    paddingLeft: '0',
    paddingRight: '0',
    paddingTop: '0',
    paddingBottom: '0',
  }));
  vi.stubGlobal('document', {
    querySelector: (selector) =>
      ({ '#certificate': canvas, '.document': container, '#document-status': status })[selector],
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'application/pdf' } }),
    ),
  );
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: ({ scale }) => ({ width: 792 * scale, height: 612 * scale }),
        render,
      }),
    }),
  });
});

test('renders verified PDF bytes with a bounded pixel density and no credentials', async () => {
  await import('../../src/modules/certificates/presentation/browser/viewer.mjs');
  await vi.waitFor(() => expect(canvas.hidden).toBe(false));
  expect(fetch).toHaveBeenCalledWith(
    canvas.dataset.pdfUrl,
    expect.objectContaining({ credentials: 'omit', cache: 'no-store' }),
  );
  expect(canvas.width).toBe(1584);
  expect(canvas.height).toBe(1224);
  expect(pdf.getDocument).toHaveBeenCalledWith(
    expect.objectContaining({ isEvalSupported: false, useWasm: false }),
  );
  expect(status.hidden).toBe(true);
  expect(container.setAttribute).toHaveBeenCalledWith('aria-busy', 'false');
});

test.each(['http-error', 'wrong-content-type', 'invalid-pdf', 'multiple-pages', 'render-error'])(
  'offers a document fallback for %s',
  async (failure) => {
    if (failure === 'http-error')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 409 })),
      );
    if (failure === 'wrong-content-type')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('html')),
      );
    if (failure === 'invalid-pdf')
      pdf.getDocument.mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF')) });
    if (failure === 'multiple-pages')
      pdf.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2 }) });
    if (failure === 'render-error')
      render.mockReturnValue({
        promise: Promise.reject(new Error('Render failed')),
        cancel: vi.fn(),
      });
    await import('../../src/modules/certificates/presentation/browser/viewer.mjs');
    await vi.waitFor(() => expect(status.setAttribute).toHaveBeenCalledWith('role', 'alert'));
    expect(status.textContent).toContain('descargar el PDF');
    expect(canvas.hidden).toBe(true);
    expect(container.setAttribute).toHaveBeenCalledWith('aria-busy', 'false');
  },
);
