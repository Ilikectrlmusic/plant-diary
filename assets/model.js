export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  return y >= 1970 && y <= 9999 && dateKey(new Date(y, m - 1, d)) === key;
}
export function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const length = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length }, (_, i) => {
    const date = new Date(year, month, 1 - offset + i);
    return { key: dateKey(date), day: date.getDate(), inMonth: date.getMonth() === month };
  });
}
const validPhoto = path => typeof path === 'string' && /^photos\/[\w-]+\.(?:jpg|jpeg|webp|png)$/.test(path);
export function validateData(data) {
  if (!data || data.schemaVersion !== 1 || !data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) {
    throw new Error('日记文件格式不正确。为保护记录，已停止读取与保存。');
  }
  const entries = {};
  for (const [key, e] of Object.entries(data.entries)) {
    if (!validDate(key) || !e || typeof e.title !== 'string' || e.title.length > 60 ||
      typeof e.note !== 'string' || e.note.length > 10000 || !validPhoto(e.image) ||
      !validPhoto(e.thumbnail) || typeof e.updatedAt !== 'string' || !Number.isFinite(Date.parse(e.updatedAt))) {
      throw new Error(`${key} 的日记格式不正确，请检查仓库中的原始记录。`);
    }
    entries[key] = { title: e.title, note: e.note, image: e.image, thumbnail: e.thumbnail, updatedAt: e.updatedAt };
  }
  return { schemaVersion: 1, entries };
}
export function sameEntry(a, b) {
  if (!a || !b) return !a && !b;
  return ['title', 'note', 'image', 'thumbnail', 'updatedAt'].every(k => a[k] === b[k]);
}
export function mergeEntry(latest, key, entry, original) {
  if (!validDate(key)) throw new Error('请选择有效日期。');
  if (!sameEntry(latest.entries[key], original)) {
    const error = new Error('这一天已在其他设备更新。你的文字和照片仍保留在编辑框中，请先核对云端版本。');
    error.code = 'CONFLICT';
    throw error;
  }
  const entries = { ...latest.entries };
  if (entry === null) delete entries[key];
  else entries[key] = entry;
  return validateData({ schemaVersion: 1, entries });
}
export function encodeJSON(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function decodeJSON(content) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content.replace(/\s/g, '')), c => c.charCodeAt(0))));
}
