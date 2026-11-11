import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { encodeJSON } from '../assets/model.js';
import { readCloud, setToken, disconnect, saveEntry } from '../assets/cloud.js';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; disconnect(); });
const entry = { title: '新叶', note: '长大一点', image: 'photos/new.jpg', thumbnail: 'photos/new-thumb.jpg', updatedAt: '2026-11-11T00:00:00Z' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function api({ race = false, lostResponse = false, initial = {}, failBlob = false } = {}) {
  let entries = { ...initial }, head = 'head-1', attempts = 0, staged;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.replace('/repos/Ilikectrlmusic/plant-diary', '');
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body, method: options.method || 'GET' });
    if (path === '/git/ref/heads/main') return json({ object: { sha: head } });
    if (path.startsWith('/git/commits/') && !body) return json({ tree: { sha: 'base-tree' } });
    if (path === '/contents/data/diary.json') return json({ encoding: 'base64', sha: 'file-sha', content: encodeJSON({ schemaVersion: 1, entries }) });
    if (path === '/git/blobs') {
      if (failBlob) return json({}, 403);
      const content = Buffer.from(body.content, 'base64').toString();
      if (content.startsWith('{')) staged = JSON.parse(content).entries;
      return json({ sha: 'blob-sha' });
    }
    if (path === '/git/trees') return json({ sha: 'tree-sha' });
    if (path === '/git/commits') return json({ sha: 'commit-new' });
    if (path === '/git/refs/heads/main') {
      attempts++;
      if (race && attempts === 1) { head = 'head-2'; entries['2026-11-10'] = { ...entry, title: '另一设备' }; return json({}, 422); }
      entries = staged;
      if (lostResponse) throw new TypeError('connection reset');
      return json({ object: { sha: 'commit-new' } });
    }
    throw new Error(`Unexpected path: ${path}`);
  };
  return { calls, getEntries: () => entries };
}
test('atomic save publishes image and diary in one non-forced commit', async () => {
  const mock = api(); setToken('test-token');
  const data = await saveEntry('2026-11-11', entry, null, [{ path: entry.image, content: 'aW1hZ2U=' }]);
  assert.deepEqual(data.entries['2026-11-11'], entry);
  const tree = mock.calls.find(c => c.path === '/git/trees').body;
  assert.deepEqual(tree.tree.map(f => f.path), ['photos/new.jpg', 'data/diary.json']);
  assert.equal(mock.calls.at(-1).body.force, false);
});
test('concurrent unrelated update is merged after non-fast-forward rejection', async () => {
  const mock = api({ race: true }); setToken('test-token');
  const data = await saveEntry('2026-11-11', entry, null);
  assert.equal(Object.keys(data.entries).length, 2);
  assert.equal(data.entries['2026-11-10'].title, '另一设备');
  assert.equal(mock.calls.filter(c => c.path === '/git/refs/heads/main').length, 2);
});
test('same-day conflict prevents writes', async () => {
  const mock = api({ initial: { '2026-11-11': entry } }); setToken('test-token');
  await assert.rejects(saveEntry('2026-11-11', { ...entry, note: 'overwrite' }, null), e => e.code === 'CONFLICT');
  assert.equal(mock.calls.filter(c => c.method !== 'GET').length, 0);
});
test('lost success response is verified by rereading the cloud', async () => {
  api({ lostResponse: true }); setToken('test-token');
  assert.deepEqual((await saveEntry('2026-11-11', entry, null)).entries['2026-11-11'], entry);
});
test('failed upload never advances the branch', async () => {
  const mock = api({ failBlob: true }); setToken('test-token');
  await assert.rejects(saveEntry('2026-11-11', entry, null, [{ path: entry.image, content: 'aW1hZ2U=' }]), /拒绝/);
  assert.ok(!mock.calls.some(c => c.path === '/git/refs/heads/main'));
});
test('malformed or missing cloud files are never interpreted as an empty diary', async () => {
  globalThis.fetch = async () => json({}, 404);
  await assert.rejects(readCloud(''), /无法访问/);
  globalThis.fetch = async () => json({ encoding: 'base64', sha: 'sha', content: encodeJSON({ entries: {} }) });
  await assert.rejects(readCloud(''), /格式/);
});

test('photos use the site base path with no GitHub raw fallback', async () => {
  const { BASE, photoURL } = await import('../assets/cloud.js');
  const url = photoURL('photos/example-thumb.jpg');
  assert.equal(url, new URL('photos/example-thumb.jpg', BASE).href);
  assert.ok(!url.includes('raw.githubusercontent.com'));
});
