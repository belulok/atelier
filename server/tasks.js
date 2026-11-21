// Agent tasks you can watch. You give an agent a job in chat or voice; it plans it as a few
// plain-English steps (Mistral), then runs them one by one with its real tools. Every move is
// written to task_log, which is the terminal view; the steps are the workflow view.
// While it works you can add or change things: the request is parked, and at the next safe
// point (after the current step, or while it waits for your approval) the agent pauses,
// re-plans the steps it hasn't done yet, and carries on. Nothing is queued behind the task.
// Steps that message a guest, give money back or change a price go through Raise Hand.
import { q } from './db.js';
import { emit } from './events.js';
import { chat, MOCK, TASK_MODEL } from './mistral.js';
import { agentDef, executeTool, TOOLS } from './agents.js';
import { createApproval, clearHand } from './approvals.js';

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = (p) => p + '_' + Math.random().toString(36).slice(2, 8);
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const OPEN = "('planning','running','waiting_approval','replanning')";
const STEP_TOOLS = TOOLS_WITHOUT(['send_visual_card']);
function TOOLS_WITHOUT(names) { return () => TOOLS.filter((t) => !names.includes(t.function.name)); }

export function getTask(id) {
  if (!id) return null;
  const t = q.get('SELECT * FROM tasks WHERE id=?', id);
  return t && { ...t, steps: parse(t.steps, []), additions: parse(t.additions, []) };
}
// Writes everything except `additions`: those come from the conversation at any moment and
// are only taken (read + cleared in one go) by the task runner, so none get lost.
function save(t) {
  q.run('UPDATE tasks SET title=?, instructions=?, expect=?, status=?, steps=?, result=?, updated_at=? WHERE id=?',
    t.title, t.instructions, t.expect, t.status, JSON.stringify(t.steps), t.result ?? null, now(), t.id);
  emit('state');
}
function takeAdditions(id) {
  const adds = parse(q.get('SELECT additions FROM tasks WHERE id=?', id)?.additions, []);
  if (adds.length) q.run("UPDATE tasks SET additions='[]' WHERE id=?", id);
  return adds;
}
export function log(taskId, kind, text) {
  q.run('INSERT INTO task_log (task_id,ts,kind,text) VALUES (?,?,?,?)', taskId, now(), kind, String(text).slice(0, 400));
  emit('state');
}
export function activeTask(agentId) {
  return getTask(q.get(`SELECT id FROM tasks WHERE agent_id=? AND status IN ${OPEN} ORDER BY created_at DESC LIMIT 1`, agentId)?.id);
}
export function latestTask(agentId) {
  return getTask(q.get('SELECT id FROM tasks WHERE agent_id=? ORDER BY created_at DESC LIMIT 1', agentId)?.id);
}
export function taskForApproval(approvalId) {
  return q.all(`SELECT id, steps FROM tasks WHERE status IN ${OPEN}`).find((t) => parse(t.steps, []).some((s) => s.approval_id === approvalId)) || null;
}
// While a task runs, the agent stays "working" in the office even between chat turns.
export function restingState(agentId) {
  const t = activeTask(agentId);
  return t ? { status: 'working', current_task: t.title.slice(0, 60) } : { status: 'idle', current_task: '' };
}
function setAgent(agentId, patch) {
  const keys = Object.keys(patch);
  q.run(`UPDATE agent_state SET ${keys.map((k) => k + '=?').join(',')} WHERE agent_id=?`, ...keys.map((k) => patch[k]), agentId);
  emit('state');
}

