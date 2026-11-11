import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  FORMAT_LABEL,
  type Format,
  type Item,
  STATUS_LABEL,
  type Status,
  type Taxonomy,
  upload,
} from '../api.ts';
import type { Draft } from '../App.tsx';

type Props = {
  itemId: string | null;
  draft: Draft | null;
  taxonomy: Taxonomy;
  onClose: () => void;
  onChanged: () => void;
  onCreated: (id: string) => void;
};

type Fields = {
  title: string;
  message: string;
  pillar: string;
  format: Format;
  service: string;
  funnel: string;
  cta: string;
  scheduled_at: string;
  copy: string;
  notes: string;
};

const FORMATS: Format[] = ['post', 'carrusel', 'reel', 'story'];
const BUSY: Status[] = ['produciendo', 'ajustes', 'publicando'];

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function fieldsOf(item: Item | null, draft: Draft | null): Fields {
  return {
    title: item?.title ?? '',
    message: item?.message ?? '',
    pillar: item?.pillar ?? '',
    format: item?.format ?? 'post',
    service: item?.service ?? '',
    funnel: item?.funnel ?? '',
    cta: item?.cta ?? '',
    scheduled_at: toLocalInput(item?.scheduled_at ?? draft?.scheduled_at ?? null),
    copy: item?.copy ?? '',
    notes: item?.notes ?? '',
  };
}

