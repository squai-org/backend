import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { type AppStatus, api, type Item, Unauthorized } from './api.ts';
import { Automation } from './views/Automation.tsx';
import { Connections } from './views/Connections.tsx';
import { Calendar } from './views/Calendar.tsx';
import { Files } from './views/Files.tsx';
import { Inspector } from './views/Inspector.tsx';
import { Review } from './views/Review.tsx';

type View = 'calendario' | 'revision' | 'bases' | 'templates' | 'skills' | 'agents' | 'conexiones' | 'automatizacion';
export type Draft = { scheduled_at: string | null };

const NAV: { group: string; entries: { id: View; label: string }[] }[] = [
  {
    group: 'Contenido',
    entries: [
      { id: 'calendario', label: 'Calendario' },
      { id: 'revision', label: 'Revisión' },
    ],
  },
  {
    group: 'Bases',
    entries: [
      { id: 'bases', label: 'Documentos' },
      { id: 'templates', label: 'Templates' },
    ],
  },
  {
    group: 'Sistema',
    entries: [
      { id: 'skills', label: 'Skills' },
      { id: 'agents', label: 'Agentes' },
      { id: 'conexiones', label: 'Conexiones' },
      { id: 'automatizacion', label: 'Automatización' },
    ],
  },
];

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api('/login', 'POST', { password });
      onDone();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <form className="login" onSubmit={submit}>
      <h1>Contenido</h1>
      <input
        type="password"
        placeholder="Contraseña"
        value={password}
        autoFocus
        onChange={(event) => setPassword(event.target.value)}
      />
      <button className="primary" type="submit">
        Entrar
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [locked, setLocked] = useState(false);
  const returned = new URLSearchParams(window.location.search);
  const [view, setView] = useState<View>(returned.has('conexion') ? 'conexiones' : 'calendario');
  const [notice] = useState(returned.get('conexion') === 'error' ? (returned.get('motivo') ?? '') : '');
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await api<Item[]>('/items'));
      setLocked(false);
    } catch (failure) {
      if (failure instanceof Unauthorized) setLocked(true);
    }
  }, []);

  const boot = useCallback(async () => {
    try {
      setStatus(await api<AppStatus>('/status'));
      setLocked(false);
      await refresh();
    } catch (failure) {
      if (failure instanceof Unauthorized) setLocked(true);
    }
  }, [refresh]);

  useEffect(() => {
    boot();
    if (window.location.search) window.history.replaceState(null, '', '/');
  }, [boot]);

  useEffect(() => {
    if (locked || !status) return;
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, [locked, status, refresh]);

  if (locked) return <Login onDone={boot} />;
  if (!status) return null;

  const pending = items.filter((item) => item.status === 'revision').length;
  const open = (id: string) => {
    setDraft(null);
    setSelected(id);
  };
  const close = () => {
    setSelected(null);
    setDraft(null);
  };
  const inspecting = selected !== null || draft !== null;

  return (
    <div className={`shell${inspecting ? ' with-inspector' : ''}`}>
      <nav className="sidebar">
        <div className="brand">Contenido</div>
        {NAV.map((section) => (
          <div key={section.group} className="nav-group">
            <div className="nav-title">{section.group}</div>
            {section.entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`nav-item${view === entry.id ? ' active' : ''}`}
                onClick={() => setView(entry.id)}
              >
                <span>{entry.label}</span>
                {entry.id === 'revision' && pending > 0 && <span className="badge">{pending}</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">
          <span className={`dot ${status.instagram ? 'ok' : 'off'}`} />
          {status.instagram ? 'Instagram conectado' : 'Instagram sin conectar'}
        </div>
      </nav>
      <main className="content">
        {view === 'calendario' && (
          <Calendar
            items={items}
            selected={selected}
            onOpen={open}
            onCreate={(scheduled_at) => {
              setSelected(null);
              setDraft({ scheduled_at });
            }}
            onChanged={refresh}
          />
        )}
        {view === 'revision' && <Review items={items} selected={selected} onOpen={open} />}
        {view === 'bases' && <Files kind="bases" title="Documentos" extension=".md" />}
        {view === 'templates' && <Files kind="templates" title="Templates" extension=".html" />}
        {view === 'skills' && <Files kind="skills" title="Skills" extension="" />}
        {view === 'agents' && <Files kind="agents" title="Agentes" extension=".md" />}
        {view === 'conexiones' && <Connections notice={notice} onChanged={boot} />}
        {view === 'automatizacion' && <Automation status={status} onTaxonomy={boot} />}
      </main>
      {inspecting && (
        <Inspector
          key={selected ?? 'nuevo'}
          itemId={selected}
          draft={draft}
          taxonomy={status.taxonomy}
          onClose={close}
          onChanged={refresh}
          onCreated={(id) => {
            setDraft(null);
            setSelected(id);
            refresh();
          }}
        />
      )}
    </div>
  );
}
