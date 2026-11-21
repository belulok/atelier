// Hands-free voice conversation, like ChatGPT's voice mode:
//   listening → (you start talking) hearing → (you stop) thinking → speaking → listening …
// Talking while the agent speaks interrupts it.
//
// Transcription: Voxtral (16 kHz WAV sent to /api/voice/stt) when the server has a
// Mistral key; otherwise the browser's own speech recognition. Speech: the Voxtral
// audio from the server when available; otherwise the browser's speech synthesis.
import { uploadAudio } from '../api.js';
import { encodeWav } from './wav.js';

const CALIBRATE_MS = 600; // measure background noise before listening
const START_MS = 150; // sustained voice needed to start a turn
const END_SILENCE_MS = 900; // silence that ends your turn
const MAX_TURN_MS = 20000;
const PRE_ROLL_MS = 400; // keep the start of a word that began before detection
const INTERRUPT_MS = 350; // sustained voice needed to interrupt the agent
const INTERRUPT_FACTOR = 2.5; // the agent's own voice can leak into the mic, so interrupting needs to be louder

const rmsOf = (buf) => { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); };

// Browsers (Safari especially) only allow audio that is started during a tap. Call
// primeAudio() synchronously in the click handler that opens voice mode: it creates
// the audio context and the player the engine reuses, and unlocks both.
let shared = null;
export function primeAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!shared || shared.ctx.state === 'closed') {
    const ctx = new Ctx();
    const audio = new Audio();
    audio.playsInline = true;
    const outAnalyser = ctx.createAnalyser();
    outAnalyser.fftSize = 512;
    ctx.createMediaElementSource(audio).connect(outAnalyser);
    outAnalyser.connect(ctx.destination);
    shared = { ctx, audio, outAnalyser, silence: URL.createObjectURL(encodeWav([new Float32Array(1600)], 16000)) };
  }
  shared.ctx.resume().catch(() => {});
  try { shared.audio.src = shared.silence; shared.audio.play().catch(() => {}); } catch {}
  try { window.speechSynthesis?.cancel(); window.speechSynthesis?.speak(new SpeechSynthesisUtterance(' ')); } catch {}
  return shared;
}

export class VoiceEngine {
  // turn(text) → Promise<{ reply, audio_url }>; callbacks update the UI.
  constructor({ turn, onPhase, onLevel, onMouth, onHeard, onReply, onNote, onEngine }) {
    Object.assign(this, { turn, onPhase, onLevel, onMouth, onHeard, onReply, onNote, onEngine });
    this.phase = 'starting';
    this.muted = false;
    this.stopped = false;
  }

  setPhase(p) { this.phase = p; this.onPhase?.(p); }

  async start(useVoxtral) {
    this.mode = useVoxtral ? 'voxtral' : 'browser';
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (this.mode === 'browser' && !SR) {
      this.setPhase('error');
      this.onNote?.('Voice needs a Mistral key on the server, or a browser with speech recognition (Chrome, Edge or Safari).');
      return;
    }
    this.onEngine?.(this.mode);

    // Reuses the context and player unlocked by primeAudio() during the user's tap.
    const s = shared || primeAudio();
    this.ctx = s.ctx;
    this.audio = s.audio;
    this.outAnalyser = s.outAnalyser;
    this.outBuf = new Float32Array(this.outAnalyser.fftSize);

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (this.stopped) { this.stream.getTracks().forEach((t) => t.stop()); return; }
    await this.ctx.resume().catch(() => {});
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.micSource = src;
    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 1024;
    src.connect(this.micAnalyser);
    this.micBuf = new Float32Array(this.micAnalyser.fftSize);

    // Raw samples for Voxtral: keep a short pre-roll and record during your turn.
    this.preRoll = [];
    this.turnChunks = null;
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    src.connect(proc);
    proc.connect(silent);
    silent.connect(this.ctx.destination);
    const preRollMax = Math.ceil((PRE_ROLL_MS / 1000) * this.ctx.sampleRate / 4096);
    proc.onaudioprocess = (e) => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      if (this.turnChunks) this.turnChunks.push(data);
      this.preRoll.push(data);
      if (this.preRoll.length > preRollMax) this.preRoll.shift();
    };
    this.proc = proc;
    this.silentGain = silent;

