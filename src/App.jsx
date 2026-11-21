import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OfficeExperience from './office/OfficeExperience.jsx';
import SimpleMode from './SimpleMode.jsx';
import Icon from './office/Icon.jsx';
import AgentHead from './office/AgentHead.jsx';
import { api, subscribe, uploadAudio } from './api.js';

const AGENT_META = {
  mila: { name: 'Mila', role: 'Guest Concierge' },
  theo: { name: 'Theo', role: 'Turnover Coordinator' },
  priya: { name: 'Priya', role: 'Pricing & Calendar' },
  sam: { name: 'Sam', role: 'Reviews & Reputation' },
};

export default function App() {
  const [state, setState] = useState(null);
  const [workOpen, setWorkOpen] = useState(false);
  const [tab, setTab] = useState('approvals');
  const [busy, setBusy] = useState('');
  const [briefing, setBriefing] = useState(null);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const [inspector, setInspector] = useState(null); // {agentId}
  const [threadView, setThreadView] = useState(null); // thread id
  const [teamBuilder, setTeamBuilder] = useState(false);
  const [handsfree, setHandsfree] = useState(false);
  const handsfreeRef = useRef(false);
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('atelier-mode') || 'advanced'; } catch { return 'advanced'; } });
  const openThreadRef = useRef(null); // set by SimpleMode: open chat with an agent from the 3D office
  const [voiceReply, setVoiceReply] = useState(null);
  useEffect(() => { try { localStorage.setItem('atelier-mode', mode); } catch {} }, [mode]);
  // Esc closes the Simple mode popup (clicking empty office space does too, via OfficeExperience).
  useEffect(() => {
    if (mode !== 'simple') return;
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) setMode('advanced'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);
  const audioRef = useRef(null);
  const playedRef = useRef(new Set());
  const mediaRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => subscribe(setState, (ev) => {
    if (ev?.type === 'voice_reply') {
      setVoiceReply(ev);
      if (ev.audio_url && mode === 'advanced') { const el = audioRef.current; el.src = ev.audio_url; el.play().catch(() => speakBrowser(ev.text || '')); }
    }
  }), [mode]);

  // Speak each new approval request (Voxtral TTS via server); browser speech as fallback.
  useEffect(() => {
    if (!state) return;
    for (const a of state.approvals.filter((x) => x.status === 'pending')) {
      if (playedRef.current.has(a.id)) continue;
      playedRef.current.add(a.id);
      setWorkOpen(true); // a raised hand pops the work queue open so the card is visible
      const spoken = `${AGENT_META[a.agent_id]?.name || a.agent_id} needs your approval. ${a.summary}. ${a.amount_gbp ? `Amount: ${a.amount_gbp} pounds.` : ''} Say approve or deny.`;
      fetch(`/api/approvals/${a.id}/audio`).then((r) => {
        if (r.ok) { const el = audioRef.current; el.src = `/api/approvals/${a.id}/audio`; return el.play().catch(() => speakBrowser(spoken)); }
        speakBrowser(spoken);
      }).catch(() => speakBrowser(spoken));
    }
  }, [state]);

  const speakBrowser = (text) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      window.speechSynthesis?.speak(u);
    } catch {}
  };

  const resolveApproval = useCallback(async (id, decision) => {
    try { await api(`/approvals/${id}/resolve`, { method: 'POST', body: { decision } }); }
    catch (e) { setVoiceNote('Error: ' + e.message); }
  }, []);

  const handleVoiceText = useCallback(async (text) => {
    setVoiceNote(`Heard: “${text}”`);
    const t = text.toLowerCase();
    const pending = state?.approvals?.filter((a) => a.status === 'pending') || [];
    if (!pending.length) return;
    if (/\b(approve|approvieren|ja|yes|ok|grant)\b/.test(t)) return resolveApproval(pending[0].id, 'approved');
    if (/\b(deny|denied|ablehnen|nein|no|reject)\b/.test(t)) return resolveApproval(pending[0].id, 'denied');
  }, [state, resolveApproval]);

  const toggleListen = useCallback(async () => {
    if (listening) { mediaRef.current?.stop(); setListening(false); return; }
    setVoiceNote('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        try { const { text, engine } = await uploadAudio(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); setVoiceNote(`Heard (${engine}): “${text}”`); await handleVoiceText(text); }
        catch { browserRecognize(); }
      };
      mediaRef.current = rec; rec.start(); setListening(true);
      setTimeout(() => { if (mediaRef.current?.state === 'recording') { mediaRef.current.stop(); setListening(false); } }, 4000);
    } catch { browserRecognize(); }
  }, [listening, handleVoiceText]);

  const browserRecognize = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceNote('No mic / no speech API available'); return; }
    const r = new SR(); recognitionRef.current = r;
    r.lang = 'en-GB'; r.onresult = (e) => handleVoiceText(e.results[0][0].transcript);
    r.onerror = () => setVoiceNote('Browser speech recognition failed'); r.onend = () => setListening(false);
    setListening(true); r.start();
  };

  const simulate = async () => { setBusy('overnight'); setBriefing(null); try { await api('/simulate/overnight', { method: 'POST' }); } catch (e) { alert(e.message); } finally { setBusy(''); } };
  const brief = async () => { setBusy('briefing'); try { const b = await api('/briefing', { method: 'POST' }); setBriefing(b); if (b.audio_url) { const el = audioRef.current; el.src = b.audio_url; el.play().catch(() => speakBrowser(b.text)); } } catch (e) { alert(e.message); } finally { setBusy(''); } };
  const reset = async () => { if (!confirm('Reset demo data?')) return; await api('/reset', { method: 'POST' }); setBriefing(null); };

  const agents = useMemo(() => (state?.agents || []).map((a) => ({ ...a, name: AGENT_META[a.id]?.name || a.name || a.id, role: AGENT_META[a.id]?.role || a.role })), [state]);
  const pending = state?.approvals?.filter((a) => a.status === 'pending') || [];

  // F4 hands-free: continuous listening; route approvals + instructions by voice
  const routeUtterance = useCallback(async (text) => {
    const t = text.toLowerCase().trim();
    setVoiceNote(`🎙️ “${text}”`);
    const pend = state?.approvals?.filter((a) => a.status === 'pending') || [];
    if (/\b(approve|approvieren|ja|yes|ok|grant)\b/.test(t) && pend.length) return resolveApproval(pend[0].id, 'approved');
    if (/\b(deny|denied|ablehnen|nein|no|reject)\b/.test(t) && pend.length) return resolveApproval(pend[0].id, 'denied');
    const target = agents.find((a) => t.startsWith(a.name.toLowerCase()) || t.includes(' ' + a.name.toLowerCase()));
    if (target) return api('/instruct', { method: 'POST', body: { agent_id: target.id, text, voice: true } }).catch((e) => setVoiceNote('Error: ' + e.message));
    if (t.length > 3) return api('/instruct', { method: 'POST', body: { agent_id: agents[0]?.id, text, voice: true } }).catch((e) => setVoiceNote('Error: ' + e.message));
  }, [state, agents, resolveApproval]);

  useEffect(() => {
    handsfreeRef.current = handsfree;
    if (!handsfree) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const r = new SR(); r.lang = 'en-GB'; r.continuous = true; r.interimResults = false;
      r.onresult = (e) => { const txt = e.results[e.results.length - 1][0].transcript; routeUtterance(txt); };
      r.onerror = () => {}; r.onend = () => { if (handsfreeRef.current) { try { r.start(); } catch {} } };
      recognitionRef.current = r; r.start(); setListening(true);
      return () => { try { r.stop(); } catch {} setListening(false); };
    }
    // fallback: rolling MediaRecorder chunks to Voxtral STT
    let rec, stream, stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const loop = async () => {
          if (stopped || !handsfreeRef.current) return;
          rec = new MediaRecorder(stream); const chunks = [];
          rec.ondataavailable = (e) => chunks.push(e.data);
          rec.onstop = async () => { if (stopped) return; try { const { text } = await uploadAudio(new Blob(chunks, { type: 'audio/webm' })); if (text) routeUtterance(text); } catch { /* browser fallback unavailable */ } loop(); };
          rec.start(); setListening(true);
          setTimeout(() => { try { rec.stop(); } catch {} setListening(false); }, 3500);
        };
        loop();
      } catch { setVoiceNote('Hands-free needs mic permission'); setHandsfree(false); }
    })();
    return () => { stopped = true; try { rec?.stop(); } catch {} stream?.getTracks().forEach((t) => t.stop()); setListening(false); };
  }, [handsfree, routeUtterance]);

  return (
    <div className="app">
      <header className="topbar workplace-topbar">
        <div className="brand"><span className="brand-symbol"><AgentHead size={24}/></span>Atelier<span className="brand-divider"/><span className="org-name">An overview of all your agents, at a glance</span></div>
        <span className="workspace-label">WORKSPACE</span>
        <div className="actions">
          <span className="simulation-badge">Office simulation</span>
          <details className="agent-tools-menu"><summary>Agent tools <span>⌄</span></summary><div className="agent-tools-dropdown">
            <button className="btn" onClick={simulate} disabled={!!busy}>{busy === 'overnight' ? 'Night running…' : 'Simulate overnight'}</button>
            <button className="btn" onClick={brief} disabled={!!busy}>{busy === 'briefing' ? 'Preparing…' : 'Morning briefing'}</button>
            <button className={`btn mic ${listening ? 'on' : ''}`} onClick={toggleListen}>{listening ? 'Listening…' : 'Voice approve / deny'}</button>
            <button className={`btn mic ${handsfree ? 'on' : ''}`} onClick={() => setHandsfree(v => !v)}>{handsfree ? '🎙️ Hands-free ON' : '🎙️ Hands-free'}</button>
            <button className="btn" onClick={() => { setTeamBuilder(true); setWorkOpen(true); setTab('team'); }}>＋ Hire agent</button>
            <button className="btn ghost" onClick={reset}>Reset agent demo data</button>
          </div></details>
          <button className="mode-toggle" onClick={() => setMode(mode === 'simple' ? 'advanced' : 'simple')} title="Switch between Simple (chat + quick glance) and Advanced (3D office)">{mode === 'simple' ? '🧑‍💻 Advanced' : '💬 Simple'}</button>
          <button className={`work-queue-button ${workOpen?'open':''}`} onClick={() => setWorkOpen(!workOpen)} aria-expanded={workOpen}>Work queue {pending.length>0 && <span>{pending.length}</span>}</button>
          <span className="account-avatar" title="Your workspace">Y</span>
        </div>
      </header>
      {voiceNote && <div className="voice-note">🎙️ {voiceNote}</div>}

      <main className="main workplace-main">
        <OfficeExperience agents={agents} onInspect={(id) => setInspector({ agentId: id })}
          onAgentChat={mode === 'simple' ? (id) => openThreadRef.current?.(id) : undefined}
          onEmptyClick={mode === 'simple' ? () => setMode('advanced') : undefined} />
        {mode === 'simple' && (
          <div className="simple-backdrop">
            <SimpleMode state={state} voiceReply={voiceReply} onExit={() => setMode('advanced')} registerOpen={(fn) => { openThreadRef.current = fn; }} />
          </div>
        )}
        {briefing && <div className="briefing card workspace-briefing"><div className="card-title">Morning briefing <button className="x" aria-label="Close briefing" onClick={() => setBriefing(null)}>✕</button></div><p>{briefing.text}</p></div>}
        {inspector && <Inspector agentId={inspector.agentId} state={state} onClose={() => setInspector(null)} />}
        {workOpen && <aside className="sidebar work-drawer" aria-label="Agent work queue">
          <div className="work-drawer-heading"><h2>Your work queue</h2><button className="icon-button" aria-label="Close work queue" onClick={() => setWorkOpen(false)}><Icon name="close"/></button></div>
          <nav className="tabs">
            {['approvals', 'threads', 'team', 'audit', 'inbox', 'jobs', 'flats'].map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); if (t !== 'threads') setThreadView(null); }}>
                {t === 'approvals' ? `✋ Approvals${pending.length ? ` (${pending.length})` : ''}` : t === 'threads' ? `💬 Threads${(state?.threads || []).reduce((n, x) => n + (x.unread || 0), 0) ? ` (${(state?.threads || []).reduce((n, x) => n + (x.unread || 0), 0)})` : ''}` : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>
          <div className="panel">
            {tab === 'threads' && <Threads state={state} threadView={threadView} setThreadView={setThreadView} onInspect={setInspector} />}
            {tab === 'team' && <TeamBuilder state={state} open={teamBuilder} setOpen={setTeamBuilder} />}
            {tab === 'approvals' && (
              pending.length === 0
                ? <p className="muted">No pending approvals. Agents raise a hand here whenever they need you — refunds, discounts, price changes, early check-ins, guest messages.</p>
                : pending.map((a) => (
                  <div key={a.id} className="approval card">
                    <div className="card-title"><span className="hand">✋</span> {AGENT_META[a.agent_id]?.name || a.agent_id} · {a.type.replaceAll('_', ' ')}
                      {a.amount_gbp != null && a.amount_gbp !== 0 && <b className="amount">{a.amount_gbp > 0 ? `£${a.amount_gbp}` : `−£${Math.abs(a.amount_gbp)}`}</b>}
                    </div>
                    <p>{a.summary}</p>
                    {a.payload?.reply && <blockquote>“{a.payload.reply}”</blockquote>}
                    <div className="row">
                      <button className="btn primary" onClick={() => resolveApproval(a.id, 'approved')}>Approve</button>
                      <button className="btn danger" onClick={() => resolveApproval(a.id, 'denied')}>Deny</button>
                    </div>
                  </div>
                ))
            )}
            {tab === 'audit' && <AuditList audit={state?.audit || []} />}
            {tab === 'inbox' && <Inbox messages={state?.messages || []} bookings={state?.bookings || []} />}
            {tab === 'jobs' && <Jobs jobs={state?.jobs || []} flats={state?.flats || []} />}
            {tab === 'flats' && <Flats flats={state?.flats || []} rates={state?.rates || []} bookings={state?.bookings || []} />}
          </div>
        </aside>}
      </main>
      <audio ref={audioRef} />
    </div>
  );
}

