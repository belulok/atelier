import { useEffect, useMemo, useRef, useState } from 'react';
import OfficeCanvas from './OfficeCanvas';
import Icon from './Icon';
import { FLOORS, SESSION_KEY, organisationMembers, occupantsForFloor, parseSession } from './building';

function storedSession() {
  try { return parseSession(localStorage.getItem(SESSION_KEY)); } catch { return parseSession(null); }
}
function initials(name) { return name === 'You' ? 'Y' : name.slice(0, 2); }
function ownership(person) { return person.owner === 'You' ? 'Your agent' : `${person.owner}’s agent`; }
function Avatar({ person, small = false }) {
  return <span className={`person-avatar ${person.kind} ${small ? 'small' : ''}`} style={{ '--avatar-color': person.color || ({ software: '#658eb6', content: '#c69b4a', research: '#71a18b', support: '#c78371' }[person.team]) || '#73978b' }}>
    {person.kind === 'agent' ? <Icon name="agent" size={small ? 15 : 20} /> : initials(person.name)}
  </span>;
}
function labelStatus(person) {
  if (person.isSelf) return 'You are here';
  if (person.status === 'needs_approval') return 'Needs your approval';
  if (person.kind === 'person') return person.activity;
  return person.activity || (person.status === 'idle' ? 'Ready for the next task' : person.current_task || person.status);
}

