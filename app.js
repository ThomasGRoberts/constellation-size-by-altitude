import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {feature} from 'topojson-client';
import {createSbiCoverageMap} from './sbi-map.js?v=20261025-service-2';
import {EARTH_RATE,walkerPosition,orbitalPoint} from './walker-geometry.js';
import {paintChart,chartFolds} from './chart.js';
import {buildModelCsv} from './data-export.js?v=20261025-service';

const $=id=>document.getElementById(id);
const state={altitudeIndex:4,fold:83,serviceLatitude:40,elevation:10,objective:'satelliteMinimum',view:'3d',playing:!matchMedia('(prefers-reduced-motion: reduce)').matches,speed:1,horizon:false};
const MAP_REFRESH_MS=40;
let data=null,design=null,elapsed=0,lastFrame=performance.now(),lastPositionTime=-1,lastMapWallTime=-Infinity,positions=new Float32Array(0),countries=[],requestGeneration=0,renderTimer=null,pendingLatitude=null,orbitsDirty=true,last3dKey=null,lastTimelinePaint=0;
const SERVICE_LATITUDES=Array.from({length:13},(_,i)=>30+5*i),gridCache=new Map(),gridPromises=new Map();

const scene=new THREE.Scene();scene.background=new THREE.Color(0xffffff);
const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.01,1000);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.sortObjects=true;
$('canvas-wrap').appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=2.1;controls.maxDistance=12;controls.enablePan=false;
const earthGroup=new THREE.Group();scene.add(earthGroup);
earthGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1,160,160),new THREE.MeshBasicMaterial({color:0xf7f7f7,depthTest:true})));
function spherePoint(lat,lon,r=1.004){const a=lat*Math.PI/180,b=lon*Math.PI/180;return new THREE.Vector3(r*Math.cos(a)*Math.cos(b),r*Math.sin(a),-r*Math.cos(a)*Math.sin(b));}
for(const lat of [-40,0,40]){const points=[];for(let lon=-180;lon<=180;lon+=3)points.push(spherePoint(lat,lon));earthGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:lat===0?0xd2c79f:0xdcdcdc,transparent:true,opacity:.6})));}
const countryMaterial=new THREE.LineBasicMaterial({color:0xaeb2b2,transparent:true,opacity:.48});
const mapCanvas=$('map2dCanvas'),mapView=createSbiCoverageMap(mapCanvas,$('ui'));
const mapWorker=new Worker('./coverage-worker.js',{type:'module'});
const workerSites=mapView.siteVectors.slice(),workerLatitudes=mapView.latRadians.slice();
mapWorker.postMessage({type:'init',sites:workerSites.buffer,latitudes:workerLatitudes.buffer},[workerSites.buffer,workerLatitudes.buffer]);
let mapRequestId=0,mapBusy=false,mapQueued=null,mapCounts=null,mapCountsKey=null;
fetch('./vendor/countries-110m.json').then(r=>r.json()).then(topology=>{const world=feature(topology,topology.objects.countries);countries=world.features;mapView.setWorld(world);for(const country of countries){const polys=country.geometry.type==='Polygon'?[country.geometry.coordinates]:country.geometry.coordinates;for(const poly of polys)for(const ring of poly){if(ring.length<2)continue;earthGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring.map(([lon,lat])=>spherePoint(lat,lon,1.006))),countryMaterial));}}}).catch(console.error);

// SBI satellite texture construction, rendered as instanced billboards.
function makeSatelliteSpriteTexture(fillColor,strokeColor,strokeWidth=18){
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,128,128);ctx.beginPath();ctx.arc(64,64,37,0,Math.PI*2);ctx.fillStyle=fillColor;ctx.fill();ctx.lineWidth=strokeWidth;ctx.strokeStyle=strokeColor;ctx.stroke();
  const texture=new THREE.CanvasTexture(canvas);texture.needsUpdate=true;return texture;
}
const spriteGeometry=new THREE.PlaneGeometry(1,1);
function spriteMesh(texture){const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthTest:true,depthWrite:false,alphaTest:.02,side:THREE.DoubleSide});const mesh=new THREE.InstancedMesh(spriteGeometry,material,24000);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.count=0;mesh.frustumCulled=false;mesh.renderOrder=8;scene.add(mesh);return mesh;}
const inactiveMesh=spriteMesh(makeSatelliteSpriteTexture('#d5d5d5','#4a4a4a',14));
const dummy=new THREE.Object3D(),lastBillboardQuaternion=new THREE.Quaternion();
const orbitGroup=new THREE.Group();scene.add(orbitGroup);

