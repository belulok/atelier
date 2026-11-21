import * as THREE from 'three';
import { box, cylinder, sphere, sign, material } from './primitives';
import { chair, plant } from './furniture';

function label(g,text,x,z,width=3) {
  const o=sign(g,width,.44,[x,.065,z],(c,w,h)=>{c.fillStyle='#415b50';c.font='bold 55px sans-serif';c.textAlign='center';c.fillText(text,w/2,157);});o.rotation.x=-Math.PI/2;
}
function glass(g,size,pos) {
  const o=box(g,size,pos,material('#b9d8cd',{transparent:true,opacity:.18,roughness:.12,depthWrite:false}),0);o.castShadow=false;
}
export function meetingRoom(scene,wood) {
  const g=new THREE.Group();g.position.set(7,0,3.5);g.userData.zone='meeting';scene.add(g);
  box(g,[8.2,.045,7.5],[0,.05,0],material('#a8b8ad',{roughness:.94}));
  // Glazed partition with an open doorway; low front panels preserve the cutaway.
  for(const x of [-4.1,4.1]){glass(g,[.035,2.6,7.5],[x,1.35,0]);for(const z of [-3.75,0,3.75])box(g,[.055,2.7,.055],[x,1.4,z],'#54685f');box(g,[.06,.06,7.5],[x,2.75,0],'#54685f');}
  for(const x of [-2.8,2.8]){glass(g,[2.55,1.05,.04],[x,.6,3.75]);box(g,[2.6,.05,.05],[x,1.15,3.75],'#54685f');}
  box(g,[3.8,.13,1.8],[0,1.08,0],wood,.12);
  for(const x of [-1.4,1.4])box(g,[.15,.98,1.2],[x,.54,0],'#394c43');
  for(const x of [-1.25,0,1.25]){chair(g,x,1.45);chair(g,x,-1.45,Math.PI);}
  plant(g,0,0,.4,1.16);
  for(const x of [-1.2,1.2]){box(g,[.5,.025,.4],[x,1.17,.35],'#edf0e5');cylinder(g,.085,.075,.16,[x,1.24,-.35],'#f5eee0');}
  box(g,[3.5,1.8,.13],[0,2.35,-3.65],'#303e3b');
  const monitor=sign(g,3.32,1.62,[0,2.35,-3.57],(c,w,h)=>{c.fillStyle='#e9f0e4';c.fillRect(0,0,w,h);c.fillStyle='#486657';c.font='bold 30px sans-serif';c.fillText('GOOD IDEAS START HERE.',26,62);for(let i=0;i<5;i++){c.fillStyle=['#749782','#a1bba4','#c6d4bd'][i%3];c.fillRect(28+i*92,200-i*22,60,25+i*22);}c.font='17px sans-serif';c.fillStyle='#738b77';c.fillText('THE MEETING ROOM',28,100);});
  monitor.userData.meetingScreen=true;g.userData.monitor=monitor;
  plant(g,3.25,-2.7,1.4);label(g,'MEETING ROOM',0,3.1,3.1);
  return g;
}
function arcade(g,x,z,color) {
  const a=new THREE.Group();a.position.set(x,0,z);g.add(a);
  box(a,[.85,1.65,.7],[0,.85,0],color,.06);box(a,[.9,.22,.85],[0,1.14,.22],'#293a3b');
  box(a,[.72,.59,.06],[0,1.61,.38],'#142d34');
  const screen=sign(a,.64,.5,[0,1.61,.419],(c,w,h)=>{c.fillStyle='#122d39';c.fillRect(0,0,w,h);c.fillStyle='#f3dc72';c.font='bold 42px monospace';c.textAlign='center';c.fillText('PLAY',w/2,58);for(let i=0;i<10;i++){c.fillStyle=i%2?'#53d5bd':'#f47e84';c.fillRect(40+(i%5)*87,100+Math.floor(i/5)*55,52,27);}});
  cylinder(a,.035,.035,.15,[-.2,1.34,.5],'#b4bdb6');sphere(a,.065,[-.2,1.44,.5],'#f8d564');
  for(const x of [.14,.28])cylinder(a,.04,.04,.03,[x,1.265,.52],'#d94957');
  sign(a,.7,.2,[0,1.98,.37],(c,w,h)=>{c.fillStyle='#eedca6';c.fillRect(0,0,w,h);c.fillStyle='#2d5147';c.font='bold 74px monospace';c.textAlign='center';c.fillText('ARCADE',w/2,154);});
  return {screen,ball:[256,128],velocity:[97,65],score:[0,0],lastDraw:0};
}
export function gameRoom(scene,wood) {
  const g=new THREE.Group();g.position.set(7,0,-4.5);g.userData.zone='games';scene.add(g);
  box(g,[8.2,.055,7.2],[0,.06,0],'#b9b9cc');
  box(g,[.09,1.0,7.2],[-4.1,.55,0],'#e4e0d5');box(g,[2.5,.8,.13],[-2.85,.45,3.55],'#deddd5');box(g,[4,.8,.13],[2.1,.45,3.55],'#deddd5');
  // A proper pool table with a rail, six pockets, balls and a cue.
  box(g,[3.25,.38,1.85],[.45,.99,-.2],wood,.09);box(g,[2.97,.04,1.58],[.45,1.2,-.2],'#337666',.04);
  for(const x of [-.9,1.8])for(const z of [-.9,.5])box(g,[.2,.84,.2],[x,.48,z],'#39453d');
  for(const x of [-1.02,.45,1.92])for(const z of [-.97,.57])cylinder(g,.075,.075,.02,[x,1.232,z],'#142e28');
  const balls=[];for(let i=0;i<7;i++){const mesh=sphere(g,.053,[i===0?-.65:.1+(i%3)*.2,1.28,-.3+Math.floor(i/3)*.18],['#f2eee0','#d9a820','#d85f4e','#4366a0'][i%4]);balls.push({mesh,v:[0,0]});}
  const cue=box(g,[2.8,.035,.035],[.55,1.27,.93],'#dfc08b',.009);cue.rotation.y=.12;
  const arcades=[arcade(g,-2.8,-2.8,'#9d655c'),arcade(g,-1.65,-2.8,'#647e97')];g.userData.games={balls,arcades,lastStrike:0};
  box(g,[3.1,.42,.85],[2.1,.46,-2.65],'#798681',.16);box(g,[3.1,.65,.2],[2.1,.9,-2.98],'#798681',.1);
  for(const x of [.55,3.65])box(g,[.2,.6,.9],[x,.73,-2.65],'#657770',.1);
  for(const x of [1.05,2.1,3.1])box(g,[.88,.15,.65],[x,.75,-2.53],'#9daa9e',.1);
  plant(g,3.25,2.55,1.2);label(g,'THE GAME ROOM',0,2.85,3.3);
  return g;
}
export function phoneBooths(scene,wood) {
  const g=new THREE.Group();g.position.set(-.6,0,-7.2);g.userData.zone='booths';scene.add(g);
  for(const x of [-1.25,1.25]){
    box(g,[2.15,.08,2.6],[x,.06,0],'#60796d');box(g,[2.15,2.6,.12],[x,1.4,-1.3],'#6e8978');
    for(const dx of [-1.04,1.04])box(g,[.1,2.6,2.6],[x+dx,1.4,0],'#c4b596');
    glass(g,[1.87,2.4,.025],[x,1.35,1.25]);box(g,[2.15,.1,2.6],[x,2.74,0],'#e6dfcd');
    box(g,[.055,.48,.06],[x+.78,1.2,1.31],'#3c5148');
    box(g,[1.6,.08,.6],[x,1.1,-.65],wood);cylinder(g,.34,.34,.1,[x,.63,.25],'#57675c');cylinder(g,.04,.08,.6,[x,.3,.25],'#35483d');
    box(g,[.12,.025,1.8],[x,2.675,0],material('#fff2c9',{emissive:'#ffe4a2',emissiveIntensity:.4}));
    for(let i=0;i<7;i++)box(g,[.035,2.35,.025],[x-.78+i*.26,1.4,-1.217],'#567461');
    box(g,[.48,.04,.35],[x,1.17,-.6],'#e4e7dd');
  }
  label(g,'QUIET ZONE',0,1.7,2.9);return g;
}
