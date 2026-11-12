// Independent publication guard: no deletes, no historical daily rewrites, no unrelated paths.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { formatInTimeZone } = require('date-fns-tz');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const dir = fs.readdirSync('.cache/pilot').sort().at(-1);
const manifest = JSON.parse(fs.readFileSync(`.cache/pilot/${dir}/manifest.json`)).map(f => `data/${f}`);
const now = new Date();
const dates = new Set([formatInTimeZone(now, 'America/Denver', 'yyyy-MM-dd'), now.toISOString().slice(0, 10)]);
function allowed(file) {
  if (['data/latest.json', 'data/latest-snow.json'].includes(file)) return true;
  const match = /^data\/(breckenridge|keystone)\/(snow|terrain)\/(.+)$/.exec(file);
  if (!match) return false;
  if (match[3] === (match[2] === 'snow' ? 'latest.json' : 'index.json')) return true;
  const daily = /^(\d{4}-\d{2}-\d{2})\.(json|ndjson)$/.exec(match[3]);
  return daily && dates.has(daily[1]) && (daily[2] !== 'ndjson' || match[2] === 'snow');
}
if (!manifest.length || manifest.some(f => !allowed(f))) throw Error('Unsafe publication manifest');
const changed = git('diff', '--name-only', 'HEAD').split('\n').filter(Boolean);
const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
if ([...changed, ...untracked].some(f => !manifest.includes(f))) throw Error('Unrelated changes in checkout');
if (git('diff', '--name-only', '--diff-filter=D', 'HEAD')) throw Error('Publication would delete data');
git('add', '--', ...manifest);
git('commit', '-m', 'data: refresh Breckenridge and Keystone snow and terrain');
console.log(git('rev-parse', 'HEAD'));
