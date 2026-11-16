// Hourly scheduler opportunities, with collection roughly every two hours.
const fs = require('node:fs');
const { keys } = require('../lib/pilot-resorts');
function cadence(latest, now = new Date(), force = false) {
  const times = keys.map(k => Date.parse(latest[k]?.data?.timestamp)).filter(Number.isFinite);
  const lastCollected = times.length ? Math.max(...times) : null;
  const ageMinutes = lastCollected === null ? null : (+now - lastCollected) / 60000;
  if (ageMinutes !== null && ageMinutes < -15) throw Error('Published collection timestamp is in the future');
  return { due: force || ageMinutes === null || ageMinutes >= 105, ageMinutes, lastCollected: lastCollected === null ? null : new Date(lastCollected).toISOString() };
}
if (require.main === module) {
  const result = cadence(JSON.parse(fs.readFileSync('data/latest-snow.json','utf8')), new Date(), process.env.GITHUB_EVENT_NAME === 'workflow_dispatch');
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `due=${result.due}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Last pilot collection: ${result.lastCollected || 'none'}. Age: ${result.ageMinutes === null ? 'unknown' : Math.round(result.ageMinutes)+' minutes'}. ${result.due ? 'Collection due.' : 'Skipping recent collection.'}\n`);
  if (result.ageMinutes > 180) console.log(`::warning::Pilot collection gap is ${Math.round(result.ageMinutes)} minutes; GitHub schedule delivery is delayed.`);
}
module.exports = { cadence };
