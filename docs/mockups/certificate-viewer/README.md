# Propuesta de visualización de certificados

Mockup aislado en `design/certificate-viewer-mockup`. No modifica rutas, módulos, datos, build ni archivos servidos por el Worker. Abrir `index.html` localmente o con un servidor estático; `docs/` no forma parte de los assets de producción.

Referencia: `squai-org/landing` en su rama principal, componentes Header, Logo, Waitlist y estilos globales. Navbar oscuro con la geometría de la landing, un único CTA «Sigue aprendiendo», Familjen Grotesk, Atkinson Hyperlegible Next y Gloria Hallelujah. El CTA dirige a `https://squai.io`.

El documento ocupa una tarjeta redondeada y mantiene su proporción completa. Los bento muestran destinatario, programa, fecha, emisor y código. Descargar tiene prioridad; Ver en grande permite leer el documento pequeño en móvil. El código puede copiarse. Datos y PDF son de ejemplo, sin consultas a producción.

El diseño fue aprobado. Su implementación está en `src/modules/certificates/presentation/`: renderiza metadatos del registro verificado y carga el PDF desde `api.squai.io` mediante PDF.js. Los archivos de este directorio conservan la propuesta estática original con datos de ejemplo; no se sirven en producción.

La restricción de no hacer scroll obliga a reducir la vista del documento en pantallas pequeñas; los datos clave siguen disponibles como texto. El certificado se muestra completo. En móvil el código se abrevia visualmente y Copiar conserva los 64 caracteres; destinatario, programa, fecha y emisor permanecen visibles.

Los archivos de fuente proceden de la landing; sus familias usan SIL Open Font License. Se incluyen las licencias y la atribución en `assets/`.
