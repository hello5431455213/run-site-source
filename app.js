import { parseGPX, LIMITS } from './gpx.js';
import { parsePace, paceText, durationText, validateSettings, simulate } from './simulation.js?v=10';
import { downloadTCX } from './tcx.js?v=10';
import { encodeProfile, decodeProfile, newRandomSeed } from './profile.js?v=10';
import { zonedStart, parseZonedStart } from './time.js?v=10';
import { prepareExport } from './export-profile.js?v=10';
const $ = id => document.getElementById(id);
let route = null, result = null, map = null, mapLayer = null, busy = false, revision = 0, importId = 0;
const fields = ['start', 'timeZone', 'pace', 'paceDeviation', 'cadence', 'cadenceDeviation', 'heartRateEnabled', 'heartRate', 'heartRateDeviation', 'seed'];
const storageKey = 'stride-lab-settings-v1';
let profileRandom = newRandomSeed();
let restoredStart = null;
const charts = [{ id: 'pace-chart', key: 'pace', color: '#21967c', label: 'Темп', format: paceText }, { id: 'cadence-chart', key: 'cadence', color: '#c18e44', label: 'Каденс', format: v => format(v, 1) }, { id: 'speed-chart', key: 'speed', color: '#659cae', label: 'Скорость', format: v => format(v, 2) }, {id:'hr-chart',key:'heartRate',color:'#c96a78',label:'Пульс',format:v=>format(v)}];
const format = (v, digits = 0) => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits });
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function setTheme(theme) { document.documentElement.dataset.theme = theme; $('theme').setAttribute('aria-label', theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'); try { localStorage.setItem('stride-lab-theme', theme); } catch {} drawCharts(); }
let savedTheme;
try { savedTheme = localStorage.getItem('stride-lab-theme'); } catch {}
setTheme(savedTheme === 'dark' || (!savedTheme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
$('theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
const now = new Date();
$('start').value = zonedStart(now.toISOString(),$('timeZone').value);
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
  for (const id of fields) if (id==='heartRateEnabled') $(id).checked=saved[id]===true; else if (typeof saved[id] === 'string') $(id).value = saved[id];
} catch {}
let previousZone=$('timeZone').value || 'Europe/Kyiv';
function restoreProfile(s) {
  restoredStart = s.start;
  $('timeZone').value=s.timeZone || 'Europe/Kyiv';previousZone=$('timeZone').value;
  $('start').value = zonedStart(s.start,$('timeZone').value); $('pace').value = paceText(s.pace);
  for (const id of ['paceDeviation','cadence','cadenceDeviation']) $(id).value = s[id];
  $('heartRateEnabled').checked=!!s.heartRateEnabled;
  $('heartRate').value=s.heartRate ?? 145;$('heartRateDeviation').value=s.heartRateDeviation ?? 12;
  profileRandom = s.seed;
  $('seed').value = encodeProfile(s); $('seed').setCustomValidity('');
}
try {
  if (/^RUN[12]\|/.test($('seed').value)) restoreProfile(decodeProfile($('seed').value));
  else if ($('seed').value.trim() && !['run-2026','stride-2026'].includes($('seed').value.trim())) profileRandom = $('seed').value.trim();
} catch { /* Invalid saved code must not prevent the rest of the page from working. */ }
// An explicit paste may enable HR; reopening the page always starts with HR off.
$('heartRateEnabled').checked=false;
function persist() { try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(fields.map(id => [id, id==='heartRateEnabled' ? $(id).checked : $(id).value])))); } catch {} }
function rawSettings() {
  const timeZone=$('timeZone').value;
  const start = restoredStart && zonedStart(restoredStart,timeZone)===$('start').value ? restoredStart : parseZonedStart($('start').value,timeZone);
  const s = { start, timeZone, pace:parsePace($('pace').value), paceDeviation:Number($('paceDeviation').value), cadence:Number($('cadence').value), cadenceDeviation:Number($('cadenceDeviation').value), heartRateEnabled:$('heartRateEnabled').checked, heartRate:Number($('heartRate').value), heartRateDeviation:Number($('heartRateDeviation').value), seed:profileRandom };
  validateSettings(s); return s;
}
function syncProfile() {
  try { $('seed').value=encodeProfile(rawSettings()); $('seed').setCustomValidity(''); } catch { /* Keep the last complete code while a parameter is being edited. */ }
}
function updateBounds() {
  try { const p = parsePace($('pace').value), d = Number($('paceDeviation').value); $('pace-bounds').textContent = `Диапазон ${paceText(p - d)} — ${paceText(p + d)} мин/км`; $('pace-range').value = p; } catch { $('pace-bounds').textContent = 'Введите темп в формате MM:SS'; }
  const c = Number($('cadence').value), d = Number($('cadenceDeviation').value);
  $('cadence-bounds').textContent = `Диапазон ${c - d} — ${c + d} шаг/мин · обе ноги`;
  for (const id of ['paceDeviation', 'cadence', 'cadenceDeviation']) $(`${id}-range`).value = $(id).value;
  for(const id of ['heartRate','heartRateDeviation']) $(`${id}-range`).value=$(id).value;
  $('hr-fields').hidden=!$('heartRateEnabled').checked;
  for(const id of ['heartRate','heartRateDeviation']) $(id).disabled=!$('heartRateEnabled').checked;
  const hr=Number($('heartRate').value),hrd=Number($('heartRateDeviation').value);
  $('hr-bounds').textContent=`Диапазон ${hr-hrd} — ${hr+hrd} уд/мин`;
}
function buttons() {
  $('generate').disabled = !route || busy; $('regenerate').disabled = !route || busy; $('download').disabled = !result || busy;
  $('preview').hidden = !route;
  $('map-panel').hidden = !route;
  $('profile-panel').hidden = !result;
  $('export').hidden = !result;
}
function invalidate() { revision++; result = null; buttons(); $('preview-state').textContent = route ? 'Нужна генерация' : 'Ожидает GPX'; for (const id of ['duration', 'avg-pace', 'avg-cadence', 'steps-total']) $(id).textContent = '—'; $('consistency').textContent = 'Настройки изменены. Сгенерируйте новый профиль.'; drawCharts(); }
for (const id of fields.filter(id=>id!=='seed')) $(id).addEventListener('input', () => {
  if(id==='timeZone') {
    try { const instant=restoredStart || parseZonedStart($('start').value,previousZone);restoredStart=instant;$('start').value=zonedStart(instant,$('timeZone').value); } catch {restoredStart=null;}
    previousZone=$('timeZone').value;
  }
  if(id==='start') restoredStart=null; updateBounds(); syncProfile(); persist(); invalidate();
});
$('seed').addEventListener('input', () => {
  const code=$('seed').value.trim();
  try {
    if (/^RUN[12]\|/.test(code)) { restoreProfile(decodeProfile(code)); updateBounds(); status('Код применён: параметры и часовой пояс восстановлены. Для того же профиля загрузите тот же GPX.'); }
    else if (/^RUN\d+\|/.test(code)) throw new Error('Эта версия кода настроек не поддерживается.');
    else if (code && code.length<=80) { profileRandom=code; $('seed').setCustomValidity(''); }
    else throw new Error('Вставьте полный код RUN2| или seed длиной до 80 символов.');
    persist(); invalidate();
  } catch(error) { $('seed').setCustomValidity(error.message); status(error.message,true); invalidate(); }
});
$('seed').addEventListener('change', () => { if ($('seed').validity.valid) { syncProfile();persist(); } });
$('copy-seed').onclick = async () => {
  try { settings(); persist(); }
  catch(error) { status(error.message,true); return; }
  try { await navigator.clipboard.writeText($('seed').value); status('Код настроек скопирован.'); }
  catch { $('seed').select(); status('Код выделен. Скопируйте его через меню устройства или Ctrl+C.'); }
};
for (const id of ['pace', 'paceDeviation', 'cadence', 'cadenceDeviation','heartRate','heartRateDeviation']) $(`${id}-range`).oninput = event => { $(id).value = id === 'pace' ? paceText(Number(event.target.value)) : event.target.value; $(id).dispatchEvent(new Event('input')); };
updateBounds();
syncProfile(); persist();
function settings() {
  for (const input of $('form').querySelectorAll('input,textarea,select')) {
    if (!input.validity.valid) input.closest('details')?.setAttribute('open', '');
  }
  if (!$('form').reportValidity()) throw new Error('Проверьте заполнение полей настройки.');
  const s=rawSettings();
  s.profileCode=encodeProfile(s); $('seed').value=s.profileCode;
  return s;
}
function showRoute(name) {
  invalidate();
  $('route-info').hidden = false;
  $('route-info').textContent = `${name} · ${format(route.distance / 1000, 2)} км · ${format(route.pointCount)} точек`;
  $('distance').textContent = format(route.distance / 1000, 2);
  $('map-detail').textContent = route.segments.length > 1 ? `${route.segments.length} отдельных сегмента — разрывы не соединяются` : '';
  renderMap(); buttons();
}
async function importFile(file) {
  if (!file || busy) return;
  const token = ++importId;
  busy = true; invalidate(); route = null; buttons(); $('route-info').hidden = true; $('distance').textContent = '—'; clearMap();
  status('Читаем и проверяем GPX…');
  try {
    if (file.size > LIMITS.bytes) throw new Error('Размер GPX превышает 32 МБ.');
    const text = await file.text();
    await new Promise(resolve => setTimeout(resolve, 20));
    const parsed = parseGPX(text);
    if (token !== importId) return;
    route = parsed; showRoute(file.name); status('Маршрут загружен. Настройте параметры и сгенерируйте тренировку.');
  } catch (error) { if (token === importId) { route = null; result = null; status(error.message, true); $('preview-state').textContent = 'Ошибка GPX'; } }
  finally { busy = false; buttons(); $('file').value = ''; }
}
$('file').onchange = event => importFile(event.target.files[0]);
for (const type of ['dragover', 'dragleave', 'drop']) $('dropzone').addEventListener(type, event => { event.preventDefault(); $('dropzone').classList.toggle('drag', type === 'dragover'); if (type === 'drop') importFile(event.dataTransfer.files[0]); });

function clearMap() {
  if (mapLayer && map) { map.removeLayer(mapLayer); mapLayer = null; }
}
function renderMap() {
  if (!globalThis.L) { $('map').innerHTML = '<div class="map-empty"><strong>Карта недоступна</strong><p>Не удалось загрузить Leaflet через CDN.<br>Генерация и экспорт работают без карты.</p></div>'; return; }
  if (!map) {
    $('map').replaceChildren();
    map = L.map('map', { preferCanvas: true, worldCopyJump: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
  }
  clearMap();
  // Unwrap longitudes for display only. Source and TCX coordinates stay unchanged.
  const segments = route.segments.map(seg => { let prev = seg[0].lon; return seg.map(p => { let lon = p.lon; while (lon - prev > 180) lon -= 360; while (lon - prev < -180) lon += 360; prev = lon; return [p.lat, lon]; }); });
  mapLayer = L.featureGroup(segments.map(seg => L.polyline(seg, { color: '#168873', weight: 4, opacity: .9, smoothFactor: .5 }))).addTo(map);
  const first = segments[0][0], last = segments.at(-1).at(-1);
  L.circleMarker(first, { radius: 6, color: '#fff', weight: 2, fillColor: '#168873', fillOpacity: 1 }).bindTooltip('Старт').addTo(mapLayer);
  L.circleMarker(last, { radius: 6, color: '#fff', weight: 2, fillColor: '#d8a748', fillOpacity: 1 }).bindTooltip('Финиш').addTo(mapLayer);
  map.fitBounds(mapLayer.getBounds(), { padding: [28, 28], maxZoom: 16 });
}
function computeInWorker(s) {
  if (!globalThis.Worker) return Promise.resolve().then(() => prepareExport(simulate(route, s)));
  return new Promise((resolve, reject) => {
    const worker = new Worker('./simulation-worker.js?v=10', { type: 'module' });
    worker.onmessage = ({ data }) => { worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data.result); };
    worker.onerror = () => { worker.terminate(); reject(new Error('Не удалось запустить симуляцию. Откройте сайт через HTTP/HTTPS и проверьте наличие simulation-worker.js.')); };
    worker.postMessage({ route, settings: s });
  });
}
async function generate() {
  if (!route || busy) return;
  try {
    const s = settings(), token = revision;
    busy = true; buttons(); status('Создаём плавный профиль и проверяем средние значения…');
    await new Promise(resolve => setTimeout(resolve, 20));
    const next = await computeInWorker(s);
    if (token !== revision) { status('Настройки изменились во время расчёта. Запустите генерацию ещё раз.'); return; }
    result = next; persist();
    $('export-info').textContent=result.exportSamplingSeconds ? `GPS каждые ${result.exportSamplingSeconds} с. Время приведено к целым секундам: изменение ${format(result.exportTimeAdjustment,3)} с. Карточки и графики показывают данные скачиваемого файла.` : result.exportReason;
    $('duration').textContent = durationText(result.duration); $('avg-pace').textContent = paceText(result.avgPace); $('avg-cadence').textContent = format(result.avgCadence, 1); $('steps-total').textContent = format(Math.round(result.steps));
    $('calories').textContent=format(result.calories);
    $('hr-metric').hidden=!s.heartRateEnabled;$('hr-chart-block').hidden=!s.heartRateEnabled;
    $('avg-hr').textContent=s.heartRateEnabled ? format(result.avgHeartRate) : '—';
    $('preview-state').textContent = 'Профиль готов';
    const unusual = result.minStep < .25 || result.maxStep > 2.5;
    $('consistency').textContent = `${unusual ? '⚠ Необычная длина шага: проверьте сочетание темпа и каденса.' : '✓ Скорость, каденс и шаг согласованы.'} Длина шага ${format(result.minStep, 2)}–${format(result.maxStep, 2)} м. Средний темп отличается от ориентира на ${format(result.avgPace - s.pace, 1)} с/км. ${format(result.pointCount)} точек экспорта.`;
    buttons(); drawCharts(); status('Тренировка готова. Проверьте графики и скачайте TCX.');
  } catch (error) { status(error.message, true); }
  finally { busy = false; buttons(); }
}
$('form').onsubmit = event => { event.preventDefault(); generate(); };
$('regenerate').onclick = () => { profileRandom=newRandomSeed(); syncProfile(); invalidate(); persist(); generate(); };
$('download').onclick = () => { if (!result) return; try { status('Проверяем XML и создаём файл…'); downloadTCX(result); status('TCX проверен. Файл передан браузеру для скачивания.'); } catch (error) { status(error.message, true); } };
function chartData() {
  if (!result) return [];
  // Bound drawing work, preserve individual tracks so the charts do not span gaps.
  const stride = Math.max(1, Math.ceil(result.pointCount / 1600));
  return result.tracks.map(track => track.filter((_, i) => i === 0 || i === track.length - 1 || i % stride === 0));
}
function drawCharts() {
  if (typeof charts === 'undefined') return;
  const tracks = chartData();
  for (const chart of charts) if(chart.key!=='heartRate' || result?.settings.heartRateEnabled) drawChart(chart, tracks);
}
function drawChart(chart, tracks, hover) {
  const canvas = $(chart.id); if (!canvas) return;
  const width = canvas.clientWidth, height = 124, dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = width * dpr; canvas.height = height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), muted = css.getPropertyValue('--muted'), line = css.getPropertyValue('--line');
  ctx.font = '9px sans-serif'; ctx.fillStyle = muted;
  if (!tracks.length) { canvas.setAttribute('aria-label', `${chart.label}: профиль ещё не сгенерирован`); ctx.textAlign = 'center'; ctx.fillText('Профиль появится после генерации', width / 2, 65); return; }
  let min = Infinity, max = -Infinity;
  for (const t of tracks) for (const p of t) { min = Math.min(min, p[chart.key]); max = Math.max(max, p[chart.key]); }
  const pad = Math.max((max - min) * .22, chart.key === 'pace' ? 3 : chart.key === 'cadence' ? 1 : .05);
  min -= pad; max += pad;
  const left = 40, right = width - 12, top = 12, bottom = 99;
  const x = p => left + p.distance / result.distance * (right - left), y = p => bottom - (p[chart.key] - min) / (max - min) * (bottom - top);
  for (let i = 0; i < 3; i++) { const yy = top + i * (bottom - top) / 2; ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillStyle = muted; ctx.fillText(chart.format(max - i * (max - min) / 2), left - 7, yy + 3); }
  for (let i = 0; i <= 4; i++) { ctx.textAlign = i === 4 ? 'right' : i === 0 ? 'left' : 'center'; ctx.fillText(`${format(result.distance / 1000 * i / 4, 1)} км`, left + (right - left) * i / 4, 119); }
  for (const track of tracks) { ctx.strokeStyle = chart.color; ctx.lineWidth = 2; ctx.beginPath(); track.forEach((p, i) => i ? ctx.lineTo(x(p), y(p)) : ctx.moveTo(x(p), y(p))); ctx.stroke(); ctx.lineTo(x(track.at(-1)), bottom); ctx.lineTo(x(track[0]), bottom); ctx.closePath(); ctx.fillStyle = chart.color + '13'; ctx.fill(); }
  canvas.setAttribute('aria-label', `${chart.label}: от ${chart.format(min + pad)} до ${chart.format(max - pad)}, дистанция ${format(result.distance / 1000, 2)} км`);
  if (hover !== undefined) {
    let nearest = null, diff = Infinity;
    for (const t of tracks) for (const p of t) if (Math.abs(x(p) - hover) < diff) { diff = Math.abs(x(p) - hover); nearest = p; }
    ctx.strokeStyle = chart.color; ctx.beginPath(); ctx.moveTo(x(nearest), top); ctx.lineTo(x(nearest), bottom); ctx.stroke(); ctx.textAlign = 'left'; ctx.fillStyle = css.getPropertyValue('--text'); ctx.fillText(`${chart.format(nearest[chart.key])} · ${format(nearest.distance / 1000, 2)} км`, Math.min(Math.max(left, x(nearest) + 8), right - 115), 9);
  }
}
for (const chart of charts) { $(chart.id).onpointermove = event => { if (result) drawChart(chart, chartData(), event.clientX - $(chart.id).getBoundingClientRect().left); }; $(chart.id).onpointerleave = () => drawChart(chart, chartData()); }
new ResizeObserver(() => { drawCharts(); map?.invalidateSize(); }).observe($('map-panel'));
new ResizeObserver(() => drawCharts()).observe($('preview'));
drawCharts();
