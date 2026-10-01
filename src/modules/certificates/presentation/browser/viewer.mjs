import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/build/pdf.mjs';

GlobalWorkerOptions.workerSrc = '/certificate-viewer/pdf.worker.js';
const canvas = document.querySelector('#certificate');
const container = document.querySelector('.document');
const status = document.querySelector('#document-status');
let page;
let renderTask;
let generation = 0;

async function fitDocument() {
  if (!page) return;
  const current = ++generation;
  if (renderTask) {
    renderTask.cancel();
    await renderTask.promise.catch(() => {});
  }
  if (current !== generation) return;
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(
    container.clientWidth / original.width,
    container.clientHeight / original.height,
  );
  const viewport = page.getViewport({ scale });
  const density = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(viewport.width * density));
  canvas.height = Math.max(1, Math.floor(viewport.height * density));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  renderTask = page.render({
    canvas,
    viewport,
    transform: density === 1 ? null : [density, 0, 0, density, 0, 0],
  });
  try {
    await renderTask.promise;
    if (current !== generation) return;
    canvas.hidden = false;
    status.hidden = true;
    container.setAttribute('aria-busy', 'false');
  } catch (error) {
    if (error.name !== 'RenderingCancelledException') throw error;
  }
}

async function loadDocument() {
  try {
    const response = await fetch(canvas.dataset.pdfUrl, {
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/pdf'))
      throw new Error('Document unavailable');
    const pdf = await getDocument({
      data: new Uint8Array(await response.arrayBuffer()),
      isEvalSupported: false,
      useWasm: false,
      useSystemFonts: false,
      isOffscreenCanvasSupported: false,
      stopAtErrors: true,
    }).promise;
    if (pdf.numPages !== 1) throw new Error('Unexpected document');
    page = await pdf.getPage(1);
    await fitDocument();
    new ResizeObserver(() => {
      fitDocument().catch(showError);
    }).observe(container);
  } catch {
    showError();
  }
}

function showError() {
  status.hidden = false;
  status.textContent = 'No pudimos mostrar el certificado. Puedes descargar el PDF o abrirlo.';
  status.setAttribute('role', 'alert');
  container.setAttribute('aria-busy', 'false');
}

loadDocument();
