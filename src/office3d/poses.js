import { MathUtils } from 'three';
export function animateCharacter(c,t,dt,motion){
  const walk=c.mode==='walk',working=c.mode==='work'||c.mode==='wrapup',talk=c.mode==='talk',playing=c.mode==='games',coffee=c.mode==='coffee',phone=c.mode==='phone';
  const sit=c.sitting?1:0;c.poseBlend=MathUtils.lerp(c.poseBlend,sit,Math.min(1,dt*8));const s=c.poseBlend;
  c.body.position.y=walk&&motion?Math.abs(Math.sin(t*8))*.035:0;c.body.rotation.x=s*.05;
  c.head.rotation.y=motion?Math.sin(t*.9)*(working?.025:.09):0;c.head.rotation.x=working?.1:phone?.2:0;c.head.rotation.z=talk&&motion?Math.sin(t*3)*.045:0;
  c.torso.scale.y=1.02+(motion?Math.sin(t*2)*.012:0);
  c.legs.forEach(({leg,shin},i)=>{const swing=walk&&motion?Math.sin(t*8+i*Math.PI)*.55:0;leg.rotation.x=-1.2*s+swing*(1-s);shin.rotation.x=1.2*s+Math.max(0,-swing)*.5;});
  c.arms.forEach(({arm,forearm},i)=>{
    const typing=(working||(playing&&c.goal.game==='arcade'))&&motion;
    let angle=walk&&motion?-Math.sin(t*8+i*Math.PI)*.45:-.12,bend=-.15;
    if(s>.3){angle=-1.65*s;bend=.45*s;}
    if(typing){angle=-1.95+Math.sin(t*9+i*2)*.07;bend=.7+Math.sin(t*11+i)*.1;}
    if(talk&&motion&&i===1){angle=-.9+Math.sin(t*2.2)*.3;bend=-.5;}
    if(coffee&&i===0){angle=-1.8+(motion?Math.sin(t*.9)*.35:0);bend=-.65;}
    if(phone&&i===1){angle=-1.4;bend=-.6;}
    if(playing&&c.goal.game==='pool'&&i===1){angle=-1.6+(motion?Math.sin(t*2)*.17:0);bend=.1;}
    arm.rotation.x=MathUtils.lerp(arm.rotation.x,angle,Math.min(1,dt*12));arm.rotation.z=(i?1:-1)*.12;forearm.rotation.x=MathUtils.lerp(forearm.rotation.x,bend,Math.min(1,dt*12));
  });
  c.cup.visible=coffee;c.phone.visible=phone;c.cue.visible=playing&&c.goal.game==='pool';
}
