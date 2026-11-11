import { type DragEvent, useMemo, useState } from 'react';
import { api, FORMAT_LABEL, type Item, STATUS_LABEL } from '../api.ts';

type Mode = 'mes' | 'semana';
type Props = {
  items: Item[];
  selected: string | null;
  onOpen: (id: string) => void;
  onCreate: (scheduledAt: string | null) => void;
  onChanged: () => void;
};

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DEFAULT_HOUR = 12;

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

export function Calendar({ items, selected, onOpen, onCreate, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>('mes');
  const [cursor, setCursor] = useState(() => new Date());
  const [target, setTarget] = useState<string | null>(null);
  const today = dayKey(new Date());

  const days = useMemo(() => {
    if (mode === 'semana') {
      const start = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = startOfWeek(first);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const weeks = Math.ceil((Math.round((last.getTime() - start.getTime()) / 86400000) + 1) / 7);
    return Array.from({ length: weeks * 7 }, (_, index) => addDays(start, index));
  }, [mode, cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      if (!item.scheduled_at) continue;
      const key = dayKey(new Date(item.scheduled_at));
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [items]);

  const unscheduled = items.filter((item) => !item.scheduled_at);

  function move(step: number) {
    const next = new Date(cursor);
    if (mode === 'mes') next.setMonth(next.getMonth() + step, 1);
    else next.setDate(next.getDate() + step * 7);
    setCursor(next);
  }

  async function drop(event: DragEvent, day: Date) {
    event.preventDefault();
    setTarget(null);
    const item = items.find((entry) => entry.id === event.dataTransfer.getData('text/plain'));
    if (!item || item.status === 'publicada' || item.status === 'publicando') return;
    const previous = item.scheduled_at ? new Date(item.scheduled_at) : null;
    const next = new Date(day);
    next.setHours(previous?.getHours() ?? DEFAULT_HOUR, previous?.getMinutes() ?? 0, 0, 0);
    await api(`/items/${item.id}`, 'PATCH', { scheduled_at: next.toISOString() });
    onChanged();
  }

  function createOn(day: Date) {
    const date = new Date(day);
    date.setHours(DEFAULT_HOUR, 0, 0, 0);
    onCreate(date.toISOString());
  }

  const title =
    mode === 'mes'
      ? cursor.toLocaleDateString('es', { month: 'long', year: 'numeric' })
      : `${days[0].toLocaleDateString('es', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">{title}</h1>
        <div className="spacer" />
        <div className="segmented">
          {(['mes', 'semana'] as Mode[]).map((option) => (
            <button
              key={option}
              type="button"
              className={mode === option ? 'on' : ''}
              onClick={() => setMode(option)}
            >
              {option === 'mes' ? 'Mes' : 'Semana'}
            </button>
          ))}
        </div>
        <div className="segmented">
          <button type="button" onClick={() => move(-1)} aria-label="Anterior">
            ‹
          </button>
          <button type="button" onClick={() => setCursor(new Date())}>
            Hoy
          </button>
          <button type="button" onClick={() => move(1)} aria-label="Siguiente">
            ›
          </button>
        </div>
        <button type="button" className="primary" onClick={() => onCreate(null)}>
          Nueva idea
        </button>
      </header>
      {unscheduled.length > 0 && (
        <div className="tray">
          <span className="tray-label">Sin fecha</span>
          {unscheduled.map((item) => (
            <Chip key={item.id} item={item} active={item.id === selected} onOpen={onOpen} />
          ))}
        </div>
      )}
      <div className="weekdays">
        {WEEKDAYS.map((name) => (
          <div key={name}>{name}</div>
        ))}
      </div>
      <div className={`grid ${mode}`}>
        {days.map((day) => {
          const key = dayKey(day);
          const outside = mode === 'mes' && day.getMonth() !== cursor.getMonth();
          return (
            <div
              key={key}
              className={`day${outside ? ' outside' : ''}${target === key ? ' target' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setTarget(key);
              }}
              onDragLeave={() => setTarget((current) => (current === key ? null : current))}
              onDrop={(event) => drop(event, day)}
              onDoubleClick={() => createOn(day)}
            >
              <div className={`day-number${key === today ? ' today' : ''}`}>{day.getDate()}</div>
              {(byDay.get(key) ?? []).map((item) => (
                <Chip
                  key={item.id}
                  item={item}
                  active={item.id === selected}
                  onOpen={onOpen}
                  large={mode === 'semana'}
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Chip({
  item,
  active,
  onOpen,
  large,
}: {
  item: Item;
  active: boolean;
  onOpen: (id: string) => void;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      draggable
      className={`chip s-${item.status}${active ? ' active' : ''}${large ? ' large' : ''}`}
      title={`${STATUS_LABEL[item.status]} · ${FORMAT_LABEL[item.format]}`}
      onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={() => onOpen(item.id)}
    >
      {large && item.assets[0] && !/\.(mp4|mov)$/.test(item.assets[0]) && (
        <img src={`/media/${item.assets[0]}`} alt="" />
      )}
      <span className="chip-line">
        <span className="chip-dot" />
        {item.scheduled_at && <span className="chip-time">{timeLabel(item.scheduled_at)}</span>}
        <span className="chip-title">{item.title}</span>
      </span>
      {large && (
        <span className="chip-meta">
          {FORMAT_LABEL[item.format]} · {STATUS_LABEL[item.status]}
        </span>
      )}
    </button>
  );
}
