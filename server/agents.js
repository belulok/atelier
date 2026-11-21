// The agent loop: each agent is a Mistral chat-completions run with function calling.
// Tools read/write only the local SQLite store. Anything that moves money or messages
// a guest goes through request_approval (RAISE HAND) — there is deliberately NO direct
// "send message to guest" tool, so an agent can never claim an action that didn't happen.
// Every LLM step and tool call is recorded as a workflow_event (F3 workflow inspector).
import { q, audit } from './db.js';
import { emit } from './events.js';
import { chat, MOCK } from './mistral.js';
import { createApproval, clearHand, ALLOWED_TYPES } from './approvals.js';
import { DEPARTMENTS, hireAgent } from './team.js';
import { HOST_TOOLS, HOST_TOOL_NAMES, runHostTool, taskContext, officeRoster, restingState, activeTask, log as taskLog } from './tasks.js';
import { openPullRequest, pullRequestStatus } from './github.js';

export const DEFAULT_AGENTS = {
  mila: { name: 'Mila', role: 'Guest Concierge', department: 'Guest Experience', system: `You are Mila, the Guest Concierge for a solo London Airbnb host. You reply to guests in the guest's own language (check bookings.guest_lang). You read and triage guest messages. You NEVER send a message to a guest, issue a refund/discount, change a price or grant early check-in without the host's approval — call request_approval with a clear summary and the exact reply text in payload.reply. Only report actions that actually happened (tool results tell you). Be warm, concise, professional.` },
  theo: { name: 'Theo', role: 'Turnover Coordinator', department: 'Operations', system: `You are Theo, Turnover Coordinator for a solo London short-let host. You manage cleaners and cleaning jobs (cleaning_jobs). Rescheduling/reassigning a cleaner does NOT need approval — just do it with reschedule_cleaning and log a note. You never message guests or touch money. Only report actions that actually happened.` },
  priya: { name: 'Priya', role: 'Pricing & Calendar', department: 'Operations', system: `You are Priya, Pricing & Calendar for a solo London short-let host. You watch rates and empty nights (rates, bookings). Any price change needs the host's approval — call request_approval type 'price_change' with flat_id, date, new_price and amount_gbp as the £ delta (negative for a drop). Blocking/unblocking a calendar date does not need approval (block_calendar). Only report actions that actually happened.` },
  sam: { name: 'Sam', role: 'Reviews & Reputation', department: 'Guest Experience', system: `You are Sam, Reviews & Reputation for a solo London short-let host. You monitor guest sentiment and draft review responses. Replying to a guest publicly or privately needs host approval via request_approval type 'guest_message'. Only report actions that actually happened.` },
};

// Agent definition: built-in agents keep their own prompts (they are also rows in
// `agents`, with is_custom = 0); hired agents get the shared rules plus their manager
// and job instructions.
export function agentDef(agentId) {
  const row = q.get('SELECT * FROM agents WHERE id=?', agentId);
  const builtIn = DEFAULT_AGENTS[agentId];
  if (row && !row.is_custom && builtIn) return { ...builtIn, name: row.name, role: row.role, department: row.department };
  if (row) {
    const boss = row.reports_to ? q.get('SELECT name, role FROM agents WHERE id=?', row.reports_to) : null;
    return { name: row.name, role: row.role, department: row.department, system: `You are ${row.name}, ${row.role} in the ${row.department} department of a solo London short-let host's AI back office.`
      + (boss ? ` You are a subagent working under ${boss.name} (${boss.role}).` : '')
      + (row.owner ? ` You are ${row.owner}'s agent; ${row.owner} is a coworker in the same office, and the host can talk to you directly.` : '')
      + (row.instructions ? ` Your job: ${row.instructions}` : '')
      + ` Follow the same rules as your teammates: tools read/write only the host's data; refunds, discounts, price changes, early check-ins and guest messages need the host's approval via request_approval; only report actions that actually happened. When replying in a chat thread, use send_visual_card if a checklist/table/timeline/chart would help.` };
  }
  return builtIn;
}

