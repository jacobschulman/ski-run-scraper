const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readSnowAggregate, recoverConflictVariants} = require('../lib/recover-snow-aggregate');
test('normal aggregates pass through; unknown corruption still blocks publication', () => {
  assert.deepEqual(readSnowAggregate('{"vail":{"untouched":true}}'), {vail:{untouched:true}});
  assert.throws(() => readSnowAggregate('{bad json'));
  assert.throws(() => readSnowAggregate('<<<<<<< unknown\n{}\n=======\n{}\n>>>>>>> unknown'));
});
test('nested legacy conflicts retain every resort and newest whole observation', () => {
  const raw = `{
"vail": {"data":{"timestamp":"2026-05-01T00:00:00Z"}},
"breckenridge":
<<<<<<< Updated upstream
<<<<<<< Updated upstream
{"data":{"timestamp":"2026-02-02T10:14:00Z","snow":4}},
=======
{"data":{"timestamp":"2026-02-02T10:07:00Z","snow":3}},
>>>>>>> Stashed changes
=======
{"data":{"timestamp":"2026-02-02T10:00:00Z","snow":2}},
>>>>>>> Stashed changes
"keystone": {"data":{"timestamp":"2026-05-02T00:00:00Z"}}
}`;
  const result = recoverConflictVariants(raw);
  assert.deepEqual(Object.keys(result), ['vail','breckenridge','keystone']);
  assert.deepEqual(result.breckenridge, {data:{timestamp:'2026-02-02T10:14:00Z',snow:4}});
});
