// A small navigation grid keeps avatars in aisles and room doorways.
const STEP=.4,X0=-12,Z0=-8.2,NX=61,NZ=43;
const desks=[[-8.8,-4.9],[-4.9,-4.9],[-8.8,-.9],[-4.9,-.9],[-8.8,3.1],[-4.9,3.1],[-.9,-4.9],[-.9,-.9]];
const inside=(x,z,a,b,w,d,p=.22)=>Math.abs(x-a)<w/2+p&&Math.abs(z-b)<d/2+p;
export function blocked(x,z,ownDesk){
  if(x<-12-1e-6||x>12+1e-6||z<-8.2-1e-6||z>8.2+1e-6)return true;
  for(let i=0;i<desks.length;i++){const [dx,dz]=desks[i];if(inside(x,z,dx,dz,2.5,1.2))return true;if(i+1!==ownDesk&&inside(x,z,dx,dz+.86,.75,.7,.12))return true;}
  if(inside(x,z,-9.2,-8.2,3.4,.65)||inside(x,z,-5.4,-8.2,2.6,.65)||inside(x,z,-2.3,6.9,4.9,.95))return true;
  if(inside(x,z,7,3.5,3.8,1.8)||inside(x,z,7.45,-4.7,3.25,1.85)||inside(x,z,9.1,-7.15,3.3,1))return true;
  if(inside(x,z,4.2,-7.3,.85,.8)||inside(x,z,5.35,-7.3,.85,.8))return true;
  if(inside(x,z,2.9,3.5,.06,7.5,.15)||inside(x,z,11.1,3.5,.06,7.5,.15)||inside(x,z,2.9,-4.5,.1,7.2,.15))return true;
  if(inside(x,z,4.15,-.95,2.5,.13,.16)||inside(x,z,9.1,-.95,4,.13,.16))return true;
  if(inside(x,z,4.2,7.25,2.55,.04,.1)||inside(x,z,9.8,7.25,2.55,.04,.1))return true;
  for(const bx of [-1.85,.65]){for(const side of [-1.04,1.04])if(inside(x,z,bx+side,-7.2,.1,2.6,.11))return true;if(inside(x,z,bx,-7.85,1.6,.7,.1))return true;}
  return false;
}
const coords=id=>[X0+(id%NX)*STEP,Z0+Math.floor(id/NX)*STEP];
const cell=(x,z)=>Math.max(0,Math.min(NZ-1,Math.round((z-Z0)/STEP)))*NX+Math.max(0,Math.min(NX-1,Math.round((x-X0)/STEP)));
function clearSegment(from,to,ownDesk){
  const steps=Math.max(1,Math.ceil(Math.hypot(to[0]-from[0],to[1]-from[1])/.05));
  for(let n=0;n<=steps;n++){const t=n/steps;if(blocked(from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t,ownDesk))return false;}
  return true;
}
function reachableCell(point,ownDesk){
  const center=cell(...point),cx=center%NX,cz=Math.floor(center/NX);let best=null,distance=Infinity;
  for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
    const x=cx+dx,z=cz+dz;if(x<0||x>=NX||z<0||z>=NZ)continue;const id=z*NX+x,[wx,wz]=coords(id),d=Math.hypot(wx-point[0],wz-point[1]);if(d>=distance||blocked(wx,wz,ownDesk))continue;
    if(clearSegment(point,[wx,wz],ownDesk)){best=id;distance=d;}
  }
  return best;
}
export function findPath(start,end,ownDesk){
  const from=reachableCell(start,ownDesk),to=reachableCell(end,ownDesk);if(from===null||to===null)return [];
  const open=new Set([from]),closed=new Set(),came=new Map(),g=new Map([[from,0]]),f=new Map([[from,Math.hypot(...start.map((v,i)=>v-end[i]))]]);
  let reached=null;
  for(let count=0;open.size&&count<NX*NZ;count++){
    let current=null,best=Infinity;for(const id of open){if(f.get(id)<best){best=f.get(id);current=id;}}
    if(current===to){reached=current;break;}open.delete(current);closed.add(current);const [x,z]=coords(current),cx=current%NX,cz=Math.floor(current/NX);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
      if(cx+dx<0||cx+dx>=NX||cz+dz<0||cz+dz>=NZ)continue;const id=current+dx+dz*NX,[nx,nz]=coords(id);
      if(closed.has(id)||blocked(nx,nz,ownDesk)||(dx&&dz&&(blocked(x+dx*STEP,z,ownDesk)||blocked(x,z+dz*STEP,ownDesk)))||!clearSegment([x,z],[nx,nz],ownDesk))continue;
      const cost=g.get(current)+Math.hypot(dx,dz)*STEP;if(cost>=(g.get(id)??Infinity))continue;came.set(id,current);g.set(id,cost);f.set(id,cost+Math.hypot(nx-end[0],nz-end[1]));open.add(id);
    }
  }
  if(reached===null)return [];
  const path=[];let node=reached;while(node!==from){path.push(coords(node));node=came.get(node);if(node==null)return [];}
  path.reverse();path.unshift(coords(from));path.push(end);return path;
}
