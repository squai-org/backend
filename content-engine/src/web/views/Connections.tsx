import { useCallback, useEffect, useState } from 'react';
import { api, type InstagramConnection } from '../api.ts';

type Props = { notice: string; onChanged: () => void };

const DAY_MS = 86400000;

export function Connections({ notice, onChanged }: Props) {
  const [info, setInfo] = useState<InstagramConnection | null>(null);
  const [error, setError] = useState(notice);

  const load = useCallback(async () => {
    const data = await api<{ instagram: InstagramConnection }>('/connections');
    setInfo(data.instagram);
  }, []);

  useEffect(() => {
    load().catch((failure) => setError((failure as Error).message));
  }, [load]);

  async function connect() {
    setError('');
    try {
      const { url } = await api<{ url: string }>('/connections/instagram/start', 'POST');
      window.location.href = url;
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  async function disconnect() {
    if (!window.confirm('¿Desconectar Instagram?')) return;
    await api('/connections/instagram', 'DELETE');
    await load();
    onChanged();
  }

  const days = info?.expiresAt ? Math.floor((info.expiresAt - Date.now()) / DAY_MS) : null;

  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">Conexiones</h1>
      </header>
      <div className="scroll">
        {error && <p className="banner error">{error}</p>}
        <div className="list-section">
          <h2>Redes</h2>
          <div className="list">
            <div className="list-row static">
              <span className="list-main">
                <b>Instagram</b>
                <span className="muted">
                  {info?.connected
                    ? `${info.username ? `@${info.username}` : 'Conectado'}${days !== null ? ` · renueva solo, vence en ${days} días si deja de renovarse` : ''}`
                    : 'Sin conectar'}
                </span>
              </span>
              {info?.connected && (
                <button type="button" className="destructive" onClick={disconnect}>
                  Desconectar
                </button>
              )}
              <button
                type="button"
                className="primary"
                disabled={!info?.configured}
                onClick={connect}
              >
                {info?.connected ? 'Reconectar' : 'Conectar'}
              </button>
            </div>
          </div>
        </div>
        {info && !info.configured && (
          <p className="banner">
            Define IG_APP_ID e IG_APP_SECRET en el servidor y reinícialo para activar el botón.
          </p>
        )}
        {info && (
          <div className="list-section">
            <h2>URL de redirección para la app de Meta</h2>
            <pre className="script">{info.redirectUri}</pre>
          </div>
        )}
      </div>
    </section>
  );
}
