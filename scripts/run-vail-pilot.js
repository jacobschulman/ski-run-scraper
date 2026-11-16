#!/usr/bin/env node
// Intentionally limited to the configured pilot resorts. Each resort must pass before its own publication.
const fs = require('node:fs');
const path = require('node:path');
const { formatInTimeZone } = require('date-fns-tz');
const { fetchSource } = require('../lib/source-http');
const { extractJSONAssignment } = require('../lib/embedded-json');
const { extractVailTerrain, validateTerrainFreshness } = require('../lib/vail-terrain-normalization');
const { validateSnowReport } = require('../lib/snow-freshness');
const { seasonOutputs } = require('../lib/season-reports');
const { readSnowAggregate } = require('../lib/recover-snow-aggregate');
const { normalizeVailSnowReport } = require('../lib/vail-snow-normalization');
const config = require('../config.json');
const { keys, vailIds } = require('../lib/pilot-resorts');
const { normalizeInspectorResort, normalizeInspectorSnowReport } = require('../lib/data-normalization');
const resorts = config.resorts.filter(r => keys.includes(r.key));

function checkTerrain(terrain, resort, now) {
  validateTerrainFreshness(terrain, vailIds[resort.key], now);
  if (!terrain.GroomingAreas?.flatMap(a => a.Trails || []).length) throw Error(`${resort.key}: empty terrain`);
}

async function collect(now = new Date(), request = fetchSource) {
  const records = [], outcomes = [];
  let inspectorFeed;
  for (const resort of resorts) {
    try {
      const date = formatInTimeZone(now, resort.timezone, 'yyyy-MM-dd');
      let terrain, snow, snowSource, provider;
      if (resort.provider === 'vail') {
        terrain = extractVailTerrain(await request(resort.terrainUrl, { json: false }));
        const html = await request(resort.snowReportUrl, { json: false });
        const raw = { snowReport: extractJSONAssignment(html, 'FR.snowReportData'), forecasts: extractJSONAssignment(html, 'FR.forecasts') };
        provider = 'vail'; snowSource = { snowReport: raw.snowReport };
        snow = normalizeVailSnowReport(resort.key, resort, raw, date, now);
      } else {
        inspectorFeed ??= await request(config.inspector.apiUrl + '?bearer_token=' + encodeURIComponent(config.inspector.bearerToken));
        const raw = inspectorFeed.Resorts?.find(r => r.Name === (resort.inspectorName || resort.name));
        if (!raw) throw Error(`${resort.key}: missing Inspector resort`);
        terrain = normalizeInspectorResort(raw);
        provider = 'inspector'; snowSource = { SnowReport: raw.SnowReport };
        snow = { ...normalizeInspectorSnowReport(raw, resort.key, resort.name, date), timestamp: now.toISOString(), provider: resort.provider };
      }
      checkTerrain(terrain, resort, now);
      const freshness = validateSnowReport(provider, snowSource, { timezone: resort.timezone, now });
      if (!freshness.accepted) throw Error(`${resort.key}: ${freshness.reason}`);
      records.push({ key: resort.key, date, terrain, snow, snowSource, freshness });
      outcomes.push({key:resort.key, accepted:true});
    } catch (error) { outcomes.push({key:resort.key, accepted:false, reason:error.message}); }
  }
  return { collectedAt: now.toISOString(), records, outcomes };
}

