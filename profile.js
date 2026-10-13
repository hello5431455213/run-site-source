import { parsePace, paceText, validateSettings } from './simulation.js?v=10';
export function newRandomSeed() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return Array.from(values, v => v.toString(16).padStart(8, '0')).join('-');
}
export function encodeProfile(settings) {
  validateSettings(settings);
  return `RUN2|start=${new Date(settings.start).toISOString()}|zone=${settings.timeZone || 'Europe/Kyiv'}|pace=${paceText(settings.pace)}|paceDeviation=${settings.paceDeviation}|cadence=${settings.cadence}|cadenceDeviation=${settings.cadenceDeviation}|hr=${settings.heartRateEnabled ? 1 : 0}|heartRate=${settings.heartRate ?? 145}|heartRateDeviation=${settings.heartRateDeviation ?? 12}|random=${encodeURIComponent(settings.seed)}`;
}
export function decodeProfile(code) {
  if (typeof code !== 'string' || code.length > 2048 || !/^RUN[12]\|/.test(code)) throw new Error('Вставьте полный код настроек RUN2| (или старый RUN1|).');
  const legacy = code.startsWith('RUN1|');
  const fields = Object.create(null);
  for (const item of code.trim().split('|').slice(1)) {
    const index = item.indexOf('=');
    if (index < 1) throw new Error('Код настроек повреждён.');
    const key = item.slice(0, index);
    if (Object.hasOwn(fields, key)) throw new Error('В коде настроек повторяются поля.');
    fields[key] = item.slice(index + 1);
  }
  const required = ['start', 'pace', 'paceDeviation', 'cadence', 'cadenceDeviation', 'random', ...(legacy ? [] : ['zone','hr','heartRate','heartRateDeviation'])];
  if (Object.keys(fields).length !== required.length || required.some(k => !Object.hasOwn(fields, k))) throw new Error('В коде настроек отсутствуют обязательные поля.');
  const integer = key => {
    if (!/^\d+$/.test(fields[key])) throw new Error('В коде настроек неверное числовое значение.');
    return Number(fields[key]);
  };
  const date = new Date(fields.start);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/.test(fields.start) || !Number.isFinite(date.getTime()) || date.toISOString() !== fields.start) throw new Error('В коде должна быть корректная UTC-дата с точностью до минуты.');
  let seed;
  try { seed = decodeURIComponent(fields.random); } catch { throw new Error('В коде повреждено значение random.'); }
  const settings = { start: fields.start, pace: parsePace(fields.pace), paceDeviation: integer('paceDeviation'), cadence: integer('cadence'), cadenceDeviation: integer('cadenceDeviation'), seed };
  settings.timeZone=legacy ? 'Europe/Kyiv' : fields.zone;
  if (!legacy && !['0','1'].includes(fields.hr)) throw new Error('Неверный переключатель пульса.');
  settings.heartRateEnabled=!legacy && fields.hr==='1';
  settings.heartRate=legacy ? 145 : integer('heartRate');
  settings.heartRateDeviation=legacy ? 12 : integer('heartRateDeviation');
  // Validate dormant fields too, so a pasted code cannot populate invalid controls.
  validateSettings({...settings,heartRateEnabled:true});
  validateSettings(settings);
  return settings;
}
