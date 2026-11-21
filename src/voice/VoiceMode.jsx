import { useEffect, useRef, useState } from 'react';
import AgentHead from '../office/AgentHead.jsx';
import { api } from '../api.js';
import { VoiceEngine } from './engine.js';
import './voice.css';

// Full-screen voice conversation with one agent, like ChatGPT's voice mode, but the
// agent's own face is the visual: its ring follows your voice, it bobs while thinking,
// and its mouth moves with its voice. Talk to interrupt it. Every turn is also saved
// in the chat thread.
// `useVoxtral`: the server has a Mistral key (from /api/meta). Without one, the engine
// uses the browser's speech recognition and voice.
// embedded: render inside the chat box (Simple mode popup) instead of over the whole screen;
// the popup's own header already shows the agent's name.
// onUi(actions): the agent asked to change the chat box (show a screen, switch agent). A switch
// waits until the agent has finished speaking. stage: a screen (workflow / terminal) to show
// under a compact face. greeting: spoken once when this conversation starts (after a hand-over).
export default function VoiceMode({ agent, color, threadId, useVoxtral = true, onClose, embedded = false, onUi, stage = null, greeting = '' }) {
  const [phase, setPhase] = useState('starting');
  const [level, setLevel] = useState(0);
  const [mouth, setMouth] = useState(0);
  const [blink, setBlink] = useState(false);
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [engine, setEngine] = useState('');
  const [muted, setMuted] = useState(false);
  const engineRef = useRef(null);
  const onUiRef = useRef(onUi); onUiRef.current = onUi;
  const pendingSwitchRef = useRef(null);
  const greetRef = useRef(greeting);

  useEffect(() => {
    const e = new VoiceEngine({
      turn: async (text) => {
        const r = await api(`/threads/${threadId}/voice-turn`, { method: 'POST', body: { text } });
        const ui = r.ui || [];
        const sw = ui.find((a) => a.type === 'switch_agent');
        if (sw) pendingSwitchRef.current = sw; // after the agent finishes speaking
        else if (ui.length) onUiRef.current?.(ui);
        if (sw && !r.reply) { pendingSwitchRef.current = null; onUiRef.current?.([sw]); }
        return r;
      },
      onPhase: (p) => {
        setPhase(p); if (p === 'hearing') setNote('');
        if (p === 'listening' && pendingSwitchRef.current) { const sw = pendingSwitchRef.current; pendingSwitchRef.current = null; onUiRef.current?.([sw]); return; }
        if (p === 'listening' && greetRef.current) { const g = greetRef.current; greetRef.current = ''; greet(e, g); }
      },
      onLevel: setLevel,
      onMouth: setMouth,
      onHeard: setHeard,
      onReply: setReply,
      onNote: setNote,
      onEngine: setEngine,
    });
    engineRef.current = e;
    e.start(useVoxtral).catch((err) => {
      setPhase('error');
      setNote(err?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser and try again.' : `Voice couldn’t start: ${err?.message || err}`);
    });
    return () => e.stop();
  }, [threadId, useVoxtral]);

  // Blink every few seconds so the face feels alive.
  useEffect(() => {
    let t;
    const next = () => { t = setTimeout(() => { setBlink(true); setTimeout(() => setBlink(false), 130); next(); }, 2500 + Math.random() * 3000); };
    next();
    return () => clearTimeout(t);
  }, []);

  // Say hello after a hand-over (Voxtral if the server has a key, else the browser voice).
  async function greet(e, text) {
    setReply(text);
    let audio_url = null;
    if (useVoxtral) { try { audio_url = (await api('/tts', { method: 'POST', body: { text } })).audio_url; } catch {} }
    if (!e.stopped) { e.stopRecognition?.(); e.speak({ reply: text, audio_url }); }
  }

  const toggleMute = () => { const m = !muted; setMuted(m); engineRef.current?.setMuted(m); };

  const label = {
    starting: 'Connecting…',
    calibrating: 'Getting ready…',
    listening: muted ? 'Muted' : 'Listening…',
    hearing: 'Go on, I’m listening',
    thinking: `${agent.name} is thinking…`,
    speaking: `${agent.name} is speaking · talk to interrupt`,
    error: 'Voice unavailable',
  }[phase] || '';

  const ring = phase === 'speaking' ? 1 + mouth * 0.18 : 1 + level * 0.35;

  return (
    <div className={`vm${embedded ? ' vm-embedded' : ''}${stage ? ' vm-compact' : ''}`} role={embedded ? 'region' : 'dialog'} aria-label={`Voice conversation with ${agent.name}`}>
      <header className="vm-top">
        {!embedded && <div className="vm-who"><b>{agent.name}</b><small>{agent.role}</small></div>}
        {engine && <span className="vm-engine">{engine === 'voxtral' ? 'Voxtral voice' : 'Browser voice (no Mistral key)'}</span>}
      </header>

      {stage ? (
        <>
          <div className="vm-strip">
            <div className={`vm-stage ${phase}`}>
              <div className="vm-ring" style={{ transform: `scale(${ring})`, borderColor: color }} />
              <div className="vm-face"><AgentHead size={52} color={color} mouth={phase === 'speaking' ? mouth : 0} blink={blink} /></div>
            </div>
            <div className="vm-strip-text">
              <div className="vm-label">{label}</div>
              {(reply || heard) && <div className="vm-strip-cap">{reply ? <><b>{agent.name}:</b> {reply}</> : <><b>You:</b> {heard}</>}</div>}
            </div>
          </div>
          <div className="vm-stagebox">{stage}</div>
        </>
      ) : (
        <>
          <div className={`vm-stage ${phase}`}>
            <div className="vm-ring" style={{ transform: `scale(${ring})`, borderColor: color }} />
            <div className="vm-face"><AgentHead size={embedded ? 128 : 176} color={color} mouth={phase === 'speaking' ? mouth : 0} blink={blink} /></div>
            {phase === 'thinking' && <div className="vm-dots"><i /><i /><i /></div>}
          </div>

          <div className="vm-label">{label}</div>
          <div className="vm-captions">
            {heard && <p className="vm-you">{heard}</p>}
            {reply && <p className="vm-agent">{reply}</p>}
          </div>
        </>
      )}
      {note && <div className="vm-note">{note}</div>}

      <div className="vm-controls">
        <button className={`vm-btn ${muted ? 'on' : ''}`} onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>{muted ? '🔇' : '🎙️'}</button>
        <button className="vm-btn end" onClick={onClose} title="End voice conversation">✕</button>
      </div>
    </div>
  );
}
