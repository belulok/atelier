import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COLORS, DESKS3D, disposeTree } from './primitives';
import { desk } from './furniture';
import character from './character';
import room from './room';
import buildingShell, { FLOOR_HEIGHT } from './buildingShell';
import { FLOORS } from '../office/building';
import { updateBehavior, coordinateSocial } from './behavior';
import { animateCharacter } from './poses';
import { animateGames } from './games';
import { updateDeskScreens } from './deskScreens';
import { updateMeetingScreen } from './meetingScreen';

const ANGLES = { isometric: [28, 30, 34], front: [1, 23, 42], plan: [0, 48, .1] };

export default function createOffice(host, state, onReady = () => {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, .1, 220);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute('aria-label', 'Interactive office building. Use the floor buttons to travel, or drag to rotate the view.');
  renderer.domElement.setAttribute('role', 'img');
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: .09, enablePan: true,
    screenSpacePanning: true, panSpeed: .6, minPolarAngle: .01, maxPolarAngle: 1.3,
    minAzimuthAngle: -.7, maxAzimuthAngle: 1.5, minZoom: .65, maxZoom: 2.5 });
  scene.add(new THREE.HemisphereLight('#f4f9ff', '#94a89b', 2.3));
  const sun = new THREE.DirectionalLight('#fff0da', 3.1);
  sun.position.set(-5, 35, 18); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 32, bottom: -25, near: .1, far: 100 });
  sun.shadow.bias = -.0004; sun.shadow.normalBias = .05; sun.shadow.radius = 4; scene.add(sun);
  const fill = new THREE.DirectionalLight('#d7e7f5', 1);fill.position.set(8, 15, -6);scene.add(fill);

  const shell = buildingShell(scene, FLOORS);
  let world, furniture, actors, wood, zones = [], floorId = -1, overview = false;
  let people = new Map(), byDesk = {}, layoutSignature = '', hovered = null;
  let frame = 0, disposed = false, last = 0, lastLabel = 0, lastSync = 0, lastShadow = 0;
  let pointerStart = null, commandRevision = -1, lastMode = '', flight = null;
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let cameraAngle = 'isometric';

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const aspect = w / h, span = overview ? Math.max(42, 44 / aspect) : Math.max(24, 37 / aspect);
    Object.assign(camera, { left: -span * aspect / 2, right: span * aspect / 2, top: span / 2, bottom: -span / 2 });
    camera.updateProjectionMatrix(); renderer.setSize(w, h);
  }
  function reset(angle = cameraAngle, immediate = false) {
    cameraAngle = angle;
    const target = new THREE.Vector3(1.3, overview ? 10.5 : .6, 0);
    const offset = new THREE.Vector3(...(overview ? ({ isometric: [34, 29, 42], front: [1, 28, 50], plan: [0, 60, .1] }[angle] || [34,29,42]) : ANGLES[angle] || ANGLES.isometric));
    const position = target.clone().add(offset);
    if (immediate || reduce.matches) {
      controls.target.copy(target); camera.position.copy(position); camera.zoom = 1; flight = null;
      controls.update(); camera.updateProjectionMatrix();
    } else flight = { target, position, zoom: 1 };
  }
  function buildFloor(id) {
    if (world) { scene.remove(world); disposeTree(world); }
    world = new THREE.Group(); scene.add(world);
    const result = room(world, FLOORS[id]);wood = result.wood;zones = result.zones;
    actors = new THREE.Group(); furniture = new THREE.Group();world.add(actors, furniture);
    floorId = id; people = new Map(); layoutSignature = ''; hovered = null;
    state.current.onPresence?.([]); renderer.shadowMap.needsUpdate = true;
  }
  function sync() {
    const nextId = state.current.floorId ?? 0;
    if (nextId !== floorId) buildFloor(nextId);
    overview = state.current.view === 'building';
    shell.group.visible = overview; world.visible = !overview;
    shell.decks.forEach(d => { d.edges.visible = d.floor.id === floorId; });
    if (lastMode !== state.current.view) { lastMode = state.current.view; resize(); reset(cameraAngle, true); }
    const agents = (state.current.agents || []).slice(0, 8);
    const next = JSON.stringify(agents.map(a => [a.id, a.desk, a.team, a.color]));
    byDesk = {};
    agents.forEach((a, i) => { const slot = DESKS3D.find(d => d.n === a.desk) || DESKS3D[i]; byDesk[slot.n] = a; });
    if (next !== layoutSignature) {
      layoutSignature = next;world.remove(furniture);disposeTree(furniture, wood);furniture = new THREE.Group();world.add(furniture);
      if (floorId !== 0) for (const d of DESKS3D) {
        const person = byDesk[d.n]; desk(furniture, d, wood, person?.color || COLORS[person?.team] || '#b0bdb1', !!person);
      }
      renderer.shadowMap.needsUpdate = true;
    }
    for (const [id, c] of people) if (!agents.some(a => a.id === id)) { actors.remove(c.group);disposeTree(c.group);people.delete(id); }
    agents.forEach((a, i) => {
      const slot = DESKS3D.find(d => d.n === a.desk) || DESKS3D[i];let c = people.get(a.id);
      if (!c) {
        c = character(actors, a, slot, a.color || COLORS[a.team] || '#759e88');
        if (floorId === 0) c.group.position.set(-6 + i * 3, 0, 4.5);
        people.set(a.id, c);
      }
      c.agent = a;
    });
    updateDeskScreens(furniture, people, Date.now());
    updateMeetingScreen(zones, state.current.meeting);
    return agents;
  }
  function hit(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(pointer, camera);
    for (const result of ray.intersectObjects(overview ? shell.group.children : world.children, true)) {
      let object = result.object;
      while (object && object !== scene) {
        if (overview && object.userData.floorId !== undefined) return { floor: object.userData.floorId };
        if (!overview && object.userData.elevator) return { elevator: true };
        if (!overview && object.userData.agentId) return { agent: people.get(object.userData.agentId)?.agent };
        if (!overview && object.userData.desk && byDesk[object.userData.desk]) return { agent: byDesk[object.userData.desk] };
        object = object.parent;
      }
    }
    return null;
  }
  const down = e => { pointerStart = [e.clientX, e.clientY]; flight = null; };
  const move = e => {
    if (pointerStart) return;
    const target = hit(e);hovered = target?.agent?.id || null;host.style.cursor = target ? 'pointer' : 'grab';
  };
  const up = e => {
    const start = pointerStart;pointerStart = null;
    if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 6) return;
    const target = hit(e);
    if (target?.floor !== undefined) state.current.onFloorSelect?.(target.floor);
    else if (target?.elevator) state.current.onLift?.();
    else if (target?.agent) state.current.onSelect?.(target.agent);
  };
  const leave = () => { hovered = null;pointerStart = null; };
  for (const [name, fn] of [['pointerdown', down], ['pointerup', up], ['pointermove', move], ['pointerleave', leave]]) renderer.domElement.addEventListener(name, fn);
  const observer = new ResizeObserver(resize);observer.observe(host);
  sync();resize();reset('isometric', true);
  let visible = true;const intersection = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });intersection.observe(host);

  function animate(time) {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    if (time - last < 32 || document.hidden || !visible) return;
    const dt = Math.min(.08, (time - last) / 1000 || .033);last = time;
    // Floor/view changes must be atomic with character updates. Throttling these
    // could pair the old floor's characters with the next floor's roster.
    if (time - lastSync > 180 || (state.current.floorId ?? 0) !== floorId || state.current.view !== lastMode) { sync(); lastSync = time; }
    const command = state.current.cameraRequest;
    if (command && command.revision !== commandRevision) {
      commandRevision = command.revision;
      if (command.action === 'zoom') { flight = null;camera.zoom = THREE.MathUtils.clamp(camera.zoom * command.factor, .65, 2.5);camera.updateProjectionMatrix(); }
      else reset(command.angle || 'isometric');
    }
    if (flight) {
      const speed = Math.min(1, dt * 7);
      controls.target.lerp(flight.target, speed);camera.position.lerp(flight.position, speed);
      camera.zoom = THREE.MathUtils.lerp(camera.zoom, flight.zoom, speed);camera.updateProjectionMatrix();
      if (camera.position.distanceTo(flight.position) < .03) flight = null;
    }
    controls.update();
    const characters = [...people.values()], agents = state.current.agents || [], motion = !reduce.matches;
    if (!overview) {
      characters.forEach((c, i) => {
        if (motion || !c.goal) updateBehavior(c, agents, Date.now(), dt);
        animateCharacter(c, time / 1000 + i * 4, dt, motion);
        c.ring.visible = hovered === c.agent.id || state.current.selectedId === c.agent.id || c.agent.isSelf;
      });
      coordinateSocial(characters);if (motion) animateGames(zones, characters, time / 1000, dt);
    }
    if (time - lastShadow > 180) { renderer.shadowMap.needsUpdate = true;lastShadow = time; }
    renderer.render(scene, camera);
    if (time - lastLabel > 180) {
      lastLabel = time;
      state.current.onPresence?.(overview ? [] : characters.map(c => {
        const p = new THREE.Vector3(c.group.position.x, 2.5, c.group.position.z).project(camera);
        const x = (p.x + 1) * host.clientWidth / 2, y = (1 - p.y) * host.clientHeight / 2;
        return { id: c.agent.id, name: c.agent.name, label: c.label, mode: c.mode, x, y,
          hovered: hovered === c.agent.id, visible: p.z < 1 && x > 32 && x < host.clientWidth - 32 && y > 20 && y < host.clientHeight - 12 };
      }));
      state.current.onFloorLabels?.(overview ? FLOORS.map(f => {
        const p = new THREE.Vector3(16.4, f.id * FLOOR_HEIGHT + .6, 5.3).project(camera);
        return { id: f.id, x: Math.min(host.clientWidth - 102, Math.max(102, (p.x + 1) * host.clientWidth / 2)), y: (1 - p.y) * host.clientHeight / 2, visible: p.z < 1 && Math.abs(p.y) < .95 };
      }) : []);
    }
  }
  frame = requestAnimationFrame(animate);onReady();
  return { dispose() {
    disposed = true;cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();controls.dispose();
    for (const [name, fn] of [['pointerdown', down], ['pointerup', up], ['pointermove', move], ['pointerleave', leave]]) renderer.domElement.removeEventListener(name, fn);
    disposeTree(scene);renderer.dispose();renderer.domElement.remove();
  } };
}
