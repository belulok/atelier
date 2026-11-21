// Server-side Mistral API client. The API key lives only here (loaded from .env),
// never in the browser. All AI goes through Mistral — no other providers.
//
// If MISTRAL_API_KEY is empty, a clearly-labeled LOCAL DEMO STUB answers instead so
// the hackathon demo still runs end-to-end. Set the key in .env for real Mistral AI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

export const API_KEY = process.env.MISTRAL_API_KEY || '';
export const MODEL = process.env.MISTRAL_MODEL || 'mistral-large-latest';
// Agent tasks (plan, run each step, re-plan) use a fast non-reasoning model so the host can watch
// steps move; mistral-large-latest now reasons first and takes far longer per call.
export const TASK_MODEL = process.env.MISTRAL_TASK_MODEL || 'mistral-medium-latest';
// Voxtral 3 ids per docs.mistral.ai (Studio > Audio). The 2603 TTS id is deprecated.
export const TTS_MODEL = process.env.VOXTRAL_TTS_MODEL || 'voxtral-mini-tts-3-0';
export const STT_MODEL = process.env.VOXTRAL_STT_MODEL || 'voxtral-mini-transcribe-3';
// TTS needs a voice: a preset slug (docs example: gb_jane_neutral) or a saved workspace voice id.
export const TTS_VOICE = process.env.VOXTRAL_VOICE || 'gb_jane_neutral';
export const BASE = 'https://api.mistral.ai/v1';
export const MOCK = !API_KEY;
if (MOCK) console.warn('[atelier] MISTRAL_API_KEY not set — using LOCAL DEMO STUB (no external AI). Put your key in .env for real Mistral AI.');

async function call(pathname, body, raw = false) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mistral ${pathname} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return raw ? res : res.json();
}

// Chat completions with function calling.
export async function chat({ messages, tools, toolChoice = 'auto', model }) {
  if (MOCK) return mockChat(messages, tools);
  const body = { model: model || MODEL, messages, temperature: 0.3 };
  if (tools?.length) { body.tools = tools; body.tool_choice = toolChoice; }
  const r = await call('/chat/completions', body);
  const msg = r.choices[0].message;
  // Mistral can return content as a list of chunks (text, and reasoning for some models).
  // The app works with plain text, so keep only the text chunks.
  if (Array.isArray(msg.content)) {
    msg.content = msg.content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('');
  }
  return msg;
}

// Voxtral TTS: POST /v1/audio/speech -> mp3. The docs return the audio base64-encoded
// in `audio_data` (JSON); raw audio bytes are accepted too, in case the API returns them.
export async function tts(text) {
  if (MOCK) return null;
  const res = await call('/audio/speech', { model: TTS_MODEL, input: text, voice_id: TTS_VOICE, response_format: 'mp3' }, true);
  if ((res.headers.get('content-type') || '').includes('json')) {
    const j = await res.json();
    if (!j.audio_data) throw new Error('Voxtral TTS response had no audio_data');
    return Buffer.from(j.audio_data, 'base64');
  }
  return Buffer.from(await res.arrayBuffer());
}

