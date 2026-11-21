// Atelier — Express server. Serves the API + SSE stream only; the React app
// is served by Vite (dev) which proxies /api here. The Mistral key never leaves this process.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, q, seed, snapshot, audit } from './db.js';
import { onEvent, emit } from './events.js';
import { getApproval, resolveApproval, approvalAudioPath } from './approvals.js';
import { notifyApprovalResolved, runAgent, instruct, askAboutStep, agentDef } from './agents.js';
import { simulateOvernight, morningBriefing } from './simulate.js';
import { DEPARTMENTS, hireAgent } from './team.js';
import { ensureColleagueAgents } from './colleagues.js';
import { stt, tts, chat, MOCK, MODEL } from './mistral.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4100);

if (q.all('SELECT id FROM flats').length === 0) { console.log('[atelier] seeding demo data…'); seed(); }
ensureColleagueAgents(); // every agent in the office is a real, chat-able agent

const app = express();
app.use(express.json({ limit: '25mb' }));

// --- SSE stream: every state change fans out a fresh snapshot -----------------
const clients = new Set();
onEvent(() => { const snap = JSON.stringify(snapshot()); for (const res of clients) res.write(`event: state\ndata: ${snap}\n\n`); });
app.get('/api/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

app.get('/api/state', (_req, res) => res.json(snapshot()));
app.get('/api/meta', (_req, res) => res.json({ mock: MOCK, model: MODEL, ai: MOCK ? 'local-demo-stub (set MISTRAL_API_KEY in .env for Mistral AI)' : 'mistral' }));

app.post('/api/reset', (_req, res) => { seed(); ensureColleagueAgents(); emit('state'); res.json({ ok: true }); });

app.post('/api/simulate/overnight', async (_req, res) => {
  res.json({ ok: true, started: true });
  simulateOvernight().catch((e) => { console.error(e); audit(null, 'system', '⚠️ overnight error: ' + e.message); emit('state'); });
});

app.post('/api/briefing', async (_req, res) => {
  try { res.json(await morningBriefing()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Approvals ---------------------------------------------------------------
app.post('/api/approvals/:id/resolve', async (req, res) => {
  const { decision } = req.body || {};
  if (!['approved', 'denied'].includes(decision)) return res.status(400).json({ error: 'decision must be approved|denied' });
  const r = resolveApproval(req.params.id, decision);
  if (!r.ok) return res.status(409).json(r);
  emit('state');
  // let the agent react honestly to the decision (fire and forget)
  notifyApprovalResolved(r.approval.agent_id, r.approval, decision).catch((e) => console.error('followup', e.message));
  res.json(r);
});

app.get('/api/approvals/:id/audio', (req, res) => {
  const p = approvalAudioPath(req.params.id);
  if (!p) return res.status(404).end();
  res.type('audio/mpeg').sendFile(p);
});

// --- Voice: Voxtral STT (server-side; raw audio body -> Mistral multipart) -----
app.post('/api/voice/stt', async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);
    const mime = req.headers['content-type'] || 'audio/webm';
    if (MOCK) {
      // no key: we cannot run Voxtral — tell the client to use browser speech instead
      return res.status(501).json({ error: 'MISTRAL_API_KEY not set — Voxtral STT unavailable; client should fall back to browser speech recognition' });
    }
    if (!buf.length) return res.status(400).json({ error: 'empty audio' });
    const ext = mime.includes('wav') ? 'wav' : mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('mpeg') ? 'mp3' : 'webm';
    const text = await stt(buf, `voice.${ext}`, mime);
    res.json({ text, engine: 'voxtral-stt' });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/audio/:name', (req, res) => {
  const p = path.join(__dirname, '..', 'data', 'audio', path.basename(req.params.name));
  if (!fs.existsSync(p)) return res.status(404).end();
  res.type('audio/mpeg').sendFile(p);
});

// --- F1: team builder (create / rename / delete agents) ------------------------
app.post('/api/agents', (req, res) => {
  const { name, role, department, desk, instructions, reports_to } = req.body || {};
  try {
    const agent = hireAgent({ name, role, department, desk, instructions, reportsTo: reports_to });
    res.json({ ok: true, id: agent.id, agent });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/agents/:id', (req, res) => {
  const { name, role, department, desk } = req.body || {};
  const a = q.get('SELECT * FROM agents WHERE id=?', req.params.id);
  if (!a) return res.status(404).json({ error: 'no such agent' });
  const dept = DEPARTMENTS[department] || null;
  q.run('UPDATE agents SET name=COALESCE(?,name), role=COALESCE(?,role), department=COALESCE(?,department), desk=COALESCE(?,desk), floor=COALESCE(?,floor), team=COALESCE(?,team) WHERE id=?',
    name ?? null, role ?? null, department ?? null, desk ?? null, dept?.floor ?? null, dept?.team ?? null, req.params.id);
  audit(req.params.id, 'system', `✏️ agent updated: ${name || a.name}`);
  emit('state');
  res.json({ ok: true });
});
app.delete('/api/agents/:id', (req, res) => {
  const a = q.get('SELECT * FROM agents WHERE id=?', req.params.id);
  if (!a) return res.status(404).json({ error: 'no such agent' });
  if (!a.is_custom) return res.status(400).json({ error: 'built-in agents cannot be deleted' });
  q.run('DELETE FROM agents WHERE id=?', req.params.id);
  q.run('DELETE FROM agent_state WHERE agent_id=?', req.params.id);
  q.run('DELETE FROM workflow_events WHERE agent_id=?', req.params.id);
  audit(null, 'system', `👋 agent removed: ${a.name}`);
  emit('state');
  res.json({ ok: true });
});

// --- F3: workflow inspector ------------------------------------------------------
app.get('/api/agents/:id/workflow', (req, res) => {
  const safe = (s) => { if (!s) return null; try { return JSON.parse(s); } catch { return { truncated: s }; } };
  res.json(q.all('SELECT * FROM workflow_events WHERE agent_id=? ORDER BY id DESC LIMIT 120', req.params.id).reverse()
    .map((e) => ({ ...e, input: safe(e.input), output: safe(e.output) })));
});
app.post('/api/agents/:id/ask', async (req, res) => {
  try { res.json(await askAboutStep(req.params.id, Number(req.body?.node_id), String(req.body?.question || ''))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// --- F4/F5: instructions (voice or text) + threads + TTS --------------------------
app.post('/api/instruct', async (req, res) => {
  const { agent_id, text, voice } = req.body || {};
  if (!agentDef(agent_id)) return res.status(404).json({ error: 'no such agent' });
  res.json({ ok: true, started: true });
  const r = await instruct(agent_id, String(text || ''));
  let audio_url = null;
  if (voice && r?.final) {
    try { const buf = await tts(`${agentDef(agent_id)?.name || agent_id} says: ${r.final}`); if (buf) { const name = `reply-${Date.now()}.mp3`; fs.writeFileSync(path.join(__dirname, '..', 'data', 'audio', name), buf); audio_url = '/api/audio/' + name; } } catch {}
  }
  emit('state');
  if (audio_url) emit('voice_reply', { agent_id, audio_url, text: r.final });
});

app.post('/api/tts', async (req, res) => {
  try {
    const buf = await tts(String(req.body?.text || ''));
    if (!buf) return res.status(501).json({ error: 'MISTRAL_API_KEY not set — Voxtral TTS unavailable' });
    const name = `tts-${Date.now()}.mp3`; fs.writeFileSync(path.join(__dirname, '..', 'data', 'audio', name), buf);
    res.json({ audio_url: '/api/audio/' + name });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

function getOrCreateThread(agentId) {
  let t = q.get('SELECT * FROM threads WHERE agent_id=? AND user_id=?', agentId, 'host');
  if (!t) {
    const id = 'th_' + Math.random().toString(36).slice(2, 9);
    q.run('INSERT INTO threads (id,agent_id,user_id,created_at) VALUES (?,?,?,?)', id, agentId, 'host', new Date().toISOString());
    t = q.get('SELECT * FROM threads WHERE id=?', id);
  }
  return t;
}
app.post('/api/threads', (req, res) => {
  const { agent_id } = req.body || {};
  if (!agentDef(agent_id)) return res.status(404).json({ error: 'no such agent' });
  res.json({ thread: getOrCreateThread(agent_id) });
});
app.post('/api/threads/:id/messages', async (req, res) => {
  const t = q.get('SELECT * FROM threads WHERE id=?', req.params.id);
  if (!t) return res.status(404).json({ error: 'no such thread' });
  const text = String(req.body?.text || '');
  const voice = !!req.body?.voice;
  const mid = 'tm_' + Math.random().toString(36).slice(2, 9);
  q.run('INSERT INTO thread_messages (id,thread_id,from_side,text,ts) VALUES (?,?,?,?,?)', mid, t.id, 'host', text, new Date().toISOString());
  emit('state');
  res.json({ ok: true, id: mid });
  // agent replies in the thread; a visual card (if any) is attached to the reply
  const r = await runAgent(t.agent_id, `Chat thread with the host: "${text}". Reply concisely as ${agentDef(t.agent_id)?.name || t.agent_id}. If a checklist/table/timeline/chart would help, call send_visual_card before your final reply.`, { allowHiring: true });
  const rid = 'tm_' + Math.random().toString(36).slice(2, 9);
  q.run('INSERT INTO thread_messages (id,thread_id,from_side,text,card,run_id,ts) VALUES (?,?,?,?,?,?,?)',
    rid, t.id, 'agent', r.final, r.card ? JSON.stringify(r.card) : null, r.runId, new Date().toISOString());
  emit('state');
  if (voice && r.final) { // voice conversation: speak the reply back (Voxtral TTS)
    try {
      const buf = await tts(`${agentDef(t.agent_id)?.name || t.agent_id} says: ${r.final}`);
      if (buf) { const name = `reply-${Date.now()}.mp3`; fs.writeFileSync(path.join(__dirname, '..', 'data', 'audio', name), buf); emit('voice_reply', { thread_id: t.id, audio_url: '/api/audio/' + name, text: r.final }); }
    } catch (e) { console.error('voice reply tts', e.message); }
  }
});
// Voice conversation turn (Simple mode voice screen): one request per spoken turn.
// Stores both messages in the thread, runs the agent, and returns the reply text with
// its Voxtral audio, so the client can play it straight away (no SSE race).
app.post('/api/threads/:id/voice-turn', async (req, res) => {
  const t = q.get('SELECT * FROM threads WHERE id=?', req.params.id);
  if (!t) return res.status(404).json({ error: 'no such thread' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty text' });
  const name = agentDef(t.agent_id)?.name || t.agent_id;
  q.run('INSERT INTO thread_messages (id,thread_id,from_side,text,ts) VALUES (?,?,?,?,?)',
    'tm_' + Math.random().toString(36).slice(2, 9), t.id, 'host', text, new Date().toISOString());
  emit('state');
  try {
    const r = await runAgent(t.agent_id, `Voice conversation with the host (your reply is spoken aloud): "${text}". Reply as ${name} in one to three short, natural spoken sentences. No markdown, lists or emoji.`, { allowHiring: true });
    const reply = r.final || '';
    q.run('INSERT INTO thread_messages (id,thread_id,from_side,text,card,run_id,ts) VALUES (?,?,?,?,?,?,?)',
      'tm_' + Math.random().toString(36).slice(2, 9), t.id, 'agent', reply, r.card ? JSON.stringify(r.card) : null, r.runId, new Date().toISOString());
    emit('state');
    let audio_url = null, tts_error = null;
    if (reply && !MOCK) {
      try {
        const buf = await tts(reply);
        if (buf) {
          const dir = path.join(__dirname, '..', 'data', 'audio');
          fs.mkdirSync(dir, { recursive: true });
          const file = `voice-${Date.now()}.mp3`;
          fs.writeFileSync(path.join(dir, file), buf);
          audio_url = '/api/audio/' + file;
        }
      } catch (e) { tts_error = e.message; console.error('voice-turn tts', e.message); }
    }
    res.json({ reply, audio_url, tts: audio_url ? 'voxtral' : MOCK ? 'no-key' : 'failed', tts_error });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/threads/:id/read', (req, res) => {
  q.run('INSERT INTO thread_reads (thread_id,user_id,ts) VALUES (?,?,?) ON CONFLICT(thread_id,user_id) DO UPDATE SET ts=excluded.ts', req.params.id, 'host', new Date().toISOString());
  emit('state'); res.json({ ok: true });
});
// Quick Glance: card shown when the user returns to a thread after a run since last read.
// Cached per "last agent message ts" so it only recomputes when something new happened.
app.post('/api/threads/:id/glance', async (req, res) => {
  const t = q.get('SELECT * FROM threads WHERE id=?', req.params.id);
  if (!t) return res.status(404).json({ error: 'no such thread' });
  const read = q.get('SELECT ts FROM thread_reads WHERE thread_id=? AND user_id=?', t.id, 'host');
  const msgs = q.all('SELECT * FROM thread_messages WHERE thread_id=? ORDER BY ts', t.id);
  const lastAgentMsg = [...msgs].reverse().find((m) => m.from_side === 'agent');
  const since = read?.ts || '1970-01-01';
  const newMsgs = msgs.filter((m) => m.from_side === 'agent' && m.ts > since);
  const events = q.all('SELECT * FROM workflow_events WHERE agent_id=? AND ts>? ORDER BY id', t.agent_id, since);
  const latestRun = events.length ? events[events.length - 1].run_id : null;
  const runNodes = latestRun ? q.all('SELECT * FROM workflow_events WHERE run_id=? ORDER BY seq', latestRun) : [];
  const done = runNodes.filter((n) => n.status === 'done').length;
  const progress = runNodes.length ? Math.round((done / runNodes.length) * 100) : (newMsgs.length ? 100 : 0);
  const changed = events.slice(-6).map((e) => ({ ts: e.ts, label: e.node, status: e.status, kind: e.kind }));
  const pendingForAgent = q.all("SELECT * FROM approvals WHERE agent_id=? AND status='pending'", t.agent_id);
  const cacheKey = lastAgentMsg?.ts || t.created_at;
  if (t.glance_json && t.glance_for === cacheKey) return res.json(JSON.parse(t.glance_json));

  let summary, suggestions;
  const ctx = { newMessages: newMsgs.map((m) => m.text), changed, progress, pendingApprovals: pendingForAgent.map((a) => ({ type: a.type, summary: a.summary, amount: a.amount_gbp })) };
  if (MOCK) {
    summary = (newMsgs.length ? newMsgs.map((m) => m.text.slice(0, 90)) : ['Nothing new — the agent is idle.']).slice(0, 4);
    suggestions = ['View conversation', 'Ask a follow-up by voice', ...(pendingForAgent.length ? [`Decide the pending ${pendingForAgent[0].type} (${pendingForAgent[0].amount_gbp ? '£' + pendingForAgent[0].amount_gbp : 'no cost'})`] : ['Review the latest workflow step'])];
  } else {
    const prompt = `You are ${agentDef(t.agent_id)?.name || 'the agent'}'s quick-glance card for the host. Given: ${JSON.stringify(ctx)}. Return JSON: {"summary": [up to 4 short bullet strings of what happened since the host last read], "suggestions": [up to 3 short action strings the host can do next, e.g. "View conversation", "Approve the £40 refund", "Ask about step X"]}. Plain JSON only.`;
    const msg = await chat({ messages: [{ role: 'user', content: prompt }] });
    try { const parsed = JSON.parse(msg.content.replace(/```json|```/g, '').trim()); summary = parsed.summary; suggestions = parsed.suggestions; }
    catch { summary = [(msg.content || '').slice(0, 120)]; suggestions = ['View conversation', 'Ask a follow-up']; }
  }
  const glance = { summary, suggestions, progress, changed, newCount: newMsgs.length, lastRead: read?.ts || null, generated_at: new Date().toISOString() };
  try { q.run('ALTER TABLE threads ADD COLUMN glance_json TEXT'); } catch {}
  try { q.run('ALTER TABLE threads ADD COLUMN glance_for TEXT'); } catch {}
  q.run('UPDATE threads SET glance_json=?, glance_for=? WHERE id=?', JSON.stringify(glance), cacheKey, t.id);
  res.json(glance);
});

// "Since you last opened" catch-up summary, written by Mistral
app.post('/api/threads/:id/summary', async (req, res) => {
  const t = q.get('SELECT * FROM threads WHERE id=?', req.params.id);
  if (!t) return res.status(404).json({ error: 'no such thread' });
  const read = q.get('SELECT ts FROM thread_reads WHERE thread_id=? AND user_id=?', t.id, 'host');
  const msgs = q.all('SELECT * FROM thread_messages WHERE thread_id=? AND ts>? ORDER BY ts', t.id, read?.ts || '1970-01-01');
  if (!msgs.length) return res.json({ summary: 'Nothing new since you last opened this thread.' });
  const prompt = `Summarise in ONE line what ${agentDef(t.agent_id)?.name || 'the agent'} said in these new chat messages: ${JSON.stringify(msgs.map(m => ({ from: m.from_side, text: m.text })))}`;
  let summary;
  if (MOCK) summary = `${msgs.length} new message(s): “${msgs[msgs.length - 1].text.slice(0, 110)}”`;
  else summary = (await chat({ messages: [{ role: 'user', content: prompt }] })).content;
  res.json({ summary });
});


app.listen(PORT, () => console.log(`[atelier] server on http://localhost:${PORT}  (AI: ${MOCK ? 'LOCAL DEMO STUB — set MISTRAL_API_KEY in .env' : 'Mistral ' + MODEL})`));
