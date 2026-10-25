/* Adapted from the SBI interactive's Mollweide/Voronoi coverage renderer.
 * The geometry, colors, boundary treatment, and map interactions follow
 * sbi-constellation-viz/app.js. Counts mean simultaneous visible satellites.
 */
const COVERAGE_ZERO_COLOR = '#eeeeee';
const COVERAGE_LOW_COLOR = '#fffdf1';
const COVERAGE_MID_LOW_COLOR = '#fff4b8';
const COVERAGE_MID_COLOR = '#ffe066';
const COVERAGE_HIGH_COLOR = '#eaaa00';
const COVERAGE_TOP_COLOR = '#b87900';
const ZERO_REGION_STROKE = '#4a4a4a';

function interpolateHexColor(a,b,t){
  const aa=a.slice(1),bb=b.slice(1),u=Math.max(0,Math.min(1,t));
  const channels=[0,2,4].map(i=>Math.round(parseInt(aa.slice(i,i+2),16)+(parseInt(bb.slice(i,i+2),16)-parseInt(aa.slice(i,i+2),16))*u));
  return `rgb(${channels.join(',')})`;
}
function coverageColor(count,maxCount){
  if(!count||count<=0)return COVERAGE_ZERO_COLOR;
  const t=Math.max(0,Math.min(1,count/Math.max(1,maxCount)));
  if(t<.25)return interpolateHexColor(COVERAGE_LOW_COLOR,COVERAGE_MID_LOW_COLOR,t/.25);
  if(t<.5)return interpolateHexColor(COVERAGE_MID_LOW_COLOR,COVERAGE_MID_COLOR,(t-.25)/.25);
  if(t<.75)return interpolateHexColor(COVERAGE_MID_COLOR,COVERAGE_HIGH_COLOR,(t-.5)/.25);
  return interpolateHexColor(COVERAGE_HIGH_COLOR,COVERAGE_TOP_COLOR,(t-.75)/.25);
}
function generateGlobalFibonacciCells(count=15000){
  const cells=[],goldenAngle=Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<count;i++){
    const y=1-2*(i+.5)/count,radius=Math.sqrt(Math.max(0,1-y*y)),theta=goldenAngle*i;
    const x=Math.cos(theta)*radius,z=Math.sin(theta)*radius;
    const lat=Math.asin(y)*180/Math.PI,lon=Math.atan2(z,x)*180/Math.PI;
    cells.push({lat,lon});
  }
  return cells;
}

function edgeKey(a,b){const ar=`${Math.round(a[0]*10)/10},${Math.round(a[1]*10)/10}`,br=`${Math.round(b[0]*10)/10},${Math.round(b[1]*10)/10}`;return ar<br?`${ar}|${br}`:`${br}|${ar}`;}
export function zeroBoundaryEdges(mapCells,counts){
  const edges=new Map();
  for(const cell of mapCells){
    if((counts[cell.targetIdx]||0)>0||cell.vertices.length<3)continue;
    for(let i=0;i<cell.vertices.length;i++){
      const a=cell.vertices[i],b=cell.vertices[(i+1)%cell.vertices.length];
      if(Math.hypot(a[0]-b[0],a[1]-b[1])<1.5)continue;
      const key=edgeKey(a,b);if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);
    }
  }
  return [...edges.values()];
}

function buildZeroEdgeTopology(mapCells){
  const edges=new Map();
  for(const cell of mapCells){
    if(cell.vertices.length<3)continue;
    for(let i=0;i<cell.vertices.length;i++){
      const a=cell.vertices[i],b=cell.vertices[(i+1)%cell.vertices.length];
      if(Math.hypot(a[0]-b[0],a[1]-b[1])<1.5)continue;
      const key=edgeKey(a,b),edge=edges.get(key);
      if(edge)edge.owners.push(cell.targetIdx);
      else edges.set(key,{a,b,owners:[cell.targetIdx]});
    }
  }
  return [...edges.values()];
}