// ---- Mistral helpers -------------------------------------------------------------
async function askJson(prompt) {
  const msg = await chat({ model: TASK_MODEL, messages: [{ role: 'system', content: 'Reply with one JSON object only. No markdown, no code fences.' }, { role: 'user', content: prompt }] });
  const text = String(msg.content || '');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(json);
}
function facts() {
  return {
    today: now().slice(0, 10),
    bookings: q.all('SELECT b.id, b.guest_name, b.guest_lang, b.flat_id, f.name AS flat, b.checkin, b.checkout, b.status, b.early_checkin_at FROM bookings b LEFT JOIN flats f ON f.id=b.flat_id ORDER BY checkin'),
    guest_messages: q.all("SELECT booking_id, text, ts FROM messages WHERE from_side='guest' ORDER BY ts DESC LIMIT 6"),
    cleaning_jobs: q.all('SELECT id, flat_id, date, time, cleaner, status FROM cleaning_jobs ORDER BY date'),
  };
}
const short = (out) => {
  if (Array.isArray(out)) return `${out.length} row${out.length === 1 ? '' : 's'}` + (out[0] ? ' · ' + JSON.stringify(out[0]).slice(0, 140) : '');
  return JSON.stringify(out ?? null).slice(0, 220);
};
const stepLine = (s, i) => `${i + 1}. [${s.status}] ${s.title} — ${s.explain}${s.result ? ` → ${s.result}` : ''}`;

// ---- Planning ----------------------------------------------------------------------
async function planTask(agentId, goal) {
  const def = agentDef(agentId);
  if (MOCK) {
    return { title: goal.slice(0, 48), instructions: `You asked: "${goal}". I follow the office rules: guest messages and money need your approval.`,
      expect: 'A short summary of what I found and did (demo stub: add a Mistral key for real work).',
      steps: [
        { title: 'Look at the details', explain: 'I read the bookings and messages this is about.', needs_approval: false },
        { title: 'Work out what to do', explain: 'I decide the best next action from what I found.', needs_approval: false },
        { title: 'Ask you to approve', explain: 'Anything that reaches a guest waits for your OK (Raise Hand).', needs_approval: true },
        { title: 'Wrap up', explain: 'I note what happened so you can see it later.', needs_approval: false },
      ] };
  }
  const tools = STEP_TOOLS().map((t) => t.function.name).join(', ');
  const plan = await askJson(`${def.system}
The host gave you, ${def.name}, this task: "${goal}"
What you can see right now: ${JSON.stringify(facts())}
Plan it as 3 to 6 steps you will really do with your tools (${tools}).
Rules: plain everyday English for a non-technical host, no jargon. Each step: a short "title" (max 6 words) and one sentence "explain" saying what you'll do and why. Any step that sends a message to a guest, grants an early check-in, refunds or discounts, or changes a price must be its own step that asks the host to approve it (Raise Hand); set "needs_approval": true on it and say so in "explain". Use only the data above; don't invent guests or numbers.
Return: {"title": "short task name", "instructions": "one or two sentences restating what the host asked and the rules you'll follow", "expect": "one or two sentences on what the host will have at the end", "steps": [{"title": "...", "explain": "...", "needs_approval": false}]}`);
  if (!Array.isArray(plan.steps) || !plan.steps.length) throw new Error('the plan came back empty');
  return plan;
}
const mkStep = (s, added = false) => ({ id: rid('s'), title: String(s.title || 'Step').slice(0, 60), explain: String(s.explain || '').slice(0, 240),
  needs_approval: !!s.needs_approval, status: 'todo', added: !!(added || s.added), result: null, approval_id: null, started_at: null, ended_at: null });

