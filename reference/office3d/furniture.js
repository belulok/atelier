import * as THREE from 'three';
import { box, cylinder, sphere, material, sign, shadow } from './primitives';

export function plant(parent,x,z,size=1,y=0) {
  const g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(size);parent.add(g);
  cylinder(g,.24,.17,.4,[0,.2,0],'#b27552');cylinder(g,.21,.21,.025,[0,.405,0],'#342b23');
  for(let i=0;i<9;i++){const a=i*2.4;const h=.62+(i%3)*.2;const leaf=sphere(g,.23,[Math.cos(a)*.21,h,Math.sin(a)*.21],i%2?'#437d42':'#2e6438',[.42,1.7,.65]);leaf.rotation.z=Math.cos(a)*.55;leaf.rotation.x=Math.sin(a)*.55;cylinder(g,.014,.018,h-.35,[0,(h+.35)/2,0],'#52663a');}
}
export function chair(parent,x,z,angle=0) {
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=angle;parent.add(g);
  const upholstery=material('#59645c');
  box(g,[.72,.16,.66],[0,.58,0],upholstery,.09);box(g,[.72,.72,.13],[0,.96,.31],upholstery,.09);
  cylinder(g,.055,.055,.4,[0,.3,0],'#353d3b');
  for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const foot=box(g,[.43,.045,.06],[Math.cos(a)*.18,.1,Math.sin(a)*.18],'#3c4541');foot.rotation.y=-a;sphere(g,.065,[Math.cos(a)*.37,.065,Math.sin(a)*.37],'#303431');}
  for(const s of [-1,1]){box(g,[.05,.3,.05],[s*.39,.71,.06],'#333d36');box(g,[.08,.07,.38],[s*.39,.88,.02],'#333d36');}
  return g;
}
export function desk(parent,slot,wood,color,occupied) {
  const g=new THREE.Group();g.position.set(slot.x,0,slot.z);g.userData.desk=slot.n;parent.add(g);
  shadow(g,0,.15,3.3,2.8,.24);
  if(occupied)box(g,[2.8,.025,2.4],[0,.025,.4],material(color,{roughness:1}),.05);
  box(g,[2.5,.13,1.2],[0,1.12,0],wood,.065);
  for(const x of [-1.05,1.05])for(const z of [-.44,.44])box(g,[.07,1.06,.07],[x,.55,z],'#333b37');
  box(g,[.55,.6,.78],[.83,.75,.03],'#c7b296',.04);
  for(const y of [.6,.82])box(g,[.25,.025,.035],[.83,y,.436],'#62594d');
  box(g,[.43,.04,.29],[0,1.21,-.2],'#252d32');box(g,[.055,.29,.055],[0,1.34,-.27],'#313c40');
  box(g,[1.15,.69,.065],[0,1.73,-.29],'#293339');
  g.userData.screen=sign(g,1.05,.59,[0,1.73,-.253],(c,w,h)=>{c.fillStyle=occupied?'#15232b':'#29363e';c.fillRect(0,0,w,h);c.fillStyle='#364851';c.fillRect(0,0,w,27);for(let i=0;i<3;i++){c.fillStyle=['#f46b64','#edc564','#76caa4'][i];c.beginPath();c.arc(17+i*18,13,4,0,7);c.fill();}if(occupied){for(let i=0;i<10;i++){c.fillStyle=['#8cc0cd','#e2bc8d','#74bd98'][i%3];c.fillRect(35+(i%3)*22,47+i*17,80+((i*71)%230),5);}}else{c.fillStyle='#748c96';c.font='22px sans-serif';c.fillText('Ready for your next agent',65,140);}});
  box(g,[.7,.035,.26],[0,1.21,.27],'#dde0db',.018);
  const keys=sign(g,.66,.23,[0,1.235,.27],(c,w,h)=>{c.fillStyle='#dce1d9';c.fillRect(0,0,w,h);c.fillStyle='#8d9991';for(let r=0;r<3;r++)for(let k=0;k<10;k++)c.fillRect(12+k*49,16+r*76,37,51);});keys.rotation.x=-Math.PI/2;
  sphere(g,.105,[.59,1.23,.27],'#e2e5dd',[.65,.35,1]);
  cylinder(g,.09,.08,.17,[-.82,1.27,.25],'#efe8db');cylinder(g,.074,.074,.008,[-.82,1.359,.25],'#53382b');
  const handle=meshHandle();handle.position.set(-.94,1.28,.25);g.add(handle);
  box(g,[.32,.045,.42],[-.86,1.22,-.28],'#739084');
  chair(g,0,.86);
  return g;
}
function meshHandle(){const o=new THREE.Mesh(new THREE.TorusGeometry(.065,.018,8,18),material('#efe8db'));return o;}
export function bookcase(parent,x,z,width=2) {
  const g=new THREE.Group();g.position.set(x,0,z);parent.add(g);
  const oak=material('#9c7d59');box(g,[width,1.8,.08],[0,.94,-.19],oak);
  box(g,[width-.12,1.62,.055],[0,.95,-.13],'#514b3e');
  for(const y of [.17,.7,1.22,1.8])box(g,[width,.08,.55],[0,y,.08],oak);
  for(const x of [-width/2,width/2])box(g,[.09,1.8,.55],[x,.94,.08],oak);
  for(let r=0;r<3;r++)for(let i=0;i<12;i++){const h=.28+(i%3)*.055;const o=box(g,[.09,h,.27],[-width/2+.19+i*(width-.3)/12,.22+r*.52+h/2,.12],['#d5c5a3','#62756a','#a6674b','#6c8190','#a3a29a'][i%5],.005);o.rotation.z=i%5===0?.09:0;}
  plant(g,-.5,0,.47,1.85);
}
export function meetingArea(parent,wood) {
  const g=new THREE.Group();g.position.set(3.65,0,1.2);parent.add(g);
  cylinder(g,1.73,1.73,.025,[0,.025,0],'#8b9990');shadow(g,0,0,4.8,4.8,.23);
  cylinder(g,1.2,1.2,.12,[0,1.0,0],wood);cylinder(g,.12,.18,.92,[0,.49,0],'#404b43');cylinder(g,.6,.6,.05,[0,.05,0],'#404b43');
  for(let i=0;i<4;i++){const a=i*Math.PI/2;chair(g,Math.sin(a)*1.58,Math.cos(a)*1.58,-a);}
  plant(g,.1,0,.4,1.08);box(g,[.48,.025,.35],[.55,1.08,.35],'#e6e5dc');cylinder(g,.08,.07,.15,[-.57,1.14,.12],'#f1eee6');
}
