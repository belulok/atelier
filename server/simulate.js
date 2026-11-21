// "Simulate overnight": injects 4 realistic events and dispatches the 4 agents in
// parallel. (a) German guest asks for 11:00 check-in at Flat 2 → approval.
// (b) Flat 1 guest reports broken heater + asks £40 refund → approval.
// (c) Flat 3 Saturday cleaner cancels → Theo reschedules WITHOUT approval.
// (d) Flat 3 Saturday is empty, rate could drop → approval.
import { q, audit } from './db.js';
import { emit } from './events.js';
import { runAgent } from './agents.js';
import { chat, tts, MOCK, MODEL } from './mistral.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'audio');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const DAY = 86400000;
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const saturday = () => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return d.toISOString().slice(0, 10); };

export async function simulateOvernight() {
  audit(null, 'system', '🌙 Overnight simulation started — 4 events incoming.');
  const sat = saturday();

  // (a) German guest asks for 11:00 check-in at Flat 2
  q.run('INSERT INTO messages (id,booking_id,from_side,text,lang,ts) VALUES (?,?,?,?,?,?)',
    'm_night_a_'+Math.random().toString(36).slice(2,7), 'bk2', 'guest', 'Hallo! Wir kommen morgen an und wollten fragen: Könnten wir bitte schon um 11:00 Uhr einchecken? Vielen Dank! 😊', 'de', new Date().toISOString());
  // (b) Flat 1 guest: broken heater + £40 refund ask
  q.run('INSERT INTO messages (id,booking_id,from_side,text,lang,ts) VALUES (?,?,?,?,?,?)',
    'm_night_b_'+Math.random().toString(36).slice(2,7), 'bk1', 'guest', 'Hi — the heater in the flat isn\'t working at all and it\'s freezing in here. Can you get someone out? And can you take £40 off our stay for the trouble?', 'en', new Date().toISOString());
  // (c) Flat 3 Saturday cleaner cancels
  q.run("UPDATE cleaning_jobs SET status='cancelled', note='Marta cancelled (sick)' WHERE id='j3'");
  // (d) Flat 3 Saturday is empty (no booking covers it — seeded that way)
  q.run('DELETE FROM rates WHERE flat_id=? AND date=?', 'flat3', sat); // ensure visible
  q.run('INSERT OR IGNORE INTO rates (flat_id,date,price) VALUES (?,?,?)', 'flat3', sat, 181);
  emit('state');

  const jobs = [
    runAgent('mila', `New overnight guest message on booking bk2 (Lukas Weber, German, Flat 2, arrives ${day(0)}): "Hallo! Wir kommen morgen an und wollten fragen: Könnten wir bitte schon um 11:00 Uhr einchecken? Vielen Dank!" Read it with list_messages/get_booking. If you want to grant the 11:00 early check-in and reply in German, you MUST raise a hand first (request_approval type early_checkin, with the exact German reply in payload.reply and booking_id). Do not claim anything happened before approval.`),
    runAgent('mila', `New overnight guest message on booking bk1 (Emma Clarke, English, Flat 1, checked in): "Hi — the heater in the flat isn't working at all and it's freezing in here. Can you get someone out? And can you take £40 off our stay for the trouble?" Handle it: any refund or guest reply needs request_approval first (type refund, amount_gbp 40, payload.reply with your drafted reply).`),
    runAgent('theo', `Overnight: cleaning job j3 (Flat 3, ${sat} Saturday) — the cleaner just cancelled (see job note). Reschedule the turnover with another cleaner from our pool (Daniel Osei). This does NOT need host approval — use reschedule_cleaning and log_note. Report only what you actually did.`),
    runAgent('priya', `Overnight: Flat 3 (Camden Loft) has NO booking this Saturday ${sat}; the rate is £181. Check get_rates/get_overview. If you want to drop the Saturday rate to £145 to fill the night, raise a hand: request_approval type price_change with payload {flat_id:'flat3', date:'${sat}', new_price:145} and amount_gbp -36. Price changes always need approval.`),
  ];
  // NOTE: mila gets two events; run sequentially so her second turn starts after the first.
  const [a, c, d] = await Promise.all([jobs[0], jobs[2], jobs[3]]);
  const b = await jobs[1];
  audit(null, 'system', '🌙 Overnight simulation finished dispatching agents.');
  return { a, b, c, d };
}

// "Morning briefing": summarize the night (audit log + data) in ~30s of speech via Mistral + Voxtral.
export async function morningBriefing() {
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const ctx = {
    audit: q.all('SELECT * FROM audit WHERE ts>? ORDER BY id', since).slice(-30),
    approvals: q.all('SELECT * FROM approvals ORDER BY created_at DESC LIMIT 10'),
    bookings: q.all('SELECT * FROM bookings ORDER BY checkin'),
    jobs: q.all('SELECT * FROM cleaning_jobs ORDER BY date'),
    unread: q.all("SELECT m.*, b.guest_name FROM messages m JOIN bookings b ON b.id=m.booking_id WHERE m.from_side='guest' ORDER BY m.ts DESC LIMIT 5"),
  };
  const prompt = `You are the host's AI back office writing a 30-second SPOKEN morning briefing (about 70-80 words, plain text, no markdown). Summarize the night from this data: ${JSON.stringify(ctx)}. Mention: approvals taken and their money impact, the cleaning reschedule, the Flat 3 Saturday situation, and what needs the host's attention this morning. Start with "Good morning!".`;
  let text;
  if (MOCK) {
    const n = ctx.approvals.length;
    text = `Good morning! Overnight your team handled four events. ${n ? `${n} approval request(s) are on your desk — check the Approvals tab before anything else. ` : ''}A guest in Flat 2 asked for 11am check-in, Flat 1 reported a broken heater with a £40 refund ask, Flat 3's Saturday cleaner cancelled and Theo rescheduled, and Flat 3's Saturday is still empty. Have a great day!`;
  } else {
    const msg = await chat({ messages: [{ role: 'user', content: prompt }] });
    text = msg.content;
  }
  audit(null, 'system', '☀️ Morning briefing generated.');
  let audioUrl = null;
  try {
    const buf = await tts(text);
    if (buf) { const name = `briefing-${Date.now()}.mp3`; fs.writeFileSync(path.join(AUDIO_DIR, name), buf); audioUrl = '/api/audio/' + name; }
  } catch (e) { console.error('briefing tts', e.message); }
  emit('state');
  return { text, audio_url: audioUrl, engine: MOCK ? 'local-stub (set MISTRAL_API_KEY for Voxtral)' : `mistral ${MODEL} + voxtral tts` };
}