export async function startTask(agentId, goal, threadId = null) {
  const def = agentDef(agentId);
  const open = activeTask(agentId);
  if (open) return { error: `You are already working on "${open.title}". Use add_to_task to add or change something in it.`, task_id: open.id };
  const id = rid('task');
  q.run('INSERT INTO tasks (id,agent_id,thread_id,title,goal,instructions,expect,status,steps,additions,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    id, agentId, threadId, goal.slice(0, 60), goal, '', '', 'planning', '[]', '[]', now(), now());
  log(id, 'cmd', `$ ${def.name.toLowerCase()} run "${goal.slice(0, 120)}"`);
  log(id, 'info', 'planning the steps with Mistral…');
  setAgent(agentId, { status: 'working', current_task: 'Planning: ' + goal.slice(0, 48), behavior: 'auto', behavior_until: null });
  // Plan and run in the background so the agent can answer the host straight away.
  planAndRun(id, agentId, goal).catch((e) => { console.error('task', id, e); log(id, 'error', '✗ ' + e.message); });
  return { ok: true, task_id: id, status: 'planning', note: 'The task is being planned now and will run step by step; the host can ask to see it (workflow or terminal).' };
}

async function planAndRun(id, agentId, goal) {
  let plan;
  try { plan = await planTask(agentId, goal); }
  catch (e) {
    const t = getTask(id); t.status = 'failed'; t.result = 'Could not plan: ' + e.message; save(t);
    log(id, 'error', `✗ planning failed: ${e.message}`);
    setAgent(agentId, restingState(agentId));
    return;
  }
  const t = getTask(id);
  if (t.status === 'cancelled') return;
  Object.assign(t, { title: String(plan.title || goal).slice(0, 60), instructions: String(plan.instructions || ''), expect: String(plan.expect || ''), status: 'running', steps: plan.steps.slice(0, 7).map((s) => mkStep(s)) });
  save(t);
  t.steps.forEach((s, i) => log(id, 'plan', `  ${i + 1}. ${s.title}${s.needs_approval ? '  (needs your approval)' : ''}`));
  await execute(id);
}

// ---- Mid-task changes ---------------------------------------------------------------
export function addToTask(agentId, request) {
  const t = activeTask(agentId);
  if (!t) return { error: 'No task is running right now. Use start_task for a new job.' };
  const adds = parse(q.get('SELECT additions FROM tasks WHERE id=?', t.id)?.additions, []);
  adds.push({ text: String(request).slice(0, 300), ts: now() });
  q.run('UPDATE tasks SET additions=? WHERE id=?', JSON.stringify(adds), t.id);
  log(t.id, 'add', `+ you asked: "${String(request).slice(0, 160)}" (I'll fit it in at the next safe point)`);
  return { ok: true, task_id: t.id, note: 'Parked. You will pause at the next safe point and re-plan the remaining steps (a draft still waiting for approval can be redone with the change). Tell the host you will fit it in; do not claim it is done.' };
}

async function replan(taskId, adds) {
  const t = getTask(taskId);
  const def = agentDef(t.agent_id);
  const prevStatus = t.status;
  t.status = 'replanning'; save(t);
  const lastDone = [...t.steps].reverse().find((s) => s.status === 'done' || s.status === 'skipped');
  log(taskId, 'pause', `⏸ pausing${lastDone ? ` after "${lastDone.title}"` : ''} to fit in your request`);
  const fixed = t.steps.filter((s) => s.status !== 'todo');
  const todo = t.steps.filter((s) => s.status === 'todo');
  const waiting = t.steps.find((s) => s.status === 'waiting');
  let next = todo, note = 'kept the plan as it was', redo = null;
  try {
    if (MOCK) {
      next = [...todo, ...adds.map((a) => mkStep({ title: 'Your extra request', explain: a.text }, true))];
      note = 'added your request as a new step';
    } else {
      const r = await askJson(`${def.system}
You are ${def.name}, part-way through the task "${t.title}" (${t.goal}).
Plan so far:
${t.steps.map(stepLine).join('\n')}
The host has just asked: ${adds.map((a) => `"${a.text}"`).join(' and ')}
Re-plan ONLY the steps that are still [todo]; the others are done or in progress and stay as they are.
Merge the request sensibly: if it changes a step that hasn't happened yet (e.g. what a message should say), update that step instead of adding a duplicate; add a new step where it fits best if it's new work; remove a step if the host no longer wants it. Same rules: plain English, short titles, approval steps for guest messages, early check-ins, money or prices.${waiting ? `
Step "${waiting.title}" is drafted and WAITING for the host's approval, so nothing has been sent yet. If the request changes what that step does (e.g. what the message says), set "redo_waiting": true and give the updated step as "waiting_step": the draft is withdrawn and redone with the change. Never add a second step that does the same thing as that one.` : ''}
Data: ${JSON.stringify(facts())}
Return: {${waiting ? '"redo_waiting": false, "waiting_step": {"title": "...", "explain": "...", "needs_approval": true}, ' : ''}"steps": [{"title": "...", "explain": "...", "needs_approval": false, "changed": true}], "note": "one short sentence on what you changed"}  ("steps" = the remaining [todo] steps; "changed": true for steps that are new or changed because of the request)`);
      if (waiting && r.redo_waiting && r.waiting_step) redo = r.waiting_step;
      if (Array.isArray(r.steps)) {
        next = r.steps.map((s) => {
          const same = todo.find((o) => o.title === s.title && o.explain === s.explain);
          return same || mkStep(s, s.changed !== false);
        });
        note = r.note || 'updated the remaining steps';
      }
    }
  } catch (e) { log(taskId, 'error', `re-plan failed (${e.message}); carrying on with the plan as it was`); }
  const fresh = getTask(taskId); // steps may have changed status while we waited for Mistral
  fresh.steps = [...fresh.steps.filter((s) => fixed.some((f) => f.id === s.id)), ...next];
  let redone = false;
  const w = redo && fresh.steps.find((s) => s.status === 'waiting');
  if (w) {
    // Withdraw the draft that was waiting for approval and redo the step with the change.
    const res = q.run("UPDATE approvals SET status='withdrawn', decision='withdrawn', resolved_at=? WHERE id=? AND status='pending'", now(), w.approval_id);
    if (res.changes) {
      clearHand(fresh.agent_id);
      Object.assign(w, mkStep(redo, true), { id: w.id, needs_approval: true });
      redone = true;
      log(taskId, 'pause', `↩ withdrew the draft that was waiting for your approval, so I can redo it with your change`);
    }
  }
  fresh.status = prevStatus === 'waiting_approval' && !redone ? 'waiting_approval' : 'running';
  save(fresh);
  log(taskId, 'plan', `↻ plan updated: ${note}`);
  fresh.steps.forEach((s, i) => { if (s.status === 'todo') log(taskId, 'plan', `  ${i + 1}. ${s.title}${s.added ? '  (new)' : ''}${s.needs_approval ? '  (needs your approval)' : ''}`); });
  log(taskId, 'info', '▶ resuming');
}

// ---- Running ------------------------------------------------------------------------
async function runStep(t, step, idx) {
  const def = agentDef(t.agent_id);
  if (MOCK) {
    await sleep(900);
    if (step.needs_approval) {
      const a = createApproval(t.agent_id, { type: 'guest_message', summary: `${def.name}: ${step.title} (demo)`, payload: {} });
      log(t.id, 'cmd', `$ request_approval {"type":"guest_message"}`);
      return { approvalId: a.id, summary: step.title };
    }
    return { result: 'Done (demo stub: add a Mistral key for real work).' };
  }
  const messages = [
    { role: 'system', content: def.system + `\nToday: ${now().slice(0, 10)}. You are running a task step by step for the host in Atelier.` },
    { role: 'user', content: `Task: ${t.goal}
Plan:
${t.steps.map(stepLine).join('\n')}
Data (use these exact ids): ${JSON.stringify(facts())}
Do ONLY step ${idx + 1}: "${step.title}" — ${step.explain}
Use your tools as needed. ${step.needs_approval
    ? 'This step needs the host\'s approval: call request_approval exactly once, with the exact guest-facing text in payload.reply and the booking_id where relevant.'
    : 'Do not call request_approval in this step.'}
Finish with ONE short plain sentence saying what you found or did; it is shown to the host as this step's result.` },
  ];
  for (let i = 0; i < 5; i++) {
    const msg = await chat({ model: TASK_MODEL, messages, tools: STEP_TOOLS() });
    messages.push(msg);
    if (!msg.tool_calls?.length) return { result: String(msg.content || 'Done.').slice(0, 300) };
    for (const call of msg.tool_calls) {
      let args; try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      const name = call.function.name;
      if (name === 'request_approval' && !step.needs_approval) {
        messages.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify({ error: 'Not in this step: approvals happen in their own step.' }) });
        continue;
      }
      log(t.id, 'cmd', `$ ${name} ${JSON.stringify(args).slice(0, 200)}`);
      const out = await executeTool(t.agent_id, t.id, name, args);
      log(t.id, out?.error ? 'error' : 'out', `  ${out?.error ? '✗ ' + out.error : short(out)}`);
      if (name === 'request_approval' && out?.pending) return { approvalId: out.approval_id, summary: args.summary || step.title };
      messages.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify(out).slice(0, 2000) });
    }
  }
  return { result: 'I ran out of moves on this step, so I stopped here.' };
}

