const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { publicationPlan } = require('../scripts/run-vail-pilot');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ski-pilot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['latest.json', 'latest-snow.json']) fs.writeFileSync(path.join(root, name), JSON.stringify({vail: { untouched: true }}));
  const collectedAt = '2026-11-12T05:00:00.000Z';
  const records = ['breckenridge', 'keystone'].map(key => {
    for (const kind of ['terrain', 'snow']) fs.mkdirSync(path.join(root, key, kind), { recursive: true });
    fs.writeFileSync(path.join(root, key, 'terrain/2025-11-15.json'), '{"historical":true}');
    fs.writeFileSync(path.join(root, key, 'snow/2026-11-11.ndjson'), '{"earlier":true}\n');
    return { key, date: '2026-11-11', terrain: {...require(`./fixtures/${key}-terrain-http.json`), Date: '2026-11-11T21:55:00-07:00'}, snow: {timestamp: collectedAt, lastUpdated: 'Updated November 11, 2026 at 05:34 AM MST', baseDepth: {inches:18}} };
  });
  return {root, candidate: {collectedAt, records}, now: new Date(collectedAt)};
}
test('publication preserves history, other resorts, snow stream prefix, and complete terrain index', t => {
  const {root, candidate, now} = fixture(t);
  const writes = publicationPlan(candidate, root, now);
  assert.deepEqual(writes.get('latest.json').vail, {untouched:true});
  assert.deepEqual(writes.get('latest-snow.json').vail, {untouched:true});
  for (const key of ['breckenridge','keystone']) {
    assert(!writes.has(`${key}/terrain/2025-11-15.json`));
    assert.equal(fs.readFileSync(path.join(root,key,'terrain/2025-11-15.json'),'utf8'), '{"historical":true}');
    assert.deepEqual(writes.get(`${key}/terrain/index.json`).files, ['2026-11-12','2026-11-11','2025-11-15']);
    assert(writes.get(`${key}/snow/2026-11-11.ndjson`).startsWith('{"earlier":true}\n'));
    assert.equal(writes.get(`${key}/terrain/2026-11-11.json`).sourceLastUpdated, candidate.records[0].terrain.Date);
  }
});
test('publication fails closed for incomplete, expired, missing aggregate, and newer existing data', t => {
  const {root, candidate, now} = fixture(t);
  assert.throws(() => publicationPlan({...candidate, records:[candidate.records[0]]},root,now));
  assert.throws(() => publicationPlan(candidate,root,new Date(+now+3600001)));
  fs.writeFileSync(path.join(root,'latest.json'), JSON.stringify({breckenridge:{data:{Date:'2026-11-12T06:00:00Z'}}}));
  assert.throws(() => publicationPlan(candidate,root,now));
  fs.unlinkSync(path.join(root,'latest.json'));
  assert.throws(() => publicationPlan(candidate,root,now));
});