function rebuildOrbits(){
  while(orbitGroup.children.length){const child=orbitGroup.children[0];orbitGroup.remove(child);child.geometry.dispose();child.material.dispose();}
  orbitsDirty=false;last3dKey=mapArchitectureKey();
  if(!design)return;
  const P=design.planes,alt=data.altitudesKm[state.altitudeIndex];
  for(let p=0;p<P;p++){
    const node=2*Math.PI*p/P,points=[];for(let j=0;j<=120;j++){const xyz=orbitalPoint(node,2*Math.PI*j/120,alt,0,design.inclinationDeg);points.push(new THREE.Vector3(...xyz));}
    const curve=new THREE.CatmullRomCurve3(points,true);
    const geometry=new THREE.TubeGeometry(curve,180,.0008,5,true);
    const material=new THREE.MeshBasicMaterial({color:0x666666,transparent:true,opacity:.24*Math.min(1,Math.sqrt(24/P)),depthTest:true,depthWrite:false});
    const tube=new THREE.Mesh(geometry,material);tube.renderOrder=6;orbitGroup.add(tube);
  }
  positions=new Float32Array(design.satellites*3);lastPositionTime=-1;
}
function updatePositions(){
  if(!design)return;let i=0;const {planes,perPlane,phase}=design,alt=data.altitudesKm[state.altitudeIndex];
  for(let p=0;p<planes;p++)for(let k=0;k<perPlane;k++){const xyz=walkerPosition(planes,perPlane,phase,alt,p,k,elapsed,design.inclinationDeg);positions.set(xyz,i*3);i++;}
  orbitGroup.rotation.y=-EARTH_RATE*elapsed;lastPositionTime=elapsed;if(state.view==='3d')updateBillboards();
}
function updateBillboards(){
  if(!design)return;const scale=Math.min(.029,Math.max(.012,.029*Math.sqrt(500/design.satellites)));
  for(let i=0;i<design.satellites;i++){
    dummy.position.set(positions[3*i],positions[3*i+1],positions[3*i+2]);dummy.quaternion.copy(camera.quaternion);dummy.scale.setScalar(scale);dummy.updateMatrix();
    inactiveMesh.setMatrixAt(i,dummy.matrix);
  }
  inactiveMesh.count=design.satellites;inactiveMesh.instanceMatrix.needsUpdate=true;lastBillboardQuaternion.copy(camera.quaternion);
}
function mapArchitectureKey(){return design?`${design.inclinationDeg}/${data.altitudesKm[state.altitudeIndex]}/${design.planes}/${design.perPlane}/${design.phase}`:null;}
function updateMapLegend(){$('coverageMaxLabel').textContent=mapView.getMax().toLocaleString();}
function dispatchMapRequest(request){mapBusy=true;mapWorker.postMessage(request);}
function updateMapCoverage(reuseCounts=false){
  if(!design||state.view!=='2d')return;
  const key=mapArchitectureKey();
  if(reuseCounts&&mapCounts&&mapCountsKey===key)return;
  const request={type:'count',id:++mapRequestId,key,alt:data.altitudesKm[state.altitudeIndex],inc:design.inclinationDeg,design:{planes:design.planes,perPlane:design.perPlane,phase:design.phase},time:elapsed};
  lastMapWallTime=performance.now();
  if(mapBusy){mapQueued=request;return;}
  dispatchMapRequest(request);
}
mapWorker.onmessage=event=>{
  const {id,counts}=event.data;mapBusy=false;
  const current=id===mapRequestId&&state.view==='2d'&&design;
  if(mapQueued){const next=mapQueued;mapQueued=null;dispatchMapRequest(next);}
  else if(current&&state.playing&&performance.now()-lastMapWallTime>=MAP_REFRESH_MS)updateMapCoverage();
  if(current){
    mapCounts=new Uint16Array(counts);mapCountsKey=mapArchitectureKey();
    mapView.setCoverage(mapCounts);updateMapLegend();
  }
};
mapWorker.onerror=error=>{console.error('Map worker failed',error);mapBusy=false;mapQueued=null;$('recalcStatus').textContent='Coverage map calculation failed; reload the preview to retry.';};

