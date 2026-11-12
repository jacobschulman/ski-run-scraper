const {test} = require('node:test');
const assert = require('node:assert/strict');
const {extractJSONAssignment,redactURL,terrainSummary,sourceDates,targets} = require('../scripts/audit-scrapers');
test('extracts nested JSON with flexible whitespace, escaped quotes and braces in strings', () => {
  const expected = {name:'a } " quoted',nested:[{value:2}]};
  assert.deepEqual(extractJSONAssignment(`FR.TerrainStatusFeed=\n${JSON.stringify(expected)}; other();`,'FR.TerrainStatusFeed'),expected);
});
test('never executes JavaScript assignments or trailing code', () => {
  assert.throws(()=>extractJSONAssignment('FR.x = function(){ throw Error("executed") }','FR.x'), /not JSON/);
  assert.throws(()=>extractJSONAssignment('FR.x = {a: 1}','FR.x'));
  assert.equal(extractJSONAssignment('other = {}','FR.x'),null);
  assert.throws(()=>extractJSONAssignment('FR.x = {"a":','FR.x'), /Truncated/);
});
test('redacts request credentials while retaining routing parameters', () => {
  const value=redactURL('https://example.com/feed?bearer_token=private&apiKey=secret&ids=123');
  assert(!value.includes('private')); assert(!value.includes('secret')); assert(value.includes('ids=123'));
});
test('counts numeric zero distinctly from missing wait times', () => {
  assert.deepEqual(terrainSummary({Lifts:[{WaitTimeInMinutes:0},{WaitTimeInMinutes:null},{WaitTimeInMinutes:5},{WaitTimeInMinutes:'--'}],GroomingAreas:[{Trails:[{}]}]}),{lifts:4,trails:1,openLifts:0,numericWaits:2,positiveWaits:1});
});
test('does not manufacture source freshness', () => {
  assert.deepEqual(sourceDates({lift:[{}]}),{});
  assert.deepEqual(sourceDates({LastUpdate:'old',snow:{lastUpdated:'also old'}}),{LastUpdate:'old','snow.lastUpdated':'also old'});
});
test('every configured resort has public source targets and none point at deployment servers', () => {
  for(const r of require('../config.json').resorts) {
    assert(targets(r).length,r.key);
    for(const t of targets(r)) {const u=new URL(t.url);assert(!/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname));assert(['http:','https:'].includes(u.protocol));}
  }
});
