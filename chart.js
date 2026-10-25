/* Small panel chart for the selected optimization objective. */
export const chartFolds = selected => {
  return [...new Set([1,10,50,100,selected])].sort((a,b)=>a-b);
};
const niceStep=raw=>{const power=10**Math.floor(Math.log10(Math.max(raw,1e-9))),fraction=raw/power;return (fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*power;};
const fmt=value=>Math.round(value).toLocaleString('en-US');
function plot(data,state,width,height){
  const metric=state.objective==='satelliteMinimum'?'satellites':'planes',folds=chartFolds(state.fold),alts=data.altitudesKm;
  const values=n=>alts.map(a=>data.results[String(a)]?.[String(n)]?.[state.objective]?.[metric]??null);
  const series=folds.map(n=>({n,values:values(n)})),all=series.flatMap(s=>s.values).filter(v=>v!==null);
  const yStep=niceStep(Math.max(1,...all)/4),yMax=Math.max(yStep,Math.ceil(Math.max(1,...all)/yStep)*yStep);
  const margin={left:58,right:18,top:11,bottom:30};
  const plotWidth=width-margin.left-margin.right,plotHeight=height-margin.top-margin.bottom;
  const X=i=>margin.left+plotWidth*i/(alts.length-1),Y=v=>margin.top+plotHeight*(1-v/yMax);
  return {metric,folds,series,all,alts,yStep,yMax,X,Y,margin,plotWidth,plotHeight,width,height};
}
export function paintChart(canvas,data,state){
  const ctx=canvas.getContext('2d'),width=canvas.clientWidth,height=canvas.clientHeight,dpr=Math.min(devicePixelRatio,2);
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const p=plot(data,state,width,height),{X,Y,margin,plotWidth,plotHeight}=p;
  if(!p.all.length){ctx.font='11px -apple-system,sans-serif';ctx.fillStyle='#777';ctx.fillText('Calculating this parameter set…',margin.left,70);return p;}
  ctx.font='9px -apple-system,sans-serif';ctx.textBaseline='middle';ctx.textAlign='right';
  for(let value=0;value<=p.yMax+p.yStep*.01;value+=p.yStep){const y=Y(value);ctx.strokeStyle='#e7e7e7';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(margin.left,y);ctx.lineTo(margin.left+plotWidth,y);ctx.stroke();ctx.fillStyle='#777';ctx.fillText(fmt(value),margin.left-5,y);}
  ctx.save();ctx.translate(9,margin.top+plotHeight/2);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.fillStyle='#666';ctx.font='9px -apple-system,sans-serif';ctx.fillText(p.metric==='satellites'?'Satellites required':'Orbital planes required',0,0);ctx.restore();
  ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillStyle='#777';for(const a of [350,550,1000,1500,2000])ctx.fillText(fmt(a),X(p.alts.indexOf(a)),height-13);
  ctx.font='9px -apple-system,sans-serif';ctx.fillText('Altitude (km)',margin.left+plotWidth/2,height-1);
  const currentX=X(state.altitudeIndex);ctx.setLineDash([3,3]);ctx.strokeStyle='#c8aa58';ctx.beginPath();ctx.moveTo(currentX,margin.top);ctx.lineTo(currentX,margin.top+plotHeight);ctx.stroke();ctx.setLineDash([]);
  for(const s of p.series.filter(s=>s.n!==state.fold).concat(p.series.filter(s=>s.n===state.fold))){const selected=s.n===state.fold;ctx.strokeStyle=selected?'#a77c08':'#aeb3b5';ctx.globalAlpha=selected?1:.7;ctx.lineWidth=selected?2.6:1.1;ctx.beginPath();let drawing=false;s.values.forEach((v,i)=>{if(v===null){drawing=false;return;}if(drawing)ctx.lineTo(X(i),Y(v));else{ctx.moveTo(X(i),Y(v));drawing=true;}});ctx.stroke();ctx.globalAlpha=1;if(selected&&s.values[state.altitudeIndex]!==null){ctx.fillStyle='#a77c08';ctx.beginPath();ctx.arc(currentX,Y(s.values[state.altitudeIndex]),4,0,Math.PI*2);ctx.fill();}}
  canvas.setAttribute('aria-label',`${p.metric} by altitude for ${p.folds.join(', ')}-fold coverage. Selected ${state.fold}-fold at ${p.alts[state.altitudeIndex]} km.`);
  return p;
}
