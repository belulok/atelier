import { findPath } from './navigation';
const hash=s=>[...s].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);
const SEATS=[[5.75,4.95,Math.PI],[7,4.95,Math.PI],[8.25,4.95,Math.PI],[5.75,2.05,0],[7,2.05,0],[8.25,2.05,0]];
function destination(c,agents,now){
  const a=c.agent;
  if(a.isVisitor){const leave=a.departAt&&now>a.departAt;return {key:leave?'visitor-leaving':'visitor-meeting',point:leave?[7,8.1]:[5.75,2.05],angle:leave?0:0,mode:leave?'idle':'talk',label:leave?'Heading out':a.visitorStatus==='failed'?'Exchange interrupted':a.visitorStatus==='completed'?'Exchange complete':'Exchanging with '+a.hostAgent,sit:!leave};}
  const index=agents.findIndex(b=>b.id===a.id),seed=hash(a.id),running=a.run_id&&Date.parse(a.run_until)>now;
  const override=(!a.run_id||running)&&a.behavior&&a.behavior!=='auto'&&(!a.behavior_until||Date.parse(a.behavior_until)>now)?a.behavior:null;
  const assigned=!!a.current_task&&a.status!=='idle';
  if(running&&override!=='meeting')return {key:'work',point:[c.slot.x,c.slot.z+.86],angle:Math.PI,mode:'work',label:a.status==='working'?'Working · '+a.current_task:'Thinking through your message',sit:true};
  if(override==='meeting')return {key:'meeting',point:SEATS[index%6].slice(0,2),angle:SEATS[index%6][2],mode:['connecting','failed'].includes(a.externalMeetingStatus)?'review':'talk',label:a.externalHost?(a.externalMeetingStatus==='completed'?'Exchange complete · ':a.externalMeetingStatus==='failed'?'Connection stopped · ':a.externalMeetingStatus==='connecting'?'Connecting to ':'Exchanging with ')+a.externalHost:running?'Collaborating with the team':'In the meeting room',sit:true};
  if(!override&&now-Date.parse(a.last_reply_at||0)<30000)return {key:'wrapup',point:[c.slot.x,c.slot.z+.86],angle:Math.PI,mode:'wrapup',label:'Reviewing latest reply',sit:true};
  if(!override&&assigned)return {key:'assigned',point:[c.slot.x,c.slot.z+.86],angle:Math.PI,mode:'review',label:a.status==='blocked'?'Needs your input':'Assigned · '+a.current_task,sit:true};
  const cycle=Math.floor(now/24000),phase=(cycle+Math.floor(index/2))%5;
  const mode=override||(phase===0?'coffee':phase===1?'games':phase===2?'social':phase===3?'booths':'wander');
  if(mode==='coffee')return {key:'coffee',point:[-4.2+(index%3)*1.2,6.0],angle:0,mode:'coffee',label:'Taking a coffee break'};
  if(mode==='games')return index%2?{key:'pool',point:[7.45,index%4===3?-6.25:-3.1],angle:index%4===3?0:Math.PI,mode:'games',game:'pool',label:'Playing pool'}:{key:'arcade',point:[4.2+(index%4===2?1.15:0),-6.25],angle:Math.PI,mode:'games',game:'arcade',label:'Playing the arcade'};
  if(mode==='booths')return {key:'booth',point:[index%2?.65:-1.85,-6.8],angle:Math.PI,mode:'phone',label:'Quiet time · reading',sit:false};
  if(mode==='social'){
    const peer=agents.find(b=>b.id!==a.id&&!b.current_task&&!b.run_id);
    return {key:'social',point:[-.8+(index%2)*1.4,3.6+Math.floor(index/2)*.9],angle:index%2?-Math.PI/2:Math.PI/2,mode:'talk',label:peer?'Taking a breather':'Enjoying the lounge'};
  }
  const spots=[[-6.9,1.1],[-10.7,5.4],[1.2,4.4],[-6.8,-6.6]];return {key:'wander'+cycle,point:spots[(seed+cycle)%spots.length],angle:(seed%628)/100,mode:'idle',label:'Stretching their legs'};
}
export function updateBehavior(c,agents,now,dt){
  const goal=destination(c,agents,now);
  if(goal.key!==c.goal?.key||c.goal?.point[0]!==goal.point[0]||c.goal?.point[1]!==goal.point[1]){
    c.goal=goal;c.path=findPath([c.group.position.x,c.group.position.z],goal.point,c.slot.n);c.replanAt=now+8000;
  }else c.goal={...c.goal,...goal};
  if(!c.path.length&&Math.hypot(c.group.position.x-goal.point[0],c.group.position.z-goal.point[1])>.35&&now>c.replanAt){c.path=findPath([c.group.position.x,c.group.position.z],goal.point,c.slot.n);c.replanAt=now+8000;}
  if(c.path.length){
    const [x,z]=c.path[0],dx=x-c.group.position.x,dz=z-c.group.position.z,distance=Math.hypot(dx,dz),speed=1.65*dt;
    if(distance<speed){c.group.position.x=x;c.group.position.z=z;c.path.shift();}else{c.group.position.x+=dx/distance*speed;c.group.position.z+=dz/distance*speed;}
    if(distance>.025){const target=Math.atan2(dx,dz),diff=Math.atan2(Math.sin(target-c.group.rotation.y),Math.cos(target-c.group.rotation.y));c.group.rotation.y+=diff*Math.min(1,dt*9);}
    c.mode='walk';c.label='On the way · '+({work:'desk',wrapup:'desk',assigned:'desk',meeting:'meeting room',coffee:'coffee bar',arcade:'arcade',pool:'pool table',booth:'quiet zone',social:'lounge'}[goal.key]||'taking a stroll');c.sitting=false;
  }else{
    const arrived=Math.hypot(c.group.position.x-goal.point[0],c.group.position.z-goal.point[1])<.5;
    c.mode=arrived?goal.mode:'idle';c.label=arrived?goal.label:'Finding a clear path';c.sitting=arrived&&goal.sit;
    const diff=Math.atan2(Math.sin(goal.angle-c.group.rotation.y),Math.cos(goal.angle-c.group.rotation.y));c.group.rotation.y+=diff*Math.min(1,dt*6);
  }
}
export function coordinateSocial(characters){
  const social=characters.filter(c=>c.goal?.key==='social'&&c.mode!=='walk');
  for(const c of social){const peer=social.find(p=>p!==c&&p.group.position.distanceTo(c.group.position)<2.4);if(peer){c.group.rotation.y=Math.atan2(peer.group.position.x-c.group.position.x,peer.group.position.z-c.group.position.z);c.label='Chatting with '+peer.agent.name;}else c.label='Taking a breather';}
}
