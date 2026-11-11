import { validateData, mergeEntry, sameEntry, encodeJSON, decodeJSON } from './model.js';

export const REPO = { owner: 'Ilikectrlmusic', name: 'plant-diary', branch: 'main', path: 'data/diary.json' };
const API = `https://api.github.com/repos/${REPO.owner}/${REPO.name}`;
const TOKEN_KEY = 'plant-diary:github-token';
export const BASE = new URL('../', import.meta.url);
let memoryToken = '';
function stored(kind) {
  try { return window[kind].getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function getToken() { return memoryToken || stored('sessionStorage') || stored('localStorage'); }
export function disconnect() {
  memoryToken = '';
  for (const kind of ['sessionStorage', 'localStorage']) {
    try { window[kind].removeItem(TOKEN_KEY); } catch { /* Connection can work without browser storage. */ }
  }
}
export function setToken(token, remember = false) {
  disconnect();
  memoryToken = token;
  try { window[remember ? 'localStorage' : 'sessionStorage'].setItem(TOKEN_KEY, token); } catch { /* Use memory for this tab. */ }
}
export function photoURL(path, published = false) {
  return published ? new URL(path, BASE).href : `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.branch}/${path}`;
}
export async function request(path, { token = '', ...options } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options, cache: 'no-store', signal: AbortSignal.timeout(25000),
      headers: {
        Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    const error = new Error('暂时无法连接 GitHub，请检查网络。编辑内容仍保留在当前页面。');
    error.code = 'NETWORK';
    throw error;
  }
  if (!response.ok) {
    const messages = {
      401: 'GitHub 密钥无效或已过期，请重新连接。',
      403: 'GitHub 暂时拒绝访问，请检查 Contents 读写权限、密钥有效期或 API 请求限额。',
      404: '无法访问仓库或日记文件，请确认密钥已选择 plant-diary，并且代码已推送到 main。',
      409: '云端刚刚更新，请核对最新记录后重试。',
      422: 'GitHub 未接受这次更新，可能有其他设备同时保存。请稍后重试。',
      429: '请求较频繁，请稍等片刻再试。',
    };
    const error = new Error(messages[response.status] || `GitHub 请求失败（${response.status}），请稍后重试。`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
export async function readCloud(token = getToken(), ref = REPO.branch) {
  const file = await request(`/contents/${REPO.path}?ref=${encodeURIComponent(ref)}`, { token });
  if (file.encoding !== 'base64' || !file.sha || typeof file.content !== 'string') throw new Error('GitHub 返回的日记文件不完整，已停止保存。');
  return { data: validateData(decodeJSON(file.content)), sha: file.sha };
}
export async function readPublished() {
  const response = await fetch(new URL(REPO.path, BASE), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('无法读取已发布的日记。');
  return validateData(await response.json());
}
export async function verifyToken(token) {
  const repo = await request('', { token });
  if (!repo.permissions?.push) throw new Error('此密钥没有仓库写入权限，请选择 plant-diary 并授予 Contents: Read and write。');
  return readCloud(token);
}
async function blob(content, token) {
  const result = await request('/git/blobs', { token, method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
  if (!result.sha) throw new Error('GitHub 未返回文件标识，未发布任何修改。');
  return result.sha;
}
// Photos, thumbnails and the diary index become visible together in one Git commit.
// A non-forced ref update prevents overwriting concurrent commits on main.
export async function saveEntry(key, entry, original, photos = []) {
  const token = getToken();
  if (!token) throw new Error('请先连接 GitHub，再保存这一天的日记。');
  const photoBlobs = [];
  let uploaded = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await request(`/git/ref/heads/${REPO.branch}`, { token });
    const parent = head.object?.sha;
    if (!parent) throw new Error('无法读取 main 分支，请先将网站推送到仓库。');
    const [commit, latest] = await Promise.all([
      request(`/git/commits/${parent}`, { token }), readCloud(token, parent),
    ]);
    if (sameEntry(latest.data.entries[key], entry)) return latest.data;
    const data = mergeEntry(latest.data, key, entry, original);
    if (!uploaded) {
      for (const photo of photos) photoBlobs.push({ path: photo.path, mode: '100644', type: 'blob', sha: await blob(photo.content, token) });
      uploaded = true;
    }
    const treeItems = [...photoBlobs, { path: REPO.path, mode: '100644', type: 'blob', sha: await blob(encodeJSON(data), token) }];
    if (original) {
      for (const path of new Set([original.image, original.thumbnail])) {
        if (path !== entry?.image && path !== entry?.thumbnail && !Object.values(data.entries).some(e => e.image === path || e.thumbnail === path)) {
          treeItems.push({ path, mode: '100644', type: 'blob', sha: null });
        }
      }
    }
    const tree = await request('/git/trees', { token, method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: treeItems }) });
    const created = await request('/git/commits', { token, method: 'POST', body: JSON.stringify({ message: `${entry ? '记录' : '删除'} ${key} 的植物日记`, tree: tree.sha, parents: [parent] }) });
    try {
      await request(`/git/refs/heads/${REPO.branch}`, { token, method: 'PATCH', body: JSON.stringify({ sha: created.sha, force: false }) });
      return data;
    } catch (error) {
      // If the response was lost after a successful ref update, confirm the result.
      try {
        const confirmed = await readCloud(token);
        if (sameEntry(confirmed.data.entries[key], entry)) return confirmed.data;
      } catch { /* Keep the original failure and the user's unsaved draft. */ }
      if ([409, 422].includes(error.status) && attempt < 2) continue;
      if (error.code === 'NETWORK') error.message = '保存结果暂时无法确认。请保留当前页面，恢复网络后重试；系统会先核对云端，避免覆盖其他设备的记录。';
      throw error;
    }
  }
}
