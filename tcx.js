import { prepareExport } from './export-profile.js?v=10';
export const TCX_NS = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2';
export const AX_NS = 'http://www.garmin.com/xmlschemas/ActivityExtension/v2';
const escape = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
export function timestamp(start, elapsedMicros) {
  const base = new Date(start).getTime();
  const ms = Math.floor(elapsedMicros / 1000), us = elapsedMicros % 1000;
  return new Date(base + ms).toISOString().replace('Z', `${String(us).padStart(3, '0')}Z`);
}
export function createTCX(input) {
  const result=prepareExport(input);
  const { settings: s } = result;
  const time = us => result.exportSamplingSeconds ? timestamp(s.start, us).replace(/\.000000Z$/, 'Z') : timestamp(s.start, us);
  const start = time(0);
  const tracks = result.tracks.map(track => '<Track>' + track.map(p => `<Trackpoint><Time>${time(p.elapsedMicros)}</Time><Position><LatitudeDegrees>${p.lat.toFixed(9)}</LatitudeDegrees><LongitudeDegrees>${p.lon.toFixed(9)}</LongitudeDegrees></Position>${p.alt !== undefined ? `<AltitudeMeters>${p.alt.toFixed(3)}</AltitudeMeters>` : ''}<DistanceMeters>${p.distance.toFixed(6)}</DistanceMeters>${s.heartRateEnabled ? `<HeartRateBpm><Value>${Math.round(p.heartRate)}</Value></HeartRateBpm>` : ''}<Extensions><ax:TPX><ax:Speed>${p.speed.toFixed(6)}</ax:Speed></ax:TPX></Extensions></Trackpoint>`).join('') + '</Track>').join('');
  let maxSpeed = 0;
  for (const track of result.tracks) for (const p of track) { maxSpeed = Math.max(maxSpeed, p.speed); }
  const notes = `SYNTHETIC TEST DATA. Not a real run. Estimated steps: ${Math.round(result.steps)}. Calories estimate: ${result.calories} kcal, reference mass 70 kg, 1 kcal/kg/km. ${s.heartRateEnabled ? 'Heart rate is simulated. ' : ''}Seed: ${s.seed}.`;
  const rootAttrs = `xmlns:ax="${AX_NS}"`;
  const lapExtensions = `<Extensions><ax:LX><ax:AvgSpeed>${(result.distance / result.duration).toFixed(6)}</ax:AvgSpeed>${result.steps <= 65535 ? `<ax:Steps>${Math.round(result.steps)}</ax:Steps>` : ''}</ax:LX></Extensions>`;
  let heartSummary='';
  if(s.heartRateEnabled) {
    let max=0;for(const track of result.tracks) for(const p of track) max=Math.max(max,p.heartRate);
    heartSummary=`<AverageHeartRateBpm><Value>${Math.round(result.avgHeartRate)}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${Math.round(max)}</Value></MaximumHeartRateBpm>`;
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<TrainingCenterDatabase xmlns="${TCX_NS}" ${rootAttrs}><Activities><Activity Sport="Running"><Id>${start}</Id><Lap StartTime="${start}"><TotalTimeSeconds>${result.duration.toFixed(6)}</TotalTimeSeconds><DistanceMeters>${result.distance.toFixed(6)}</DistanceMeters><MaximumSpeed>${maxSpeed.toFixed(6)}</MaximumSpeed><Calories>${Math.min(65535,result.calories)}</Calories>${heartSummary}<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>${tracks}${lapExtensions}</Lap><Notes>${escape(notes)}</Notes></Activity></Activities></TrainingCenterDatabase>`;
  validateTCX(xml);
  return xml;
}
export function validateTCX(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Недопустимые объявления XML.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Ошибка структуры XML.');
  const get = name => Array.from(doc.getElementsByTagNameNS(TCX_NS, name));
  if (doc.documentElement.localName !== 'TrainingCenterDatabase' || doc.documentElement.namespaceURI !== TCX_NS || !get('Activities').length || get('Activity')[0]?.getAttribute('Sport') !== 'Running' || !get('Lap').length || !get('Track').length) throw new Error('Некорректная структура TCX.');
  let last = null, distance = -1;
  for (const p of get('Trackpoint')) {
    const text = p.getElementsByTagNameNS(TCX_NS, 'Time')[0]?.textContent;
    const match = /^(.*\.)(\d{6})Z$/.exec(text ?? '');
    const ms = match ? Date.parse(`${match[1]}${match[2].slice(0, 3)}Z`) : Date.parse(text);
    const time = Number.isFinite(ms) ? BigInt(ms) * 1000n + BigInt(match ? match[2].slice(3) : 0) : null;
    const d = Number(p.getElementsByTagNameNS(TCX_NS, 'DistanceMeters')[0]?.textContent);
    const lat = Number(p.getElementsByTagNameNS(TCX_NS, 'LatitudeDegrees')[0]?.textContent);
    const lon = Number(p.getElementsByTagNameNS(TCX_NS, 'LongitudeDegrees')[0]?.textContent);
    const speed = Number(p.getElementsByTagNameNS(AX_NS, 'Speed')[0]?.textContent);
    const hr=p.getElementsByTagNameNS(TCX_NS,'HeartRateBpm')[0];
    if(hr) { const v=Number(hr.getElementsByTagNameNS(TCX_NS,'Value')[0]?.textContent);if(!Number.isInteger(v)||v<1||v>254) throw new Error('Некорректный пульс TCX.'); }
    if (time === null || (last !== null && time <= last) || !Number.isFinite(d) || d < distance || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(speed) || speed < 0) throw new Error('Некорректные данные Trackpoint.');
    last = time; distance = d;
  }
  if (get('Trackpoint').length < 2) throw new Error('Недостаточно точек TCX.');
  return doc;
}
export function downloadTCX(result) {
  const xml = createTCX(result), url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.garmin.tcx+xml;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `run-${new Date(result.settings.start).toISOString().replace(/[:.]/g, '-')}.tcx`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
