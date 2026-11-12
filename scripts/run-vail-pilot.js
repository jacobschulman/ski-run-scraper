#!/usr/bin/env node
// Intentionally limited to two resorts. Collection must pass before any publication.
const fs = require('node:fs');
const path = require('node:path');
const { formatInTimeZone } = require('date-fns-tz');
const { fetchSource } = require('../lib/source-http');
const { extractJSONAssignment } = require('../lib/embedded-json');
const { extractVailTerrain, validateTerrainFreshness } = require('../lib/vail-terrain-normalization');
const { validateSnowReport } = require('../lib/snow-freshness');
const { normalizeVailSnowReport } = require('../lib/vail-snow-normalization');
const resorts = require('../config.json').resorts.filter(r => ['breckenridge', 'keystone'].includes(r.key));

async function collect(now = new Date()) {
  const records = [];
  for (const resort of resorts) {
    const terrain = extractVailTerrain(await fetchSource(resort.terrainUrl, { json: false }));
    validateTerrainFreshness(terrain, resort.key === 'breckenridge' ? 4 : 8, now);
    const html = await fetchSource(resort.snowReportUrl, { json: false });
    const raw = { snowReport: extractJSONAssignment(html, 'FR.snowReportData'), forecasts: extractJSONAssignment(html, 'FR.forecasts') };
    const freshness = validateSnowReport('vail', raw, { timezone: resort.timezone, now });
    if (!freshness.accepted) throw Error(`${resort.key}: ${freshness.reason}`);
    const date = formatInTimeZone(now, resort.timezone, 'yyyy-MM-dd');
    records.push({ key: resort.key, date, terrain, snow: normalizeVailSnowReport(resort.key, resort, raw, date, now), freshness });
  }
  return { collectedAt: now.toISOString(), records };
}

function publicationPlan(candidate, root, now = new Date()) {
  if (Math.abs(+now - Date.parse(candidate.collectedAt)) > 3600000) throw Error('Expired collection');
  if (candidate.records.length !== 2 || new Set(candidate.records.map(r => r.key)).size !== 2) throw Error('Incomplete pilot');
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  // Require aggregates: a missing/sparse checkout must never erase other resorts.
  const latest = read('latest.json'), latestSnow = read('latest-snow.json');
  const writes = new Map();
  for (const record of candidate.records) {
    const resort = resorts.find(r => r.key === record.key);
    if (!resort) throw Error('Outside pilot allowlist');
    const { key, date, terrain, snow } = record;
    const collected = new Date(candidate.collectedAt);
    if (date !== formatInTimeZone(collected, resort.timezone, 'yyyy-MM-dd') || date !== formatInTimeZone(now, resort.timezone, 'yyyy-MM-dd')) throw Error('Collection crossed local date; recollect');
    validateTerrainFreshness(terrain, key === 'breckenridge' ? 4 : 8, now);
    const snowGate = validateSnowReport('vail', { snowReport: { LastUpdatedText: snow.lastUpdated, BaseDepth: { Inches: snow.baseDepth.inches } } }, { timezone: resort.timezone, now });
    if (!snowGate.accepted) throw Error('Snow expired before publication');
    for (const [old, incoming] of [[latest[key]?.data?.Date, terrain.Date], [latestSnow[key]?.data?.timestamp, snow.timestamp]]) {
      if (old && Date.parse(old) > Date.parse(incoming)) throw Error('Refusing to replace a newer observation');
    }
    const terrainRecord = { ...terrain, provider: 'vail', scrapedAt: candidate.collectedAt, sourceLastUpdated: terrain.Date };
    writes.set(`${key}/terrain/${date}.json`, terrainRecord);
    const utcDate = collected.toISOString().slice(0, 10);
    if (utcDate !== date) writes.set(`${key}/terrain/${utcDate}.json`, terrainRecord);
    writes.set(`${key}/snow/${date}.json`, snow);
    writes.set(`${key}/snow/latest.json`, snow);
    const stream = `${key}/snow/${date}.ndjson`;
    const previous = fs.existsSync(path.join(root, stream)) ? fs.readFileSync(path.join(root, stream), 'utf8') : '';
    if (previous && !previous.endsWith('\n')) throw Error('Malformed existing snow stream');
    writes.set(stream, previous + JSON.stringify(snow) + '\n');
    const terrainDir = path.join(root, key, 'terrain');
    const files = new Set(fs.readdirSync(terrainDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, -5)));
    files.add(date); files.add(utcDate);
    const sorted = [...files].sort().reverse();
    writes.set(`${key}/terrain/index.json`, { resort: key, resortName: resort.name, provider: 'vail', files: sorted, latest: sorted[0], count: sorted.length, generated: candidate.collectedAt });
    latest[key] = { date, name: resort.name, provider: 'vail', data: terrain };
    latestSnow[key] = { date, name: resort.name, provider: 'vail', data: snow };
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
  if (process.argv.includes('--publish')) {
    const root = path.resolve('data');
    const writes = publicationPlan(candidate, root);
    for (const [file, value] of writes) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    }
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify([...writes.keys()], null, 2));
  }
  console.log(out);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { collect, publicationPlan };
