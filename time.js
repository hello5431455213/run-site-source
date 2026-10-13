export const TIME_ZONES = ['Europe/Kyiv', 'Europe/Berlin'];
const formatter = zone => new Intl.DateTimeFormat('en-GB', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
function parts(instant, zone) {
  const values = Object.fromEntries(formatter(zone).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}
export function zonedStart(instant, zone='Europe/Kyiv') {
  if (!TIME_ZONES.includes(zone)) throw new Error('Неизвестный часовой пояс.');
  return parts(instant,zone).slice(0,16);
}
export function parseZonedStart(value, zone='Europe/Kyiv') {
  if (!TIME_ZONES.includes(zone) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) throw new Error('Укажите дату и время начала.');
  const wall = Date.parse(value+':00Z');
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0,16)!==value) throw new Error('Некорректная дата.');
  const offsets = new Set();
  for(let hour=-36;hour<=36;hour+=6) {
    const probe=wall+hour*3600000;
    offsets.add(Date.parse(parts(probe,zone)+'Z')-probe);
  }
  const candidates=[...offsets].map(offset=>wall-offset).filter(t=>zonedStart(t,zone)===value).sort((a,b)=>a-b);
  if (!candidates.length) throw new Error('Такого времени нет из-за перехода на летнее время. Выберите другое время.');
  // If the clock repeats in autumn, manual entry selects the first occurrence.
  return new Date(candidates[0]).toISOString();
}
