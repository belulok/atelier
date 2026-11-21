export const FLOORS = [
  { id: 0, code: 'G', name: 'The Commons', short: 'Lobby & lounge', description: 'A good day starts with a hello.', color: '#d39a57', tint: '#eee3d2', type: 'lobby' },
  { id: 1, code: '01', name: 'Guest Experience', short: 'Concierge & care', description: 'Great stays, thoughtful little details.', color: '#558c78', tint: '#dce9e1', type: 'office' },
  { id: 2, code: '02', name: 'Operations', short: 'Planning & delivery', description: 'The people keeping everything moving.', color: '#648aaf', tint: '#dbe6ee', type: 'office' },
  { id: 3, code: '03', name: 'The Studio', short: 'Ideas & strategy', description: 'A little space for the next big thing.', color: '#9b83b5', tint: '#e8e1ed', type: 'studio' },
];

export const AGENT_PROFILES = {
  mila: { name: 'Mila', role: 'Guest concierge', floor: 1, team: 'content' },
  sam: { name: 'Sam', role: 'Reviews & reputation', floor: 1, team: 'support' },
  theo: { name: 'Theo', role: 'Turnover coordinator', floor: 2, team: 'research' },
  priya: { name: 'Priya', role: 'Pricing & calendar', floor: 2, team: 'software' },
};

const HUMAN_MEMBERS = [
  { id: 'demo-alex', name: 'Alex', role: 'Community lead', floor: 0, color: '#bb7e5d', activity: 'Welcoming the team', behavior: 'coffee' },
  { id: 'demo-jules', name: 'Jules', role: 'Guest experience lead', floor: 1, color: '#798ec0', activity: 'At their desk', behavior: 'desk' },
  { id: 'demo-nina', name: 'Nina', role: 'Guest relations', floor: 1, color: '#b4819c', activity: 'Catching up with the team', behavior: 'social' },
  { id: 'demo-omar', name: 'Omar', role: 'Operations lead', floor: 2, color: '#679789', activity: 'Planning the week', behavior: 'desk' },
  { id: 'demo-ellie', name: 'Ellie', role: 'Property manager', floor: 2, color: '#ba9053', activity: 'Taking a coffee break', behavior: 'coffee' },
  { id: 'demo-finn', name: 'Finn', role: 'Creative director', floor: 3, color: '#8b81b1', activity: 'Exploring a new idea', behavior: 'desk' },
  { id: 'demo-ada', name: 'Ada', role: 'Founder', floor: 3, color: '#bd816c', activity: 'In a focus session', behavior: 'booths' },
];
export function organisationMembers(agents = []) {
  // Every agent in the office comes from the server (yours, hired subagents and coworkers'
  // agents like Pip or Iris), so every agent on the floor has a chat. The built-in
  // profiles only fill in until the first state arrives.
  const list = agents.length ? agents : Object.keys(AGENT_PROFILES).map(id => ({ id }));
  const all = list.map((a) => {
    const profile = AGENT_PROFILES[a.id] || {};
    return { status: 'idle', ...profile, ...a, id: a.id,
      name: a.name || profile.name || a.id, role: a.role || profile.role || 'Agent',
      floor: a.floor ?? profile.floor ?? 1, desk: a.desk, team: a.team || profile.team || 'software',
      owner: a.owner || 'You', kind: 'agent' };
  });
  return [
    ...HUMAN_MEMBERS.map(p => ({ ...p, kind: 'person', isSample: true, status: 'present' })),
    ...all,
  ];
}

export function occupantsForFloor(members, floor, session) {
  const occupants = members.filter(m => m.floor === floor);
  occupants.push({ id: 'you', name: 'You', kind: 'person', isSelf: true, floor, color: '#426b63',
    role: 'Your workspace', status: session.active ? 'working' : 'present',
    activity: session.active ? 'Making things happen' : 'Getting ready for the day',
    behavior: session.active && floor > 0 ? 'desk' : 'social' });
  return occupants.map((p, i) => ({ ...p, desk: i + 1 }));
}

export const SESSION_KEY = 'isomux-building-session-v1';
export function parseSession(value) {
  try {
    const s = JSON.parse(value);
    const startedAt = Number.isFinite(s.startedAt) && s.startedAt > 0 && s.startedAt <= Date.now() ? s.startedAt : null;
    return { active: !!s.active && !!startedAt, startedAt, floor: FLOORS.some(f => f.id === s.floor) ? s.floor : 0 };
  } catch { return { active: false, startedAt: null, floor: 0 }; }
}
