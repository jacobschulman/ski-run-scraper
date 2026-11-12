const { createHash } = require('node:crypto');
// Exact pre-pilot latest-snow.json on main (dc6016e). This derived aggregate
// contains nested unresolved stash conflicts. Historical daily files are untouched.
const KNOWN_CONFLICTED_SHA256 = '2898482ab341fd160497eeb6ceb1d1b1240b74f0c80b90ad446f6a24eacd126f';

function recoverConflictVariants(raw) {
  const lines = raw.split('\n');
  let depth = 0, maxDepth = 0;
  for (const line of lines) {
    if (line.startsWith('<<<<<<< ')) maxDepth = Math.max(maxDepth, ++depth);
    else if (line.startsWith('>>>>>>> ')) depth--;
    if (depth < 0) throw Error('Unbalanced aggregate conflict');
  }
  if (depth || !maxDepth || maxDepth > 2) throw Error('Unexpected aggregate conflict structure');
  const variants = [];
  for (let mask = 0; mask < 2 ** maxDepth; mask++) {
    const stack = [], output = [];
    for (const line of lines) {
      if (line.startsWith('<<<<<<< ')) stack.push(true);
      else if (line === '=======') {
        if (!stack.length) throw Error('Unbalanced aggregate conflict');
        stack[stack.length - 1] = false;
      } else if (line.startsWith('>>>>>>> ')) stack.pop();
      else if (stack.every((upstream, index) => upstream === !(mask & (1 << index)))) output.push(line);
    }
    variants.push(JSON.parse(output.join('\n')));
  }
  const keys = Object.keys(variants[0]).sort();
  if (variants.some(v => JSON.stringify(Object.keys(v).sort()) !== JSON.stringify(keys))) throw Error('Conflicting aggregate resort membership');
  const result = {};
  for (const key of Object.keys(variants[0])) {
    const records = variants.map(v => v[key]);
    if (records.some(r => !Number.isFinite(Date.parse(r.data?.timestamp)))) throw Error('Aggregate record missing observation timestamp');
    // Keep complete records; never splice forecast or measurements across observations.
    records.sort((a, b) => Date.parse(b.data.timestamp) - Date.parse(a.data.timestamp));
    result[key] = records[0];
  }
  return result;
}
function readSnowAggregate(raw) {
  try { return JSON.parse(raw); } catch (error) {
    if (createHash('sha256').update(raw).digest('hex') !== KNOWN_CONFLICTED_SHA256) throw error;
    const result = recoverConflictVariants(raw);
    if (Object.keys(result).length !== 65) throw Error('Unexpected recovered resort count');
    console.log('Recovered known legacy snow aggregate conflicts; retained all 65 resorts and newest complete observations.');
    return result;
  }
}
module.exports = { readSnowAggregate, recoverConflictVariants };