export default function OfficeExperience({ agents, onInspect, onAgentChat }) {
  const [session, setSession] = useState(storedSession);
  const [view, setView] = useState('floor');
  const [scope, setScope] = useState('floor');
  const [bubbles, setBubbles] = useState([]);
  const [floorLabels, setFloorLabels] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [travel, setTravel] = useState(null);
  const [liftOpen, setLiftOpen] = useState(false);
  const [cameraRequest, setCameraRequest] = useState(null);
  const [angle, setAngle] = useState('isometric');
  const [clock, setClock] = useState(Date.now());
  const [announcement, setAnnouncement] = useState('Welcome to your organisation’s home.');
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const timerRef = useRef(null), dialogRef = useRef(null), directoryRef = useRef(null);
  const floor = FLOORS[session.floor];
  const members = useMemo(() => organisationMembers(agents), [agents]);
  const occupants = useMemo(() => occupantsForFloor(members, session.floor, session), [members, session]);
  const selected = occupants.find(p => p.id === selectedId) || members.find(p => p.id === selectedId);
  const directory = scope === 'floor' ? occupants : members;
  const humans = directory.filter(p => p.kind === 'person');
  const assistants = directory.filter(p => p.kind === 'agent');
  const elapsed = session.startedAt ? Math.max(0, Math.floor((clock - session.startedAt) / 60000)) : 0;

  useEffect(() => { try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {} }, [session]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30000);return () => clearInterval(timer); }, []);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  useEffect(() => { if (selectedId) directoryRef.current?.scrollTo({ top: 0 }); }, [selectedId]);
  useEffect(() => { if (liftOpen && !dialogRef.current?.open) dialogRef.current?.showModal();else if (!liftOpen && dialogRef.current?.open) dialogRef.current.close(); }, [liftOpen]);

  function visit(id, focusId = null) {
    if (travel || !FLOORS[id]) return;
    setLiftOpen(false); setView('floor');setSelectedId(focusId);setBubbles([]);
    if (id === session.floor) return;
    setTravel({ from: session.floor, to: id });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timerRef.current = setTimeout(() => {
      setSession(s => ({ ...s, floor: id }));
      setAnnouncement(`You arrived on ${id === 0 ? 'the ground floor' : `level ${FLOORS[id].code}`} · ${FLOORS[id].name}.`);
      setTravel(null);
    }, reduced ? 0 : 850);
  }
  function startWork() {
    setSession(s => ({ ...s, active: true, startedAt: Date.now() }));setClock(Date.now());
    setAnnouncement('Your work session has started. Welcome back.');visit(1);
  }
  function endWork() {
    setSession(s => ({ ...s, active: false, startedAt: null }));visit(0, 'you');
    setAnnouncement('Work session ended. See you next time.');
  }
  function camera(action, value) {
    if (action === 'angle') setAngle(value);
    if (action === 'reset') setAngle('isometric');
    setCameraRequest({ action, ...(action === 'zoom' ? { factor: value } : { angle: value || 'isometric' }), revision: performance.now() });
  }
  const visibleBubbles = useMemo(() => {
    const chosen = [];
    const priority = b => b.id === selectedId ? 3 : b.id === 'you' ? 2 : b.hovered ? 1 : 0;
    [...bubbles].filter(b => b.visible).sort((a,b) => priority(b) - priority(a)).forEach(b => {
      if (!chosen.some(p => Math.abs(p.x - b.x) < 112 && Math.abs(p.y - b.y) < 35)) chosen.push(b);
    });
    return chosen;
  }, [bubbles, selectedId]);

  // In simple mode the office stays clickable behind the popup: tapping an agent
  // opens the chat with them instead of the people sidebar.
  function handleSelect(p) {
    if (onAgentChat) {
      if (p?.kind === 'agent') { setSelectedId(p.id); onAgentChat(p.id); }
      return;
    }
    setSelectedId(p?.id); setPeopleOpen(true);
  }

  return <div className={`office-experience ${peopleOpen ? 'show-people' : ''} ${railOpen ? 'rail-open' : ''}`}>
    <button className="rail-fab" onClick={() => setRailOpen(v => !v)} aria-expanded={railOpen} aria-label="Open building floors"><Icon name="building" size={17}/><span>Floors</span></button>
    <nav className="floor-rail" aria-label="Building floors">
      <div className="rail-heading"><span className="building-mark"><Icon name="building" size={22}/></span><div><strong>Your HQ</strong><span>One team. Four floors.</span></div><button className="icon-button rail-close" aria-label="Close building panel" onClick={() => setRailOpen(false)}><Icon name="close" size={15}/></button></div>
      <button className={`building-toggle ${view === 'building' ? 'active' : ''}`} onClick={() => {setView(view === 'building' ? 'floor' : 'building');setBubbles([]);}} aria-pressed={view === 'building'}><Icon name="layers" size={18}/> Building overview</button>
      <div className="rail-caption">EXPLORE THE BUILDING</div>
      <div className="floor-stops">
        {[...FLOORS].reverse().map(f => {
          const count = members.filter(p => p.floor === f.id).length + (session.floor === f.id ? 1 : 0);
          return <button key={f.id} className={`floor-stop ${session.floor === f.id ? 'current' : ''}`} style={{ '--floor-color': f.color, '--floor-tint': f.tint }} onClick={() => visit(f.id)} disabled={!!travel} aria-current={session.floor === f.id ? 'location' : undefined} aria-label={`Go to ${f.id ? `level ${f.code}` : 'ground floor'}: ${f.name}`}>
            <span className="floor-number">{f.code}</span><span className="floor-stop-copy"><strong>{f.name}</strong><span>{f.short}</span><small>{count} here {session.floor === f.id && <b>· You’re here</b>}</small></span>
          </button>;
        })}
      </div>
      <div className="rail-bottom"><span className="tiny-building"><Icon name="people" size={18}/></span><strong>Better, together.</strong><p>Your people and their agents,<br/>under one roof.</p><span className="sample-label">Organisation simulation</span></div>
    </nav>

    <section className={`building-stage ${travel ? 'travelling' : ''}`} aria-label="Office simulation">
      <div className="scene-heading">
        <div className="eyebrow">{view === 'building' ? 'YOUR ORGANISATION' : `LEVEL ${floor.code} / YOUR HQ`}</div>
        <h1>{view === 'building' ? 'Room to do great things.' : floor.name}<span className="floor-dot" style={{background: floor.color}}/></h1>
        <p>{view === 'building' ? 'A shared home for your people and their agents. Select a floor to step inside.' : floor.description}</p>
      </div>
      <div className="view-switch" aria-label="Scene view">
        <button onClick={() => setView('floor')} className={view === 'floor' ? 'on' : ''} aria-pressed={view === 'floor'}><Icon name="focus" size={15}/> Floor</button>
        <button onClick={() => {setView('building');setBubbles([]);}} className={view === 'building' ? 'on' : ''} aria-pressed={view === 'building'}><Icon name="layers" size={15}/> Building</button>
      </div>
      <div className="scene-world">
        <OfficeCanvas agents={occupants} selectedId={selectedId} onSelect={handleSelect} onPresence={setBubbles}
          floorId={session.floor} view={view} cameraRequest={cameraRequest} onFloorSelect={visit} onLift={() => setLiftOpen(true)} onFloorLabels={setFloorLabels} />
        {view === 'building' && <div className="building-markers">{floorLabels.filter(f => f.visible).map(label => {const f = FLOORS[label.id];return <button key={f.id} style={{left:label.x,top:label.y,'--floor-color':f.color}} className={`building-label ${f.id===session.floor?'current':''}`} onClick={() => visit(f.id)} aria-label={`Enter ${f.name}`}><b>{f.code}</b><span>{f.name}{f.id===session.floor && <small>You are here</small>}</span></button>;})}</div>}
        <div className="bubbles">
          {view === 'floor' && !travel && visibleBubbles.map(b => {
            const p = occupants.find(a => a.id === b.id);if (!p) return null;
            const expanded = selectedId === b.id || b.hovered;
            return <button key={b.id} className={`presence-tag ${p.isSelf ? 'self' : ''} ${expanded ? 'expanded' : ''} ${p.status === 'needs_approval' ? 'approval-tag' : ''}`} style={{left:b.x,top:b.y}} onClick={() => handleSelect(p)} aria-label={onAgentChat && p.kind === 'agent' ? `Chat with ${p.name}` : `View ${p.name}, ${p.kind === 'agent' ? ownership(p) : p.role}`}>
              <span className="presence-name">{p.kind === 'agent' ? <Icon name="agent" size={12}/> : <span className="presence-dot"/>}{p.name}</span>
              {expanded && <span className="presence-detail">{p.kind === 'agent' ? `${ownership(p)} · ` : ''}{b.label}</span>}
            </button>;
          })}
        </div>
      </div>
      {travel && <div className="lift-transition" role="status"><div className="lift-travel-icon"><Icon name="lift" size={30}/></div><span>{travel.to > travel.from ? 'Going up' : 'Going down'}</span><strong>{FLOORS[travel.to].code}</strong><span>{FLOORS[travel.to].name}</span></div>}
      <div className="camera-toolbar" aria-label="Camera controls">
        <div className="camera-select"><select aria-label="Camera angle" value={angle} onChange={e => camera('angle',e.target.value)}><option value="isometric">Isometric</option><option value="front">Front view</option><option value="plan">Top view</option></select><span>⌄</span></div>
        <button onClick={() => camera('zoom',1.2)} aria-label="Zoom in"><Icon name="plus" size={17}/></button>
        <button onClick={() => camera('zoom',1/1.2)} aria-label="Zoom out"><Icon name="minus" size={17}/></button>
        <button onClick={() => camera('reset')} aria-label="Reset camera"><Icon name="reset" size={17}/></button>
      </div>
      <div className="stage-hint">Drag to look around <span>·</span> Scroll to zoom <span>·</span> {onAgentChat ? 'Click an agent to open the chat' : 'Select a teammate'}</div>
      <div className="work-session-bar">
        <div className={`session-avatar ${session.active ? 'working' : ''}`}><span>Y</span><i/></div>
        <div className="session-location"><strong>{session.active ? 'You’re at work' : 'Make yourself at home'}</strong><span><Icon name="pin" size={12}/>{floor.name} · Level {floor.code}</span></div>
        {session.active && <div className="session-duration"><Icon name="clock" size={14}/>{elapsed < 60 ? `${elapsed} min` : `${Math.floor(elapsed/60)}h ${elapsed%60}m`}</div>}
        <button className="lift-button" aria-label="Take the lift" onClick={() => setLiftOpen(true)} disabled={!!travel}><Icon name="lift" size={17}/><span>Take the lift</span></button>
        <button className={`session-button ${session.active ? 'end' : ''}`} onClick={session.active ? endWork : startWork} disabled={!!travel}><Icon name={session.active ? 'check' : 'sun'} size={17}/>{session.active ? 'Finish work' : 'Start work'}</button>
      </div>
      <button className="mobile-people-button" onClick={() => setPeopleOpen(!peopleOpen)} aria-expanded={peopleOpen}><Icon name="people" size={18}/> People</button>
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    </section>

    <aside className="people-panel" aria-label="Organisation directory">
      <div className="people-heading"><div><h2>In good company</h2><p>People & their agents</p></div><button className="mobile-close icon-button" aria-label="Close people" onClick={() => setPeopleOpen(false)}><Icon name="close"/></button></div>
      <div className="directory-scope"><button className={scope==='floor'?'on':''} onClick={() => setScope('floor')} aria-pressed={scope==='floor'}>This floor <span>{occupants.length}</span></button><button className={scope==='organisation'?'on':''} onClick={() => setScope('organisation')} aria-pressed={scope==='organisation'}>Everyone <span>{members.length}</span></button></div>
      <div className="directory-content" ref={directoryRef}>
        {selected && <div className="person-detail"><button className="detail-close icon-button" onClick={() => setSelectedId(null)} aria-label="Close person details"><Icon name="close" size={15}/></button><Avatar person={selected}/><h3>{selected.name}</h3><p>{selected.role}</p><div className="detail-status"><span/>{labelStatus(selected)}</div>{selected.kind === 'agent' && <div className="detail-owner">Agent for <b>{selected.owner}</b></div>}<button className="find-person" onClick={() => {visit(selected.floor,selected.id);setPeopleOpen(false);}}><Icon name="pin" size={14}/>{FLOORS[selected.floor].name} · {FLOORS[selected.floor].code}</button>{selected.kind === 'agent' && onInspect && <button className="find-person" onClick={() => onInspect(selected.id)}>🔀 Inspect workflow</button>}{selected.isSample && <small className="sample-person">Sample {selected.kind === 'person' ? 'coworker' : 'agent'} in this simulation</small>}</div>}
        {[['PEOPLE',humans],['AI AGENTS',assistants]].map(([label,list]) => <div className="member-group" key={label}><div className="member-group-title">{label}<span>{list.length}</span></div>{list.map(p => <button key={p.id} className={`member-row ${p.id===selectedId?'selected':''}`} onClick={() => setSelectedId(p.id)} aria-label={`View details for ${p.name}`}><Avatar person={p}/><span className="member-copy"><strong>{p.name}{p.kind==='agent' && p.owner==='You' && <small className="yours">yours</small>}</strong><span>{p.kind==='agent'?ownership(p):p.role}</span></span>{scope==='organisation'?<span className="member-floor">{FLOORS[p.floor].code}</span>:<span className={`member-state ${p.status==='needs_approval'?'needs-approval':''}`} title={labelStatus(p)}/>}</button>)}</div>)}
      </div>
      <div className="directory-note"><span className="demo-presence"><Icon name="people" size={16}/> Demo presence</span><p>Coworkers and their agents are simulated. Your existing agent workflow stays connected.</p></div>
    </aside>

    <dialog ref={dialogRef} className="lift-dialog" onCancel={() => setLiftOpen(false)} onClick={e => {if(e.target===e.currentTarget)setLiftOpen(false);}} aria-labelledby="lift-title">
      <div className="lift-dialog-heading"><span className="building-mark"><Icon name="lift" size={24}/></span><button className="icon-button" aria-label="Close lift" onClick={() => setLiftOpen(false)}><Icon name="close"/></button></div>
      <h2 id="lift-title">Where are we heading?</h2><p>You’re on level {floor.code}. There’s a whole building to explore.</p>
      {[...FLOORS].reverse().map(f => <button key={f.id} className={`lift-floor ${f.id===session.floor?'here':''}`} onClick={() => visit(f.id)}><span style={{background:f.tint,color:f.color}}>{f.code}</span><div><strong>{f.name}</strong><small>{f.short}</small></div>{f.id===session.floor?<small>You’re here</small>:<Icon name="chevron" size={16}/>}</button>)}
    </dialog>
  </div>;
}