// Wait for the host's decision; re-plan meanwhile if they add something.
async function waitForApproval(taskId, approvalId) {
  const until = Date.now() + 30 * 60e3;
  while (Date.now() < until) {
    const a = q.get('SELECT status FROM approvals WHERE id=?', approvalId);
    if (!a || a.status !== 'pending') return a?.status || 'denied';
    if (getTask(taskId)?.status === 'cancelled') return 'cancelled';
    const adds = takeAdditions(taskId);
    if (adds.length) await replan(taskId, adds);
    await sleep(1000);
  }
  return 'timeout';
}

async function execute(taskId) {
  let t = getTask(taskId);
  setAgent(t.agent_id, { status: 'working', current_task: t.title.slice(0, 60), behavior: 'auto', behavior_until: null });
  try {
    for (let guard = 0; guard < 14; guard++) {
      if (getTask(taskId).status === 'cancelled') return;
      const adds = takeAdditions(taskId);
      if (adds.length) await replan(taskId, adds);
      t = getTask(taskId);
      const idx = t.steps.findIndex((s) => s.status === 'todo');
      if (idx < 0) break;
      Object.assign(t.steps[idx], { status: 'running', started_at: now() });
      t.status = 'running'; save(t);
      setAgent(t.agent_id, { status: 'working', current_task: `${t.steps[idx].title} (${idx + 1}/${t.steps.length})`.slice(0, 60) });
      log(taskId, 'step', `▶ step ${idx + 1}/${t.steps.length}: ${t.steps[idx].title}`);
      await sleep(600); // lets the workflow view show the step starting
      const r = await runStep(t, t.steps[idx], idx);
      t = getTask(taskId);
      let step = t.steps.find((s) => s.status === 'running');
      if (r.approvalId) {
        Object.assign(step, { status: 'waiting', approval_id: r.approvalId });
        t.status = 'waiting_approval'; save(t);
        log(taskId, 'wait', `✋ waiting for your approval: ${r.summary}`);
        const decision = await waitForApproval(taskId, r.approvalId);
        if (decision === 'cancelled') return;
        if (decision === 'withdrawn') { setAgent(t.agent_id, { status: 'working', current_task: t.title.slice(0, 60) }); continue; } // redone with the host's change
        clearHand(t.agent_id);
        t = getTask(taskId); step = t.steps.find((s) => s.approval_id === r.approvalId);
        const ok = decision === 'approved';
        Object.assign(step, { status: ok ? 'done' : 'skipped', ended_at: now(),
          result: ok ? `You approved it, so it's done: ${r.summary}`.slice(0, 300) : decision === 'timeout' ? 'No answer in 30 minutes, so I skipped it.' : 'You said no, so this was not done.' });
        t.status = 'running'; save(t);
        log(taskId, ok ? 'done' : 'skip', ok ? '✓ approved by you, done' : `↷ ${step.result}`);
        setAgent(t.agent_id, { status: 'working', current_task: t.title.slice(0, 60) });
      } else {
        Object.assign(step, { status: 'done', result: r.result, ended_at: now() });
        save(t);
        log(taskId, 'done', `✓ ${r.result}`);
      }
    }
    t = getTask(taskId);
    const done = t.steps.filter((s) => s.status === 'done').length;
    t.status = 'done'; t.result = `${done} of ${t.steps.length} steps done.`; save(t);
    log(taskId, 'end', `■ task complete: ${t.result}`);
  } catch (e) {
    t = getTask(taskId); t.status = 'failed'; t.result = e.message;
    t.steps.forEach((s) => { if (s.status === 'running') s.status = 'failed'; });
    save(t);
    log(taskId, 'error', `✗ ${e.message}`);
  } finally {
    setAgent(t.agent_id, restingState(t.agent_id));
  }
}