// The open-area offset is copied from SBI's apply3DViewOffset().
function apply3DViewOffset(){const ui=$('ui').getBoundingClientRect(),width=innerWidth,height=innerHeight,openAreaCenter=ui.right+(width-ui.right)/2,shiftPixels=openAreaCenter-width/2;camera.setViewOffset(width,height,-shiftPixels,0,width,height);camera.updateProjectionMatrix();}
function clear3DViewOffset(){camera.clearViewOffset();camera.updateProjectionMatrix();}
const focus=spherePoint(20,-25,1).normalize();
function cameraLayoutScale(){const available=Math.max(300,innerWidth-$('ui').getBoundingClientRect().right);return Math.max(1,750/(available*.9));}
let layoutScale=cameraLayoutScale();
function setFullEarthView(){camera.position.copy(focus.clone().multiplyScalar(3.8*layoutScale));camera.up.set(0,1,0);controls.target.set(0,-.06,0);controls.update();apply3DViewOffset();state.horizon=false;$('viewToggleBtn').textContent='◠';updateBillboards();}
function setHorizonView(){const worldNorth=new THREE.Vector3(0,1,0),tangentNorth=worldNorth.clone().sub(focus.clone().multiplyScalar(worldNorth.dot(focus))).normalize(),tangentEast=new THREE.Vector3().crossVectors(tangentNorth,focus).normalize();camera.position.copy(focus.clone().multiplyScalar(2.22).add(tangentNorth.clone().multiplyScalar(.52)).add(tangentEast.clone().multiplyScalar(-.18)).multiplyScalar(layoutScale));camera.up.copy(tangentNorth);controls.target.copy(focus.clone().multiplyScalar(.82).add(tangentNorth.clone().multiplyScalar(.32)));controls.update();apply3DViewOffset();state.horizon=true;$('viewToggleBtn').textContent='◎';updateBillboards();}
function zoomCamera(factor){if(state.view==='2d'){mapView.zoom(1/factor);return;}const direction=camera.position.clone().sub(controls.target).multiplyScalar(factor);camera.position.copy(controls.target.clone().add(direction));controls.update();updateBillboards();}
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;const nextScale=cameraLayoutScale();if(nextScale!==layoutScale){camera.position.sub(controls.target).multiplyScalar(nextScale/layoutScale).add(controls.target);layoutScale=nextScale;controls.update();}if(state.view==='3d')apply3DViewOffset();else mapView.resize();if(data)renderChart();}addEventListener('resize',resize);setFullEarthView();