function publicationPlan(candidate, root, now = new Date()) {
  if (Math.abs(+now - Date.parse(candidate.collectedAt)) > 3600000) throw Error('Expired collection');
  if (!candidate.records.length || new Set(candidate.records.map(r => r.key)).size !== candidate.records.length || candidate.records.some(r => !keys.includes(r.key))) throw Error('Empty, duplicate or unknown pilot records');
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  // Require aggregates: a missing/sparse checkout must never erase other resorts.
  const latest = read('latest.json');
  const latestSnow = readSnowAggregate(fs.readFileSync(path.join(root, 'latest-snow.json'), 'utf8'));
  const writes = new Map();
  writes.outcomes = [];
  for (const record of candidate.records) {
    const resort = resorts.find(r => r.key === record.key);
    if (!resort) throw Error('Outside pilot allowlist');
    const { key, date, terrain, snow } = record;
    try {
      const resortWrites = new Map();
      const collected = new Date(candidate.collectedAt);
      if (date !== formatInTimeZone(collected, resort.timezone, 'yyyy-MM-dd') || date !== formatInTimeZone(now, resort.timezone, 'yyyy-MM-dd')) throw Error('Collection crossed local date; recollect');
      checkTerrain(terrain, resort, now);
      const snowGate = validateSnowReport(resort.provider === 'vail' ? 'vail' : 'inspector', record.snowSource || { snowReport: { LastUpdatedText: snow.lastUpdated, BaseDepth: { Inches: snow.baseDepth.inches } } }, { timezone: resort.timezone, now });
      if (!snowGate.accepted) throw Error('Snow expired before publication');
      for (const [old, incoming] of [[latest[key]?.data?.Date, terrain.Date], [latestSnow[key]?.data?.timestamp, snow.timestamp]]) {
        if (old && Date.parse(old) > Date.parse(incoming)) throw Error('Refusing to replace a newer observation');
      }
      const terrainRecord = { ...terrain, provider: resort.provider, scrapedAt: candidate.collectedAt, sourceLastUpdated: terrain.Date };
      resortWrites.set(`${key}/terrain/${date}.json`, terrainRecord);
      const utcDate = collected.toISOString().slice(0, 10);
      if (utcDate !== date) resortWrites.set(`${key}/terrain/${utcDate}.json`, terrainRecord);
      resortWrites.set(`${key}/snow/${date}.json`, snow);
      resortWrites.set(`${key}/snow/latest.json`, snow);
      const stream = `${key}/snow/${date}.ndjson`;
      const previous = fs.existsSync(path.join(root, stream)) ? fs.readFileSync(path.join(root, stream), 'utf8') : '';
      if (previous && !previous.endsWith('\n')) throw Error('Malformed existing snow stream');
      resortWrites.set(stream, previous + JSON.stringify(snow) + '\n');
      const terrainDir = path.join(root, key, 'terrain');
      const files = new Set((fs.existsSync(terrainDir) ? fs.readdirSync(terrainDir) : key === 'abasin' ? [] : (() => { throw Error('Missing terrain history checkout'); })()).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, -5)));
      files.add(date); files.add(utcDate);
      const sorted = [...files].sort().reverse();
      resortWrites.set(`${key}/terrain/index.json`, { resort: key, resortName: resort.name, provider: resort.provider, files: sorted, latest: sorted[0], count: sorted.length, generated: candidate.collectedAt });
      for (const [file,value] of seasonOutputs(root,resort,resortWrites,now,{currentOnly:true})) resortWrites.set(file,value);
      for (const [file, value] of resortWrites) writes.set(file, value);
      writes.outcomes.push({key, accepted:true});
      latest[key] = { date, name: resort.name, provider: resort.provider, data: terrain };
      latestSnow[key] = { date, name: resort.name, provider: resort.provider, data: snow };
    } catch (error) { writes.outcomes.push({key, accepted:false, reason:error.message}); }
  }
  if (!writes.size) {
    const error = Error('No resort passed publication validation');
    error.outcomes = writes.outcomes;
    throw error;
  }
  writes.set('latest.json', latest); writes.set('latest-snow.json', latestSnow);
  return writes;
}

async function main() {
  const candidate = await collect();
  const out = path.resolve('.cache/pilot', candidate.collectedAt.replace(/[:.]/g, '-'));
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'candidate.json'), JSON.stringify(candidate, null, 2));
  for (const r of candidate.records) console.log(`${r.key}: ${r.terrain.GroomingAreas.flatMap(a => a.Trails).length} trails; snow ${r.freshness.reason}`);
  let outcomes = candidate.outcomes;
  fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify({collectedAt:candidate.collectedAt,outcomes}, null, 2));
  if (!candidate.records.length) throw Error('All resorts rejected; see candidate.json');
  if (process.argv.includes('--publish')) {
    const root = path.resolve('data');
    let writes;
    try { writes = publicationPlan(candidate, root); }
    catch (error) {
      fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify({collectedAt:candidate.collectedAt,outcomes:[...candidate.outcomes.filter(o=>!o.accepted), ...(error.outcomes || [])],error:error.message}, null, 2));
      throw error;
    }
    outcomes = [...candidate.outcomes.filter(o => !o.accepted), ...writes.outcomes];
    fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify({collectedAt:candidate.collectedAt,outcomes}, null, 2));
    for (const [file, value] of writes) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    }
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify([...writes.keys()], null, 2));
  }
  for (const o of outcomes.filter(o => !o.accepted)) console.log(`::warning::${o.key}: ${o.reason.replace(/[\r\n]/g,' ')}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n| Resort | Result |\n|---|---|\n' + outcomes.map(o => `| ${o.key} | ${o.accepted ? 'Published candidate accepted' : 'Skipped: '+o.reason.replace(/[\r\n|]/g,' ')} |`).join('\n')+'\n');
  console.log(out);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { collect, publicationPlan };
