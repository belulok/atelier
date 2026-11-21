// Team builder shared by the API (Hire button) and the agents' hire_agent tool.
import { q, audit } from './db.js';
import { emit } from './events.js';

export const DEPARTMENTS = {
  'Guest Experience': { floor: 1, team: 'content' },
  'Operations': { floor: 2, team: 'research' },
  'The Studio': { floor: 3, team: 'software' },
  'Support': { floor: 1, team: 'support' },
};

// Keeps a runaway conversation from filling the office.
export const MAX_AGENTS = 16;

// Hire an agent. `reportsTo`: the id of the agent it works under (a subagent), if any.
// `instructions`: a short job description added to its system prompt.
export function hireAgent({ name, role, department, desk, instructions, reportsTo, hiredBy = 'host' }) {
  name = String(name || '').trim().slice(0, 40);
  role = String(role || '').trim().slice(0, 80);
  if (!name || !role) throw new Error('name and role are required');
  if (q.all('SELECT id FROM agents').length >= MAX_AGENTS) throw new Error(`the office is full (${MAX_AGENTS} agents)`);
  if (reportsTo && !q.get('SELECT id FROM agents WHERE id=?', reportsTo)) throw new Error(`no agent ${reportsTo} to report to`);
  const deptName = DEPARTMENTS[department] ? department : 'Operations';
  const dept = DEPARTMENTS[deptName];
  const deskN = Math.min(8, Math.max(1, parseInt(desk, 10) || (q.all('SELECT desk FROM agents').length % 8) + 1));
  const id = 'agent_' + Math.random().toString(36).slice(2, 9);
  q.run('INSERT INTO agents (id,name,role,department,desk,floor,team,is_custom,created_at,reports_to,instructions) VALUES (?,?,?,?,?,?,?,1,?,?,?)',
    id, name, role, deptName, deskN, dept.floor, dept.team, new Date().toISOString(), reportsTo || null, String(instructions || '').trim().slice(0, 600) || null);
  q.run('INSERT INTO agent_state (agent_id,status,current_task,memory) VALUES (?,?,?,?)', id, 'idle', `${role} — ready`, '[]');
  const boss = reportsTo ? q.get('SELECT name FROM agents WHERE id=?', reportsTo)?.name : null;
  audit(id, 'system', `🧑‍💼 agent hired by ${hiredBy}: ${name} (${role}, ${deptName}, desk ${deskN}${boss ? `, reports to ${boss}` : ''})`);
  emit('state');
  return { id, name, role, department: deptName, desk: deskN, floor: dept.floor, reports_to: reportsTo || null };
}
