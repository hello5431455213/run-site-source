// All coordinates remain in source order; disconnected segments never contribute distance.
export const LIMITS = { bytes: 32 * 1024 * 1024, points: 200000, samples: 350000 };
export function haversine(a, b) {
  const rad = Math.PI / 180;
  const u = Math.sin((b.lat - a.lat) * rad / 2);
  const v = Math.sin((b.lon - a.lon) * rad / 2);
  const h = u * u + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * v * v;
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}
const children = (el, name) => Array.from(el.children).filter(n => n.localName === name);
export function parseGPX(text) {
  if (typeof text !== 'string' || new Blob([text]).size > LIMITS.bytes) throw new Error('Размер GPX превышает 32 МБ.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTD и XML-сущности не разрешены.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'gpx') throw new Error('Некорректный XML: ожидается GPX-файл.');
  const ns = doc.documentElement.namespaceURI;
  if (ns && !['http://www.topografix.com/GPX/1/0', 'http://www.topografix.com/GPX/1/1'].includes(ns)) throw new Error('Неизвестное пространство имён GPX.');
  const segments = [];
  let count = 0;
  const read = (parent, name) => {
    const points = children(parent, name).map(el => {
      if (++count > LIMITS.points) throw new Error('Допустимо до 200 000 исходных точек.');
      const latText = el.getAttribute('lat'), lonText = el.getAttribute('lon');
      const lat = Number(latText), lon = Number(lonText);
      if (latText === null || lonText === null || !latText.trim() || !lonText.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error(`Некорректные координаты в точке ${count}.`);
      const ele = children(el, 'ele')[0];
      const alt = ele ? Number(ele.textContent) : undefined;
      if (ele && (!ele.textContent.trim() || !Number.isFinite(alt))) throw new Error(`Некорректная высота в точке ${count}.`);
      return { lat, lon, ...(ele ? { alt } : {}) };
    });
    if (points.length) segments.push(points);
  };
  for (const el of doc.documentElement.children) {
    if (el.localName === 'trk') for (const seg of children(el, 'trkseg')) read(seg, 'trkpt');
    if (el.localName === 'rte') read(el, 'rtept');
  }
  return measureRoute(segments);
}
export function measureRoute(segments) {
  let distance = 0, pointCount = 0;
  for (const segment of segments) {
    pointCount += segment.length;
    for (let i = 1; i < segment.length; i++) distance += haversine(segment[i - 1], segment[i]);
  }
  if (pointCount < 2 || distance < 1) throw new Error('Маршрут должен содержать хотя бы две точки и 1 метр пути внутри сегментов.');
  return { segments, distance, pointCount };
}
// Spherical interpolation follows the short great-circle arc, including the date line.
export function interpolate(a, b, f) {
  if (f === 0) return { ...a };
  if (f === 1) return { ...b };
  const r = Math.PI / 180;
  const xyz = p => [Math.cos(p.lat * r) * Math.cos(p.lon * r), Math.cos(p.lat * r) * Math.sin(p.lon * r), Math.sin(p.lat * r)];
  const x = xyz(a), y = xyz(b);
  const angle = Math.acos(Math.max(-1, Math.min(1, x.reduce((s, v, i) => s + v * y[i], 0))));
  if (angle > Math.PI - 1e-6) throw new Error('Противоположные GPS-точки: направление интерполяции неоднозначно.');
  const k = angle < 1e-8 ? 1 - f : Math.sin((1 - f) * angle) / Math.sin(angle);
  const l = angle < 1e-8 ? f : Math.sin(f * angle) / Math.sin(angle);
  const z = x.map((v, i) => k * v + l * y[i]);
  return { lat: Math.atan2(z[2], Math.hypot(z[0], z[1])) / r, lon: Math.atan2(z[1], z[0]) / r,
    ...(a.alt !== undefined && b.alt !== undefined ? { alt: a.alt + (b.alt - a.alt) * f } : {}) };
}
export function sampleRoute(route) {
  // Adaptive spacing bounds memory while retaining every original point.
  const spacing = Math.max(10, route.distance / Math.max(1, LIMITS.samples - route.pointCount));
  let distance = 0, count = 0;
  const segments = route.segments.map(source => {
    const result = [{ ...source[0], distance }];
    count++;
    for (let i = 1; i < source.length; i++) {
      const a = source[i - 1], b = source[i], length = haversine(a, b);
      const n = Math.max(1, Math.ceil(length / spacing));
      for (let j = 1; j <= n; j++) {
        if (++count > LIMITS.samples) throw new Error('Слишком много точек для предпросмотра. Разделите GPX на части.');
        result.push({ ...interpolate(a, b, j / n), distance: distance + length * j / n });
      }
      distance += length;
    }
    return result;
  });
  return { segments, distance, count };
}