function AuditList({ audit }) {
  if (!audit.length) return <p className="muted">Nothing yet. Every agent decision lands here.</p>;
  return <ul className="audit">{audit.map((e) => (
    <li key={e.id} className={e.kind}>
      <span className="ts">{new Date(e.ts).toLocaleTimeString('en-GB')}</span>
      <b>{AGENT_META[e.agent_id]?.name || e.agent_id || 'system'}</b> {e.detail}
    </li>
  ))}</ul>;
}

function Inbox({ messages, bookings }) {
  const bmap = Object.fromEntries(bookings.map((b) => [b.id, b]));
  if (!messages.length) return <p className="muted">No messages yet.</p>;
  return <ul className="inbox">{[...messages].reverse().map((m) => (
    <li key={m.id} className={m.from_side}>
      <div className="m-head"><b>{m.from_side === 'guest' ? bmap[m.booking_id]?.guest_name || 'Guest' : 'You (via agent)'}</b> <span>{m.lang}</span> <span className="ts">{new Date(m.ts).toLocaleString('en-GB')}</span></div>
      <div>{m.text}</div>
    </li>
  ))}</ul>;
}

function Jobs({ jobs, flats }) {
  const fmap = Object.fromEntries(flats.map((f) => [f.id, f.name]));
  return <ul className="jobs">{jobs.map((j) => (
    <li key={j.id} className={j.status}>
      <b>{fmap[j.flat_id] || j.flat_id}</b> · {j.date} {j.time} — {j.cleaner || 'unassigned'} <span className={`pill ${j.status}`}>{j.status}</span>
      {j.note && <div className="note">{j.note}</div>}
    </li>
  ))}</ul>;
}