    this.floor = 0;
    this.calibrating = CALIBRATE_MS;
    this.above = 0;
    this.below = 0;
    this.turnMs = 0;
    this.last = performance.now();
    this.setPhase('calibrating');
    this.loop = requestAnimationFrame(this.tick);
  }

  get threshold() { return Math.max(0.012, this.floor * 2.5); }

  tick = (now) => {
    if (this.stopped) return;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.micAnalyser.getFloatTimeDomainData(this.micBuf);
    const rms = rmsOf(this.micBuf);
    this.onLevel?.(Math.min(1, rms / (this.threshold * 4)));

    if (this.phase === 'speaking') {
      if (this.synthSpeaking) this.onMouth?.(0.35 + 0.35 * Math.abs(Math.sin(now / 90)));
      else { this.outAnalyser.getFloatTimeDomainData(this.outBuf); this.onMouth?.(Math.min(1, rmsOf(this.outBuf) * 6)); }
    }

    switch (this.phase) {
      case 'calibrating':
        this.floor = this.floor ? this.floor * 0.9 + rms * 0.1 : rms;
        this.calibrating -= dt;
        if (this.calibrating <= 0) this.listen();
        break;
      case 'listening':
        if (this.muted) break;
        if (rms > this.threshold) this.above += dt; else { this.above = 0; this.floor = this.floor * 0.995 + rms * 0.005; }
        if (this.mode === 'voxtral' && this.above >= START_MS) this.beginTurn();
        if (this.mode === 'browser' && this.above >= START_MS) this.setPhase('hearing');
        break;
      case 'hearing':
        if (this.mode !== 'voxtral') break; // browser recognition decides when you've finished
        this.turnMs += dt;
        if (rms < this.threshold) this.below += dt; else this.below = 0;
        if (this.below >= END_SILENCE_MS || this.turnMs >= MAX_TURN_MS) this.endTurn();
        break;
      case 'speaking':
        if (this.muted) break;
        if (rms > this.threshold * INTERRUPT_FACTOR) this.above += dt; else this.above = 0;
        if (this.above >= INTERRUPT_MS) this.interrupt();
        break;
      default:
        break;
    }
    this.loop = requestAnimationFrame(this.tick);
  };

  listen() {
    if (this.stopped) return;
    this.above = 0;
    this.below = 0;
    this.onMouth?.(0);
    this.setPhase('listening');
    if (this.mode === 'browser' && !this.muted) this.startRecognition();
  }

  // --- Voxtral path: record your turn, then transcribe it ---------------------
  beginTurn() {
    this.turnChunks = [...this.preRoll];
    this.turnMs = 0;
    this.below = 0;
    this.setPhase('hearing');
  }

  async endTurn() {
    const chunks = this.turnChunks || [];
    this.turnChunks = null;
    this.setPhase('thinking');
    try {
      const wav = encodeWav(chunks, this.ctx.sampleRate);
      const { text } = await uploadAudio(wav);
      await this.handleText(text || '');
    } catch (e) {
      if (e.status === 501) { // the server has no Mistral key: switch to browser speech
        this.mode = 'browser';
        this.onEngine?.('browser');
        this.onNote?.('No Mistral key on the server, so I switched to your browser’s speech recognition. Please say that again.');
        this.listen();
        return;
      }
      this.onNote?.(`Couldn’t transcribe that: ${String(e.message).slice(0, 140)}`);
      this.listen();
    }
  }

  // --- Browser path: the browser's speech recognition ------------------------
  startRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.stopRecognition();
    const r = new SR();
    r.lang = navigator.language || 'en-GB';
    r.continuous = false;
    r.interimResults = true;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      this.onHeard?.((finalText + interim).trim());
      if (this.phase === 'listening') this.setPhase('hearing');
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed') { this.setPhase('error'); this.onNote?.('Microphone access was blocked. Allow it in the browser and try again.'); }
    };
    r.onend = () => {
      if (this.recognition !== r || this.stopped) return;
      this.recognition = null;
      if (finalText.trim()) this.handleText(finalText.trim());
      else if (this.phase === 'listening' || this.phase === 'hearing') this.listen(); // no speech yet: keep listening
    };
    this.recognition = r;
    try { r.start(); } catch {}
  }

  stopRecognition() {
    const r = this.recognition;
    this.recognition = null;
    if (r) { r.onend = null; try { r.abort(); } catch {} }
  }

  // --- Shared: send the turn to the agent, then speak the reply ----------------
  async handleText(text) {
    if (this.stopped) return;
    if (!text.trim()) { this.listen(); return; }
    this.stopRecognition();
    this.onHeard?.(text);
    this.onReply?.('');
    this.setPhase('thinking');
    let res;
    try { res = await this.turn(text); } catch (e) {
      this.onNote?.(`The agent couldn’t reply: ${String(e.message).slice(0, 140)}`);
      this.listen();
      return;
    }
    if (this.stopped) return;
    this.onReply?.(res.reply || '');
    if (!res.reply) { this.listen(); return; }
    this.speak(res);
  }

  speak({ reply, audio_url }) {
    this.above = 0;
    this.setPhase('speaking');
    const done = () => { if (this.phase === 'speaking') this.listen(); };
    if (audio_url) {
      this.synthSpeaking = false;
      this.audio.onended = done;
      this.audio.onerror = () => this.speakWithBrowser(reply, done);
      this.audio.src = audio_url;
      this.audio.play().catch(() => this.speakWithBrowser(reply, done));
    } else {
      this.speakWithBrowser(reply, done);
    }
  }

  speakWithBrowser(text, done) {
    const synth = window.speechSynthesis;
    if (!synth) { done(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || 'en-GB';
    u.onend = () => { this.synthSpeaking = false; done(); };
    u.onerror = () => { this.synthSpeaking = false; done(); };
    this.synthSpeaking = true;
    synth.speak(u);
  }

  interrupt() {
    this.audio.pause();
    this.synthSpeaking = false;
    try { window.speechSynthesis?.cancel(); } catch {}
    this.onMouth?.(0);
    if (this.mode === 'voxtral') this.beginTurn();
    else this.listen();
  }

  setMuted(m) {
    this.muted = m;
    if (m) {
      this.stopRecognition();
      if (this.phase === 'hearing') { this.turnChunks = null; this.listen(); }
    } else if (this.phase === 'listening' && this.mode === 'browser') {
      this.startRecognition();
    }
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.loop);
    this.stopRecognition();
    try { this.audio?.pause(); } catch {}
    try { window.speechSynthesis?.cancel(); } catch {}
    // Disconnect the microphone but keep the shared context and player for next time.
    try { if (this.proc) { this.proc.onaudioprocess = null; this.proc.disconnect(); } } catch {}
    try { this.silentGain?.disconnect(); this.micSource?.disconnect(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}
