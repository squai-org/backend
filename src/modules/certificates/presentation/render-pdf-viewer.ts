import type { VerifiedCertificate } from '../domain/certificate';
import { escapeHtml } from './render-certificate';

export function renderPdfViewer(certificate: VerifiedCertificate, apiOrigin = ''): string {
  const pdfUrl = escapeHtml(`${apiOrigin}/api/v1/certificates/${certificate.record.hash}/pdf`);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Verificación de certificado · Squai</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#F4F6FF;color:#0A0C1A;font-family:Arial,sans-serif}main{width:min(100% - 24px,1200px);height:100svh;margin:0 auto;padding:16px 0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:12px}.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}.status{color:#25675e;margin:0;font-size:14px}.actions{display:flex;gap:8px;flex-wrap:wrap}.actions a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border-radius:999px;background:#0A0C1A;color:#fff;text-decoration:none;font-size:14px}.actions .secondary{background:#fff;color:#0A0C1A;border:1px solid #dce0f0}.actions a:focus-visible{outline:3px solid #7C8CFF;outline-offset:3px}.document{min-height:0;min-width:0;display:flex;align-items:center;justify-content:center;position:relative}.document canvas{display:block;max-width:100%;max-height:100%;box-shadow:0 8px 32px #0a0c1a15}.document canvas[hidden]{display:none}#document-status{text-align:center;font-size:14px;max-width:32ch}.help{font-size:12px;text-align:center;color:#5f657a;margin:0}@media(max-width:600px){main{padding:12px 0;gap:8px}.toolbar{justify-content:center}.status{text-align:center;width:100%}.actions a{padding:10px 16px}}@media(max-height:450px){main{padding:8px 0;gap:4px}.help{display:none}.toolbar{flex-wrap:nowrap}.status{width:auto}}
</style>
<script type="module" src="/certificate-viewer/viewer.js"></script>
</head>
<body><main>
<header class="toolbar">
<p class="status">Certificado verificado · Firma digital válida</p>
<nav class="actions" aria-label="Documento del certificado">
<a href="${pdfUrl}?download=1">Descargar PDF</a>
<a class="secondary" href="${pdfUrl}" target="_blank" rel="noopener noreferrer">Abrir PDF</a>
</nav>
</header>
<section class="document" aria-label="Certificado en PDF" aria-busy="true">
<canvas id="certificate" data-pdf-url="${pdfUrl}" role="img" aria-label="Certificado completo verificado. Descarga el PDF para leer su contenido con tecnologías de asistencia." hidden></canvas>
<p id="document-status" role="status">Cargando certificado…</p>
</section>
<p class="help">Documento completo en formato PDF · Usa la descarga para conservarlo.</p>
<noscript>Activa JavaScript para visualizar el certificado, o utiliza Descargar PDF.</noscript>
</main></body>
</html>`;
}
