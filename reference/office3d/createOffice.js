import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COLORS,DESKS3D,disposeTree } from './primitives';
import { ZONES } from './zones';
import { desk } from './furniture';
import character from './character';
import room from './room';
import { updateBehavior,coordinateSocial } from './behavior';
import { animateCharacter } from './poses';
import { animateGames } from './games';
import { updateDeskScreens } from './deskScreens';
import { updateMeetingScreen } from './meetingScreen';
export default function createOffice(host,state,onReady,onHover){
  const scene=new THREE.Scene();scene.background=new THREE.Color('#e9ece8');
  const camera=new THREE.OrthographicCamera(-18,18,11,-11,.1,160),renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.6));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
  renderer.domElement.setAttribute('aria-label','A living office. Teammates work, walk, meet and take breaks. Click a teammate to chat, or open group chat.');renderer.domElement.setAttribute('role','img');host.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.enablePan=true;controls.screenSpacePanning=false;controls.panSpeed=.65;
  controls.minPolarAngle=.32;controls.maxPolarAngle=1.18;controls.minAzimuthAngle=-.1;controls.maxAzimuthAngle=1.6;controls.minZoom=.65;controls.maxZoom=3;
  const offset=new THREE.Vector3(27,30,34);let flight=null,focusRevision=-1;
  function reset(){controls.target.set(host.clientWidth<640?-6:0,1.3,0);camera.position.copy(controls.target).add(offset);camera.zoom=1;flight=null;controls.update();camera.updateProjectionMatrix();}
  function focus(id){const zone=ZONES[id];if(zone)flight={target:new THREE.Vector3(...zone.position),zoom:host.clientWidth<640?1:zone.zoom};}
  reset();scene.add(new THREE.HemisphereLight('#f7fbff','#919c87',2.15));
  const sun=new THREE.DirectionalLight('#fff1d7',3.3);sun.position.set(-4,18,9);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-20,right:20,top:20,bottom:-20,near:.1,far:65});sun.shadow.bias=-.0004;sun.shadow.normalBias=.05;sun.shadow.radius=4;scene.add(sun);
  const fill=new THREE.DirectionalLight('#c6deed',1);fill.position.set(5,9,-3);scene.add(fill);
  const {wood,zones}=room(scene),actors=new THREE.Group();scene.add(actors);
  let furniture=new THREE.Group();scene.add(furniture);
  const people=new Map();let visitor=null;let layoutSignature='',byDesk={},frame=0,disposed=false,last=0,lastLabel=0,lastShadow=0;
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let pointerStart=null,hovered=null;
  function hit(event){const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);for(const result of ray.intersectObjects([...actors.children,...furniture.children,...zones],true)){let o=result.object;while(o&&o!==scene){if(o.userData.meetingScreen||o.userData.visitor)return {meetingScreen:true};if(o.userData.agentId)return {agent:people.get(o.userData.agentId)?.agent};if(o.userData.desk)return {desk:DESKS3D.find(d=>d.n===o.userData.desk),agent:byDesk[o.userData.desk]};if(o.userData.zone)return {zone:o.userData.zone};o=o.parent;}}return null;}
  const move=e=>{if(pointerStart&&Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5){onHover(null);return;}const target=hit(e);hovered=target?.agent?.id||null;host.style.cursor=target?'pointer':'grab';};
  const down=e=>{pointerStart=[e.clientX,e.clientY];flight=null;};
  const up=e=>{const start=pointerStart;pointerStart=null;if(!start||Math.hypot(e.clientX-start[0],e.clientY-start[1])>6)return;const target=hit(e);if(target?.meetingScreen)state.current.onMeetingScreen?.();else if(target?.agent||target?.desk)state.current.onSelect?.(target.agent||null,target.desk);else if(target?.zone)state.current.onZone?.(target.zone);};
  const leave=()=>{hovered=null;pointerStart=null;};
  for(const [name,fn] of [['pointerdown',down],['pointerup',up],['pointermove',move],['pointerleave',leave]])renderer.domElement.addEventListener(name,fn);
  function sync(){
    const agents=(state.current.agents||[]).slice(0,8),next=JSON.stringify(agents.map(a=>[a.id,a.desk,a.team]));
    byDesk={};agents.forEach((a,i)=>{const slot=DESKS3D.find(d=>d.n===a.desk)||DESKS3D[i];byDesk[slot.n]=a;});
    if(next!==layoutSignature){layoutSignature=next;scene.remove(furniture);disposeTree(furniture,wood);furniture=new THREE.Group();scene.add(furniture);for(const d of DESKS3D)desk(furniture,d,wood,COLORS[byDesk[d.n]?.team]||'#85988c',!!byDesk[d.n]);renderer.shadowMap.needsUpdate=true;}
    for(const [id,c] of people){if(!agents.some(a=>a.id===id)){actors.remove(c.group);disposeTree(c.group);people.delete(id);}}
    agents.forEach((a,i)=>{let c=people.get(a.id);const slot=DESKS3D.find(d=>d.n===a.desk)||DESKS3D[i];if(c&&(c.agent.team!==a.team||c.slot.n!==slot.n)){actors.remove(c.group);disposeTree(c.group);people.delete(a.id);c=null;}if(!c){c=character(actors,a,slot,COLORS[a.team]||'#85988c');people.set(a.id,c);}const session=state.current.meeting,finished=session?.finished_at?Date.parse(session.finished_at):0,hold=session?.agent_id===a.id&&(!finished?Date.now()-Date.parse(session.created_date)<600000:Date.now()-finished<(session.status==='failed'?5000:20000))&&(!a.run_id||a.run_id===session.request_id);c.agent=hold?{...a,behavior:'meeting',behavior_until:new Date(Date.now()+30000).toISOString(),externalMeetingStatus:session.status,externalHost:session.visitor_name}:a;});
    const meeting=state.current.meeting,finished=meeting?.finished_at?Date.parse(meeting.finished_at):0,hasReply=meeting&&(meeting.status==='reviewing'||meeting.status==='completed'||meeting.events?.some(e=>e.label?.startsWith('Accoma concierge →')||e.label==='Accoma replied'||e.label==='Accoma booking response')),wanted=hasReply&&(!finished?Date.now()-Date.parse(meeting.created_date)<600000:Date.now()-finished<65000);
    if(visitor&&(!wanted||visitor.agent.id!=='visitor-'+meeting.id)){actors.remove(visitor.group);disposeTree(visitor.group);visitor=null;}
    if(wanted){if(!visitor){visitor=character(actors,{id:'visitor-'+meeting.id,name:meeting.visitor_name,isVisitor:true},{n:99,x:7,z:7.16},'#8b80c3');visitor.group.userData.visitor=true;}visitor.agent={...visitor.agent,hostAgent:meeting.agent_name,visitorStatus:meeting.status,departAt:finished?finished+(meeting.status==='failed'?3000:35000):0};}
    updateMeetingScreen(zones,state.current.screenSession||meeting);
    updateDeskScreens(furniture,people,Date.now());
    return agents;
  }
  let wasMobile=host.clientWidth<640;
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;const mobile=w<640,aspect=w/h,span=mobile?25:Math.max(21.5,33/aspect);Object.assign(camera,{left:-span*aspect/2,right:span*aspect/2,top:span/2,bottom:-span/2});camera.updateProjectionMatrix();renderer.setSize(w,h);if(mobile!==wasMobile){wasMobile=mobile;reset();if(state.current.focusRequest?.zone)focus(state.current.focusRequest.zone);}};
  const observer=new ResizeObserver(resize);observer.observe(host);resize();sync();
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');let visible=true;const intersection=new IntersectionObserver(([e])=>{visible=e.isIntersecting;});intersection.observe(host);
  function animate(time){
    if(disposed)return;frame=requestAnimationFrame(animate);if(time-last<32||document.hidden||!visible)return;
    const dt=Math.min(.08,(time-last)/1000||.033);last=time;const agents=sync(),characters=[...people.values(),...(visitor?[visitor]:[])];
    const command=state.current.focusRequest;if(command&&command.revision!==focusRevision){focusRevision=command.revision;focus(command.zone);}
    if(flight){const old=controls.target.clone();controls.target.lerp(flight.target,reduce.matches?1:.12);camera.position.add(controls.target.clone().sub(old));camera.zoom=THREE.MathUtils.lerp(camera.zoom,flight.zoom,reduce.matches?1:.12);camera.updateProjectionMatrix();if(controls.target.distanceTo(flight.target)<.02&&Math.abs(camera.zoom-flight.zoom)<.01)flight=null;}
    controls.update();const motion=state.current.animate&&!reduce.matches,now=Date.now();
    characters.forEach((c,i)=>{if(motion||!c.goal)updateBehavior(c,agents,now,dt);animateCharacter(c,time/1000+i*4,dt,motion);c.ring.visible=hovered===c.agent.id||state.current.selectedId===c.agent.id;if(c.agent.isVisitor&&c.goal?.key==='visitor-leaving'&&!c.path.length)c.group.visible=false;});coordinateSocial(characters);if(motion)animateGames(zones,characters,time/1000,dt);
    if(motion&&time-lastShadow>120){renderer.shadowMap.needsUpdate=true;lastShadow=time;}
    renderer.render(scene,camera);
    if(time-lastLabel>220){lastLabel=time;state.current.onPresence?.(characters.map(c=>{const p=new THREE.Vector3(c.group.position.x,2.28,c.group.position.z).project(camera),x=(p.x+1)*host.clientWidth/2,y=(1-p.y)*host.clientHeight/2;return {id:c.agent.id,name:c.agent.name,label:c.label,mode:c.mode,x,y,visitor:!!c.agent.isVisitor,visible:c.group.visible&&p.z<1&&x>20&&x<host.clientWidth-20&&y>105&&y<host.clientHeight-60};}));}
  }
  frame=requestAnimationFrame(animate);onReady();
  return {reset,zoom:factor=>{flight=null;camera.zoom=THREE.MathUtils.clamp(camera.zoom*factor,.65,3);camera.updateProjectionMatrix();},dispose:()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();controls.dispose();for(const [name,fn] of [['pointerdown',down],['pointerup',up],['pointermove',move],['pointerleave',leave]])renderer.domElement.removeEventListener(name,fn);disposeTree(scene);renderer.dispose();renderer.domElement.remove();}};
}
