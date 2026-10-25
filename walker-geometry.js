/* Walker T/P/F geometry in the same x=north/east projection convention as SBI.
 * All vectors returned here are Earth-fixed scene units (Earth radius = 1).
 */
export const EARTH_KM=6371;
export const MU=398600.4418;
export const EARTH_RATE=7.2921159e-5;
export const DEFAULT_INCLINATION_DEG=55;

export function walkerPosition(planes,perPlane,phase,altitudeKm,planeIndex,satelliteIndex,timeSeconds,inclinationDeg=DEFAULT_INCLINATION_DEG){
  const node=2*Math.PI*planeIndex/planes;
  const u=2*Math.PI*(satelliteIndex/perPlane+phase*planeIndex/(planes*perPlane))+
    Math.sqrt(MU/Math.pow(EARTH_KM+altitudeKm,3))*timeSeconds;
  return orbitalPoint(node,u,altitudeKm,timeSeconds,inclinationDeg);
}

export function orbitalPoint(node,u,altitudeKm,timeSeconds,inclinationDeg=DEFAULT_INCLINATION_DEG){
  const inclination=inclinationDeg*Math.PI/180;
  const cn=Math.cos(node),sn=Math.sin(node),cu=Math.cos(u),su=Math.sin(u),ci=Math.cos(inclination),si=Math.sin(inclination),r=1+altitudeKm/EARTH_KM;
  const x=r*(cn*cu-sn*su*ci),y=r*su*si,z=-r*(sn*cu+cn*su*ci);
  const theta=EARTH_RATE*timeSeconds,c=Math.cos(theta),s=Math.sin(theta);
  // Equivalent to SBI's applyAxisAngle(y-axis, -Earth rotation angle).
  return [x*c-z*s,y,x*s+z*c];
}
