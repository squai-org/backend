import { beforeEach, expect, test, vi } from 'vitest';

let click;
let button;
let status;
const hash = '0123456789abcdef'.repeat(4);

beforeEach(() => {
  vi.resetModules();
  button = {
    textContent: 'Copiar',
    addEventListener: (_type, handler) => {
      click = handler;
    },
  };
  status = { textContent: '' };
  vi.stubGlobal('document', {
    querySelector: (selector) =>
      ({
        '#copy-code': button,
        '#verification-code': { dataset: { code: hash }, textContent: '0123456789ab…89abcdef' },
        '#copy-status': status,
      })[selector],
  });
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

test('copies the complete verification hash rather than its mobile abbreviation', async () => {
  await import('../../src/modules/certificates/presentation/browser/copy-code.mjs');
  await click();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(hash);
  expect(button.textContent).toBe('Copiado');
  expect(status.textContent).toBe('Código completo copiado');
});

test('announces clipboard denial without changing the document or code', async () => {
  navigator.clipboard.writeText.mockRejectedValue(new Error('Permission denied'));
  await import('../../src/modules/certificates/presentation/browser/copy-code.mjs');
  await click();
  expect(button.textContent).toBe('Sin permiso');
  expect(status.textContent).toContain('PDF');
  expect(document.querySelector('#verification-code').dataset.code).toBe(hash);
});