// What the agent knows about its own task during a conversation turn.
export function taskContext(agentId) {
  const t = activeTask(agentId) || (() => { const l = latestTask(agentId); return l && Date.now() - Date.parse(l.updated_at) < 3600e3 ? l : null; })();
  if (!t) return 'You have no task running.';
  const mark = { done: '✓', running: '▶', waiting: '✋ waiting for the host\'s approval', todo: '○', skipped: '↷ skipped', failed: '✗' };
  return `Your ${['done', 'failed', 'cancelled'].includes(t.status) ? 'last' : 'current'} task: "${t.title}" (status: ${t.status}). What the host asked: ${t.goal}
Steps:\n${t.steps.map((s, i) => `${i + 1}. ${mark[s.status] || s.status} ${s.title}${s.result ? ' → ' + s.result : ''}`).join('\n')}${t.additions.length ? `\nHost requests waiting to be fitted in: ${t.additions.map((a) => a.text).join('; ')}` : ''}`;
}

// ---- Tools only offered in conversations the host started ---------------------------
export const HOST_TOOLS = [
  { type: 'function', function: { name: 'start_task', description: 'Start a job with several steps. It is planned and then runs in the background step by step (the host can watch it). Use when the host asks you to do something that takes more than one action.',
    parameters: { type: 'object', properties: { goal: { type: 'string', description: 'The job in one sentence, in the host\'s words' } }, required: ['goal'] } } },
  { type: 'function', function: { name: 'add_to_task', description: 'Add to or change the task you are running (e.g. "also offer a late checkout", "write it in English instead", "skip the cleaner"). You pause at the next safe point and re-plan. Never start a second task for this.',
    parameters: { type: 'object', properties: { request: { type: 'string' } }, required: ['request'] } } },
  { type: 'function', function: { name: 'show_screen', description: 'Change what the host sees in the chat box: "workflow" = your task as a simple step-by-step diagram (when they ask what you are working on, or to see the steps/progress), "terminal" = the command-line view of the same task (when they ask for the CLI, terminal, logs or commands), "chat" = back to the conversation.',
    parameters: { type: 'object', properties: { view: { type: 'string', enum: ['workflow', 'terminal', 'chat'] } }, required: ['view'] } } },
  { type: 'function', function: { name: 'switch_agent', description: 'Hand the conversation over to another agent in the office when the host asks to talk to them.',
    parameters: { type: 'object', properties: { agent: { type: 'string', description: 'The other agent\'s name' } }, required: ['agent'] } } },
];
export const HOST_TOOL_NAMES = new Set(HOST_TOOLS.map((t) => t.function.name));