function renderChart(){
  if(!data)return;
  const metric=state.objective==='satelliteMinimum'?'satellites':'planes';
  $('chartTitle').textContent=metric==='satellites'?'Satellites by altitude':'Orbital planes by altitude';
  const folds=chartFolds(state.fold);
  $('chartLegend').innerHTML=folds.map(n=>`<span class="${n===state.fold?'selected':''}"><i style="background:${n===state.fold?'#a77c08':'#aeb3b5'}"></i>${n}-fold</span>`).join('');
  paintChart($('scalingChart'),data,state);
  $('downloadData').disabled=false;
}
function setSliderProgress(input){const min=+input.min,max=+input.max,value=+input.value;input.style.setProperty('--timeline-progress',`${100*(value-min)/(max-min)}%`);}
function statusText(){
  if(pendingLatitude!==null)return `Showing ±${state.serviceLatitude}° until the ±${pendingLatitude}° grid is ready.`;
  const alt=data.altitudesKm[state.altitudeIndex],entry=data.results[String(alt)]?.[String(state.fold)];
  if(entry===null)return `No design in the searched inclination, fleet, and plane range meets ${state.fold}-fold coverage across ±${state.serviceLatitude}°.`;
  return '';
}
function render(){
  if(!data)return;
  const alt=data.altitudesKm[state.altitudeIndex],entry=data.results[String(alt)]?.[String(state.fold)];
  design=entry?.[state.objective]??null;
  $('altitudeValue').textContent=alt.toLocaleString()+' km';$('foldValue').textContent=state.fold+'-fold';$('serviceLatitudeValue').textContent=`±${state.serviceLatitude}°`;
  $('recalcStatus').textContent=statusText();
  $('satellites').textContent=design?design.satellites.toLocaleString():'—';$('planes').textContent=design?design.planes.toLocaleString():'—';
  $('selectedInclination').textContent=`Optimized inclination: ${design?design.inclinationDeg+'°':'—'}`;
  for(const id of ['altitude','fold','serviceLatitude'])setSliderProgress($(id));
  $('serviceLatitude').setAttribute('aria-valuetext',`${state.serviceLatitude} degrees south to ${state.serviceLatitude} degrees north`);
  mapView.setServiceLatitude(state.serviceLatitude);
  if(state.view==='3d'){
    if(orbitsDirty||last3dKey!==mapArchitectureKey())rebuildOrbits();
    if(design)updatePositions();else{inactiveMesh.count=0;positions=new Float32Array(0);}
  }else{
    orbitsDirty=true;
    if(design)updateMapCoverage(mapCountsKey===mapArchitectureKey());
    else{++mapRequestId;mapQueued=null;mapCounts=null;mapCountsKey=null;inactiveMesh.count=0;mapView.setCoverage(new Uint16Array(mapView.cells.length));$('coverageMaxLabel').textContent='—';}
  }
  renderChart();
}
function validGrid(grid,latitude){return grid?.serviceLatitudeDeg===latitude&&grid.elevationDeg===10&&grid.altitudesKm?.length===34&&grid.altitudesKm.every((alt,i)=>alt===350+50*i)&&grid.folds?.length===100&&grid.folds.every((n,i)=>n===i+1)&&grid.altitudesKm.every(alt=>{const row=grid.results?.[String(alt)];return row&&Array.from({length:100},(_,i)=>i+1).every(n=>Object.hasOwn(row,String(n)));});}
async function fetchGrid(latitude){
  if(gridCache.has(latitude))return gridCache.get(latitude);
  if(gridPromises.has(latitude))return gridPromises.get(latitude);
  const promise=fetch(`./data/service_grids/lat-${latitude}.json`).then(async response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);const grid=await response.json();if(!validGrid(grid,latitude))throw Error('Incomplete or mismatched grid');gridCache.set(latitude,grid);return grid;}).finally(()=>gridPromises.delete(latitude));
  gridPromises.set(latitude,promise);return promise;
}
function showLoad(message,progress=null){$('loadIndicator').hidden=false;$('loadMessage').textContent=message;$('loadProgress').hidden=progress===null;if(progress!==null)$('loadProgress').value=progress;}
function hideLoad(){$('loadIndicator').hidden=true;$('recalcStatus').textContent=statusText();}
async function selectServiceLatitude(latitude){
  const generation=++requestGeneration;
  if(latitude===state.serviceLatitude){pendingLatitude=null;hideLoad();return;}
  pendingLatitude=latitude;$('recalcStatus').textContent=statusText();
  if(!gridCache.has(latitude))showLoad(`Loading validated ±${latitude}° grid`);
  try{
    const grid=await fetchGrid(latitude);
    if(generation!==requestGeneration)return;
    data=grid;state.serviceLatitude=latitude;pendingLatitude=null;hideLoad();render();
  }catch(error){if(generation!==requestGeneration)return;pendingLatitude=null;console.error(error);$('loadMessage').textContent=`Could not load ±${latitude}°: ${error.message}`;$('loadProgress').hidden=true;$('recalcStatus').textContent=`Showing ±${state.serviceLatitude}°; ±${latitude}° failed to load.`;$('serviceLatitude').value=SERVICE_LATITUDES.indexOf(state.serviceLatitude);$('serviceLatitude').setAttribute('aria-valuetext',`${state.serviceLatitude} degrees south to ${state.serviceLatitude} degrees north`);setSliderProgress($('serviceLatitude'));}
}
function queueRender(){clearTimeout(renderTimer);renderTimer=setTimeout(render,35);}
function toggle(a,b,active){$(a).classList.toggle('activeViewSwitch',active);$(b).classList.toggle('activeViewSwitch',!active);$(a).setAttribute('aria-pressed',String(active));$(b).setAttribute('aria-pressed',String(!active));}
function setView(mode){state.view=mode;toggle('view3d','view2d',mode==='3d');renderer.domElement.style.display=mode==='3d'?'block':'none';mapCanvas.style.display=mode==='2d'?'block':'none';$('viewToggleBtn').style.display=mode==='3d'?'block':'none';$('legendContainer').style.display=mode==='2d'?'block':'none';if(mode==='2d'){clear3DViewOffset();mapView.draw();lastMapWallTime=-Infinity;updateMapCoverage();}else{++mapRequestId;mapQueued=null;apply3DViewOffset();if(orbitsDirty||last3dKey!==mapArchitectureKey())rebuildOrbits();if(design)updatePositions();else inactiveMesh.count=0;renderer.render(scene,camera);}}
function updatePlaybackButton(){$('playBtn').innerHTML=state.playing?'<span class="pauseIcon"></span>':'<span class="playIcon"></span>';$('playBtn').setAttribute('aria-label',state.playing?'Pause animation':'Play animation');}
function updateTimeline(){const hours=elapsed/3600;$('timelineSlider').value=hours;setSliderProgress($('timelineSlider'));const hh=Math.floor(hours),mm=Math.floor((hours-hh)*60);$('timelineTime').textContent=`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;}
function animate(now){const dt=Math.min((now-lastFrame)/1000,state.view==='2d'?1:.1);lastFrame=now;if(state.playing)elapsed=(elapsed+dt*72*state.speed)%(24*3600);if(state.view==='3d'){if(design&&(lastPositionTime<0||Math.abs(elapsed-lastPositionTime)>4))updatePositions();controls.update();if(design&&lastBillboardQuaternion.angleTo(camera.quaternion)>.002)updateBillboards();renderer.render(scene,camera);}else if(state.playing&&design&&!mapBusy&&now-lastMapWallTime>=MAP_REFRESH_MS)updateMapCoverage();if(now-lastTimelinePaint>100){updateTimeline();lastTimelinePaint=now;}requestAnimationFrame(animate);}requestAnimationFrame(animate);

$('view3d').onclick=()=>setView('3d');$('view2d').onclick=()=>setView('2d');
$('zoomInBtn').onclick=()=>zoomCamera(.82);$('zoomOutBtn').onclick=()=>zoomCamera(1.22);$('viewToggleBtn').onclick=()=>state.horizon?setFullEarthView():setHorizonView();
$('altitude').oninput=e=>{state.altitudeIndex=+e.target.value;queueRender();};$('fold').oninput=e=>{state.fold=+e.target.value;queueRender();};
$('serviceLatitude').oninput=e=>{setSliderProgress(e.target);const latitude=SERVICE_LATITUDES[+e.target.value];e.target.setAttribute('aria-valuetext',`${latitude} degrees south to ${latitude} degrees north`);selectServiceLatitude(latitude);};
$('minSat').onclick=()=>{state.objective='satelliteMinimum';toggle('minSat','minPlane',true);queueRender();};$('minPlane').onclick=()=>{state.objective='planeTradeoff';toggle('minSat','minPlane',false);queueRender();};
$('playBtn').onclick=()=>{state.playing=!state.playing;updatePlaybackButton();};updatePlaybackButton();
$('speedDownBtn').onclick=()=>{state.speed=Math.max(.25,state.speed-.5);};$('speedUpBtn').onclick=()=>{state.speed=Math.min(4,state.speed+.5);};
$('timelineSlider').oninput=e=>{state.playing=false;elapsed=+e.target.value*3600;updatePlaybackButton();if(state.view==='2d')updateMapCoverage();else if(design)updatePositions();updateTimeline();};
$('downloadData').onclick=()=>{if(!data||$('downloadData').disabled)return;const blob=new Blob([buildModelCsv(data)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`espl-constellation-coverage-lat-${state.serviceLatitude}deg.csv`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
fetchGrid(40).then(grid=>{
  data=grid;$('altitude').max=data.altitudesKm.length-1;
  const query=new URLSearchParams(location.search),requestedAltitude=data.altitudesKm.indexOf(Number(query.get('alt'))),requestedFold=Number(query.get('fold')),requestedLatitude=Number(query.get('lat'));
  if(requestedAltitude>=0)state.altitudeIndex=requestedAltitude;
  if(data.folds.includes(requestedFold))state.fold=requestedFold;
  for(const [id,value] of [['altitude',state.altitudeIndex],['fold',state.fold],['serviceLatitude',SERVICE_LATITUDES.indexOf(40)]])$(id).value=value;
  render();if(query.get('view')==='2d')setView('2d');
  if(SERVICE_LATITUDES.includes(requestedLatitude)&&requestedLatitude!==40){$('serviceLatitude').value=SERVICE_LATITUDES.indexOf(requestedLatitude);selectServiceLatitude(requestedLatitude);}
  else if(query.has('lat')&&!SERVICE_LATITUDES.includes(requestedLatitude))$('recalcStatus').textContent='Unsupported service latitude in URL; showing ±40°.';
  if(query.has('elev')&&Number(query.get('elev'))!==10)$('recalcStatus').textContent='Minimum elevation is fixed at 10° for validated results.';
  for(const latitude of SERVICE_LATITUDES)if(latitude!==40)fetchGrid(latitude).catch(()=>{});
}).catch(error=>{console.error(error);$('satellites').textContent='Error';$('recalcStatus').textContent=`Could not load validated results: ${error.message}`;});
