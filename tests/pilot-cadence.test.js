const {test} = require('node:test');
const assert = require('node:assert/strict');
const {cadence} = require('../scripts/check-pilot-cadence');
test('hourly wakeups avoid duplicate collections but delayed runs catch up', () => {
  const latest={vail:{data:{timestamp:'2026-11-16T12:00:00Z'}},abasin:{data:{timestamp:'2026-11-14T12:00:00Z'}}};
  assert.equal(cadence(latest,new Date('2026-11-16T13:00:00Z')).due,false);
  assert.equal(cadence(latest,new Date('2026-11-16T13:50:00Z')).due,true);
  assert.equal(cadence(latest,new Date('2026-11-16T20:00:00Z')).due,true);
  assert.equal(cadence(latest,new Date('2026-11-16T12:10:00Z'),true).due,true);
  assert.equal(cadence({},new Date()).due,true);
  assert.throws(()=>cadence(latest,new Date('2026-11-15T12:00:00Z')));
});