export function createSbiCoverageMap(canvas,panel){
  const d3=window.d3;
  if(!d3?.geoMollweide||!d3?.Delaunay)throw new Error('Local SBI map libraries did not load');
  const ctx=canvas.getContext('2d'),cells=generateGlobalFibonacciCells(),siteVectors=new Float32Array(cells.length*3),latRadians=new Float32Array(cells.length);
  cells.forEach((cell,i)=>{const lat=cell.lat*Math.PI/180,lon=cell.lon*Math.PI/180,c=Math.cos(lat);latRadians[i]=lat;siteVectors[3*i]=c*Math.cos(lon);siteVectors[3*i+1]=Math.sin(lat);siteVectors[3*i+2]=-c*Math.sin(lon);});
  let counts=new Uint16Array(cells.length),maxCount=1,colors=[COVERAGE_ZERO_COLOR],worldGeoJson=null,mapCells=[],zeroEdges=[],mapProjection=null,mapPath=null,needsGeometry=true,mapZoom=1,mapPanX=0,mapPanY=0,drag=null,wheelTimer=null,serviceLatitude=40;

  function resizeMapCanvas(){const dpr=Math.min(window.devicePixelRatio||1,2),width=window.innerWidth,height=window.innerHeight,nw=Math.round(width*dpr),nh=Math.round(height*dpr);if(canvas.width!==nw||canvas.height!==nh){canvas.width=nw;canvas.height=nh;needsGeometry=true;}canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;}
  function getAvailableMapExtent(){const ui=panel.getBoundingClientRect(),margin=22;return {left:ui.right+margin,top:margin,right:window.innerWidth-margin,bottom:window.innerHeight-margin};}
  function makeMapProjection(){const extent=getAvailableMapExtent(),projection=d3.geoMollweide();projection.fitExtent([[extent.left,extent.top],[extent.right,extent.bottom]],{type:'Sphere'});const translate=projection.translate(),scale=projection.scale();return projection.scale(scale*mapZoom).translate([translate[0]+mapPanX,translate[1]+mapPanY]);}
  function rebuildMapGeometry(){resizeMapCanvas();mapProjection=makeMapProjection();mapPath=d3.geoPath(mapProjection,ctx);const projectedPoints=cells.map((cell,idx)=>{const xy=mapProjection([cell.lon,cell.lat]);return xy&&Number.isFinite(xy[0])&&Number.isFinite(xy[1])?{idx,x:xy[0],y:xy[1]}:null;}).filter(Boolean);const buffer=260*mapZoom;if(projectedPoints.length<3){mapCells=[];zeroEdges=[];return;}const delaunay=d3.Delaunay.from(projectedPoints,p=>p.x,p=>p.y),voronoi=delaunay.voronoi([-buffer,-buffer,window.innerWidth+buffer,window.innerHeight+buffer]);mapCells=projectedPoints.map((point,i)=>{const polygon=voronoi.cellPolygon(i),path=new Path2D(),vertices=[];if(polygon)polygon.forEach(([x,y],j)=>{vertices.push([x,y]);if(j===0)path.moveTo(x,y);else path.lineTo(x,y);});path.closePath();return {targetIdx:point.idx,path,vertices};});zeroEdges=buildZeroEdgeTopology(mapCells);needsGeometry=false;}
  function drawMapBoundaries(){if(!worldGeoJson)return;ctx.save();ctx.strokeStyle='rgba(80,80,80,.42)';ctx.lineWidth=.55;ctx.beginPath();mapPath(worldGeoJson);ctx.stroke();ctx.restore();}
  function drawServiceRegion(){if(serviceLatitude>=90)return;ctx.save();ctx.strokeStyle='rgba(96,76,16,.7)';ctx.lineWidth=.9;ctx.setLineDash([4,4]);for(const latitude of [-serviceLatitude,serviceLatitude]){ctx.beginPath();mapPath({type:'LineString',coordinates:Array.from({length:73},(_,i)=>[-180+5*i,latitude])});ctx.stroke();}ctx.restore();}
  function drawZeroCoverageOutlines(){ctx.save();ctx.strokeStyle=ZERO_REGION_STROKE;ctx.lineWidth=1.05;ctx.lineJoin='round';ctx.beginPath();for(const edge of zeroEdges){let parity=0;for(const owner of edge.owners)if(!counts[owner])parity^=1;if(parity){ctx.moveTo(edge.a[0],edge.a[1]);ctx.lineTo(edge.b[0],edge.b[1]);}}ctx.stroke();ctx.restore();}
  function draw(){if(canvas.style.display==='none')return;resizeMapCanvas();if(needsGeometry)rebuildMapGeometry();const dpr=Math.min(window.devicePixelRatio||1,2),w=window.innerWidth,h=window.innerHeight;ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);if(!mapPath){ctx.restore();return;}ctx.save();ctx.beginPath();mapPath({type:'Sphere'});ctx.clip();for(const cell of mapCells){const count=counts[cell.targetIdx]||0;ctx.fillStyle=colors[count]||COVERAGE_ZERO_COLOR;ctx.fill(cell.path);}drawZeroCoverageOutlines();ctx.restore();ctx.strokeStyle='#d0d0d0';ctx.lineWidth=.8;ctx.beginPath();mapPath({type:'Sphere'});ctx.stroke();drawMapBoundaries();drawServiceRegion();ctx.restore();}
  function setCoverage(nextCounts){counts=nextCounts;maxCount=Math.max(1,...counts);colors=Array.from({length:maxCount+1},(_,i)=>coverageColor(i,maxCount));draw();}
  function setWorld(geojson){worldGeoJson=geojson;draw();}
  function zoom(factor,centerX=innerWidth/2,centerY=innerHeight/2,defer=false){const previousZoom=mapZoom,nextZoom=Math.max(1,Math.min(8,mapZoom*factor));if(nextZoom===previousZoom)return;mapPanX=centerX-(centerX-mapPanX)*nextZoom/previousZoom;mapPanY=centerY-(centerY-mapPanY)*nextZoom/previousZoom;mapZoom=nextZoom;if(mapZoom<=1.0001){mapPanX=0;mapPanY=0;}needsGeometry=true;if(defer){clearTimeout(wheelTimer);wheelTimer=setTimeout(draw,90);}else draw();}
  function reset(){mapZoom=1;mapPanX=0;mapPanY=0;needsGeometry=true;draw();}
  canvas.addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY<0?1.12:1/1.12,event.clientX,event.clientY,true);},{passive:false});
  canvas.addEventListener('pointerdown',event=>{canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');drag={x:event.clientX,y:event.clientY,panX:mapPanX,panY:mapPanY};});
  canvas.addEventListener('pointermove',event=>{if(!drag||mapZoom<=1.0001)return;canvas.style.transform=`translate(${event.clientX-drag.x}px,${event.clientY-drag.y}px)`;});
  for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,event=>{if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(drag&&mapZoom>1.0001&&type==='pointerup'){mapPanX=drag.panX+event.clientX-drag.x;mapPanY=drag.panY+event.clientY-drag.y;needsGeometry=true;}drag=null;canvas.style.transform='';canvas.classList.remove('dragging');if(needsGeometry)draw();});
  return {cells,siteVectors,latRadians,draw,setCoverage,setWorld,zoom,reset,resize:()=>{needsGeometry=true;draw();},setServiceLatitude:latitude=>{if(serviceLatitude!==latitude){serviceLatitude=latitude;draw();}},getMax:()=>maxCount};
}
