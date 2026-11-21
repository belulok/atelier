// Local SQLite store (node:sqlite, no external deps). Seeded with a demo host:
// 3 London flats, bookings, guest messages, cleaning jobs, rates.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DIR, 'host.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS flats (id TEXT PRIMARY KEY, name TEXT, area TEXT, base_rate REAL);
CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, flat_id TEXT, guest_name TEXT, guest_lang TEXT,
  checkin TEXT, checkout TEXT, status TEXT, nightly_rate REAL, early_checkin_at TEXT, refund_gbp REAL DEFAULT 0, discount_gbp REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, booking_id TEXT, from_side TEXT, text TEXT, lang TEXT, ts TEXT, approved INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS cleaning_jobs (id TEXT PRIMARY KEY, flat_id TEXT, date TEXT, time TEXT, cleaner TEXT, status TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS rates (flat_id TEXT, date TEXT, price REAL, PRIMARY KEY (flat_id, date));
CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, agent_id TEXT, type TEXT, summary TEXT, amount_gbp REAL,
  payload TEXT, status TEXT DEFAULT 'pending', created_at TEXT, resolved_at TEXT, decision TEXT);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, agent_id TEXT, kind TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS agent_state (agent_id TEXT PRIMARY KEY, status TEXT, current_task TEXT, run_id TEXT,
  run_until TEXT, behavior TEXT, behavior_until TEXT, raise_label TEXT, last_reply_at TEXT, last_reply_title TEXT, memory TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT, role TEXT, department TEXT, desk INTEGER, floor INTEGER, team TEXT, is_custom INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS workflow_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, agent_id TEXT, run_id TEXT, seq INTEGER, node TEXT, kind TEXT, input TEXT, output TEXT, duration_ms INTEGER, status TEXT);
CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, agent_id TEXT, user_id TEXT DEFAULT 'host', created_at TEXT, glance_json TEXT, glance_for TEXT);
CREATE TABLE IF NOT EXISTS thread_messages (id TEXT PRIMARY KEY, thread_id TEXT, from_side TEXT, text TEXT, card TEXT, run_id TEXT, ts TEXT);
CREATE TABLE IF NOT EXISTS thread_reads (thread_id TEXT, user_id TEXT, ts TEXT, PRIMARY KEY (thread_id, user_id));
-- agent tasks you can watch (server/tasks.js): a plan of steps, run one by one; task_log is the terminal view
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, agent_id TEXT, thread_id TEXT, title TEXT, goal TEXT, instructions TEXT, expect TEXT,
  status TEXT, steps TEXT, additions TEXT DEFAULT '[]', result TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS task_log (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, ts TEXT, kind TEXT, text TEXT);
