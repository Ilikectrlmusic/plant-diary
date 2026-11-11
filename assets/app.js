import { dateKey, validDate, monthCells } from './model.js';
import { getToken, setToken, disconnect, readCloud, readPublished, verifyToken, saveEntry, photoURL } from './cloud.js';
import { preparePhoto } from './photos.js';

const $ = id => document.getElementById(id);
const today = dateKey();
const current = new Date();
let month = new Date(current.getFullYear(), current.getMonth(), 1);
let data = null;
let selected = today;
let original = null;
let photo = null;
let dirty = false;
let busy = false;
let photoBusy = false;
let photoGeneration = 0;
let verified = false;
let loading = false;
let detailDate = today;
let detailData = null;
let pendingSave = false;
let pendingAttempt = null;
let toastTimer;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(name, extraClass = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icon ${extraClass}`);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
function formatDate(key, options = {}) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', ...options }).format(new Date(y, m - 1, d));
}
function status(id, message, tone = '') {
  $(id).textContent = message;
  $(id).className = id === 'load-status' ? tone : `form-status ${tone}`;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').querySelector('span').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}
function updateConnection() {
  $('connection-button').classList.toggle('connected', verified);
  $('connection-label').textContent = verified ? '已连接 GitHub' : getToken() ? '连接待验证' : '连接 GitHub';
  $('connected-panel').hidden = !verified;
  $('connect-form').hidden = verified;
}
function photoElement(path, alt, className) {
  const image = el('img', className);
  image.alt = alt;
  image.loading = 'lazy';
  image.src = photoURL(path);
  image.addEventListener('error', () => {
    image.hidden = true;
    image.parentElement.classList.add('photo-unavailable');
    if (className === 'detail-photo') {
      const message = el('p', 'photo-tip', '照片尚未发布或暂时无法加载。刚保存的照片需等待站点部署完成，请稍后刷新记录。');
      image.after(message);
    }
  });
  return image;
}
function renderCalendar() {
  const year = month.getFullYear(), m = month.getMonth();
  const prefix = `${year}-${String(m + 1).padStart(2, '0')}`;
  $('month-title').textContent = `${year} 年 ${String(m + 1).padStart(2, '0')} 月`;
  $('month-english').textContent = new Intl.DateTimeFormat('en', { month: 'long' }).format(month).toUpperCase();
  $('month-picker').value = prefix;
  $('prev-month').disabled = year === 1970 && m === 0;
  $('next-month').disabled = year === 9999 && m === 11;
  const count = data ? Object.keys(data.entries).filter(key => key.startsWith(prefix)).length : 0;
  $('total-count').textContent = data ? Object.keys(data.entries).length : '—';
  $('month-count').textContent = data ? `本月 ${count} 篇记录` : '正在翻开日记';
  const grid = $('calendar-grid');
  grid.replaceChildren();
  for (const day of monthCells(year, m)) {
    const entry = data?.entries[day.key];
    const future = day.key > today;
    const button = el('button', `day${day.inMonth ? '' : ' outside'}${day.key === today ? ' today' : ''}${future ? ' future' : ''}${entry ? ' has-entry' : ''}`);
    button.type = 'button';
    button.dataset.date = day.key;
    button.disabled = future || !data || day.key < '1970-01-01';
    button.setAttribute('aria-label', `${formatDate(day.key)}${day.key === today ? '，今天' : ''}，${entry ? entry.title || '植物日记' : future ? '尚未到来' : '还没有记录'}`);
    if (day.key === today) button.setAttribute('aria-current', 'date');
    if (entry) button.append(photoElement(entry.thumbnail, entry.title || '这一天的植物照片', 'day-photo'));
    const number = el('span', 'day-number');
    number.append(el('span', '', day.day));
    if (day.key === today) number.append(el('span', 'today-word', '今天'));
    button.append(number);
    if (entry) button.append(el('span', 'day-entry-title', entry.title || '一日一植'));
    else if (day.key === today) button.append(el('span', 'day-hint', '留一点绿意'));
    else if (!future && day.inMonth) button.append(icon('plus', 'day-plus'));
    button.addEventListener('click', () => openDetail(day.key));
    grid.append(button);
  }
  const monthFuture = prefix > today.slice(0, 7);
  $('empty-month').hidden = !data || count > 0;
  $('empty-title').textContent = monthFuture ? '未来的日子，慢慢生长。' : '这里，等待第一片绿意。';
  $('empty-description').textContent = monthFuture ? '先留住今天的小美好，再与未来的绿意相遇。' : '从今天看到的那株植物开始，写下属于你的第一篇日记。';
  $('write-today').disabled = !data;
  $('empty-write').disabled = !data;
}
async function loadData() {
  if (loading) return;
  loading = true;
  $('refresh-button').disabled = true;
  status('load-status', '正在读取云端日记…');
  try {
    const result = getToken() ? await verifyToken(getToken()) : await readCloud('');
    data = result.data;
    verified = Boolean(getToken());
    status('load-status', '已读取云端最新记录 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
  } catch (error) {
    verified = false;
    try {
      data = await readPublished();
      status('load-status', '当前显示已发布版本，可能稍有延迟。连接 GitHub 或刷新可获取最新记录。', 'warning');
    } catch {
      status('load-status', data ? '刷新失败，仍显示上次读取的记录。请检查网络后重试。' : '暂时无法读取日记，请检查网络后点击「刷新记录」。', 'error');
    }
  } finally {
    loading = false;
    $('refresh-button').disabled = false;
    updateConnection();
    renderCalendar();
  }
}
function releasePhoto() {
  photoGeneration++;
  if (photo?.preview) URL.revokeObjectURL(photo.preview);
  photo = null;
  photoBusy = false;
  $('save-button').disabled = false;
}
function setPhotoPreview(src) {
  $('photo-preview').hidden = !src;
  if (src) $('photo-preview').src = src;
  else $('photo-preview').removeAttribute('src');
  $('upload-hint').hidden = Boolean(src);
  $('replace-photo').hidden = !src;
}
function populateEditor(key) {
  releasePhoto();
  selected = key;
  original = data.entries[key] ? { ...data.entries[key] } : null;
  pendingAttempt = null;
  $('entry-date').value = key;
  $('entry-title').value = original?.title || '';
  $('entry-note').value = original?.note || '';
  $('character-count').textContent = `${$('entry-note').value.length} / 10000`;
  $('photo-input').value = '';
  setPhotoPreview(original ? photoURL(original.image) : '');
  $('editor-heading').textContent = original ? '重读这一天，添一点感想' : key === today ? '写下今天的绿意' : '补一篇日子的绿意';
  $('conflict-actions').hidden = true;
  dirty = false;
  status('editor-status', '');
}
function openEditor(key = today) {
  if (!data || busy || !validDate(key) || key > today) return;
  populateEditor(key);
  $('entry-dialog').showModal();
}
function ask(title, message, yes = '确认', no = '取消') {
  return new Promise(resolve => {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-yes').textContent = yes;
    $('confirm-no').textContent = no;
    const dialog = $('confirm-dialog');
    const finish = result => { dialog.close(); cleanup(); resolve(result); };
    const onYes = () => finish(true), onNo = () => finish(false);
    const onCancel = event => { event.preventDefault(); finish(false); };
    function cleanup() {
      $('confirm-yes').removeEventListener('click', onYes);
      $('confirm-no').removeEventListener('click', onNo);
      dialog.removeEventListener('cancel', onCancel);
    }
    $('confirm-yes').addEventListener('click', onYes);
    $('confirm-no').addEventListener('click', onNo);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
    $('confirm-no').focus();
  });
}
async function closeDialog(id) {
  if (id === 'entry-dialog') {
    if (busy) return;
    if ((dirty || photoBusy) && !await ask('暂时放下这篇日记？', '还有尚未保存到 GitHub 的修改，关闭后这些修改不会保留。', '放弃修改', '继续编辑')) return;
    dirty = false;
    pendingSave = false;
    releasePhoto();
  }
  if (id === 'connect-dialog') {
    $('github-token').value = '';
    pendingSave = false;
  }
  $(id).close();
}
async function upload(file) {
  if (busy || !file) return;
  const generation = ++photoGeneration;
  photoBusy = true;
  $('save-button').disabled = true;
  status('editor-status', '正在整理照片，稍等一下…');
  try {
    const result = await preparePhoto(file);
    if (generation !== photoGeneration) { URL.revokeObjectURL(result.preview); return; }
    if (photo?.preview) URL.revokeObjectURL(photo.preview);
    photo = result;
    dirty = true;
    pendingAttempt = null;
    setPhotoPreview(result.preview);
    status('editor-status', '照片已准备好，点击「保存并同步」后才会上传。');
  } catch (error) {
    if (generation === photoGeneration) status('editor-status', error.message, 'error');
  } finally {
    if (generation === photoGeneration) { photoBusy = false; $('save-button').disabled = false; }
    $('photo-input').value = '';
  }
}
function setBusy(value) {
  busy = value;
  for (const control of $('entry-form').querySelectorAll('input, textarea, button')) control.disabled = value;
  $('upload-area').style.pointerEvents = value ? 'none' : '';
  $('save-button').querySelector('span').textContent = value ? '正在同步…' : '保存并同步';
}
function makeAttempt() {
  const fingerprint = JSON.stringify([selected, $('entry-title').value.trim(), $('entry-note').value.trim(), photo?.preview || '']);
  if (pendingAttempt?.fingerprint === fingerprint) return pendingAttempt;
  let image = original?.image, thumbnail = original?.thumbnail;
  const photos = [];
  if (photo) {
    const id = `${selected}-${crypto.randomUUID()}`;
    image = `photos/${id}.jpg`;
    thumbnail = `photos/${id}-thumb.jpg`;
    photos.push({ path: image, content: photo.full }, { path: thumbnail, content: photo.thumb });
  }
  pendingAttempt = { fingerprint, photos, entry: { title: $('entry-title').value.trim(), note: $('entry-note').value.trim(), image, thumbnail, updatedAt: new Date().toISOString() } };
  return pendingAttempt;
}
async function submitEntry() {
  if (busy || photoBusy) return;
  if (!$('entry-form').reportValidity()) return;
  if (!photo && !original?.image) { status('editor-status', '先选一张植物照片，让今天有迹可循。', 'error'); $('photo-input').focus(); return; }
  if (!getToken() || !verified) {
    pendingSave = true;
    openConnect();
    return;
  }
  const attempt = makeAttempt();
  setBusy(true);
  $('conflict-actions').hidden = true;
  status('editor-status', '正在将照片与文字同步到 GitHub，请稍候…');
  try {
    data = await saveEntry(selected, attempt.entry, original, attempt.photos);
    dirty = false;
    month = new Date(`${selected.slice(0, 7)}-01T12:00:00`);
    $('entry-dialog').close();
    renderCalendar();
    releasePhoto();
    status('load-status', '已同步到 GitHub · 新照片需等待站点部署完成后显示，请稍后刷新记录');
    toast('日记已同步，照片发布需要稍等片刻。');
  } catch (error) {
    status('editor-status', error.message, 'error');
    if (error.code === 'CONFLICT') $('conflict-actions').hidden = false;
    if ([401, 403].includes(error.status)) { verified = false; updateConnection(); }
  } finally { setBusy(false); }
}
function openDetail(key, source = data) {
  if (!source) return;
  detailDate = key;
  detailData = source;
  const entry = source.entries[key];
  $('detail-date').textContent = formatDate(key, { weekday: 'long' });
  const content = $('detail-content');
  content.replaceChildren();
  status('detail-status', '');
  if (entry) {
    content.append(photoElement(entry.image, entry.title || '这一天的植物照片', 'detail-photo'));
    const body = el('div', 'detail-body');
    const title = el('h2', '', entry.title || '与一株植物的相遇');
    title.id = 'detail-title';
    body.append(title, el('p', 'note', entry.note), el('p', 'entry-updated', `最后记录于 ${new Date(entry.updatedAt).toLocaleString('zh-CN', { hour12: false })}`));
    const remove = el('button', 'delete-entry', '删除这篇日记');
    remove.type = 'button';
    remove.id = 'delete-entry';
    remove.addEventListener('click', deleteCurrent);
    body.append(remove);
    content.append(body);
  } else {
    const body = el('div', 'empty-detail');
    const title = el('h2', '', '这一天，等你来写。');
    title.id = 'detail-title';
    body.append(icon('sprout'), title, el('p', '', '一张植物照片，一些此刻的感想。\n把平凡的一天，好好收藏。'));
    content.append(body);
  }
  const keys = Object.keys(source.entries).sort();
  const index = keys.indexOf(key);
  $('prev-entry').disabled = !keys.some(k => k < key);
  $('next-entry').disabled = !keys.some(k => k > key);
  $('entry-position').textContent = index >= 0 ? `${index + 1} / ${keys.length}` : '尚未记录';
  $('edit-entry').replaceChildren(icon(entry ? 'pen' : 'plus'), document.createTextNode(entry ? '编辑这一天' : '记录这一天'));
  $('edit-entry').disabled = key > today || $('entry-dialog').open;
  if (!$('detail-dialog').open) $('detail-dialog').showModal();
}
async function deleteCurrent() {
  if (busy) return;
  if ($('entry-dialog').open) { status('detail-status', '请先关闭当前编辑，再删除日记。', 'error'); return; }
  if (!getToken() || !verified) { status('detail-status', '请先连接 GitHub，再删除日记。'); openConnect(); return; }
  const key = detailDate, entry = detailData.entries[key];
  if (!await ask('删除这一天的日记？', '日历中的照片和感想将被移除。GitHub 历史仍会保留旧版本。', '确认删除', '保留日记')) return;
  busy = true;
  $('delete-entry').disabled = true;
  $('edit-entry').disabled = true;
  status('detail-status', '正在同步删除…');
  try {
    data = await saveEntry(key, null, entry);
    $('detail-dialog').close();
    renderCalendar();
    toast('这篇日记已从日历移除。');
  } catch (error) {
    status('detail-status', error.message, 'error');
    if ($('delete-entry')) $('delete-entry').disabled = false;
    $('edit-entry').disabled = false;
  } finally { busy = false; }
}
function openConnect() {
  updateConnection();
  status('connect-status', '');
  if (!$('connect-dialog').open) $('connect-dialog').showModal();
}

$('entry-date').max = today;
$('write-today').addEventListener('click', () => openEditor(today));
$('empty-write').addEventListener('click', () => openEditor(today));
$('about-button').addEventListener('click', () => $('about-dialog').showModal());
$('about-write').addEventListener('click', () => { $('about-dialog').close(); openEditor(today); });
$('connection-button').addEventListener('click', openConnect);
$('refresh-button').addEventListener('click', loadData);
$('prev-month').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); renderCalendar(); });
$('next-month').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); renderCalendar(); });
$('today-button').addEventListener('click', () => { month = new Date(current.getFullYear(), current.getMonth(), 1); renderCalendar(); });
$('month-picker').addEventListener('change', () => {
  const value = $('month-picker').value;
  if (/^\d{4}-\d{2}$/.test(value) && validDate(`${value}-01`)) { month = new Date(`${value}-01T12:00:00`); renderCalendar(); }
});
$('calendar-grid').addEventListener('keydown', event => {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  if (!step || !event.target.dataset.date) return;
  event.preventDefault();
  const date = new Date(`${event.target.dataset.date}T12:00:00`);
  date.setDate(date.getDate() + step);
  const key = dateKey(date);
  if (key > today || key < '1970-01-01') return;
  if (date.getMonth() !== month.getMonth() || date.getFullYear() !== month.getFullYear()) { month = new Date(date.getFullYear(), date.getMonth(), 1); renderCalendar(); }
  document.querySelector(`[data-date="${key}"]`)?.focus();
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(button.dataset.close));
for (const dialog of document.querySelectorAll('dialog:not(#confirm-dialog)')) {
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) closeDialog(dialog.id); });
  dialog.addEventListener('click', event => {
    const r = dialog.getBoundingClientRect();
    if (!busy && event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) closeDialog(dialog.id);
  });
}
$('entry-title').addEventListener('input', () => { dirty = true; });
$('entry-note').addEventListener('input', () => { dirty = true; $('character-count').textContent = `${$('entry-note').value.length} / 10000`; });
$('entry-date').addEventListener('change', async () => {
  const key = $('entry-date').value;
  if (!validDate(key) || key > today) { $('entry-date').value = selected; status('editor-status', '日记日期应为今天或以前的日期。', 'error'); return; }
  if (key === selected) return;
  if ((dirty || photoBusy) && !await ask('切换到另一天？', '当前尚未保存的修改会被放下，请先确认。', '切换日期', '继续编辑')) { $('entry-date').value = selected; return; }
  populateEditor(key);
});
$('photo-input').addEventListener('change', event => upload(event.target.files[0]));
$('photo-input').addEventListener('focus', () => $('upload-area').classList.add('dragging'));
$('photo-input').addEventListener('blur', () => $('upload-area').classList.remove('dragging'));
$('upload-area').addEventListener('dragover', event => { event.preventDefault(); if (!busy) $('upload-area').classList.add('dragging'); });
$('upload-area').addEventListener('dragleave', () => $('upload-area').classList.remove('dragging'));
$('upload-area').addEventListener('drop', event => { event.preventDefault(); $('upload-area').classList.remove('dragging'); upload(event.dataTransfer.files[0]); });
$('entry-form').addEventListener('submit', event => { event.preventDefault(); submitEntry(); });
$('edit-entry').addEventListener('click', () => { $('detail-dialog').close(); openEditor(detailDate); });
for (const [id, direction] of [['prev-entry', -1], ['next-entry', 1]]) {
  $(id).addEventListener('click', () => {
    const keys = Object.keys(detailData.entries).sort();
    const key = direction < 0 ? keys.filter(k => k < detailDate).at(-1) : keys.find(k => k > detailDate);
    if (key) openDetail(key, detailData);
  });
}
$('connect-form').addEventListener('submit', async event => {
  event.preventDefault();
  const token = $('github-token').value.trim();
  if (!token) return;
  $('confirm-connect').disabled = true;
  status('connect-status', '正在验证仓库连接…');
  try {
    const result = await verifyToken(token);
    setToken(token, $('remember-token').checked);
    verified = true;
    data = result.data;
    $('github-token').value = '';
    updateConnection();
    renderCalendar();
    $('connect-dialog').close();
    status('load-status', '已连接 GitHub · 已读取云端最新日记');
    toast('已连接，你的小花园随时可以续写。');
    if (pendingSave) { pendingSave = false; await submitEntry(); }
  } catch (error) { status('connect-status', error.message, 'error'); }
  finally { $('confirm-connect').disabled = false; }
});
$('disconnect-button').addEventListener('click', () => {
  disconnect(); verified = false; pendingSave = false;
  updateConnection();
  $('connect-dialog').close();
  toast('已断开连接，保存在 GitHub 的日记仍在。');
});
$('view-cloud').addEventListener('click', async () => {
  try { const latest = await readCloud(); openDetail(selected, latest.data); }
  catch (error) { status('editor-status', error.message, 'error'); }
});
$('use-cloud').addEventListener('click', async () => {
  if (!await ask('以云端版本继续编辑？', '当前编辑框中的未保存内容将被替换。需要保留的文字，请先自行复制。', '载入云端版本', '保留我的修改')) return;
  try { const latest = await readCloud(); data = latest.data; populateEditor(selected); renderCalendar(); }
  catch (error) { status('editor-status', error.message, 'error'); }
});
window.addEventListener('beforeunload', event => {
  if (dirty || busy || photoBusy) { event.preventDefault(); event.returnValue = ''; }
});
renderCalendar();
loadData().then(() => { if (new URLSearchParams(location.search).has('edit') && data) openEditor(today); });
