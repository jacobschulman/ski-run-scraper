const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const data = require('../dashboards/shared/published-data');

test('brief filename normalization handles mixed legacy formats without duplicate extensions', () => {
  assert.deepEqual(data.dates(['2026-05-15.json', '2026-05-15', '2026-05-14', 'latest.json', null]), ['2026-05-15', '2026-05-14']);
});

test('recent reports reject missing, stale and future timestamps', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.equal(data.recent('2026-11-15T12:00:00Z', now), true);
  for (const timestamp of [undefined, 'invalid', '2026-05-15T12:00:00Z', '2026-11-17T12:00:00Z']) {
    assert.equal(data.recent(timestamp, now), false);
  }
});

test('empty terrain is missing while measured zero snow remains available', () => {
  assert.equal(data.observation({data: {GroomingAreas: [{Trails: []}]}}, 'terrain').available, false);
  const snow = data.observation({date: '2026-11-16', data: {snowfall: {'24hour_inches': 0}, timestamp: new Date().toISOString()}}, 'snow');
  assert.equal(snow.available, true);
  assert.equal(snow.recent, true);
  assert.equal(data.observation(undefined, 'snow').available, false);
});

test('calendar comparison does not substitute the last available spring observation', () => {
  const files = data.dates(['2026-11-12', '2026-05-15']);
  assert.equal(files.includes(data.previousDay(files[0])), false);
  assert.equal(data.previousDay('2026-03-09'), '2026-03-08');
  assert.equal(data.previousDay('2026-01-01'), '2025-12-31');
});

test('all dashboard inline scripts parse', () => {
  const root = path.join(__dirname, '../dashboards');
  for (const file of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      new vm.Script(match[1], { filename: file });
    }
  }
});