function Flats({ flats, rates, bookings }) {
  return <div>{flats.map((f) => (
    <div key={f.id} className="flat card">
      <div className="card-title">{f.name} <span className="muted">{f.area}</span></div>
      <div>Base rate £{f.base_rate}/night · {bookings.filter((b) => b.flat_id === f.id).length} booking(s)</div>
      <div className="rates">{rates.filter((r) => r.flat_id === f.id).slice(0, 7).map((r) => <span key={r.date} className={`rate ${r.booked ? 'booked' : ''}`}>{r.date.slice(5)}: £{r.price}</span>)}</div>
    </div>
  ))}</div>;
}

// ---- F1: team builder ----------------------------------------------------------
function TeamBuilder({ state, open, setOpen }) {
  const [name, setName] = useState(''); const [role, setRole] = useState(''); const [department, setDepartment] = useState('Operations'); const [desk, setDesk] = useState(5);
  const agents = state?.agents || [];
  return (
    <div>
      {open && (
        <div className="card team-form">
          <div className="card-title">＋ Hire a new agent</div>
          <div className="form-row"><input placeholder="Name (e.g. Nina)" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="form-row"><input placeholder="Role (e.g. Upsell & Extras)" value={role} onChange={(e) => setRole(e.target.value)} /></div>
          <div className="form-row">
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>{['Guest Experience', 'Operations', 'The Studio', 'Support'].map((d) => <option key={d}>{d}</option>)}</select>
            <select value={desk} onChange={(e) => setDesk(Number(e.target.value))}>{[1,2,3,4,5,6,7,8].map((d) => <option key={d} value={d}>Desk {d}</option>)}</select>
          </div>
          <div className="row">
            <button className="btn primary" onClick={async () => { await api('/agents', { method: 'POST', body: { name, role, department, desk } }); setName(''); setRole(''); setOpen(false); }}>Hire</button>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      <p className="muted">Your agents — they appear at a desk in the office immediately.</p>
      <ul className="team-list">{agents.map((a) => (
        <li key={a.id} className="card">
          <div className="card-title">{a.name} <span className="muted">{a.role}</span> <span className={`pill ${a.status}`}>{a.status}</span></div>
          <div className="muted">{a.department} · desk {a.desk}{a.current_task ? ` · ${a.current_task}` : ''}</div>
          <div className="row">
            <button className="btn" onClick={async () => { const role = prompt('Rename role for ' + a.name, a.role); const name = prompt('Rename agent', a.name); if (name || role) await api('/agents/' + a.id, { method: 'PATCH', body: { name: name || undefined, role: role || undefined } }); }}>Rename</button>
            <button className="btn danger" onClick={async () => { if (confirm('Remove ' + a.name + '?')) await api('/agents/' + a.id, { method: 'DELETE' }); }}>Delete</button>
          </div>
        </li>
      ))}</ul>
    </div>
  );
}

// ---- F5: chat threads ----------------------------------------------------------
function Threads({ state, threadView, setThreadView, onInspect }) {
  const threads = state?.threads || [];
  const agents = state?.agents || [];
  const active = threads.find((t) => t.id === threadView);
  if (active) return <ThreadView thread={active} onBack={() => setThreadView(null)} onInspect={onInspect} />;
  return (
    <div>
      <p className="muted">Chat threads with your agents. Reopening shows a “Since you last opened” catch-up.</p>
      {threads.length === 0 && <p className="muted">No threads yet — start one:</p>}
      <ul className="team-list">{agents.map((a) => (
        <li key={a.id}>
          <button className="btn thread-open" onClick={async () => { const { thread } = await api('/threads', { method: 'POST', body: { agent_id: a.id } }); setThreadView(thread.id); }}>
            💬 {a.name} · {a.role} {threads.find((t) => t.agent_id === a.id)?.unread ? <b className="amount">· {threads.find((t) => t.agent_id === a.id).unread} new</b> : ''}
          </button>
        </li>
      ))}</ul>
      {threads.map((t) => (
        <button key={t.id} className="btn thread-open" onClick={() => setThreadView(t.id)}>🧵 {t.agent_name} — {t.messages.length} msgs{t.unread ? ` · ${t.unread} unread` : ''}</button>
      ))}
    </div>
  );
}

function ThreadView({ thread, onBack, onInspect }) {
  const [text, setText] = useState(''); const [summary, setSummary] = useState(null);
  const boxRef = useRef(null);
  const msgs = thread.messages || [];
  const lastRead = thread.last_read;
  const newMsgs = lastRead ? msgs.filter((m) => m.ts > lastRead && m.from_side === 'agent') : msgs.filter((m) => m.from_side === 'agent');
  useEffect(() => { api(`/threads/${thread.id}/read`, { method: 'POST' }); }, [thread.id]);
  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight }); }, [msgs.length]);
  useEffect(() => { if (newMsgs.length) api(`/threads/${thread.id}/summary`, { method: 'POST' }).then((r) => setSummary(r.summary)).catch(() => {}); }, [thread.id]);
  const send = async () => { if (!text.trim()) return; await api(`/threads/${thread.id}/messages`, { method: 'POST', body: { text } }); setText(''); };
  let dividerShown = false;
  return (
    <div className="thread-view">
      <div className="row"><button className="btn" onClick={onBack}>← Threads</button><b>{thread.agent_name}</b></div>
      <div className="thread-scroll" ref={boxRef}>
        {msgs.map((m) => {
          const isNew = lastRead && m.ts > lastRead && m.from_side === 'agent';
          const divider = isNew && !dividerShown ? (dividerShown = true, true) : false;
          return (
            <div key={m.id}>
              {divider && <div className="since-divider"><span>Since you last opened{summary ? ` — ${summary}` : ''}</span></div>}
              <div className={`tmsg ${m.from_side}`}>
                <div className="m-head"><b>{m.from_side === 'host' ? 'You' : thread.agent_name}</b><span className="ts">{new Date(m.ts).toLocaleTimeString('en-GB')}</span>
                  {m.from_side === 'agent' && m.run_id && <button className="link" onClick={() => onInspect({ agentId: thread.agent_id })}>🔀 workflow</button>}
                </div>
                <div>{m.text}</div>
                {m.card && <VisualCard card={m.card} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="row"><input className="thread-input" placeholder={`Message ${thread.agent_name}…`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} /><button className="btn primary" onClick={send}>Send</button></div>
    </div>
  );
}

function VisualCard({ card }) {
  if (!card) return null;
  const d = card.data || {};
  return (
    <div className="visual-card">
      <div className="vc-title">{card.title}</div>
      {card.card_type === 'checklist' && <ul>{(d.items || []).map((it, i) => <li key={i}>☐ {it}</li>)}</ul>}
      {card.card_type === 'table' && <table><tbody>{(d.rows || []).map((r, i) => <tr key={i}>{(r.cells || r).map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>}
      {card.card_type === 'timeline' && <ol className="timeline">{(d.events || []).map((e, i) => <li key={i}><b>{e.t || e.time}</b> {e.label || e.text}</li>)}</ol>}
      {card.card_type === 'chart' && <div className="chart">{(d.bars || []).map((b, i) => <div key={i} className="bar" style={{ height: `${Math.max(6, (b.value / Math.max(...(d.bars.map(x => x.value)), 1)) * 90)}%` }} title={`${b.label}: ${b.value}`}><span>{b.label}</span></div>)}</div>}
    </div>
  );
}

// ---- F3: workflow inspector -----------------------------------------------------
function Inspector({ agentId, state, onClose }) {
  const [tab, setTab] = useState('diagram'); const [sel, setSel] = useState(null); const [answer, setAnswer] = useState(null); const [q, setQ] = useState('');
  const events = (state?.workflow || []).filter((e) => e.agent_id === agentId);
  const agent = (state?.agents || []).find((a) => a.id === agentId);
  const runs = [...new Set(events.map((e) => e.run_id))];
  const latestRun = runs[runs.length - 1];
  const nodes = events.filter((e) => e.run_id === latestRun);
  const activeNode = [...nodes].reverse().find((n) => n.status === 'active') || null;
  const termRef = useRef(null);
  useEffect(() => { termRef.current?.scrollTo({ top: termRef.current.scrollHeight }); }, [events.length]);
  const ask = async () => { if (!q.trim() || !sel) return; const r = await api(`/agents/${agentId}/ask`, { method: 'POST', body: { node_id: sel.id, question: q } }); setAnswer(r.answer); setQ(''); };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal inspector" onClick={(e) => e.stopPropagation()}>
        <div className="card-title">{agent?.name || agentId} · workflow inspector {agent?.status && <span className={`pill ${agent.status}`}>{agent.status}</span>}<button className="x" onClick={onClose}>✕</button></div>
        <nav className="tabs">
          <button className={tab === 'diagram' ? 'on' : ''} onClick={() => setTab('diagram')}>🔀 Diagram</button>
          <button className={tab === 'terminal' ? 'on' : ''} onClick={() => setTab('terminal')}>🖥 Terminal</button>
        </nav>
        {tab === 'diagram' && (
          <div className="diagram">
            {nodes.length === 0 && <p className="muted">No workflow yet — give {agent?.name || 'this agent'} a task.</p>}
            <svg viewBox={`0 0 ${Math.max(560, nodes.length * 130)} 90`} className="wf-svg">
              {nodes.map((n, i) => {
                const x = 20 + i * 130, y = 40;
                return (
                  <g key={n.id}>
                    {i > 0 && <line x1={x - 130 + 105} y1={y} x2={x - 15} y2={y} stroke="#4a5a6a" strokeWidth="2" markerEnd="url(#arr)" />}
                    <rect x={x - 15} y={y - 22} width="110" height="44" rx="9" className={`wf-node ${n.status === 'active' || n.id === activeNode?.id ? 'active' : ''} ${n.status === 'error' ? 'error' : ''} ${sel?.id === n.id ? 'sel' : ''}`} onClick={() => { setSel(n); setAnswer(null); }} />
                    <text x={x + 40} y={y - 3} className="wf-label">{n.node.slice(0, 13)}</text>
                    <text x={x + 40} y={y + 14} className="wf-sub">{n.kind} · {n.duration_ms != null ? n.duration_ms + 'ms' : n.status}</text>
                  </g>
                );
              })}
              <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6" fill="#4a5a6a" /></marker></defs>
            </svg>
            {sel && (
              <div className="node-detail card">
                <div className="card-title">{sel.node} <span className={`pill ${sel.status}`}>{sel.status}</span><button className="x" onClick={() => setSel(null)}>✕</button></div>
                <div className="node-io"><div><b>Input</b><pre>{JSON.stringify(sel.input, null, 1)?.slice(0, 400)}</pre></div><div><b>Output</b><pre>{JSON.stringify(sel.output, null, 1)?.slice(0, 400)}</pre></div></div>
                <div className="row"><input className="thread-input" placeholder="Ask about this step…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} /><button className="btn primary" onClick={ask}>Ask</button></div>
                {answer && <p className="ask-answer">💡 {answer}</p>}
              </div>
            )}
          </div>
        )}
        {tab === 'terminal' && (
          <div className="terminal" ref={termRef}>
            {events.length === 0 && <div className="tl muted">— no events yet —</div>}
            {events.map((e) => (
              <div key={e.id} className={`tl ${e.status}`} onClick={() => { setSel(e); setTab('diagram'); }}>
                <span className="ts">{e.ts.slice(11, 19)}</span> <b>{e.node}</b> <span className="tl-kind">{e.kind}</span> {e.duration_ms != null && <span className="tl-dur">{e.duration_ms}ms</span>} {e.status === 'error' && <span className="tl-err">{JSON.stringify(e.output)?.slice(0, 120)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
