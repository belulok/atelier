import { useEffect, useMemo, useRef, useState } from 'react';
import AgentHead from './office/AgentHead.jsx';
import { api } from './api.js';
import VoiceMode from './voice/VoiceMode.jsx';
import { primeAudio } from './voice/engine.js';

const TEAM_COLORS = { software: '#3279e8', research: '#24ad68', content: '#f3b91f', support: '#ec503d' };

// SIMPLE MODE: 100% chat. A list of threads ("all your chats"); tapping one opens a
// Quick Glance card (summary since last read, progress, what changed, suggestions) with
// a "View conversation" button for the full thread. Voice = Voxtral back-and-forth.
export default function SimpleMode({ state, voiceReply, onExit, registerOpen }) {
  const [threadId, setThreadId] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [glance, setGlance] = useState(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voxtral, setVoxtral] = useState(true); // server has a Mistral key (Voxtral available)
  const [text, setText] = useState('');
  const audioRef = useRef(null);
  // Quick Glance is armed ONLY when the popup itself is (re)opened; sending messages,
  // receiving replies or switching chats inside the popup never re-shows it.
  const glanceArmedRef = useRef(true);

  const agents = state?.agents || [];
  const threads = state?.threads || [];
  const active = threads.find((t) => t.id === threadId);

  useEffect(() => {
    if (!glanceArmedRef.current || !threadId || !active) return;
    glanceArmedRef.current = false; // consume: once per popup opening
    setGlance(null); setShowChat(false);
    if (active.unread > 0) {
      api(`/threads/${threadId}/glance`, { method: 'POST' })
        .then((g) => { setGlance(g); api(`/threads/${threadId}/read`, { method: 'POST' }).catch(() => {}); })
        .catch(() => {});
    }
  }, [threadId, active?.unread, active?.last_message_at]);

  // Know up front whether voice can use Voxtral, so opening voice mode needs no wait.
  useEffect(() => { api('/meta').then((m) => setVoxtral(!m.mock)).catch(() => {}); }, []);

  const openThread = async (agentId) => {
    const { thread } = await api('/threads', { method: 'POST', body: { agent_id: agentId } });
    setThreadId(thread.id); // does NOT re-arm the glance: only a fresh popup opening does
  };

  // Let the 3D office (visible around the popup in simple mode) open this chat on agent click.
  useEffect(() => { registerOpen?.(openThread); }, [registerOpen]);

  const send = async (msg, voice = false) => {
    if (!msg?.trim() || !threadId) return;
    await api(`/threads/${threadId}/messages`, { method: 'POST', body: { text: msg, voice } });
    setText('');
  };

  // Voice conversation (like ChatGPT voice mode, with the agent's face). primeAudio()
  // must run inside the tap so the browser allows the agent's voice to play.
  const openVoice = () => { primeAudio(); setVoiceOpen(true); };

  // play agent voice replies pushed over SSE (Voxtral TTS), like a voice conversation
  useEffect(() => {
    if (voiceReply?.audio_url && voiceReply.thread_id === threadId) {
      const el = audioRef.current; if (el) { el.src = voiceReply.audio_url; el.play().catch(() => {}); }
    }
  }, [voiceReply, threadId]);

  const list = useMemo(() => agents.map((a) => {
    const t = threads.find((x) => x.agent_id === a.id);
    return { agent: a, thread: t };
  }), [agents, threads]);

  if (active) {
    return (
      <div className="simple">
        <header className="simple-top">
          <button className="s-back" onClick={() => { setThreadId(null); setGlance(null); setVoiceOpen(false); }}>←</button>
          <button className="s-avatar s-avatar-btn" onClick={openVoice} title={`Talk to ${active.agent_name}`}><AgentHead size={34} color={TEAM_COLORS[activeAgentTeam(agents, active)] || '#f3b91f'} /></button>
          <div className="s-who"><b>{active.agent_name}</b><span className={`s-status ${activeAgentStatus(agents, active)}`}>{activeAgentStatus(agents, active)}</span></div>
          <button className="s-mic" onClick={openVoice} title={`Voice conversation with ${active.agent_name}`}>🎙️</button>
          <button className="s-mode" onClick={onExit}>Advanced</button>
        </header>
        {voiceOpen ? (
          <VoiceMode
            agent={agents.find((a) => a.id === active.agent_id) || { name: active.agent_name, role: '' }}
            color={TEAM_COLORS[activeAgentTeam(agents, active)] || '#f3b91f'}
            threadId={active.id}
            useVoxtral={voxtral}
            onClose={() => setVoiceOpen(false)}
            embedded
          />
        ) : (
        <div className="s-body">
          {glance && !showChat && (
            <div className="glance card-light">
              <div className="g-head">✨ Here’s the update <span>quick glance</span></div>
              <p className="g-sub">A quick summary of what’s happened since you last read.</p>
              <div className="g-row2">
                <div className="g-stat">🕒 Last read<b>{glance.lastRead ? new Date(glance.lastRead).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : 'Never'}</b></div>
                <div className="g-stat">💬 New messages<b>{glance.newCount}</b></div>
              </div>
              <div className="g-progress"><div className="g-progress-top"><span>How it’s going</span><b>{glance.progress}% complete</b></div><div className="g-bar"><i style={{ width: `${glance.progress}%` }} /></div></div>
              {!!glance.changed?.length && (
                <div className="g-changed"><div className="g-sec">📣 What changed</div>
                  {glance.changed.map((c, i) => <div key={i} className="g-change"><span>{c.ts.slice(11, 16)}</span><div><b>{c.label}</b><small>{c.kind} · {c.status}</small></div></div>)}
                </div>
              )}
              <div className="g-summary"><div className="g-sec">📝 In short</div><ul>{glance.summary.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
              <div className="g-next"><div className="g-sec">✨ What’s next?</div>
                <div className="g-chips">{glance.suggestions.map((s, i) => <button key={i} className="g-chip" onClick={() => { if (/conversation/i.test(s)) setShowChat(true); else send(s); }}>{s}</button>)}</div>
              </div>
              <button className="s-viewchat" onClick={() => { setShowChat(true); api(`/threads/${active.id}/read`, { method: 'POST' }); }}>💬 View conversation</button>
            </div>
          )}
          {(showChat || !glance) && (
            <div className="s-chat">
              {active.messages.map((m) => (
                <div key={m.id} className={`s-msg ${m.from_side}`}>
                  <div className="s-bubble">{m.text}{m.card && <div className="s-card"><b>{m.card.title}</b>{m.card.card_type === 'checklist' && <ul>{(m.card.data.items || []).map((it, i) => <li key={i}>☐ {it}</li>)}</ul>}</div>}</div>
                  <span className="s-ts">{new Date(m.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
              <div className="s-inputrow">
                <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send(text)} placeholder={`Message ${active.agent_name}…`} />
                <button onClick={() => send(text)}>➤</button>
              </div>
            </div>
          )}
        </div>
        )}
        <audio ref={audioRef} />
      </div>
    );
  }

  return (
    <div className="simple">
      <header className="simple-top">
        <span className="s-logo"><AgentHead size={26} /></span><b>Atelier</b>
        <span className="s-tag">An overview of all your agents, at a glance</span>
        <button className="s-mode" onClick={onExit}>Advanced</button>
      </header>
      <div className="s-body s-list">
        <div className="s-list-head">Your chats <span>{list.length} agents</span></div>
        {list.map(({ agent, thread }) => (
          <button key={agent.id} className="s-thread" onClick={() => openThread(agent.id)}>
            <span className="s-avatar"><AgentHead size={38} color={TEAM_COLORS[agent.team] || '#f3b91f'} /></span>
            <span className="s-thread-mid">
              <b>{agent.name}</b><small>{agent.role}{agent.reports_to ? ` · reports to ${agents.find((x) => x.id === agent.reports_to)?.name || 'a teammate'}` : ''}</small>
              <small className="s-preview">{thread?.messages?.length ? thread.messages[thread.messages.length - 1].text.slice(0, 60) : 'No messages yet'}</small>
            </span>
            <span className="s-thread-right">
              {thread?.unread > 0 && <span className="s-badge">{thread.unread}</span>}
              <span className={`s-dot ${agent.status}`} title={agent.status} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function activeAgentTeam(agents, thread) { return agents.find((a) => a.id === thread.agent_id)?.team || 'content'; }
function activeAgentStatus(agents, thread) { return agents.find((a) => a.id === thread.agent_id)?.status || 'idle'; }