export function officeRoster(agentId) {
  return q.all('SELECT a.id, a.name, a.role FROM agents a ORDER BY a.name').filter((a) => a.id !== agentId).map((a) => `${a.name} (${a.role})`).join(', ');
}

// Runs a host tool; returns { out, ui } where ui is an action for the chat box.
export async function runHostTool(agentId, name, args, ctx = {}) {
  switch (name) {
    case 'start_task': return { out: await startTask(agentId, String(args.goal || '').trim() || 'Task from the host', ctx.threadId) };
    case 'add_to_task': return { out: addToTask(agentId, args.request || '') };
    case 'show_screen': {
      const view = ['workflow', 'terminal', 'chat'].includes(args.view) ? args.view : 'workflow';
      const t = latestTask(agentId);
      if (view !== 'chat' && !t) return { out: { error: 'There is no task to show yet. Offer to start one.' } };
      return { out: { ok: true, showing: view, task: t?.title }, ui: { type: 'show_screen', view, task_id: t?.id || null } };
    }
    case 'switch_agent': {
      const want = String(args.agent || '').trim().toLowerCase();
      const all = q.all('SELECT id, name, role FROM agents');
      const a = all.find((x) => x.name.toLowerCase() === want) || all.find((x) => want && (x.name.toLowerCase().startsWith(want) || want.includes(x.name.toLowerCase())));
      if (!a) return { out: { error: `No agent called "${args.agent}". The office has: ${all.map((x) => x.name).join(', ')}.` } };
      if (a.id === agentId) return { out: { error: 'That is you.' } };
      return { out: { ok: true, handing_over_to: a.name, note: `Say one short sentence handing over to ${a.name}.` }, ui: { type: 'switch_agent', agent_id: a.id, agent_name: a.name } };
    }
    default: return { out: { error: 'unknown host tool ' + name } };
  }
}
