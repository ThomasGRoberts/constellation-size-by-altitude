const OBJECTIVES=[
  ['fewest_satellites','satelliteMinimum'],
  ['fewest_planes','planeTradeoff'],
];

export function buildModelCsv(data){
  const lines=['service_latitude_limit_deg,minimum_elevation_deg,altitude_km,required_coverage_fold,objective,solution_found,inclination_deg,satellites,orbital_planes,satellites_per_plane,interplane_phase,minimum_sampled_visible'];
  const elevation=data.elevationDeg,serviceLatitude=data.serviceLatitudeDeg;
  for(const altitude of data.altitudesKm)for(const fold of data.folds){
    const result=data.results[String(altitude)][String(fold)];
    for(const [label,key] of OBJECTIVES){
      const design=result?.[key];
      lines.push([serviceLatitude,elevation,altitude,fold,label,design?1:0,design?.inclinationDeg??'',design?.satellites??'',design?.planes??'',design?.perPlane??'',design?.phase??'',design?.minimum??''].join(','));
    }
  }
  return lines.join('\r\n')+'\r\n';
}
