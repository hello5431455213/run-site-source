import { interpolate, LIMITS } from './gpx.js';

// Sample positions on the time axis before formatting time. Rounding timestamps
// of existing positions would change their apparent speed.
export function prepareExport(input) {
  if (input.exportPrepared) return input;
  const durations = input.tracks.map(t => (t.at(-1).elapsedMicros-t[0].elapsedMicros)/1e6);
  const exact = reason => ({...input, exportPrepared:true, exportSamplingSeconds:null, exportTimeAdjustment:0, sourcePointCount:input.pointCount, exportReason:reason});
  if (durations.some(d=>d<1)) return exact('Есть сегмент короче секунды: сохранены точные временные метки.');
  const rounded = durations.map(d=>Math.max(1,Math.round(d)));
  for(let segment=0;segment<input.tracks.length;segment++) {
    if(rounded[segment]===durations[segment]) continue;
    const track=input.tracks[segment],ratio=rounded[segment]/durations[segment];
    for(let i=1;i<track.length;i++) {
      const pace=(track[i].elapsedMicros-track[i-1].elapsedMicros)/1000/(track[i].distance-track[i-1].distance)*ratio;
      if(pace<input.settings.pace-input.settings.paceDeviation-.5 || pace>input.settings.pace+input.settings.paceDeviation+.5) return exact('Целые секунды заметно меняют темп короткого сегмента: сохранено точное время.');
    }
  }
  const room = LIMITS.samples-2*input.tracks.length;
  if(room<=0) return exact('Очень много отдельных сегментов: сохранены исходные точки.');
  const step = Math.max(1,Math.ceil(rounded.reduce((a,b)=>a+b,0)/room));
  let clock=0,steps=0,cadenceSum=0,heartSum=0,active=0,minStep=Infinity,maxStep=0;
  const tracks=input.tracks.map((source,segment)=>{
    if(segment) clock++; // Separate tracks; no bridging distance or running steps.
    const offset=clock, first=source[0],last=source.at(-1),duration=rounded[segment],scale=durations[segment]/duration;
    const c=[0],h=[0];
    for(let i=1;i<source.length;i++) {
      const dt=(source[i].elapsedMicros-source[i-1].elapsedMicros)/1e6;
      c[i]=c[i-1]+source[i].cadence*dt;
      h[i]=h[i-1]+(source[i].heartRate || 0)*dt;
    }
    let cursor=1;
    const at=second=>{
      const elapsed=Math.min(last.elapsedMicros,first.elapsedMicros+second*scale*1e6);
      while(cursor<source.length-1 && source[cursor].elapsedMicros<elapsed) cursor++;
      const a=source[cursor-1],b=source[cursor];
      const f=Math.max(0,Math.min(1,(elapsed-a.elapsedMicros)/(b.elapsedMicros-a.elapsedMicros)));
      const dt=(elapsed-a.elapsedMicros)/1e6;
      return {...interpolate(a,b,f),distance:a.distance+(b.distance-a.distance)*f,elapsedMicros:(offset+second)*1e6,integralC:c[cursor-1]+b.cadence*dt,integralH:h[cursor-1]+(b.heartRate || 0)*dt};
    };
    const out=[];for(let second=0;second<duration;second+=step) out.push(at(second));out.push(at(duration));
    for(const [p,boundary] of [[out[0],first],[out.at(-1),last]]) {
      Object.assign(p,{lat:boundary.lat,lon:boundary.lon,distance:boundary.distance});
      if(boundary.alt!==undefined) p.alt=boundary.alt;
    }
    for(let i=1;i<out.length;i++) {
      const p=out[i],previous=out[i-1],dt=(p.elapsedMicros-previous.elapsedMicros)/1e6;
      p.speed=(p.distance-previous.distance)/dt;p.pace=1000/p.speed;
      p.cadence=(p.integralC-previous.integralC)/(dt*scale);
      if(input.settings.heartRateEnabled) p.heartRate=(p.integralH-previous.integralH)/(dt*scale);
      p.stepLength=p.speed*60/p.cadence;
      cadenceSum+=p.cadence*dt;heartSum+=(p.heartRate || 0)*dt;active+=dt;steps+=p.cadence*dt/60;
      minStep=Math.min(minStep,p.stepLength);maxStep=Math.max(maxStep,p.stepLength);
    }
    Object.assign(out[0],{speed:out[1].speed,pace:out[1].pace,cadence:out[1].cadence,stepLength:out[1].stepLength});
    if(input.settings.heartRateEnabled) out[0].heartRate=out[1].heartRate;
    out.forEach(p=>{delete p.integralC;delete p.integralH;});
    clock=offset+duration;return out;
  });
  return {...input,tracks,duration:clock,avgPace:clock*1000/input.distance,avgCadence:cadenceSum/active,avgHeartRate:input.settings.heartRateEnabled?heartSum/active:null,steps,minStep,maxStep,pointCount:tracks.reduce((n,t)=>n+t.length,0),sourcePointCount:input.pointCount,exportPrepared:true,exportSamplingSeconds:step,exportTimeAdjustment:clock-input.duration};
}
