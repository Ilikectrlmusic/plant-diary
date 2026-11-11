import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, validDate, monthCells, validateData, sameEntry, mergeEntry, encodeJSON, decodeJSON } from '../assets/model.js';
const entry = { title: '窗边的新叶', note: '慢慢来。\n今天也在生长 🌿', image: 'photos/2026-11-11-one.jpg', thumbnail: 'photos/2026-11-11-one-thumb.jpg', updatedAt: '2026-11-11T02:00:00.000Z' };
const empty = () => ({ schemaVersion: 1, entries: {} });
test('date validation handles leap years and invalid dates', () => {
  assert.ok(validDate('2024-02-29'));
  for (const value of ['2025-02-29', '2026-13-01', '2026-04-31', '1969-12-31', '', null]) assert.equal(validDate(value), false);
  assert.equal(dateKey(new Date(2026, 10, 11)), '2026-11-11');
});
test('calendar starts on Monday and includes all days for 4, 5 and 6 week months', () => {
  for (const [year, month] of [[2021, 1], [2026, 10], [2026, 2], [2028, 1]]) {
    const cells = monthCells(year, month);
    assert.equal(cells.length % 7, 0);
    assert.equal(new Date(`${cells[0].key}T12:00:00`).getDay(), 1);
    assert.equal(cells.filter(c => c.inMonth).length, new Date(year, month + 1, 0).getDate());
    assert.equal(new Set(cells.map(c => c.key)).size, cells.length);
  }
});
test('schema rejects corrupt files, executable paths and malformed entries', () => {
  for (const input of [null, [], {}, { schemaVersion: 1, entries: [] }, { schemaVersion: 2, entries: {} }]) assert.throws(() => validateData(input));
  for (const bad of [{ image: 'javascript:alert(1)' }, { thumbnail: '../../token' }, { note: 'x'.repeat(10001) }, { updatedAt: 'invalid' }, { title: null }]) assert.throws(() => validateData({ schemaVersion: 1, entries: { '2026-11-11': { ...entry, ...bad } } }));
  assert.deepEqual(validateData({ schemaVersion: 1, entries: { '2026-11-11': entry } }).entries['2026-11-11'], entry);
});
test('Unicode text round-trips without losing emoji or newlines', () => {
  const data = { schemaVersion: 1, entries: { '2026-11-11': entry } };
  assert.deepEqual(decodeJSON(encodeJSON(data)), data);
});
test('different dates merge, same-date conflicts fail, and deletion preserves other entries', () => {
  const latest = { schemaVersion: 1, entries: { '2026-11-10': entry } };
  const merged = mergeEntry(latest, '2026-11-11', entry, null);
  assert.equal(Object.keys(merged.entries).length, 2);
  assert.deepEqual(latest.entries, { '2026-11-10': entry });
  assert.throws(() => mergeEntry(merged, '2026-11-11', { ...entry, note: 'mine' }, null), e => e.code === 'CONFLICT');
  const deleted = mergeEntry(merged, '2026-11-11', null, entry);
  assert.deepEqual(deleted, latest);
  assert.ok(sameEntry(entry, { ...entry }));
  assert.ok(!sameEntry(entry, { ...entry, note: 'different' }));
});