`);
// idempotency + approver on approvals (guarded for existing DBs)
for (const col of ['idempotency_key TEXT', 'approved_by TEXT']) {
  try { db.exec(`ALTER TABLE approvals ADD COLUMN ${col}`); } catch {}
}
// hired subagents (who they report to, job instructions) and coworkers' agents (owner) — guarded for existing DBs
for (const col of ['reports_to TEXT', 'instructions TEXT', 'owner TEXT']) {
  try { db.exec(`ALTER TABLE agents ADD COLUMN ${col}`); } catch {}
}

export const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString();
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

export function seed() {
  q.run('DELETE FROM flats'); q.run('DELETE FROM bookings'); q.run('DELETE FROM messages');
  q.run('DELETE FROM cleaning_jobs'); q.run('DELETE FROM rates'); q.run('DELETE FROM approvals');
  q.run('DELETE FROM audit'); q.run('DELETE FROM agent_state'); q.run('DELETE FROM agents');
  q.run('DELETE FROM workflow_events'); q.run('DELETE FROM threads'); q.run('DELETE FROM thread_messages'); q.run('DELETE FROM thread_reads');
  q.run('DELETE FROM tasks'); q.run('DELETE FROM task_log');

  const flats = [
    ['flat1', 'Flat 1 · Shoreditch Studio', 'Shoreditch, E2', 120],
    ['flat2', 'Flat 2 · Notting Hill 1-Bed', 'Notting Hill, W11', 180],
    ['flat3', 'Flat 3 · Camden Loft', 'Camden, NW1', 145],
  ];
  for (const f of flats) q.run('INSERT INTO flats VALUES (?,?,?,?)', ...f);

  const bookings = [
    ['bk1', 'flat1', 'Emma Clarke', 'en', day(1), day(4), 'checked_in', 120],
    ['bk2', 'flat2', 'Lukas Weber', 'de', day(0), day(3), 'confirmed', 180],
    ['bk3', 'flat3', 'Sofia Marino', 'it', day(8), day(10), 'confirmed', 145], // leaves this Saturday empty
  ];
  for (const b of bookings) q.run('INSERT INTO bookings (id,flat_id,guest_name,guest_lang,checkin,checkout,status,nightly_rate) VALUES (?,?,?,?,?,?,?,?)', ...b);

  q.run('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', 'm1', 'bk1', 'guest',
    'Hi! Loving the flat. Is there a hairdryer in the bathroom?', 'en', iso(Date.now() - 3 * 3600e3), 0);
  q.run('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', 'm2', 'bk1', 'host',
    'Hi Emma! Yes, it\'s in the second drawer. Enjoy your stay!', 'en', iso(Date.now() - 2 * 3600e3), 1);
  q.run('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', 'm3', 'bk2', 'guest',
    'Guten Tag! Wir freuen uns auf morgen. Wann ist Check-in?', 'de', iso(Date.now() - 5 * 3600e3), 0);

  q.run('INSERT INTO cleaning_jobs VALUES (?,?,?,?,?,?,?)', 'j1', 'flat1', day(4), '11:00', 'Marta Kowalska', 'scheduled', '');
  q.run('INSERT INTO cleaning_jobs VALUES (?,?,?,?,?,?,?)', 'j2', 'flat2', day(3), '11:00', 'Daniel Osei', 'scheduled', '');
  q.run('INSERT INTO cleaning_jobs VALUES (?,?,?,?,?,?,?)', 'j3', 'flat3', day(7), '10:30', 'Marta Kowalska', 'scheduled', ''); // Saturday job that will cancel
  q.run('INSERT INTO cleaning_jobs VALUES (?,?,?,?,?,?,?)', 'j4', 'flat3', day(10), '10:30', 'Daniel Osei', 'scheduled', '');

  for (const [fid, , , base] of flats) {
    for (let i = 0; i < 14; i++) {
      const d = day(i);
      const weekend = [5, 6].includes(new Date(d).getDay());
      q.run('INSERT INTO rates VALUES (?,?,?)', fid, d, Math.round(base * (weekend ? 1.25 : 1)));
    }
  }

  const agents = [
    ['mila', 'Mila', 'Guest Concierge', 'Guest Experience', 1, 1, 'content', 'Replies to guests in the guest\'s own language.'],
    ['theo', 'Theo', 'Turnover Coordinator', 'Operations', 2, 2, 'research', 'Cleaners, check-outs, rescheduling.'],
    ['priya', 'Priya', 'Pricing & Calendar', 'Operations', 3, 2, 'software', 'Rates, availability, empty nights.'],
    ['sam', 'Sam', 'Reviews & Reputation', 'Guest Experience', 4, 1, 'support', 'Reviews, ratings, guest sentiment.'],
  ];
  for (const [id, name, role, dept, desk, floor, team, task] of agents) {
    q.run('INSERT INTO agents (id,name,role,department,desk,floor,team,is_custom,created_at) VALUES (?,?,?,?,?,?,?,0,?)',
      id, name, role, dept, desk, floor, team, new Date().toISOString());
    q.run('INSERT INTO agent_state (agent_id,status,current_task,memory) VALUES (?,?,?,?)', id, 'idle', task, '[]');
  }
  audit(null, 'system', 'Seeded demo host: 3 London flats, 3 bookings, messages, 4 cleaning jobs, 4 agents.');
}

export function audit(agentId, kind, detail) {
  q.run('INSERT INTO audit (ts,agent_id,kind,detail) VALUES (?,?,?,?)', iso(Date.now()), agentId, kind, detail);
}

export function snapshot() {
  const agents = q.all(`SELECT s.*, a.name, a.role, a.department, a.desk AS meta_desk, a.floor, a.team AS meta_team, a.is_custom, a.reports_to, a.owner
    FROM agent_state s LEFT JOIN agents a ON a.id = s.agent_id ORDER BY s.agent_id`).map((r) => ({
    ...r,
    id: r.agent_id, // the 3D office keys characters by agent.id
    memory: undefined,
    name: r.name,
    role: r.role,
    department: r.department,
    floor: r.floor ?? 1,
    desk: r.meta_desk || ({ mila: 1, theo: 2, priya: 3, sam: 4 }[r.agent_id] || 1),
    team: r.meta_team || ({ mila: 'content', theo: 'research', priya: 'software', sam: 'support' }[r.agent_id] || 'software'),
  }));
  // Older rows were cut at 1500 chars mid-JSON; never let one bad row break the whole state.
  const parse = (s) => { if (!s) return null; try { return JSON.parse(s); } catch { return { truncated: s }; } };
  const workflow = q.all('SELECT * FROM workflow_events ORDER BY id DESC LIMIT 120').reverse()
    .map((e) => ({ ...e, input: parse(e.input), output: parse(e.output) }));
  const threads = q.all('SELECT t.*, a.name AS agent_name FROM threads t LEFT JOIN agents a ON a.id=t.agent_id ORDER BY t.created_at DESC LIMIT 20').map((t) => {
    const msgs = q.all('SELECT * FROM thread_messages WHERE thread_id=? ORDER BY ts', t.id).map((m) => ({ ...m, card: parse(m.card) }));
    const read = q.get('SELECT ts FROM thread_reads WHERE thread_id=? AND user_id=?', t.id, 'host');
    const lastMsg = msgs[msgs.length - 1];
    const unread = read ? msgs.filter((m) => m.ts > read.ts && m.from_side === 'agent').length : msgs.filter((m) => m.from_side === 'agent').length;
    return { ...t, messages: msgs, last_read: read?.ts || null, unread, last_message_at: lastMsg?.ts || t.created_at };
  });
  const tasks = q.all('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 8').map((t) => ({
    ...t, steps: parse(t.steps) || [], additions: parse(t.additions) || [],
    log: q.all('SELECT ts, kind, text FROM task_log WHERE task_id=? ORDER BY id DESC LIMIT 150', t.id).reverse(),
  }));
  return {
    agents,
    flats: q.all('SELECT * FROM flats'),
    bookings: q.all('SELECT * FROM bookings ORDER BY checkin'),
    messages: q.all('SELECT * FROM messages ORDER BY ts'),
    jobs: q.all('SELECT * FROM cleaning_jobs ORDER BY date'),
    rates: q.all('SELECT r.*, (SELECT COUNT(*) FROM bookings b WHERE b.flat_id=r.flat_id AND b.status NOT IN (\'cancelled\') AND b.checkin <= r.date AND b.checkout > r.date) AS booked FROM rates r ORDER BY r.flat_id, r.date'),
    approvals: q.all('SELECT * FROM approvals ORDER BY created_at DESC LIMIT 20').map((a) => ({ ...a, payload: parse(a.payload) })),
    audit: q.all('SELECT * FROM audit ORDER BY id DESC LIMIT 60'),
    workflow,
    threads,
    tasks,
  };
}
