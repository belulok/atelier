const previous=new WeakMap();
export function updateMeetingScreen(zones,session){
  const screen=zones.find(z=>z.userData.monitor)?.userData.monitor;if(!screen)return;
  const signature=JSON.stringify([session?.id,session?.status,session?.events]);if(signature===previous.get(screen))return;previous.set(screen,signature);
  const texture=screen.material.map,canvas=texture.image,c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  c.fillStyle='#172d2b';c.fillRect(0,0,w,h);c.fillStyle='#7acbaa';c.font='bold 22px monospace';c.fillText(session?(session.status==='completed'?'LATEST COMPLETED WORK':(session.isStudio?'STUDIO · ':'AGENT SESSION · ')+session.status.toUpperCase()):'MEETING ROOM · STANDBY',23,35);
  c.fillStyle='#e2ead8';c.font='bold 25px sans-serif';c.fillText(session?session.agent_name+(session.visitor_name?' ↔ '+session.visitor_name:''):'Your window into the work',23,76);
  c.fillStyle='#91ada0';c.font='16px monospace';c.fillText(session?.host||'Outside agents appear here when connected',23,105);
  for(const [i,event] of (session?.events||[{label:'Ask your agent to contact a service.',status:'done'},{label:'Actual requests and replies appear here.',status:'done'}]).slice(-3).entries()){c.fillStyle=event.status==='error'?'#eba38c':'#b9d9bf';c.font='16px monospace';c.fillText('> '+(event.label+': '+(event.detail||'')).replace(/\s+/g,' ').slice(0,47),23,148+i*28);}
  c.fillStyle='#6e9185';c.font='12px sans-serif';c.fillText('CLICK SCREEN TO VIEW THE EXCHANGE',23,h-13);texture.needsUpdate=true;
}
