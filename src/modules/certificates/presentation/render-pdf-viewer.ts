import type { VerifiedCertificate } from '../domain/certificate';
import { escapeHtml } from './render-certificate';

export function renderPdfViewer(certificate: VerifiedCertificate, apiOrigin = ''): string {
  const { payload, hash } = certificate.record;
  const pdfUrl = escapeHtml(`${apiOrigin}/api/v1/certificates/${hash}/pdf`);
  const recipientName = escapeHtml(payload.data.recipientName);
  const courseName = escapeHtml(payload.data.courseName);
  const issuerName = escapeHtml(payload.issuer.name);
  const completedOn = escapeHtml(payload.data.completedOn);
  const date = new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .formatToParts(new Date(`${payload.data.completedOn}T00:00:00Z`))
    .filter((part) => ['day', 'month', 'year'].includes(part.type))
    .map((part) => part.value)
    .join(' ');
  const achievement =
    payload.templateId === 'program-v1' ? 'Programa completado' : 'Charla acreditada';
  const shortHash = `${hash.slice(0, 12)}…${hash.slice(-8)}`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Certificado verificado · Squai</title>
<link rel="icon" type="image/svg+xml" href="/brand/mark.svg">
<link rel="stylesheet" href="/certificate-viewer/viewer.css">
<script type="module" src="/certificate-viewer/viewer.js"></script>
</head>
<body>
<div id="verification">
<header class="navbar">
<a class="brand" href="https://squai.io" aria-label="Ir a Squai"><img src="/brand/mark.svg" alt="">Squai</a>
<a class="cta" href="https://squai.io"><span>Sigue aprendiendo</span><span aria-hidden="true">↗</span></a>
</header>
<section class="hero" aria-label="Verificación de certificado">
<h1>Tu aprendizaje, <span>con respaldo.</span></h1>
<p class="hand">Aprender en serio merece dejar huella.</p>
</section>
<main class="content">
<section class="document-card" aria-label="Certificado">
<div class="document-top"><span class="verified"><i aria-hidden="true"></i>Certificado verificado</span><span>Letter · 1 página</span></div>
<div class="document" aria-label="Certificado en PDF" aria-busy="true">
<canvas id="certificate" data-pdf-url="${pdfUrl}" role="img" aria-label="Certificado completo verificado. Descarga el PDF para leer su contenido con tecnologías de asistencia." hidden></canvas>
<p id="document-status" role="status">Cargando certificado…</p>
</div>
<nav class="actions" aria-label="Documento del certificado">
<a class="download" href="${pdfUrl}?download=1"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>Descargar PDF</a>
<a class="open" href="${pdfUrl}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/></svg>Ver en grande</a>
</nav>
</section>
<aside class="metadata" aria-label="Datos del certificado">
<section class="tile person wide"><span class="label">Certificado para</span><h2>${recipientName}</h2></section>
<section class="tile course wide"><span class="label">${achievement}</span><p>${courseName}</p></section>
<section class="tile date"><span class="label">Fecha</span><p><time datetime="${completedOn}">${escapeHtml(date)}</time></p></section>
<section class="tile issuer"><span class="label">Emisor</span><p>${issuerName}</p></section>
<section class="tile hash-tile wide">
<div class="hash-top"><span class="label">Código de verificación</span><button class="copy" type="button" id="copy-code" aria-label="Copiar el código completo de verificación">Copiar</button></div>
<p class="code" id="verification-code" data-code="${escapeHtml(hash)}" aria-label="${escapeHtml(hash)}"><span class="full-code">${escapeHtml(hash)}</span><span class="short-code" aria-hidden="true">${escapeHtml(shortHash)}</span></p>
<span class="signature">Firma digital verificada</span>
<output class="copy-status" role="status" id="copy-status" aria-live="polite"></output>
</section>
</aside>
</main>
</div>
<noscript class="noscript">Activa JavaScript para visualizar el certificado o utiliza Descargar PDF.</noscript>
</body>
</html>`;
}
