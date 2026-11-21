// RAISE HAND: the only path to refunds, discounts, price changes, early check-ins
// and guest messages. request_approval() parks the agent (red status, walks to the
// host's spot) until the host resolves it. The action executes exactly once, only
// after approval, inside resolveApproval().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, audit } from './db.js';
import { emit } from './events.js';
import { tts } from './mistral.js';
import { mergePullRequest } from './github.js';

const AUDIO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'audio');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

export function setAgentRaisingHand(agentId, approval) {
  q.run(`UPDATE agent_state SET status='needs_approval', behavior='raisehand',
    behavior_until=?, raise_label=?, current_task=? WHERE agent_id=?`,
    new Date(Date.now() + 10 * 60e3).toISOString(),
    approval.type.replaceAll('_', ' '), 'Waiting for host decision', agentId);
  emit('state');
}

export function createApproval(agentId, { type, summary, amount_gbp = 0, payload = {} }) {
  const id = 'ap_' + Math.random().toString(36).slice(2, 10);
  const idempotencyKey = agentId + ':' + type + ':' + JSON.stringify(payload) + ':' + id;
  q.run('INSERT INTO approvals (id,agent_id,type,summary,amount_gbp,payload,status,created_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?)',
    id, agentId, type, summary, amount_gbp, JSON.stringify(payload), 'pending', new Date().toISOString(), idempotencyKey);
  const approval = { id, agent_id: agentId, type, summary, amount_gbp, payload, status: 'pending' };
  audit(agentId, 'approval', `✋ raised hand — ${type}: ${summary}${amount_gbp ? ` (£${amount_gbp})` : ''}`);
  setAgentRaisingHand(agentId, approval);
  // Speak the request with Voxtral TTS (async; client polls the audio endpoint).
  tts(`Approval needed. ${summary} ${amount_gbp ? `Amount: ${amount_gbp} pounds.` : ''} Say approve or deny.`)
    .then((buf) => { if (buf) fs.writeFileSync(path.join(AUDIO_DIR, id + '.mp3'), buf); })
    .catch((e) => console.error('tts', e.message));
  return approval;
}

export function getApproval(id) {
  const a = q.get('SELECT * FROM approvals WHERE id=?', id);
  if (a) a.payload = a.payload ? JSON.parse(a.payload) : null;
  return a;
}

export function approvalAudioPath(id) {
  const p = path.join(AUDIO_DIR, id + '.mp3');
  return fs.existsSync(p) ? p : null;
}

const ALLOWED_TYPES = new Set(['refund', 'discount', 'price_change', 'early_checkin', 'guest_message', 'deploy']);

// Resolve exactly once. Returns {ok, alreadyResolved?} — the action runs only on the
// first 'approved' resolution of a pending approval.
export function resolveApproval(id, decision, host = 'host') {
  // exactly-once: only the first resolution of a pending approval runs the action
  const res = q.run('UPDATE approvals SET status=?, decision=?, resolved_at=?, approved_by=? WHERE id=? AND status=?',
    decision === 'approved' ? 'approved' : 'denied', decision, new Date().toISOString(), host, id, 'pending');
  if (res.changes === 0) return { ok: false, alreadyResolved: true };
  const a = getApproval(id);
  if (decision === 'approved') {
    executeAction(a);
    audit(a.agent_id, 'action', `✅ approved by ${host} at ${new Date().toISOString().slice(11, 19)} & executed once — ${a.type}: ${a.summary} (key ${a.idempotency_key?.slice(0, 24)}…)`);
  } else {
    audit(a.agent_id, 'action', `❌ denied by ${host} at ${new Date().toISOString().slice(11, 19)} — ${a.type}: ${a.summary}`);
  }
  // Agent goes back to work; the follow-up turn lets it report honestly.
  q.run(`UPDATE agent_state SET status='working', behavior='auto', behavior_until=NULL, raise_label=NULL,
    run_id=?, run_until=?, current_task=? WHERE agent_id=?`,
    'followup_' + id, new Date(Date.now() + 25e3).toISOString(), 'Wrapping up after your decision', a.agent_id);
  emit('state');
  return { ok: true, approval: a, decision };
}

// The approved action — the ONLY place these writes happen.
function executeAction(a) {
  const p = a.payload || {};
  switch (a.type) {
    case 'early_checkin': {
      if (p.booking_id && p.new_checkin_time) {
        q.run('UPDATE bookings SET early_checkin_at=? WHERE id=?', p.new_checkin_time, p.booking_id);
      }
      if (p.reply && p.booking_id) sendGuestMessage(p.booking_id, p.reply, a.agent_id);
      break;
    }
    case 'refund': {
      if (p.booking_id) q.run('UPDATE bookings SET refund_gbp=COALESCE(refund_gbp,0)+? WHERE id=?', p.refund_gbp ?? a.amount_gbp, p.booking_id);
      if (p.reply && p.booking_id) sendGuestMessage(p.booking_id, p.reply, a.agent_id);
      break;
    }
    case 'discount': {
      if (p.booking_id) q.run('UPDATE bookings SET discount_gbp=COALESCE(discount_gbp,0)+? WHERE id=?', p.discount_gbp ?? a.amount_gbp, p.booking_id);
      if (p.reply && p.booking_id) sendGuestMessage(p.booking_id, p.reply, a.agent_id);
      break;
    }
    case 'price_change': {
      let date = p.date;
      if (!date) { // next Saturday by default
        const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
        date = d.toISOString().slice(0, 10);
      }
      q.run('INSERT INTO rates (flat_id,date,price) VALUES (?,?,?) ON CONFLICT(flat_id,date) DO UPDATE SET price=excluded.price',
        p.flat_id, date, p.new_price);
      break;
    }
    case 'guest_message': {
      if (p.booking_id && p.reply) sendGuestMessage(p.booking_id, p.reply, a.agent_id);
      break;
    }
    case 'deploy': {
      // Merge the agent's pull request (async). The result is stored on the approval so the
      // task step can report it honestly.
      mergePullRequest(p)
        .then((r) => {
          q.run('UPDATE approvals SET payload=? WHERE id=?', JSON.stringify({ ...p, merge: r }), a.id);
          audit(a.agent_id, 'action', `🚀 merged PR #${p.pr_number} on ${p.repo || 'GitHub'} (${String(r.sha || '').slice(0, 7)})`);
          emit('state');
        })
        .catch((e) => {
          q.run('UPDATE approvals SET payload=? WHERE id=?', JSON.stringify({ ...p, merge: { merged: false, error: e.message } }), a.id);
          audit(a.agent_id, 'action', `⚠️ merge of PR #${p.pr_number} failed: ${e.message}`);
          emit('state');
        });
      break;
    }
    default:
      throw new Error('unknown approval type ' + a.type);
  }
}

function sendGuestMessage(bookingId, text, agentId) {
  const booking = q.get('SELECT guest_lang FROM bookings WHERE id=?', bookingId);
  q.run('INSERT INTO messages (id,booking_id,from_side,text,lang,ts,approved) VALUES (?,?,?,?,?,?,1)',
    'm_' + Math.random().toString(36).slice(2, 10), bookingId, 'host', text, booking?.guest_lang || 'en', new Date().toISOString());
  audit(agentId, 'action', `💬 guest message sent (approved): “${text.slice(0, 90)}”`);
}

export function clearHand(agentId) {
  q.run(`UPDATE agent_state SET behavior='auto', behavior_until=NULL, raise_label=NULL WHERE agent_id=?`, agentId);
}

export { ALLOWED_TYPES };
