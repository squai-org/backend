import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';

type Props = { kind: string; title: string; extension: string };

export function Files({ kind, title, extension }: Props) {
  const [names, setNames] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  const open = useCallback(
    async (name: string) => {
      const file = await api<{ content: string }>(`/files/${kind}/${name}`);
      setCurrent(name);
      setContent(file.content);
      setSaved(file.content);
    },
    [kind],
  );

  const loadList = useCallback(async () => {
    const list = await api<string[]>(`/files/${kind}`);
    setNames(list);
    return list;
  }, [kind]);

  useEffect(() => {
    setCurrent(null);
    setContent('');
    setSaved('');
    setError('');
    loadList().then((list) => {
      if (list[0]) open(list[0]);
    });
  }, [loadList, open]);

  async function guard(action: () => Promise<void>) {
    setError('');
    try {
      await action();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  const save = () =>
    guard(async () => {
      await api(`/files/${kind}/${current}`, 'PUT', { content });
      setSaved(content);
    });

  const create = () =>
    guard(async () => {
      const typed = window.prompt('Nombre en minúsculas, con guiones');
      if (!typed) return;
      const base = typed.trim().toLowerCase();
      const name = extension && !base.includes('.') ? `${base}${extension}` : base;
      await api(`/files/${kind}/${name}`, 'PUT', { content: '' });
      await loadList();
      await open(name);
    });

  const remove = () =>
    guard(async () => {
      if (!current || !window.confirm(`¿Eliminar ${current}?`)) return;
      await api(`/files/${kind}/${current}`, 'DELETE');
      setCurrent(null);
      setContent('');
      setSaved('');
      const list = await loadList();
      if (list[0]) await open(list[0]);
    });

  const dirty = content !== saved;

  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">{title}</h1>
        <div className="spacer" />
        {error && <span className="error-text">{error}</span>}
        {current && (
          <button type="button" className="destructive" onClick={remove}>
            Eliminar
          </button>
        )}
        <button type="button" onClick={create}>
          Nuevo
        </button>
        <button type="button" className="primary" disabled={!current || !dirty} onClick={save}>
          Guardar
        </button>
      </header>
      <div className="split">
        <div className="file-list">
          {names.map((name) => (
            <button
              key={name}
              type="button"
              className={`nav-item${name === current ? ' active' : ''}`}
              onClick={() => guard(() => open(name))}
            >
              {name}
            </button>
          ))}
        </div>
        {current ? (
          <textarea
            className="editor"
            spellCheck={false}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                event.preventDefault();
                if (dirty) save();
              }
            }}
          />
        ) : (
          <p className="empty">Nada seleccionado.</p>
        )}
      </div>
    </section>
  );
}
