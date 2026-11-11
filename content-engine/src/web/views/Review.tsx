import { FORMAT_LABEL, type Item, STATUS_LABEL, type Status } from '../api.ts';

type Props = { items: Item[]; selected: string | null; onOpen: (id: string) => void };

const SECTIONS: { title: string; statuses: Status[] }[] = [
  { title: 'Esperan tu revisión', statuses: ['revision'] },
  { title: 'Con error', statuses: ['error'] },
  { title: 'En proceso', statuses: ['idea', 'produciendo', 'ajustes', 'publicando'] },
  { title: 'Programadas', statuses: ['aprobada'] },
];

function when(iso: string | null): string {
  if (!iso) return 'Sin fecha';
  return new Date(iso).toLocaleString('es', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Review({ items, selected, onOpen }: Props) {
  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">Revisión</h1>
      </header>
      <div className="scroll">
        {SECTIONS.map((section) => {
          const rows = items.filter((item) => section.statuses.includes(item.status));
          if (!rows.length) return null;
          return (
            <div key={section.title} className="list-section">
              <h2>{section.title}</h2>
              <div className="list">
                {rows.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`list-row${item.id === selected ? ' active' : ''}`}
                    onClick={() => onOpen(item.id)}
                  >
                    {item.assets[0] && !/\.(mp4|mov)$/.test(item.assets[0]) ? (
                      <img src={`/media/${item.assets[0]}`} alt="" />
                    ) : (
                      <span className="thumb" />
                    )}
                    <span className="list-main">
                      <b>{item.title}</b>
                      <span className="muted">
                        {FORMAT_LABEL[item.format]} · {item.pillar || 'Sin pilar'} ·{' '}
                        {when(item.scheduled_at)}
                      </span>
                    </span>
                    <span className={`pill s-${item.status}`}>{STATUS_LABEL[item.status]}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {!items.length && <p className="empty">Aún no hay piezas.</p>}
      </div>
    </section>
  );
}
