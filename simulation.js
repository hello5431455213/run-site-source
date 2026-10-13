import { sampleRoute } from './gpx.js';
export function parsePace(value) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(value).trim());
  if (!match) throw new Error('Введите темп в формате MM:SS, например 6:00.');
  return Number(match[1]) * 60 + Number(match[2]);
}
export function validateSettings(s) {
  for (const key of ['pace', 'paceDeviation', 'cadence', 'cadenceDeviation']) if (!Number.isFinite(s[key])) throw new Error('Все параметры должны быть числами.');
  if (s.pace < 180 || s.pace > 1200) throw new Error('Целевой темп: от 3:00 до 20:00 мин/км.');
  if (s.paceDeviation < 0 || s.paceDeviation > 120 || s.pace - s.paceDeviation < 120) throw new Error('Отклонение темпа: 0–120 с/км; минимальный темп — 2:00.');
  if (s.cadence < 100 || s.cadence > 240 || s.cadenceDeviation < 0 || s.cadenceDeviation > 30 || s.cadence - s.cadenceDeviation < 60 || s.cadence + s.cadenceDeviation > 254) throw new Error('Каденс: 100–240; отклонение: 0–30; итоговый диапазон: 60–254 шагов/мин.');
  if (!Number.isFinite(new Date(s.start).getTime())) throw new Error('Укажите корректную дату и время начала.');
  if (!String(s.seed).trim() || String(s.seed).length > 80) throw new Error('Seed должен содержать от 1 до 80 символов.');
  if (s.timeZone !== undefined && !['Europe/Kyiv', 'Europe/Berlin'].includes(s.timeZone)) throw new Error('Выберите время Украины или Германии.');
  if (s.heartRateEnabled && (!Number.isInteger(s.heartRate) || !Number.isInteger(s.heartRateDeviation) || s.heartRate < 80 || s.heartRate > 200 || s.heartRateDeviation < 0 || s.heartRateDeviation > 30 || s.heartRate-s.heartRateDeviation < 50 || s.heartRate+s.heartRateDeviation > 220)) throw new Error('Пульс: 80–200 уд/мин; отклонение 0–30; диапазон 50–220.');
}
export function random(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ h >>> 15, h | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function wave(rng, extent, scales, weights = [.65, .25, .1]) {
  // Random anchor values with smooth interpolation: correlated, without repeating sine cycles.
  const layers = scales.map(([min, max], i) => {
    const spacing = min + rng() * (max - min), offset = rng() * spacing;
    const values = Array.from({ length: Math.ceil((extent + offset) / spacing) + 2 }, () => rng() * 2 - 1);
    return { spacing, offset, values, weight: weights[i] };
  });
  return d => layers.reduce((sum, layer) => {
    const position = (d + layer.offset) / layer.spacing, index = Math.floor(position), t = position - index;
    const blend = t * t * (3 - 2 * t);
    return sum + layer.weight * (layer.values[index] * (1 - blend) + layer.values[index + 1] * blend);
  }, 0);
}
// Center by weights, then scale rather than clip: mean AND hard bounds are preserved.
function centered(values, weights, amplitude, peak = null) {
  let total = 0, sum = 0;
  for (let i = 0; i < values.length; i++) { total += weights[i]; sum += values[i] * weights[i]; }
  const mean = sum / total;
  let max = 0;
  for (const v of values) max = Math.max(max, Math.abs(v - mean));
  const scale = max > 1e-12 ? (peak === null ? Math.min(1, .95 / max) : peak / max) : 0;
  return values.map(v => (v - mean) * scale * amplitude);
}
export function simulate(route, settings) {
  validateSettings(settings);
  const sampled = sampleRoute(route), rng = random(settings.seed);
  // Consecutive identical GPS positions are not stops. Keep source GPX intact, but
  // omit redundant zero-distance samples from the running profile and TCX.
  sampled.segments = sampled.segments.map(segment => segment.filter((p, i) => i === 0 || p.distance > segment[i - 1].distance)).filter(segment => segment.length > 1);
  sampled.count = sampled.segments.reduce((n, segment) => n + segment.length, 0);
  const edges = [];
  for (let s = 0; s < sampled.segments.length; s++) {
    const seg = sampled.segments[s];
    for (let i = 1; i < seg.length; i++) edges.push({ segment: s, index: i, length: seg[i].distance - seg[i - 1].distance, midpoint: (seg[i].distance + seg[i - 1].distance) / 2 });
  }
  // Same time-based controller as RoutePilot: a new uniformly random target
  // every 15–35 seconds and an exponential response with tau=10 seconds.
  let pace=settings.pace, elapsedPace=0, target=pace, nextTarget=0, changes=0;
  const chooseTarget=()=>{
    if(++changes>2000000) throw new Error('Маршрут слишком длинный для расчёта профиля. Разделите GPX.');
    target=settings.pace+(settings.paceDeviation ? (rng()*2-1)*settings.paceDeviation : 0);
    nextTarget=elapsedPace+15+rng()*20;
  };
  for(const e of edges) {
    const startTime=elapsedPace;let remaining=e.length;
    while(remaining>1e-10) {
      if(elapsedPace>=nextTarget-1e-9) chooseTarget();
      const available=nextTarget-elapsedPace;
      const endPace=target+(pace-target)*Math.exp(-available/10);
      const availableDistance=1000/target*(available+10*Math.log(endPace/pace));
      if(remaining>=availableDistance) {
        remaining=Math.max(0,remaining-availableDistance);elapsedPace=nextTarget;pace=endPace;
      } else {
        // Analytic integral of speed=1000/pace, inverted for this GPS edge.
        const k=remaining*target/10000,ratio=pace/target;
        const dt=k>50 ? 10*(k+Math.log(ratio)) : 10*Math.log1p(ratio*Math.expm1(k));
        pace=target+(pace-target)*Math.exp(-dt/10);elapsedPace+=dt;remaining=0;
      }
    }
    e.dt=elapsedPace-startTime;e.pace=e.dt*1000/e.length;e.speed=e.length/e.dt;
  }
  const totalTime=edges.reduce((sum,e)=>sum+e.dt,0);
  const paceBias=totalTime*1000/sampled.distance-settings.pace;
  const timeScale = Math.max(1, totalTime / Math.max(1, edges.length) / 4);
  const cadenceWave = wave(rng, totalTime, [[80,140],[30,55],[12,22]].map(pair => pair.map(v => v * timeScale)));
  let elapsed = 0;
  let cadenceResponse = null;
  const cadenceValues = edges.map(e => {
    // Heuristic elasticity: speed changes mostly through step length; cadence
    // responds more mildly. This coefficient is a simulation choice, not a norm.
    const desiredResponse = settings.cadence * ((settings.pace / e.pace) ** .25 - 1);
    cadenceResponse = cadenceResponse === null ? desiredResponse : cadenceResponse+(desiredResponse-cadenceResponse)*(1-Math.exp(-e.dt/8));
    const noise = .1 * settings.cadenceDeviation * cadenceWave(elapsed + e.dt / 2);
    elapsed += e.dt;
    return cadenceResponse + noise;
  });
  // centered() works in normalized units; never amplify a small natural variation.
  const cadDelta = settings.cadenceDeviation === 0 ? edges.map(() => 0) : centered(cadenceValues.map(v => v / settings.cadenceDeviation), edges.map(e => e.dt), settings.cadenceDeviation);
  edges.forEach((e, i) => { e.cadence = settings.cadence + cadDelta[i]; e.stepLength = e.speed * 60 / e.cadence; });
  let heartRateBias = 0;
  if (settings.heartRateEnabled) {
    const hrWave = wave(rng, totalTime, [[90,150],[35,65],[15,25]], [.35,.45,.2]);
    heartRateBias=(rng()*2-1)*settings.heartRateDeviation*.4;
    let time = 0, filtered = null;
    const values = edges.map(e => {
      const mid = time+e.dt/2;
      // Gradual warm-up, mild drift, small independent variation and delayed speed response.
      const target = -.45*Math.exp(-mid/90)+.12*mid/totalTime+.75*hrWave(mid)+2*(settings.pace/e.pace-1);
      filtered = filtered === null ? target : filtered+(target-filtered)*(1-Math.exp(-e.dt/25));
      time += e.dt; return filtered;
    });
    const deltas = centered(values, edges.map(e=>e.dt), settings.heartRateDeviation-Math.abs(heartRateBias), .9*Math.min(1,totalTime/180));
    edges.forEach((e,i)=>{ e.heartRate=settings.heartRate+heartRateBias+deltas[i]; });
  }
  let micros = 0, steps = 0, weightedCadence = 0, edgeIndex = 0, minStep = Infinity, maxStep = 0;
  const tracks = sampled.segments.map((seg, s) => {
    if (s) micros++; // Explicit discontinuity, no distance or simulated running between tracks.
    const firstEdge = edges[edgeIndex];
    const initial = firstEdge?.segment === s ? firstEdge : null;
    const out = [{ ...seg[0], elapsedMicros: micros, pace: initial?.pace ?? settings.pace, speed: initial?.speed ?? 0, cadence: initial?.cadence ?? settings.cadence, stepLength: initial?.stepLength ?? 0, ...(settings.heartRateEnabled ? {heartRate:initial.heartRate} : {}) }];
    for (let i = 1; i < seg.length; i++) {
      const e = edges[edgeIndex++];
      const dtMicros = Math.max(1, Math.round(e.dt * 1e6));
      micros += dtMicros;
      const dt = dtMicros / 1e6;
      // Non-moving duplicates get an ordering tick but no steps or speed.
      const moving = e.length > 0;
      steps += moving ? e.cadence * dt / 60 : 0;
      weightedCadence += e.cadence * dt;
      if (moving) { minStep = Math.min(minStep, e.stepLength); maxStep = Math.max(maxStep, e.stepLength); }
      out.push({ ...seg[i], elapsedMicros: micros, pace: e.pace, speed: moving ? e.speed : 0, cadence: e.cadence, stepLength: moving ? e.stepLength : 0, ...(settings.heartRateEnabled ? {heartRate:e.heartRate} : {}) });
    }
    return out;
  });
  const duration = micros / 1e6;
  const avgPace = duration * 1000 / sampled.distance;
  const activeDuration = (micros - (tracks.length - 1)) / 1e6;
  const avgCadence = weightedCadence / activeDuration;
  if (Math.abs(avgPace - (settings.pace+paceBias)) > 1 || Math.abs(avgCadence - settings.cadence) > .01) throw new Error('Слишком плотные точки для точных временных меток. Используйте менее плотный GPX.');
  if (!Number.isSafeInteger(micros) || !Number.isFinite(new Date(new Date(settings.start).getTime() + duration * 1000).getTime())) throw new Error('Продолжительность маршрута выходит за допустимый диапазон.');
  const avgHeartRate = settings.heartRateEnabled ? edges.reduce((sum,e)=>sum+e.heartRate*e.dt,0)/totalTime : null;
  // Coarse running energy estimate: 1 kcal/kg/km, fixed reference mass 70 kg (no personal data).
  const calories = Math.round(sampled.distance/1000*70);
  return { tracks, distance: sampled.distance, duration, avgPace, paceBias, avgCadence, avgHeartRate, heartRateBias, calories, steps, minStep, maxStep, settings: { ...settings }, pointCount: sampled.count };
}
export function paceText(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function durationText(seconds) {
  const s = Math.round(seconds);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
