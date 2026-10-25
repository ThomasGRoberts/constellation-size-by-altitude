/* Count instantaneous 10°-elevation visibility off the UI/rendering thread. */
import {EARTH_KM,walkerPosition} from './walker-geometry.js';

let sites=null,latitudes=null;
function firstLatitudeAtOrBelow(value){
  let lo=0,hi=latitudes.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(latitudes[mid]>value)lo=mid+1;else hi=mid;}
  return lo;
}

self.onmessage=event=>{
  const message=event.data;
  if(message.type==='init'){
    sites=new Float32Array(message.sites);
    latitudes=new Float32Array(message.latitudes);
    return;
  }
  if(message.type!=='count'||!sites)return;
  const {id,alt,inc,design,time}=message;
  const e=10*Math.PI/180;
  const psi=Math.acos(EARTH_KM*Math.cos(e)/(EARTH_KM+alt))-e;
  const threshold=Math.cos(psi),rad=1+alt/EARTH_KM;
  const counts=new Uint16Array(latitudes.length);
  for(let p=0;p<design.planes;p++)for(let k=0;k<design.perPlane;k++){
    const position=walkerPosition(design.planes,design.perPlane,design.phase,alt,p,k,time,inc);
    const x=position[0]/rad,y=position[1]/rad,z=position[2]/rad;
    const lat=Math.asin(Math.max(-1,Math.min(1,y)));
    const first=firstLatitudeAtOrBelow(lat+psi+1e-8);
    const last=firstLatitudeAtOrBelow(lat-psi-1e-8);
    for(let j=first;j<last;j++){
      const v=3*j;
      if(x*sites[v]+y*sites[v+1]+z*sites[v+2]>=threshold)counts[j]++;
    }
  }
  self.postMessage({id,counts:counts.buffer},[counts.buffer]);
};
