import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const COLORS = { software: '#3279e8', research: '#24ad68', content: '#f3b91f', support: '#ec503d' };
export const DESKS3D = [
  { n: 1, x: -8.8, z: -4.9 }, { n: 2, x: -4.9, z: -4.9 },
  { n: 3, x: -8.8, z: -.9 }, { n: 4, x: -4.9, z: -.9 },
  { n: 5, x: -8.8, z: 3.1 }, { n: 6, x: -4.9, z: 3.1 },
  { n: 7, x: -.9, z: -4.9 }, { n: 8, x: -.9, z: -.9 },
];
export function material(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: .66, ...extra }); }
export function mesh(parent, geometry, mat, position = [0,0,0]) {
  const o = new THREE.Mesh(geometry, typeof mat === 'string' ? material(mat) : mat);
  o.position.set(...position); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}
export function box(parent, size, pos, mat, radius = .025) {
  return mesh(parent, radius ? new RoundedBoxGeometry(...size, 2, Math.min(radius, Math.min(...size)/3)) : new THREE.BoxGeometry(...size), mat, pos);
}
export function sphere(parent, radius, pos, mat, scale = [1,1,1]) {
  const o = mesh(parent, new THREE.SphereGeometry(radius, 24, 18), mat, pos); o.scale.set(...scale); return o;
}
export function cylinder(parent, top, bottom, height, pos, mat) {
  return mesh(parent, new THREE.CylinderGeometry(top,bottom,height,24),mat,pos);
}
export function labelTexture(draw, width=512, height=256) {
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  draw(canvas.getContext('2d'),width,height);
  const t=new THREE.CanvasTexture(canvas); t.colorSpace=THREE.SRGBColorSpace; return t;
}
export function sign(parent,w,h,pos,draw) {
  const t=labelTexture(draw); const m=new THREE.MeshBasicMaterial({map:t, toneMapped:false,transparent:true});
  const o=mesh(parent,new THREE.PlaneGeometry(w,h),m,pos);o.castShadow=false;return o;
}
export function shadow(parent,x,z,w,d,opacity=.22) {
  const t=labelTexture((c,W,H)=>{const g=c.createRadialGradient(W/2,H/2,0,W/2,H/2,W/2);g.addColorStop(0,`rgba(28,27,25,${opacity})`);g.addColorStop(1,'rgba(28,27,25,0)');c.fillStyle=g;c.fillRect(0,0,W,H);},128,128);
  const o=mesh(parent,new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false}),[x,.016,z]);o.rotation.x=-Math.PI/2;o.castShadow=false;
}
export function disposeTree(root, preserve = null) {
  const geometries=new Set(), materials=new Set(), textures=new Set();
  root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(!m || m===preserve)continue;materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
}