// Voxtral STT: POST /v1/audio/transcriptions (multipart) -> text
export async function stt(fileBuffer, filename, mime) {
  if (MOCK) return null;
  const fd = new FormData();
  fd.append('model', STT_MODEL);
  fd.append('file', new Blob([fileBuffer], { type: mime || 'audio/webm' }), filename);
  const res = await fetch(BASE + '/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${API_KEY}` }, body: fd });
  if (!res.ok) throw new Error(`Mistral /audio/transcriptions ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const r = await res.json();
  return r.text || '';
}

// ---------------------------------------------------------------------------
// LOCAL DEMO STUB — only used when MISTRAL_API_KEY is empty. Deterministic
// keyword routing that emits the same tool_calls the real model would.
function mockChat(messages, tools) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const toolNames = messages.filter((m) => m.role === 'tool' && m.name).map((m) => m.name);
  const text = (last?.content || '') + ' ' + JSON.stringify(messages.filter((m) => m.role === 'tool').map((m) => m.content));
  const has = (s) => text.toLowerCase().includes(s);
  const already = (t) => toolNames.includes(t);
  const tool = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'call_' + Math.random().toString(36).slice(2, 10), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const reply = (content) => ({ role: 'assistant', content });

  if (has('chat thread') || has('thread')) {
    if (already('send_visual_card')) return reply('Done — the checklist card is attached to my reply. Anything else?');
    return tool('send_visual_card', { card_type: 'checklist', title: 'Overnight actions', data: { items: ['£40 refund approved for Emma (Flat 1, broken heater)', '11:00 early check-in for Lukas denied', 'Flat 3 Saturday rate dropped £181 → £145', 'Saturday cleaner rescheduled to Daniel Osei'] } });
  }
  if (has('11:00') || has('einchecken') || has('check-in')) {
    if (already('request_approval')) return reply('Raised a hand and waiting for the host — the early check-in is pending, not done yet.');
    if (has('reply_sent') || has('approved') || has('denied')) return reply('Done — I updated the booking and the guest has been told. Anything else?');
    return tool('request_approval', {
      type: 'early_checkin',
      summary: 'Lukas Weber (Flat 2, arrives today) asks in German for 11:00 early check-in. Grant it and send the German reply?',
      amount_gbp: 0,
      payload: {
        booking_id: 'bk2', new_checkin_time: '11:00',
        reply: 'Guten Tag Lukas! Ja, 11:00 Uhr Check-in ist kein Problem — wir freuen uns auf Sie! 🇩🇪',
      },
    });
  }
  if (has('heater') || has('heizung') || has('refund') || has('£40') || has('40')) {
    if (already('request_approval')) return reply('Raised a hand for the £40 refund — waiting for the host. Nothing has been sent or refunded yet.');
    if (has('approved') || has('denied') || has('reply_sent')) return reply('Handled — the decision is recorded and the guest informed.');
    return tool('request_approval', {
      type: 'refund',
      summary: 'Emma Clarke (Flat 1, checked in) reports the heater is broken and asks for a £40 refund. Approve £40 off her stay and send the apology reply?',
      amount_gbp: 40,
      payload: {
        booking_id: 'bk1', refund_gbp: 40,
        reply: 'Hi Emma, so sorry about the heater — a £40 refund has been applied to your stay and we\'re sending an engineer today.',
      },
    });
  }
  if (has('cleaner') && (has('cancel') || has('sick') || has('marta'))) {
    if (already('reschedule_cleaning')) return reply('Turnover rescheduled with Daniel — no approval needed, it\'s done and logged.');
    return tool('reschedule_cleaning', { job_id: 'j3', cleaner: 'Daniel Osei', new_time: '13:00', note: 'Marta cancelled (sick) — moved to Daniel at 13:00' });
  }
  if (has('empty') || has('saturday') || has('rate') || has('drop') || has('price')) {
    if (already('request_approval')) return reply('Raised a hand on the Saturday price drop — waiting for the host.');
    if (has('approved') || has('denied')) return reply('Price decision recorded.');
    return tool('request_approval', {
      type: 'price_change',
      summary: 'Flat 3 (Camden Loft) has no booking this Saturday. Drop the Saturday rate from £181 to £145 to attract a last-minute booking?',
      amount_gbp: -36,
      payload: { flat_id: 'flat3', date: null, new_price: 145 },
    });
  }
  if (has('asked about step') || has('step “') || has('question:')) return reply('That step ran against the local store and the result above is what actually happened.');
  if (has('briefing') || has('summary') || has('morning')) return reply('Morning briefing drafted.');
  return reply('Got it — I\'ll take care of it. Anything that moves money or messages a guest, I\'ll raise a hand first.');
}
