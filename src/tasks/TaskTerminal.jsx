import { useEffect, useRef } from 'react';
import './tasks.css';
import { linkify } from './TaskBoard.jsx';

// The CLI view of the same task: every plan line, tool call, result, approval wait and
// mid-task change, as it happens (task_log on the server).
export default function TaskTerminal({ task, agentName }) {
  const bodyRef = useRef(null);
  const lines = task?.log || [];
  useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lines.length]);
  const open = task && ['planning', 'running', 'waiting_approval', 'replanning'].includes(task.status);
  const who = (agentName || 'agent').toLowerCase();
  return (
    <div className="tt">
      <div className="tt-bar"><i /><i /><i /><span>{who}@atelier: ~/tasks/{task?.id || 'none'}</span></div>
      <div className="tt-body" ref={bodyRef}>
        {!task && <div className="tt-line info">no task yet: ask {agentName} to do something</div>}
        {lines.map((l, i) => (
          <div key={i} className={`tt-line ${l.kind}`}><span className="tt-ts">{l.ts.slice(11, 19)}</span>{linkify(l.text)}</div>
        ))}
        {open && <div className="tt-line"><span className="tt-ts">{new Date().toISOString().slice(11, 19)}</span><span className="tt-cursor">▍</span></div>}
      </div>
    </div>
  );
}