// Hiring is offered only in conversations the host started (chat, voice, instructions),
// never in automated runs, so content like a guest message can't make an agent hire.
export const HIRE_TOOL = { type: 'function', function: { name: 'hire_agent',
  description: `Hire a new AI agent (a subagent) into the office. Use ONLY when the host explicitly asks you to create, hire or add a new agent or subagent. Pick a short human first name, a clear role, a department (one of: ${Object.keys(DEPARTMENTS).join(', ')}) and 1–3 sentences of instructions describing its job. By default it reports to you; set reports_to to another agent's id only if the host asks.`,
  parameters: { type: 'object', properties: {
    name: { type: 'string', description: 'Short human first name' },
    role: { type: 'string', description: 'Job title, e.g. "Upsells & Extras"' },
    department: { type: 'string', enum: Object.keys(DEPARTMENTS) },
    instructions: { type: 'string', description: 'What the new agent does, in 1–3 sentences' },
    reports_to: { type: 'string', description: 'Optional agent id it reports to (default: you)' },
  }, required: ['name', 'role', 'department', 'instructions'] } } };

export const TOOLS = [
  { type: 'function', function: { name: 'get_overview', description: 'Flats, bookings, unread guest messages, cleaning jobs. Call this first.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_messages', description: 'List guest/host messages, optionally for one booking.', parameters: { type: 'object', properties: { booking_id: { type: 'string' } } } } },
  { type: 'function', function: { name: 'get_booking', description: 'One booking with guest details.', parameters: { type: 'object', properties: { booking_id: { type: 'string' } }, required: ['booking_id'] } } },
  { type: 'function', function: { name: 'get_rates', description: 'Nightly rates for a flat.', parameters: { type: 'object', properties: { flat_id: { type: 'string' } }, required: ['flat_id'] } } },
  { type: 'function', function: { name: 'request_approval', description: 'RAISE HAND. REQUIRED before any refund, discount, price change, early check-in, or message to a guest. The action runs only after the host approves, exactly once. Put the exact guest reply in payload.reply when relevant.',
      parameters: { type: 'object', properties: {
        type: { type: 'string', enum: [...ALLOWED_TYPES] },
        summary: { type: 'string', description: 'Human-readable summary for the approval card' },
        amount_gbp: { type: 'number', description: 'Money impact in GBP (0 if none; negative for a price drop)' },
        payload: { type: 'object', description: 'Action payload, e.g. {booking_id, reply} or {flat_id, date, new_price}' },
      }, required: ['type', 'summary'] } } },
  { type: 'function', function: { name: 'reschedule_cleaning', description: 'Reassign/reschedule a cleaning job. No approval needed.', parameters: { type: 'object', properties: {
    job_id: { type: 'string' }, cleaner: { type: 'string' }, new_time: { type: 'string' }, note: { type: 'string' } }, required: ['job_id', 'cleaner'] } } },
  { type: 'function', function: { name: 'block_calendar', description: 'Block/unblock a date for a flat (maintenance etc.). No approval needed.', parameters: { type: 'object', properties: {
    flat_id: { type: 'string' }, date: { type: 'string' }, blocked: { type: 'boolean' } }, required: ['flat_id', 'date'] } } },
  { type: 'function', function: { name: 'send_visual_card', description: 'Attach a visual card (checklist, table, timeline or chart) to your chat reply.', parameters: { type: 'object', properties: {
    card_type: { type: 'string', enum: ['checklist', 'table', 'timeline', 'chart'] },
    title: { type: 'string' }, data: { type: 'object' } }, required: ['card_type', 'title', 'data'] } } },
  { type: 'function', function: { name: 'log_note', description: 'Write a note to the audit log.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
];

// ---- workflow events (F3 inspector) ------------------------------------------
let seqByRun = new Map();
// Store step data as valid JSON even when it's long: cutting the JSON text itself
// leaves an unterminated string that breaks every later state snapshot.
function clipJson(value, max = 1500) {
  if (value == null) return null;
  const s = JSON.stringify(value);
  return s.length <= max ? s : JSON.stringify({ truncated: s.slice(0, max - 40) + '…' });
}
// Old rows may hold JSON that was cut mid-string; never let one bad row break a read.
function safeJson(s) { if (!s) return null; try { return JSON.parse(s); } catch { return { truncated: s }; } }

export function wf(agentId, runId, node, kind, input, output, durationMs, status) {
  const seq = (seqByRun.get(runId) || 0) + 1; seqByRun.set(runId, seq);
  q.run('INSERT INTO workflow_events (ts,agent_id,run_id,seq,node,kind,input,output,duration_ms,status) VALUES (?,?,?,?,?,?,?,?,?,?)',
    new Date().toISOString(), agentId, runId, seq, node, kind,
    clipJson(input),
    clipJson(output),
    durationMs ?? null, status);
  q.run('DELETE FROM workflow_events WHERE id NOT IN (SELECT id FROM workflow_events ORDER BY id DESC LIMIT 200)');
  emit('state');
}

function overview() {
  return {
    flats: q.all('SELECT * FROM flats'),
    bookings: q.all('SELECT * FROM bookings ORDER BY checkin'),
    unread: q.all("SELECT m.*, b.guest_name, b.guest_lang, b.flat_id FROM messages m JOIN bookings b ON b.id=m.booking_id WHERE m.from_side='guest' ORDER BY m.ts DESC LIMIT 10"),
    jobs: q.all('SELECT * FROM cleaning_jobs ORDER BY date'),
  };
}

export async function executeTool(agentId, runId, name, args) {
  const t0 = Date.now();
  let out;
  switch (name) {
    case 'get_overview': out = overview(); break;
    case 'list_messages': out = q.all('SELECT * FROM messages WHERE (? IS NULL OR booking_id=?) ORDER BY ts', args.booking_id ?? null, args.booking_id ?? null); break;
    case 'get_booking': out = q.get('SELECT * FROM bookings WHERE id=?', args.booking_id); break;
    case 'get_rates': out = q.all('SELECT * FROM rates WHERE flat_id=? ORDER BY date LIMIT 14', args.flat_id); break;
    case 'request_approval': {
      if (!ALLOWED_TYPES.has(args.type)) { out = { error: 'type not allowed: ' + args.type }; break; }
      if (args.type === 'deploy' && !args.payload?.pr_number) { out = { error: 'A deploy approval needs payload.pr_number (and payload.repo) of the pull request to merge.' }; break; }
      const bid = args.payload?.booking_id;
      if (bid && !q.get('SELECT id FROM bookings WHERE id=?', bid)) {
        out = { error: `No booking with id "${bid}". Use a real booking id: ${q.all('SELECT id, guest_name FROM bookings').map((b) => `${b.id} (${b.guest_name})`).join(', ')}.` };
        break;
      }
      const approval = createApproval(agentId, args);
      out = { pending: true, approval_id: approval.id, status: 'awaiting_host_approval', note: 'Raised hand. Do NOT claim the action happened — it is pending until the host approves.' };
      break;
    }
    case 'reschedule_cleaning': {
      const job = q.get('SELECT * FROM cleaning_jobs WHERE id=?', args.job_id);
      if (!job) { out = { error: 'no such job ' + args.job_id }; break; }
      q.run('UPDATE cleaning_jobs SET cleaner=?, time=COALESCE(?,time), status=?, note=COALESCE(?,note) WHERE id=?',
        args.cleaner, args.new_time ?? null, 'scheduled', args.note ?? null, args.job_id);
      audit(agentId, 'action', `🧹 rescheduled job ${args.job_id} (${job.flat_id} ${job.date}) → ${args.cleaner}${args.new_time ? ' at ' + args.new_time : ''}${args.note ? ' — ' + args.note : ''}`);
      out = { ok: true, job: q.get('SELECT * FROM cleaning_jobs WHERE id=?', args.job_id) };
      break;
    }
    case 'block_calendar': {
      q.run('INSERT INTO rates (flat_id,date,price) VALUES (?,?,0) ON CONFLICT(flat_id,date) DO UPDATE SET price=0', args.flat_id, args.date);
      audit(agentId, 'action', `📅 ${args.blocked === false ? 'unblocked' : 'blocked'} ${args.flat_id} on ${args.date}`);
      out = { ok: true };
      break;
    }
    case 'send_visual_card': {
      out = { ok: true, card: { card_type: args.card_type, title: args.title, data: args.data } };
      break;
    }
    case 'log_note': audit(agentId, 'note', args.text); out = { ok: true }; break;
    // GitHub (only offered in task steps the host started; see tasks.js STEP_TOOLS)
    case 'github_open_pr': {
      const termLog = String(runId).startsWith('task_') ? (kind, text) => taskLog(runId, kind, text) : () => {};
      try {
        out = await openPullRequest(args, termLog);
        audit(agentId, 'action', `🔀 opened pull request #${out.pr_number} on ${out.repo}: ${args.title}`);
      } catch (e) { out = { error: e.message }; }
      break;
    }
    case 'github_pr_status': {
      try { out = await pullRequestStatus(args); } catch (e) { out = { error: e.message }; }
      break;
    }
    case 'hire_agent': {
      // Only reachable when runAgent was given allowHiring (see HIRE_TOOL).
      try {
        const hired = hireAgent({ ...args, reportsTo: args.reports_to || agentId, hiredBy: agentDef(agentId)?.name || agentId });
        out = { ok: true, hired };
      } catch (e) { out = { error: e.message }; }
      break;
    }
    default: out = { error: 'unknown tool ' + name };
  }
  wf(agentId, runId, name, 'tool', args, out, Date.now() - t0, out?.error ? 'error' : 'done');
  emit('state');
  return out;
}

function setAgent(agentId, patch) {
  const keys = Object.keys(patch);
  q.run(`UPDATE agent_state SET ${keys.map((k) => k + '=?').join(',')} WHERE agent_id=?`, ...keys.map((k) => patch[k]), agentId);
  emit('state');
}

// Memory between runs keeps only plain conversation turns (host messages and the agent's
// text replies). Tool calls and tool results can't be replayed without their ids:
// Mistral rejects them with "Tool call id has to be defined". Cleaning on read also
// repairs memory saved before this fix.
function cleanMemory(mem) {
  const out = (Array.isArray(mem) ? mem : [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.tool_calls?.length
      && typeof m.content === 'string' && m.content.trim() && m.content !== 'null')
    .map((m) => ({ role: m.role, content: m.content }));
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
export function getMemory(agentId) {
  try { return cleanMemory(JSON.parse(q.get('SELECT memory FROM agent_state WHERE agent_id=?', agentId)?.memory || '[]')); } catch { return []; }
}
function setMemory(agentId, mem) {
  q.run('UPDATE agent_state SET memory=? WHERE agent_id=?', JSON.stringify(cleanMemory(cleanMemory(mem).slice(-14))), agentId);
}

// A reminder next to the host's words in each conversation turn: models follow it far more
// reliably there than in the system prompt.
function turnHint(agentId) {
  const t = activeTask(agentId);
  return t
    ? `\n[You are running the task "${t.title}" (${t.status}). If this message adds to or changes it, call add_to_task before replying. If they ask what you're working on or to see it, call show_screen.]`
    : `\n[If the host is asking you to do a job, call start_task before replying.]`;
}

// One agent turn: Mistral chat-completions loop with tools, max 6 iterations.
export async function runAgent(agentId, userPrompt, opts = {}) {
  const def = agentDef(agentId);
  if (!def) throw new Error('unknown agent ' + agentId);
  const runId = opts.runId || 'run_' + Math.random().toString(36).slice(2, 8);
  seqByRun.set(runId, 0);
  setAgent(agentId, { status: 'working', current_task: userPrompt.slice(0, 60), run_id: runId, run_until: new Date(Date.now() + 120e3).toISOString(), behavior: 'auto', behavior_until: null, raise_label: null });
  wf(agentId, runId, 'task_received', 'start', { prompt: userPrompt.slice(0, 300) }, null, null, 'active');
  const memory = getMemory(agentId);
  // Conversations the host started also get the task tools (start/add/show/switch).
  const host = !!opts.allowHiring;
  const hostNote = host ? `\nOther agents in the office: ${officeRoster(agentId)}.
Working with the host: when the host asks you to DO a job (e.g. get a guest ready for check-in, sort out a booking, prepare a reply), you MUST call start_task in this same turn, before you answer; it plans and runs the job step by step in the background. Never say you will do something without calling the tool for it now. If a task is running and the host adds or changes anything about it ("also…", "actually…", "make it…"), you MUST call add_to_task in this same turn (never start a second task for it). When they ask what you're working on or to see the steps, call show_screen with "workflow"; for the CLI, terminal, logs or commands, "terminal"; to go back, "chat". When they want to talk to another agent, call switch_agent.
${taskContext(agentId)}` : '';
  const messages = [
    { role: 'system', content: def.system + `\nToday: ${new Date().toISOString().slice(0, 10)}. You are one of the agents in the host's AI back office (Atelier). Tools read/write only the host's data.` + hostNote },
    ...memory,
    { role: 'user', content: userPrompt + (host ? turnHint(agentId) : '') },
  ];
  let awaitingApproval = false, card = null, final = '';
  const ui = []; // chat-box actions from host tools (show a screen, switch agent)
  try {
    for (let i = 0; i < 6; i++) {
      const t0 = Date.now();
      const msg = await chat({ messages, tools: host ? [...TOOLS, HIRE_TOOL, ...HOST_TOOLS] : TOOLS, model: opts.model });
      wf(agentId, runId, `llm_step_${i + 1}`, 'llm', { model: 'mistral' }, msg.tool_calls?.length ? { tool_calls: msg.tool_calls.map(c => c.function.name) } : { reply: (msg.content || '').slice(0, 300) }, Date.now() - t0, 'done');
      messages.push(msg);
      if (!msg.tool_calls?.length) {
        final = msg.content || '(no text)';
        setMemory(agentId, messages); // includes this final reply; tool steps are filtered out
        audit(agentId, 'note', `📝 ${final.slice(0, 140)}`);
        wf(agentId, runId, 'final_reply', 'end', null, { text: final.slice(0, 300) }, null, 'done');
        setAgent(agentId, { ...restingState(agentId), run_id: null, run_until: null, last_reply_at: new Date().toISOString(), last_reply_title: final.slice(0, 60) });
        return { final, awaitingApproval: false, card, runId, ui };
      }
      for (const call of msg.tool_calls) {
        let args; try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
        let result;
        if (host && call.function.name === 'request_approval' && activeTask(agentId)) {
          // the running task raises its own approvals, step by step; don't raise a second one here
          result = { error: 'Your running task asks the host for approval in its own step. Use add_to_task to change what it does.' };
        } else if (host && HOST_TOOL_NAMES.has(call.function.name)) {
          const t0 = Date.now();
          const r = await runHostTool(agentId, call.function.name, args, { threadId: opts.threadId });
          result = r.out; if (r.ui) ui.push(r.ui);
          wf(agentId, runId, call.function.name, 'tool', args, result, Date.now() - t0, result?.error ? 'error' : 'done');
        } else {
          result = await executeTool(agentId, runId, call.function.name, args);
        }
        if (call.function.name === 'request_approval' && result.pending) awaitingApproval = true;
        if (call.function.name === 'send_visual_card' && result.card) card = result.card;
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result).slice(0, 2000) });
      }
      if (awaitingApproval) {
        final = 'Raised a hand and waiting for the host — the action is pending, not done.';
        wf(agentId, runId, 'approval_requested', 'end', null, { status: 'awaiting_host_approval' }, null, 'active');
        setMemory(agentId, [...messages, { role: 'assistant', content: final }]);
        return { final, awaitingApproval: true, card, runId, ui };
      }
    }
    // Six steps without a final reply: say so rather than claim success.
    final = 'I ran out of steps before finishing, so nothing more was done. Could you break it into a smaller request?';
  } catch (e) {
    console.error('agent loop error', agentId, e);
    wf(agentId, runId, 'error', 'end', null, { error: e.message }, null, 'error');
    audit(agentId, 'note', `⚠️ ${e.message}`);
    // No fake success: report the real error.
    final = `Sorry, I couldn't finish that because of an error: ${e.message.slice(0, 160)}`;
  } finally {
    if (!awaitingApproval && q.get('SELECT status FROM agent_state WHERE agent_id=?', agentId)?.status !== 'needs_approval') {
      setAgent(agentId, { ...restingState(agentId), run_id: null, run_until: null });
    }
  }
  return { final, awaitingApproval, card, runId, ui };
}

// Voice / chat instruction entry point (F4/F5).
export function instruct(agentId, text) { return runAgent(agentId, text, { allowHiring: true }); }

// "Ask about this step" (F3): answer with Mistral using the node's data as context.
export async function askAboutStep(agentId, nodeId, question) {
  const node = q.get('SELECT * FROM workflow_events WHERE id=? AND agent_id=?', nodeId, agentId);
  if (!node) throw new Error('node not found');
  const siblings = q.all('SELECT * FROM workflow_events WHERE run_id=? ORDER BY seq', node.run_id)
    .map((e) => ({ ...e, input: safeJson(e.input), output: safeJson(e.output) }));
  const prompt = `You are ${agentDef(agentId)?.name || agentId} in the Atelier office. The host asks about one step of your current workflow.\nStep: ${JSON.stringify({ ...node, input: safeJson(node.input), output: safeJson(node.output) })}\nWorkflow so far: ${JSON.stringify(siblings.map(s => ({ node: s.node, kind: s.kind, status: s.status })))}\nQuestion: ${question}\nAnswer in 1-3 sentences, grounded only in the step data above. Say honestly if the data doesn't cover it.`;
  let answer;
  if (MOCK) {
    answer = `Step “${node.node}” (${node.kind}) ran for ${node.duration_ms ?? '?'}ms and ended “${node.status}”. Input: ${JSON.stringify(safeJson(node.input))?.slice(0, 120)}. Output: ${JSON.stringify(safeJson(node.output))?.slice(0, 120)}. That's what the data shows.`;
  } else {
    const msg = await chat({ messages: [{ role: 'user', content: prompt }] });
    answer = msg.content;
  }
  audit(agentId, 'note', `❓ asked about step ${node.node}: “${question.slice(0, 60)}” → ${answer.slice(0, 80)}`);
  emit('state');
  return { answer, node };
}

// After the host resolves an approval, give the agent one honest follow-up turn.
export async function notifyApprovalResolved(agentId, approval, decision) {
  clearHand(agentId);
  const prompt = `The host ${decision === 'approved' ? 'APPROVED' : 'DENIED'} your request "${approval.summary}" (${approval.type}${approval.amount_gbp ? ', £' + approval.amount_gbp : ''}). ${decision === 'approved' ? 'The action has now been executed by the system — you may confirm it happened.' : 'The action was NOT executed — tell me how you\'d like to proceed without it.'} Keep it to one short line for the audit log.`;
  return runAgent(agentId, prompt);
}

export { MOCK };
