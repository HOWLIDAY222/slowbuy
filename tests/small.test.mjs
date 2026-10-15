import test from 'node:test';
import assert from 'node:assert/strict';
import {SMALL_KEY, MAX_SMALL, readSmall, nextMorning, dailyKey, summarizeSmall} from '../dist/small.mjs';

const local = (year, month, day, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
const now = local(2026, 10, 15);
const record = (id, overrides = {}) => ({id, name: '小东西', price: 39, status: 'planned', createdAt: now, ...overrides});
const storage = items => JSON.stringify({version: 1, items});

test('storage constants and empty summaries', () => {
  assert.equal(SMALL_KEY, 'slowbuy.small.v1');
  assert.equal(MAX_SMALL, 300);
  assert.deepEqual(readSmall(null), {items: [], malformed: false});
  assert.deepEqual(readSmall(storage([])), {items: [], malformed: false});
  assert.deepEqual(summarizeSmall([], now), {todayPlanned: 0, todayBought: 0, monthBought: 0, todayCount: 0});
});

test('prices are summed in cents; planned, bought and released remain separate', () => {
  const items = [
    record('a', {price: 0.1}),
    record('b', {price: 0.2}),
    record('c', {price: 59, status: 'bought', decidedAt: now}),
    record('d', {price: 89, status: 'released', decidedAt: now}),
    record('e', {price: 0.01, status: 'bought'}),
  ];
  assert.deepEqual(summarizeSmall(items, now), {todayPlanned: 0.3, todayBought: 59.01, monthBought: 59.01, todayCount: 4});
});

test('created date is used for planned; decision date is used for purchases', () => {
  const yesterday = local(2026, 10, 14);
  const lastMonth = local(2026, 9, 30);
  const items = [
    record('old-plan', {createdAt: yesterday}),
    record('old-now-bought', {createdAt: lastMonth, status: 'bought', decidedAt: now, price: 59}),
    record('bought-yesterday', {createdAt: yesterday, status: 'bought', price: 89}),
    record('bought-last-month', {createdAt: lastMonth, status: 'bought', price: 100}),
  ];
  assert.deepEqual(summarizeSmall(items, now), {todayPlanned: 0, todayBought: 59, monthBought: 148, todayCount: 1});
});

test('day/month/year boundaries use the local calendar with no pre-dawn shift', () => {
  const midnight = local(2027, 1, 1, 0, 1);
  const before = local(2026, 12, 31, 23, 59);
  assert.equal(dailyKey(midnight), '2027-01-01');
  assert.equal(dailyKey(before), '2026-12-31');
  assert.deepEqual(summarizeSmall([
    record('old', {createdAt: before, status: 'bought', price: 10}),
    record('new', {createdAt: before, decidedAt: midnight, status: 'bought', price: 20}),
    record('new-plan', {createdAt: midnight, price: 30}),
  ], midnight), {todayPlanned: 30, todayBought: 20, monthBought: 20, todayCount: 2});
});

test('readSmall normalizes records, drops unknown fields and deduplicates ids', () => {
  const decoded = readSmall(storage([
    record(' a ', {name: `  ${'长'.repeat(70)}  `, price: 0.1 + 0.2, secret: 'discard me'}),
    record('a', {price: 50}),
    record('b', {status: 'bought', decidedAt: now, reviewAt: now + 1000}),
  ]));
  assert.equal(decoded.malformed, true);
  assert.equal(decoded.items.length, 2);
  assert.deepEqual(decoded.items[0], {id: 'a', name: '长'.repeat(60), price: 0.3, status: 'planned', createdAt: now});
  assert.equal(decoded.items[1].decidedAt, now);
  assert.equal(decoded.items[1].reviewAt, now + 1000);
  assert.equal('secret' in decoded.items[0], false);
});

test('invalid required values are rejected; malformed optional timestamps are omitted', () => {
  const decoded = readSmall(storage([
    null,
    record('', {}),
    record('empty-name', {name: '  '}),
    record('zero', {price: 0}),
    record('too-small', {price: 0.001}),
    record('precision', {price: 1.001}),
    record('huge', {price: 1e8 + 0.01}),
    record('numeric-text', {price: '39'}),
    record('unknown', {status: 'wanted'}),
    record('time-zero', {createdAt: 0}),
    record('time-negative', {createdAt: -1}),
    record('time-infinite', {createdAt: Infinity}),
    record('time-out-of-range', {createdAt: 8.64e15 + 1}),
    record('optional', {decidedAt: -1, reviewAt: null}),
    record('maximum', {price: 1e8}),
  ]));
  assert.equal(decoded.malformed, true);
  assert.deepEqual(decoded.items.map(item => item.id), ['optional', 'maximum']);
  assert.equal('decidedAt' in decoded.items[0], false);
  assert.equal('reviewAt' in decoded.items[0], false);
});

test('malformed storage containers are handled without throwing', () => {
  for (const raw of ['', '{', 'null', '[]', '{}', '{"version":2,"items":[]}', '{"version":1,"items":{}}']) {
    assert.deepEqual(readSmall(raw), {items: [], malformed: true});
  }
});

test('maximum count applies after invalid items and duplicate ids are removed', () => {
  const items = [record('duplicate'), record('duplicate'), ...Array.from({length: MAX_SMALL + 10}, (_, index) => record(`item-${index}`))];
  const decoded = readSmall(storage(items));
  assert.equal(decoded.items.length, MAX_SMALL);
  assert.equal(new Set(decoded.items.map(item => item.id)).size, MAX_SMALL);
  assert.equal(decoded.malformed, true);
});

test('nextMorning selects today before nine, tomorrow at or after nine', () => {
  assert.equal(nextMorning(local(2026, 10, 15, 1, 30)), local(2026, 10, 15, 9));
  assert.equal(nextMorning(local(2026, 10, 15, 8, 59)), local(2026, 10, 15, 9));
  assert.equal(nextMorning(local(2026, 10, 15, 9)), local(2026, 10, 16, 9));
  assert.equal(nextMorning(local(2026, 10, 15, 23, 59)), local(2026, 10, 16, 9));
  assert.equal(nextMorning(local(2026, 12, 31, 22)), local(2027, 1, 1, 9));
});

test('nextMorning preserves local nine o’clock across daylight-saving dates', () => {
  for (const [year, month, day] of [[2026, 3, 7], [2026, 10, 31]]) {
    const result = new Date(nextMorning(local(year, month, day, 23)));
    const expected = new Date(year, month - 1, day + 1, 9);
    assert.equal(result.getTime(), expected.getTime());
    assert.equal(result.getHours(), 9);
    assert.equal(result.getMinutes(), 0);
  }
});

test('invalid calculation inputs fail safely', () => {
  assert.equal(dailyKey(NaN), '');
  assert.equal(dailyKey(Infinity), '');
  assert.throws(() => nextMorning(NaN), RangeError);
  assert.deepEqual(summarizeSmall(null, now), {todayPlanned: 0, todayBought: 0, monthBought: 0, todayCount: 0});
  assert.deepEqual(summarizeSmall([null, record('bad', {price: 0}), record('bad-time', {createdAt: -1})], now), {todayPlanned: 0, todayBought: 0, monthBought: 0, todayCount: 0});
});
