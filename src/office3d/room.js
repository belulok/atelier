import * as THREE from 'three';
import { box, cylinder, sign, labelTexture, material } from './primitives';
import { plant, bookcase } from './furniture';
import { meetingRoom, gameRoom, phoneBooths } from './rooms';
import { elevator } from './buildingShell';
function surfaceTexture(kind) {
  const t=labelTexture((c,w,h)=>{c.fillStyle=kind==='wood'?'#c39a66':'#bfc4be';c.fillRect(0,0,w,h);let seed=41;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
    for(let i=0;i<(kind==='wood'?350:24000);i++){const x=random()*w,y=random()*h;c.fillStyle=`rgba(${kind==='wood'?'74,43,19':'54,60,57'},${random()*.12})`;c.fillRect(x,y,kind==='wood'?60+random()*280:1+random()*3,kind==='wood'?.5:1+random()*3);}
  },512,512);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(kind==='wood'?2:7,kind==='wood'?1:5);return t;
}
export default function room(scene, floor = { id: 1, code: '01', name: 'Guest Experience', color: '#558c78', tint: '#dce9e1', type: 'office' }) {
  const wood=material('#e4c89d',{map:surfaceTexture('wood'),roughness:.55});
  const concrete=material('#e1e2d9',{map:surfaceTexture('concrete'),roughness:.94});
  box(scene,[25,.64,17.6],[0,-.34,0],'#a9b5ad',.09);box(scene,[24.8,.055,17.4],[0,.006,0],concrete,.015);
  box(scene,[25,.12,.12],[0,-.1,8.81],floor.color,.015);
  for(let x=-10;x<=10;x+=2.5)box(scene,[.013,.003,17.3],[x,.037,0],'#b7beb3',0);
  for(let z=-7.5;z<=7.5;z+=2.5)box(scene,[24.7,.003,.013],[0,.037,z],'#b7beb3',0);
  const wall=material('#e7e4d9');box(scene,[25,4.2,.16],[0,2.1,-8.8],wall,.04);box(scene,[.16,4.2,17.6],[-12.5,2.1,0],wall,.04);
  box(scene,[24.8,.16,.075],[0,.15,-8.69],'#b6bfb0');box(scene,[.075,.16,17.4],[-12.39,.15,0],'#b6bfb0');
  for(const z of [-6,-1.3,3.4]){
    box(scene,[.04,2.8,4.1],[-12.39,2.45,z],material('#c2d8dc',{emissive:'#adc7ce',emissiveIntensity:.16,roughness:.22}));
    for(const zz of [-2.1,0,2.1])box(scene,[.12,2.95,.075],[-12.27,2.45,z+zz],'#3b4945');
    for(const y of [.94,2.35,3.94])box(scene,[.12,.085,4.27],[-12.27,y,z],'#3b4945');box(scene,[.3,.1,4.35],[-12.23,.9,z],'#f0ede1');
  }
  bookcase(scene,-9.2,-8.2,3.2);bookcase(scene,-5.4,-8.2,2.4);
  plant(scene,-11.5,-7.7,1.65);plant(scene,-11.6,1.7,1.3);plant(scene,11.5,7.7,1.6);
  box(scene,[3.2,1.8,.08],[8.3,2.85,-8.67],'#adab96');box(scene,[3.05,1.65,.025],[8.3,2.85,-8.615],'#f1efdf');
  for(let i=0;i<12;i++){const note=box(scene,[.36,.4,.015],[7.1+(i%6)*.47,3.25-Math.floor(i/6)*.61,-8.59],['#e6cf6c','#8dbca4','#dda07e'][i%3],.005);note.rotation.z=((i%3)-1)*.07;}
  sign(scene,5.3,.6,[-6.2,3.55,-8.695],(c,w,h)=>{c.fillStyle=floor.color;c.font='bold 48px sans-serif';c.textAlign='center';c.fillText(floor.name.toUpperCase(),w/2,155);});
  // Coffee bar and stools are part of the shared circulation area.
  box(scene,[4.7,1,.7],[-2.3,.55,6.9],wood);box(scene,[4.9,.1,.95],[-2.3,1.12,6.9],wood);
  for(const x of [-3.8,-2.3,-.8]){box(scene,[1.35,.7,.025],[x,.57,7.265],'#8f795c');box(scene,[.17,.04,.04],[x,.81,7.3],'#33483b');}
  box(scene,[.85,.6,.52],[-2.8,1.48,6.85],'#333f3d',.07);box(scene,[.65,.2,.02],[-2.8,1.47,7.13],'#152321');cylinder(scene,.08,.075,.16,[-2.8,1.27,7.24],'#f4e9d5');
  plant(scene,-.45,6.85,.55,1.2);box(scene,[.3,.45,.3],[-4.3,1.4,6.9],'#e0ccb0');
  for(const x of [-3.7,-1.4]){cylinder(scene,.36,.36,.1,[x,.73,5.6],'#657e70');cylinder(scene,.045,.08,.65,[x,.35,5.6],'#344a3b');}
  const zones=[meetingRoom(scene,wood),gameRoom(scene,wood),phoneBooths(scene,wood)];
  // Floor accents make every stop recognisable without hiding the shared amenities.
  box(scene,[8,.025,7.1],[7,.095,-4.5],floor.tint,.03);
  if(floor.type==='lobby'){
    box(scene,[5.8,.045,4.1],[-7,.08,1.1],floor.tint,.08);
    for(const x of [-8.8,-4.9]){
      box(scene,[2.7,.45,.9],[x,.4,.1],floor.color,.13);
      box(scene,[2.7,.8,.18],[x,.8,-.34],floor.color,.07);
      box(scene,[2.4,.14,.7],[x,.68,.1],'#cddbd0',.07);
    }
    box(scene,[2.9,.12,1.2],[-6.9,.65,2.15],wood,.09);
    for(const x of [-7.9,-5.9])box(scene,[.12,.6,.7],[x,.3,2.15],'#5b6c64');
    plant(scene,-7,2.1,.4,.72);
    box(scene,[5.9,1.15,1.3],[-7.3,.58,-4.9],wood,.1);
    box(scene,[6.1,.15,1.45],[-7.3,1.2,-4.9],'#eee9de',.07);
    sign(scene,4,.65,[-7.3,.75,-4.23],(c,w,h)=>{c.fillStyle='#435c52';c.font='bold 64px sans-serif';c.textAlign='center';c.fillText('HELLO, HUMAN.',w/2,160);});
    plant(scene,-9.6,-4.9,.6,1.28);
    const welcome=sign(scene,5,1,[0,.065,4.8],(c,w,h)=>{c.fillStyle='#799084';c.font='bold 64px sans-serif';c.textAlign='center';c.fillText('MAKE YOURSELF AT HOME',w/2,150);});welcome.rotation.x=-Math.PI/2;
  }
  elevator(scene,floor);
  box(scene,[4,.1,2.2],[13.5,-.02,1],'#d0d9d2',.03);
  box(scene,[9,.65,.16],[7,.32,8.8],'#e1e2d7');
  sign(scene,4,.42,[7,.34,8.895],(c,w,h)=>{c.fillStyle='#e1e2d7';c.fillRect(0,0,w,h);c.fillStyle=floor.color;c.font='bold 52px sans-serif';c.textAlign='center';c.fillText(`LEVEL ${floor.code}   /   ISOMUX`,w/2,158);});
  return {wood,zones};
}