export function Inspector({ itemId, draft, taxonomy, onClose, onChanged, onCreated }: Props) {
  const [item, setItem] = useState<Item | null>(null);
  const [fields, setFields] = useState<Fields>(() => fieldsOf(null, draft));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    if (!itemId) return;
    const loaded = await api<Item>(`/items/${itemId}`);
    setItem(loaded);
    if (!dirtyRef.current) setFields(fieldsOf(loaded, null));
  }, [itemId]);

  useEffect(() => {
    load().catch((failure) => setError((failure as Error).message));
    const timer = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [load]);

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      setDirty(false);
      dirtyRef.current = false;
      await load();
      onChanged();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  const payload = () => ({ ...fields, scheduled_at: fromLocalInput(fields.scheduled_at) });

  async function create() {
    setError('');
    try {
      const created = await api<Item>('/items', 'POST', payload());
      onCreated(created.id);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  const save = (status?: Status) =>
    run(() => api(`/items/${itemId}`, 'PATCH', status ? { ...payload(), status } : payload()));

  async function remove() {
    if (!window.confirm('¿Eliminar esta pieza?')) return;
    await api(`/items/${itemId}`, 'DELETE');
    onChanged();
    onClose();
  }

  const status = item?.status;
  const locked = status ? BUSY.includes(status) || status === 'publicada' : false;
  const list = (id: string, values: string[]) => (
    <datalist id={id}>
      {values.map((value) => (
        <option key={value} value={value} />
      ))}
    </datalist>
  );

  return (
    <aside className="inspector">
      <header className="inspector-head">
        {status ? (
          <span className={`pill s-${status}`}>{STATUS_LABEL[status]}</span>
        ) : (
          <span className="pill">Nueva idea</span>
        )}
        {item && item.iteration > 0 && <span className="muted">Versión {item.iteration}</span>}
        <div className="spacer" />
        <button type="button" className="plain" onClick={onClose} aria-label="Cerrar">
          Cerrar
        </button>
      </header>

      <div className="inspector-body">
        {item?.error && <p className="banner error">{item.error}</p>}
        {error && <p className="banner error">{error}</p>}
        {status && BUSY.includes(status) && (
          <p className="banner">El agente está trabajando en esta pieza.</p>
        )}

        {item && item.assets.length > 0 && (
          <div className="assets">
            {item.assets.map((asset) =>
              /\.(mp4|mov)$/.test(asset) ? (
                <video key={asset} src={`/media/${asset}`} controls />
              ) : (
                <a key={asset} href={`/media/${asset}`} target="_blank" rel="noreferrer">
                  <img src={`/media/${asset}`} alt="" />
                </a>
              ),
            )}
          </div>
        )}

        <label className="field">
          <span>Idea</span>
          <input
            value={fields.title}
            disabled={locked}
            onChange={(event) => set('title', event.target.value)}
          />
        </label>
        <label className="field">
          <span>Mensaje a transmitir</span>
          <textarea
            rows={2}
            value={fields.message}
            disabled={locked}
            onChange={(event) => set('message', event.target.value)}
          />
        </label>

        <div className="group">
          <label className="row">
            <span>Formato</span>
            <select
              value={fields.format}
              disabled={locked || (item !== null && item.iteration > 0)}
              onChange={(event) => set('format', event.target.value as Format)}
            >
              {FORMATS.map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABEL[format]}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            <span>Fecha</span>
            <input
              type="datetime-local"
              value={fields.scheduled_at}
              disabled={locked}
              onChange={(event) => set('scheduled_at', event.target.value)}
            />
          </label>
          <label className="row">
            <span>Pilar</span>
            <input
              list="pillars"
              value={fields.pillar}
              disabled={locked}
              onChange={(event) => set('pillar', event.target.value)}
            />
          </label>
          <label className="row">
            <span>Servicio</span>
            <input
              list="services"
              value={fields.service}
              disabled={locked}
              onChange={(event) => set('service', event.target.value)}
            />
          </label>
          <label className="row">
            <span>Etapa</span>
            <input
              list="funnel"
              value={fields.funnel}
              disabled={locked}
              onChange={(event) => set('funnel', event.target.value)}
            />
          </label>
          <label className="row">
            <span>CTA</span>
            <input
              list="ctas"
              value={fields.cta}
              disabled={locked}
              onChange={(event) => set('cta', event.target.value)}
            />
          </label>
        </div>
        {list('pillars', taxonomy.pillars)}
        {list('services', taxonomy.services)}
        {list('funnel', taxonomy.funnel)}
        {list('ctas', taxonomy.ctas)}

        {item && item.iteration > 0 && (
          <label className="field">
            <span>Copy</span>
            <textarea
              rows={9}
              value={fields.copy}
              disabled={locked}
              onChange={(event) => set('copy', event.target.value)}
            />
            <small className="muted">{fields.copy.length} / 2200</small>
          </label>
        )}

        {item?.spec?.script && (
          <div className="field">
            <span>Guion</span>
            <pre className="script">{item.spec.script}</pre>
          </div>
        )}

        {item && (status === 'revision' || status === 'error' || status === 'aprobada') && (
          <div className="field">
            <span>Archivo</span>
            <input
              ref={fileInput}
              type="file"
              accept=".jpg,.jpeg,.mp4,.mov"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) run(() => upload(item.id, file));
              }}
            />
            <button type="button" onClick={() => fileInput.current?.click()}>
              {item.format === 'reel' ? 'Subir video' : 'Reemplazar con archivo propio'}
            </button>
          </div>
        )}

        {status === 'revision' && (
          <label className="field">
            <span>Anotaciones</span>
            <textarea
              rows={4}
              placeholder="Qué debe cambiar el agente"
              value={fields.notes}
              onChange={(event) => set('notes', event.target.value)}
            />
          </label>
        )}

        {item?.permalink && (
          <a className="link" href={item.permalink} target="_blank" rel="noreferrer">
            Ver en Instagram
          </a>
        )}

        {item?.events && item.events.length > 0 && (
          <div className="field">
            <span>Historial</span>
            <ul className="history">
              {item.events.map((event) => (
                <li key={event.id}>
                  <time>
                    {new Date(event.at).toLocaleString('es', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  <b>{event.kind}</b>
                  <span>{event.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="inspector-foot">
        {!item && !itemId && (
          <button type="button" className="primary" onClick={create}>
            Crear idea
          </button>
        )}
        {item && (
          <>
            <button type="button" className="destructive" onClick={remove}>
              Eliminar
            </button>
            <div className="spacer" />
            {!locked && dirty && (
              <button type="button" onClick={() => save()}>
                Guardar
              </button>
            )}
            {status === 'idea' && (
              <button
                type="button"
                onClick={() => run(() => api(`/items/${item.id}/run`, 'POST', { action: 'produce' }))}
              >
                Producir
              </button>
            )}
            {status === 'revision' && (
              <>
                <button type="button" onClick={() => save('ajustes')}>
                  Pedir ajustes
                </button>
                <button type="button" className="primary" onClick={() => save('aprobada')}>
                  Aprobar
                </button>
              </>
            )}
            {status === 'aprobada' && (
              <button type="button" onClick={() => save('revision')}>
                Volver a revisión
              </button>
            )}
            {status === 'error' && (
              <>
                <button type="button" onClick={() => save('idea')}>
                  Producir de nuevo
                </button>
                {item.iteration > 0 && (
                  <button type="button" className="primary" onClick={() => save('revision')}>
                    Volver a revisión
                  </button>
                )}
              </>
            )}
          </>
        )}
      </footer>
    </aside>
  );
}
