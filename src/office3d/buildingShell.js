import * as THREE from 'three';
import { box, cylinder, sign, material } from './primitives';

export const FLOOR_HEIGHT = 7.2;

export function elevator(parent, floor, onOverview = false) {
  const g = new THREE.Group(); g.position.set(14.4, 0, -5.5); g.userData.elevator = true; parent.add(g);
  box(g, [3.5, .4, 5.5], [0, -.12, 0], '#687b77', .08);
  box(g, [3.5, 3.65, .2], [0, 1.8, -2.65], '#59736d');
  box(g, [.18, 3.65, 5.3], [-1.65, 1.8, 0], '#d2dcd7');
  box(g, [.18, 1.05, 5.3], [1.65, .5, 0], '#d2dcd7');
  box(g, [3.5, .16, 1.5], [0, 3.7, -1.9], '#e4eae4');
  for (const x of [-.7, .7]) box(g, [1.36, 2.75, .1], [x, 1.4, -.8], '#a5b9b3');
  box(g, [.025, 2.8, .15], [0, 1.4, -.7], '#526d65', 0);
  box(g, [1.1, .42, .1], [0, 3.05, -.78], '#263e38');
  sign(g, .95, .32, [0, 3.05, -.71], (c,w,h) => { c.fillStyle='#c4f5ce';c.font='bold 120px monospace';c.textAlign='center';c.fillText(floor.code,w/2,175); });
  box(g, [.22, .5, .1], [1.48, 1.45, -.7], '#29473e');
  cylinder(g, .045, .045, .04, [1.48, 1.55, -.62], '#b6e5b5');
  const label = sign(g, 2, .4, [0, .12, 1.8], (c,w,h) => {c.fillStyle='#4a655b';c.font='bold 65px sans-serif';c.textAlign='center';c.fillText(onOverview?'LIFT':'TAKE THE LIFT',w/2,160);});label.rotation.x=-Math.PI/2;
  return g;
}

export default function buildingShell(scene, floors) {
  const group = new THREE.Group(); scene.add(group);
  const decks = [];
  floors.forEach(floor => {
    const g = new THREE.Group();g.position.y=floor.id*FLOOR_HEIGHT;g.userData.floorId=floor.id;group.add(g);
    box(g,[25.4,.65,18],[0,-.35,0],'#b9c7c1',.06);
    box(g,[25,.09,17.6],[0,.02,0],floor.tint,.02);
    box(g,[25,.16,.16],[0,.17,8.8],floor.color,.02);
    box(g,[25,3.5,.18],[0,1.75,-8.8],'#e7ece7',.02);
    box(g,[.18,3.5,17.6],[-12.5,1.75,0],'#d8e4df',.02);
    const glass=material('#a8c5cf',{transparent:true,opacity:.48,roughness:.2});
    for(let z=-6;z<7;z+=4.3)box(g,[.03,2.2,3.6],[-12.39,1.95,z],glass,0);
    for(const x of [-9,-5,-1,5,9]) {
      const z=x>0?2:-2;
      box(g,[2.5,.14,1.25],[x,1.2,z],'#d7b988',.03);
      for(const dx of [-.9,.9])box(g,[.1,1.1,.8],[x+dx,.6,z],'#71817c',0);
      box(g,[1,.65,.08],[x,1.65,z-.3],'#47635c',.02);
      box(g,[.65,.6,.65],[x,.5,z+1.1],floor.color,.08);
      if((x+floor.id)%3!==0){cylinder(g,.2,.23,.6,[x,.98,z+1.1],floor.color);const head=new THREE.Mesh(new THREE.SphereGeometry(.3,12,8),material(floor.id%2?'#d49e77':'#88aba1'));head.position.set(x,1.52,z+1.1);g.add(head);}
    }
    for(const x of [-10,10]){box(g,[.7,.6,.7],[x,.3,6],'#be9a78',.02);const plant=new THREE.Mesh(new THREE.IcosahedronGeometry(.8,1),material('#6b9675'));plant.scale.y=1.5;plant.position.set(x,1.4,6);g.add(plant);}
    sign(g,8,.6,[0,.02,8.93],(c,w,h)=>{c.fillStyle='#3c514b';c.font='bold 49px sans-serif';c.textAlign='center';c.fillText(`${floor.code}  /  ${floor.name.toUpperCase()}`,w/2,152);});
    elevator(g,floor,true);
    const edges=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(25.6,.73,18.2)),new THREE.LineBasicMaterial({color:floor.color}));edges.position.y=-.34;g.add(edges);
    decks.push({group:g,edges,floor});
  });
  box(group,[30,.8,21],[1,-1.1,0],'#a6b6ae',.15);
  return { group, decks };
}
