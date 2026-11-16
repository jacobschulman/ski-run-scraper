const {test} = require('node:test');
const assert = require('node:assert/strict');
const {collect} = require('../scripts/run-vail-pilot');
const config = require('../config.json');
const {vailIds} = require('../lib/pilot-resorts');
const inspector = require('./fixtures/inspector-pilot-source.json');
const terrain = require('./fixtures/breckenridge-terrain-http.json');
const now = new Date('2026-11-12T17:00:00Z');
function requestFor(failVail = false, staleAbasin = false) {
  return async (url) => {
    if (url.startsWith(config.inspector.apiUrl)) {
      const Resorts = structuredClone(inspector);
      if (staleAbasin) Resorts.find(r=>r.Name==='Arapahoe Basin').SnowReport.LastUpdate='2020-01-01T00:00:00Z';
      return {Resorts};
    }
    const resort = config.resorts.find(r=>r.terrainUrl===url || r.snowReportUrl===url);
    assert(resort);
    if (failVail && resort.key==='vail') throw Error('Source HTTP 503');
    if (url===resort.terrainUrl) return `FR.TerrainStatusFeed = ${JSON.stringify({...terrain,ResortId:vailIds[resort.key],Date:'2026-11-12T09:55:00-07:00'})};`;
    return 'FR.snowReportData = {"LastUpdatedText":"Updated November 12, 2026 at 05:34 AM MST","BaseDepth":{"Inches":18}};';
  };
}
test('HTTP failure and stale snow cannot stop later resorts from collecting', async () => {
  const result = await collect(now,requestFor(true,true));
  assert.equal(result.records.length,4);
  assert(result.records.some(r=>r.key==='mammoth'));
  assert(result.records.some(r=>r.key==='beavercreek'));
  assert.equal(result.outcomes.find(r=>r.key==='vail').reason,'Source HTTP 503');
  assert.match(result.outcomes.find(r=>r.key==='abasin').reason,/stale-snow-report/);
});
test('complete source outage still records six individual failures', async () => {
  const result = await collect(now,async()=>{throw Error('Source timeout');});
  assert.equal(result.records.length,0);
  assert.equal(result.outcomes.filter(r=>!r.accepted).length,6);
});
