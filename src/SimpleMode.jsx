import { useEffect, useMemo, useRef, useState } from 'react';
import AgentHead from './office/AgentHead.jsx';
import { api, uploadAudio } from './api.js';

const TEAM_COLORS = { software: '#3279e8', research: '#24ad68', content: '#f3b91f', support: '#ec503d' };

// SIMPLE MODE: 100% chat. A list of threads ("all your chats"); tapping one opens a
// Quick Glance card (summary since last read, progress, what changed, suggestions) with
// a "View conversation" button for the full thread. Voice = Voxtral back-and-forth.
export default function SimpleMode({ state, voiceReply, onExit }) {
  const [threadId, setThreadId] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [glance, setGlance] = useState(null);
  const [talking, setTalking] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const [text, setText] = useState('');
  const audioRef = useRef(null);
  const talkingRef = useRef(false);
  const recRef = useRef(null);
  const srRef = useRef(null);

  const agents = state?.agents || [];
  const threads = state?.threads || [];
  const active = threads.find((t) => t.id === threadId);

  // open thread → if there is agent activity since last read, fetch the Quick Glance
  useEffect(() => {
    setGlance(null); setShowChat(false);
    if (threadId && active && active.unread > 0) {
      api(`/threads/${threadId}/glance`, { method: 'POST' }).then(setGlance).catch(() => {});
    }
  }, [threadId, active?.last_message_at]);

  // voice_reply SSE (server TTS of agent replies) → play, then keep listening if talking
  useEffect(() => {
    if (!state) return;
  }, [state]);

  const openThread = async (agentId) => {
    const { thread } = await api('/threads', { method: 'POST', body: { agent_id: agentId } });
    setThreadId(thread.id);
  };

  const send = async (msg, voice = false) => {
    if (!msg?.trim() || !threadId) return;
    await api(`/threads/${threadId}/messages`, { method: 'POST', body: { text: msg, voice } });
    setText('');
  };

  // Voxtral voice conversation loop: listen → STT → send → agent replies → TTS plays → listen again
  const stopTalking = () => { talkingRef.current = false; setTalking(false); try { srRef.current?.stop(); } catch {} try { recRef.current?.stop(); } catch {} };
  const startTalking = async () => {
    talkingRef.current = true; setTalking(true); setVoiceNote('Listening…');
    const onText = async (t) => {
      if (!talkingRef.current) return;
      setVoiceNote(`“${t}”`);
      await send(t, true);
    };
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const r = new SR(); r.lang = 'en-GB'; r.continuous = true; r.interimResults = false;
      r.onresult = (e) => onText(e.results[e.results.length - 1][0].transcript);
      r.onend = () => { if (talkingRef.current) { try { r.start(); } catch {} } };
      srRef.current = r; r.start();
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const loop = async () => {
        if (!talkingRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        const rec = new MediaRecorder(stream); recRef.current = rec;
        const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = async () => {
          if (!talkingRef.current) return;
          try { const { text } = await uploadAudio(new Blob(chunks, { type: 'audio/webm' })); if (text) await onText(text); } catch {}
          loop();
        };
        rec.start(); setTimeout(() => { try { rec.stop(); } catch {} }, 4000);
      };
      loop();
    }
  };

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
          <button className="s-back" onClick={() => { setThreadId(null); setGlance(null); }}>←</button>
          <span className="s-avatar"><AgentHead size={34} color={TEAM_COLORS[activeAgentTeam(agents, active)] || '#f3b91f'} /></span>
          <div className="s-who"><b>{active.agent_name}</b><span className={`s-status ${activeAgentStatus(agents, active)}`}>{activeAgentStatus(agents, active)}</span></div>
          <button className={`s-mic ${talking ? 'on' : ''}`} onClick={talking ? stopTalking : startTalking} title="Voice conversation (Voxtral)">{talking ? '🎙️…' : '🎙️'}</button>
          <button className="s-mode" onClick={onExit}>Advanced</button>
        </header>
        {voiceNote && <div className="s-voicenote">{voiceNote}</div>}
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
        <audio ref={audioRef} onEnded={() => { if (talkingRef.current) { /* keep listening; SR loop already continues */ } }} />
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
              <b>{agent.name}</b><small>{agent.role}</small>
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
