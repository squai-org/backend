import { useCallback, useEffect, useState } from 'react';
import { type AppStatus, api, type Hook, type Job, STATUS_LABEL, type Taxonomy } from '../api.ts';

type Props = { status: AppStatus; onTaxonomy: () => void };

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const JOB_LABEL: Record<Job['status'], string> = {
  queued: 'En cola',
  running: 'En curso',
  done: 'Hecho',
  failed: 'Falló',
};
const ACTION_LABEL: Record<string, string> = {
  plan: 'Planear semana',
  produce: 'Producir propuesta',
  revise: 'Aplicar ajustes',
};
const TAXONOMY_LABEL: Record<keyof Taxonomy, string> = {
  pillars: 'Pilares',
  services: 'Servicios',
  funnel: 'Etapas',
  ctas: 'Llamadas a la acción',
};

export function Automation({ status, onTaxonomy }: Props) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [taxonomy, setTaxonomy] = useState(() =>
    Object.fromEntries(
      Object.entries(status.taxonomy).map(([key, values]) => [key, values.join('\n')]),
    ),
  );

  const load = useCallback(async () => {
    const [hookList, jobList, agentList] = await Promise.all([
      api<Hook[]>('/hooks'),
      api<Job[]>('/jobs'),
      api<string[]>('/files/agents'),
    ]);
    setHooks(hookList);
    setJobs(jobList);
    setAgents(agentList.map((name) => name.replace(/\.md$/, '')));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function patch(id: string, body: Partial<Hook>) {
    await api(`/hooks/${id}`, 'PATCH', body);
    load();
  }

  async function saveTaxonomy() {
    const body = Object.fromEntries(
      Object.entries(taxonomy).map(([key, text]) => [key, text.split('\n')]),
    );
    await api('/taxonomy', 'PUT', body);
    onTaxonomy();
  }

  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">Automatización</h1>
      </header>
      <div className="scroll">
        <div className="list-section">
          <h2>Hooks</h2>
          <div className="list">
            {hooks.map((hook) => (
              <div key={hook.id} className="list-row static">
                <span className="list-main">
                  <b>{hook.name}</b>
                  <span className="muted">
                    {hook.trigger === 'weekly'
                      ? 'Cada semana'
                      : `Cuando una pieza pasa a ${STATUS_LABEL[hook.status ?? 'idea']}`}{' '}
                    → {ACTION_LABEL[hook.action]}
                  </span>
                </span>
                {hook.trigger === 'weekly' && (
                  <>
                    <select
                      value={hook.weekday ?? 0}
                      onChange={(event) => patch(hook.id, { weekday: Number(event.target.value) })}
                    >
                      {WEEKDAYS.map((name, index) => (
                        <option key={name} value={index}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="time"
                      value={hook.time ?? '18:00'}
                      onChange={(event) => patch(hook.id, { time: event.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => api(`/hooks/${hook.id}/fire`, 'POST').then(load)}
                    >
                      Ejecutar ahora
                    </button>
                  </>
                )}
                <select
                  value={hook.agent}
                  onChange={(event) => patch(hook.id, { agent: event.target.value })}
                >
                  {agents.map((agent) => (
                    <option key={agent} value={agent}>
                      {agent}
                    </option>
                  ))}
                </select>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={hook.enabled}
                    onChange={(event) => patch(hook.id, { enabled: event.target.checked })}
                  />
                  <span />
                </label>
              </div>
            ))}
          </div>
          <p className="muted note">Zona horaria: {status.timezone}</p>
        </div>

        <div className="list-section">
          <h2>Ejecuciones</h2>
          <div className="list">
            {jobs.map((job) => (
              <div key={job.id} className="list-row static">
                <span className="list-main">
                  <b>{ACTION_LABEL[job.action]}</b>
                  <span className="muted">
                    {job.agent} · {new Date(job.created_at).toLocaleString('es')} · intento{' '}
                    {job.attempts}
                    {job.error ? ` · ${job.error}` : ''}
                  </span>
                </span>
                <span className={`pill j-${job.status}`}>{JOB_LABEL[job.status]}</span>
              </div>
            ))}
            {!jobs.length && <p className="empty">Sin ejecuciones.</p>}
          </div>
        </div>

        <div className="list-section">
          <h2>Taxonomía</h2>
          <div className="taxonomy">
            {(Object.keys(TAXONOMY_LABEL) as (keyof Taxonomy)[]).map((key) => (
              <label key={key} className="field">
                <span>{TAXONOMY_LABEL[key]}</span>
                <textarea
                  rows={5}
                  value={taxonomy[key]}
                  onChange={(event) => setTaxonomy({ ...taxonomy, [key]: event.target.value })}
                />
              </label>
            ))}
          </div>
          <button type="button" onClick={saveTaxonomy}>
            Guardar taxonomía
          </button>
        </div>
      </div>
    </section>
  );
}
