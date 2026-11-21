import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import './tasks.css';

// Turn URLs (e.g. a pull request) into links.
export function linkify(text) {
  return String(text || '').split(/(https?:\/\/[^\s)]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer">{part.replace(/^https?:\/\/(www\.)?/, '')}</a> : part);
}

// The workflow view of an agent task: a task card (what you asked, the instructions the
// agent follows, what to expect, progress) and the steps as a pipeline of simple cards.
// A step waiting for your approval shows the exact draft and Approve / Deny buttons.
const STATUS = {
  done: { icon: '✓', label: 'Done' },
  running: { icon: '◐', label: 'Working on it…' },
  waiting: { icon: '✋', label: 'Waiting for your approval' },
  todo: { icon: '○', label: 'Not started' },
  skipped: { icon: '↷', label: 'Skipped' },
  failed: { icon: '✗', label: 'Failed' },
};
const TASK_STATUS = {
  planning: 'Planning the steps…', running: 'Working', waiting_approval: 'Waiting for you', replanning: 'Fitting in your change…',
  done: 'Finished', failed: 'Stopped by an error', cancelled: 'Stopped',
};

export default function TaskBoard({ task, agentName, approvals = [] }) {
  const flowRef = useRef(null);
  const [busy, setBusy] = useState(null);
  const steps = task?.steps || [];
  const current = steps.findIndex((s) => s.status === 'running' || s.status === 'waiting');

  // keep the step being worked on in view
  useEffect(() => {
    const el = flowRef.current?.querySelector('.tb-step.is-current');
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [current, task?.status]);

  if (!task) return <div className="tb-empty">No task yet. Ask {agentName} to do something, e.g. “Get Lukas ready for his check-in today”.</div>;

  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const open = ['planning', 'running', 'waiting_approval', 'replanning'].includes(task.status);
  const decide = async (approvalId, decision) => {
    setBusy(approvalId + decision);
    try { await api(`/approvals/${approvalId}/resolve`, { method: 'POST', body: { decision } }); } catch {}
    setBusy(null);
  };

  return (
    <div className="tb">
      <section className="tb-task">
        <div className="tb-label">Task</div>
        <h3>{task.title}</h3>
        <div className={`tb-state ${task.status}`}><i />{TASK_STATUS[task.status] || task.status}</div>
        {task.goal && <div className="tb-field"><b>What you asked</b><p>{task.goal}</p></div>}
        {task.instructions && <div className="tb-field"><b>Instructions {agentName} follows</b><p>{task.instructions}</p></div>}
        {task.expect && <div className="tb-field"><b>What to expect</b><p>{task.expect}</p></div>}
        {!!steps.length && (
          <div className="tb-progress"><div><span>{done} of {steps.length} steps</span><b>{pct}%</b></div><div className="tb-bar"><i style={{ width: `${pct}%` }} /></div></div>
        )}
        {!!task.additions?.length && <div className="tb-note">Fitting in: {task.additions.map((a) => `“${a.text}”`).join(', ')}</div>}
        {open && <button className="tb-stop" onClick={() => api(`/tasks/${task.id}/cancel`, { method: 'POST' })}>Stop task</button>}
      </section>

      <section className="tb-stages">
        <div className="tb-label">Steps</div>
        {task.status === 'planning' && !steps.length && <div className="tb-planning"><span /><span /><span /> {agentName} is planning the steps…</div>}
        <div className="tb-flow" ref={flowRef}>
          {steps.map((s, i) => {
            const st = STATUS[s.status] || STATUS.todo;
            const ap = s.approval_id && approvals.find((a) => a.id === s.approval_id);
            return (
              <div key={s.id} className={`tb-step ${s.status} ${i === current ? 'is-current' : ''}`}>
                <div className="tb-num">{i + 1}</div>
                <div className="tb-title">{s.title}{s.added && <em className="tb-new">new · your change</em>}</div>
                <div className="tb-st"><span>{st.icon}</span>{st.label}</div>
                <p className="tb-explain">{s.explain}</p>
                {s.status === 'waiting' && ap && (
                  <div className="tb-approve">
                    {ap.type === 'deploy'
                      ? <blockquote className="deploy">🚀 Merge pull request #{ap.payload?.pr_number} into main{ap.payload?.pr_url && <> · <a href={ap.payload.pr_url} target="_blank" rel="noreferrer">review it on GitHub</a></>}</blockquote>
                      : <blockquote>{ap.payload?.reply || ap.summary}</blockquote>}
                    {ap.status === 'pending' && (
                      <div className="tb-buttons">
                        <button className="ok" disabled={!!busy} onClick={() => decide(ap.id, 'approved')}>{ap.type === 'deploy' ? '🚀 Approve & merge' : '✓ Approve'}</button>
                        <button disabled={!!busy} onClick={() => decide(ap.id, 'denied')}>Deny</button>
                      </div>
                    )}
                  </div>
                )}
                {s.result && <div className="tb-result">{linkify(s.result)}</div>}
              </div>
            );
          })}
        </div>
        {task.result && !open && <div className="tb-final">■ {task.result}</div>}
      </section>
    </div>
  );
}
