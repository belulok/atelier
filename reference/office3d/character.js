import * as THREE from 'three';
import { cylinder,sphere,box,material } from './primitives';
export default function character(parent,agent,slot,color){
  const group=new THREE.Group();group.position.set(slot.x,0,slot.z+.86);group.rotation.y=Math.PI;group.userData.agentId=agent.id;parent.add(group);
  const skin=material(color,{roughness:.34,metalness:.025}),dark=material('#183040');
  const body=new THREE.Group();group.add(body);const torso=sphere(body,.32,[0,1.0,0],skin,[.86,1.02,.72]);
  const head=new THREE.Group();head.position.set(0,1.56,0);body.add(head);sphere(head,.41,[0,0,0],skin,[1,1.04,.95]);
  for(const x of [-.145,.145]){sphere(head,.13,[x,.015,.35],'#fffdf2',[.83,1,.43]);sphere(head,.064,[x+.012,.009,.397],dark,[.82,1,.35]);sphere(head,.018,[x,.034,.419],'#fff');}
  const smile=new THREE.Mesh(new THREE.TorusGeometry(.072,.011,6,20,Math.PI),dark);smile.position.set(0,-.15,.374);smile.rotation.z=Math.PI;head.add(smile);
  const arms=[],legs=[];
  for(const side of [-1,1]){
    const arm=new THREE.Group();arm.position.set(side*.29,1.17,0);body.add(arm);cylinder(arm,.075,.09,.3,[0,-.15,0],skin);
    const forearm=new THREE.Group();forearm.position.y=-.3;arm.add(forearm);cylinder(forearm,.066,.075,.28,[0,-.14,0],skin);sphere(forearm,.09,[0,-.29,0],skin);arms.push({arm,forearm});
    const leg=new THREE.Group();leg.position.set(side*.14,.73,0);group.add(leg);cylinder(leg,.09,.1,.34,[0,-.17,0],skin);
    const shin=new THREE.Group();shin.position.y=-.34;leg.add(shin);cylinder(shin,.075,.085,.33,[0,-.165,0],skin);sphere(shin,.13,[0,-.34,.06],skin,[.8,.6,1.4]);legs.push({leg,shin});
  }
  const cup=new THREE.Group();arms[0].forearm.add(cup);cup.position.set(0,-.29,.04);cylinder(cup,.095,.08,.19,[0,0,0],'#eee5ce');cylinder(cup,.077,.077,.01,[0,.098,0],'#654733');cup.visible=false;
  const phone=new THREE.Group();arms[1].forearm.add(phone);phone.position.set(0,-.29,.04);box(phone,[.15,.24,.025],[0,0,0],'#23383f');box(phone,[.13,.2,.01],[0,0,.018],'#9acfc8');phone.visible=false;
  const cue=new THREE.Group();arms[1].forearm.add(cue);cue.position.set(0,-.29,.1);const stick=cylinder(cue,.012,.024,1.9,[0,0,0],'#d8b781');stick.rotation.x=Math.PI/2;cue.visible=false;
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.52,.024,8,48),new THREE.MeshBasicMaterial({color}));ring.rotation.x=-Math.PI/2;ring.position.y=.055;group.add(ring);
  return {group,body,head,torso,arms,legs,ring,cup,phone,cue,agent,slot,path:[],mode:'review',label:'Settling in',goal:null,replanAt:0,poseBlend:0};
}
