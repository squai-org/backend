const button = document.querySelector('#copy-code');
const code = document.querySelector('#verification-code');
const status = document.querySelector('#copy-status');

if (button && code && status) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.dataset.code);
      button.textContent = 'Copiado';
      status.textContent = 'Código completo copiado';
    } catch {
      button.textContent = 'Sin permiso';
      status.textContent = 'No se pudo copiar. Puedes consultar el código completo en el PDF.';
    }
  });
}
