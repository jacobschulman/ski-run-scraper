const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractVailTerrain, validateTerrainFreshness } = require('../lib/vail-terrain-normalization');
for (const key of ['breckenridge', 'keystone']) {
  const http = require(`./fixtures/${key}-terrain-http.json`);
  const browser = require(`./fixtures/${key}-terrain-browser.json`);
  test(`${key}: full legacy browser record, including labels, nulls, and area order`, () => {
    const html = `FR.TerrainStatusFeed = {"wrong":"first numeric assignment"}; FR.TerrainStatusFeed = ${JSON.stringify(http)};`;
    const actual = extractVailTerrain(html);
    delete actual.Date;
    assert.deepEqual(actual, browser);
  });
  test(`${key}: closed terrain is data, empty/failed/numeric payloads are not`, () => {
    const closed = structuredClone(http);
    closed.GroomingAreas.forEach(a => a.Trails.forEach(t => t.IsOpen = false));
    const parse = data => extractVailTerrain(`FR.TerrainStatusFeed = ${JSON.stringify(data)}`);
    assert.doesNotThrow(() => parse(closed));
    assert.throws(() => parse({...http, GroomingAreas: []}));
    assert.throws(() => parse({...http, IsSuccessful: false}));
    closed.GroomingAreas.find(a => a.Trails.length).Trails[0].Difficulty = 2;
    assert.throws(() => parse(closed));
  });
}
test('terrain freshness rejects stale/future/ambiguous dates and wrong resort', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const report = { ResortId: 4, Date: '2026-11-12T04:00:00-07:00' };
  assert.equal(validateTerrainFreshness(report, 4, now), 1);
  for (const Date of ['2026-05-14T04:00:00-06:00', '2026-11-13T04:00:00Z', '/Date(123)/']) assert.throws(() => validateTerrainFreshness({...report, Date}, 4, now));
  assert.throws(() => validateTerrainFreshness(report, 3, now));
});
