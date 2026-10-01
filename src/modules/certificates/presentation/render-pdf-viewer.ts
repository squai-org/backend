import type { VerifiedCertificate } from '../domain/certificate';

export function renderPdfViewer(certificate: VerifiedCertificate): string {
  const pdfPath = `/api/v1/certificates/${certificate.record.hash}/pdf`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Verificación de certificado · Squai</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#F4F6FF;color:#0A0C1A;font-family:Arial,sans-serif}main{width:min(100% - 32px,1200px);margin:24px auto}.status{display:block;margin:0 0 16px;color:#25675e;text-align:center}.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-bottom:16px}.actions a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:12px 20px;border-radius:8px;background:#0A0C1A;color:white;text-decoration:none}.actions a:focus-visible{outline:3px solid #7C8CFF;outline-offset:3px}.viewer{width:100%;height:clamp(420px,80vh,1000px);border:0;border-radius:12px;background:white}.help{line-height:1.5;text-align:center;color:#5f657a}@media(max-width:600px){main{width:calc(100% - 16px);margin:12px auto}.actions a{flex:1}.viewer{height:75vh;min-height:360px}}
</style>
</head>
<body><main>
<output class="status">Certificado verificado · Firma digital válida</output>
<nav class="actions" aria-label="Documento del certificado">
<a href="${pdfPath}?download=1" download>Descargar PDF</a>
<a href="${pdfPath}" target="_blank" rel="noopener noreferrer">Abrir PDF</a>
</nav>
<iframe class="viewer" title="Certificado en PDF" src="${pdfPath}#view=FitH" referrerpolicy="no-referrer"></iframe>
<p class="help">Si tu navegador no muestra el documento, utiliza Abrir PDF o Descargar PDF.</p>
</main></body>
</html>`;
}
