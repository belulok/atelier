// Coworkers' agents in the shared office (Pip, Iris, Atlas, Scout, Nova). They used to be
// decoration in the 3D office only; now they are real agents, so every agent on the
// floor has a chat you can open, by text or voice. Each belongs to a (sample) coworker.
import { q } from './db.js'; // db.js adds the agents.owner column

export const COLLEAGUE_AGENTS = [
  { id: 'demo-pip', name: 'Pip', role: 'Welcome assistant', owner: 'Alex', floor: 0, desk: 2, team: 'content', department: 'The Commons', activity: 'Ready to help',
    instructions: 'You greet people in the office, explain how Atelier works (floors, agents, Raise Hand approvals, voice) and point them to the right teammate.' },
  { id: 'demo-iris', name: 'Iris', role: 'Guest research', owner: 'Jules', floor: 1, desk: 5, team: 'software', department: 'Guest Experience', activity: 'Researching local favourites',
    instructions: 'You research what guests enjoy near the flats (restaurants, transport, sights) and suggest touches that make stays better. You never message guests yourself.' },
  { id: 'demo-atlas', name: 'Atlas', role: 'Schedule assistant', owner: 'Omar', floor: 2, desk: 5, team: 'content', department: 'Operations', activity: 'Organising the day',
    instructions: 'You keep the day organised: check-ins, check-outs and cleaning jobs, and you flag clashes in the schedule.' },
  { id: 'demo-scout', name: 'Scout', role: 'Research assistant', owner: 'Finn', floor: 3, desk: 2, team: 'research', department: 'The Studio', activity: 'Collecting inspiration',
    instructions: 'You collect ideas and inspiration for new services and improvements to the guest experience.' },
  { id: 'demo-nova', name: 'Nova', role: 'Strategy assistant', owner: 'Ada', floor: 3, desk: 3, team: 'software', department: 'The Studio', activity: 'Exploring opportunities',
    instructions: 'You look at the business as a whole (occupancy, pricing, reviews) and suggest where the host could grow or improve.' },
];

// Add any coworker agent that's missing. Safe to run on every start and after a reset.
export function ensureColleagueAgents() {
  for (const a of COLLEAGUE_AGENTS) {
    if (!q.get('SELECT id FROM agents WHERE id=?', a.id)) {
      q.run('INSERT INTO agents (id,name,role,department,desk,floor,team,is_custom,created_at,instructions,owner) VALUES (?,?,?,?,?,?,?,0,?,?,?)',
        a.id, a.name, a.role, a.department, a.desk, a.floor, a.team, new Date().toISOString(), a.instructions, a.owner);
    }
    if (!q.get('SELECT agent_id FROM agent_state WHERE agent_id=?', a.id)) {
      q.run('INSERT INTO agent_state (agent_id,status,current_task,memory) VALUES (?,?,?,?)', a.id, 'idle', a.activity, '[]');
    }
  }
}
