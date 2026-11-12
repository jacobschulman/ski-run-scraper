#!/usr/bin/env node
// Read-only source audit. Never invokes scraper entrypoints, publishing, SSH, or PM2.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const config = require('../config.json');
const normalizers = require('../lib/data-normalization');

const { extractJSONAssignment } = require('../lib/embedded-json');
const { extractVailTerrain } = require('../lib/vail-terrain-normalization');
function redactURL(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (/token|key|secret|password/i.test(key)) url.searchParams.set(key, 'REDACTED');
  return url.toString();
}
function terrainSummary(data) {
  if (!data || !Array.isArray(data.Lifts) || !Array.isArray(data.GroomingAreas)) throw Error('Unexpected terrain schema');
  const trails = data.GroomingAreas.flatMap(a => a.Trails || []);
  return {
    lifts: data.Lifts.length, trails: trails.length,
    openLifts: data.Lifts.filter(l => /^(open|1)$/i.test(String(l.Status))).length,
    numericWaits: data.Lifts.filter(l => typeof l.WaitTimeInMinutes === 'number' && Number.isFinite(l.WaitTimeInMinutes)).length,
    positiveWaits: data.Lifts.filter(l => typeof l.WaitTimeInMinutes === 'number' && l.WaitTimeInMinutes > 0).length,
  };
}
function sourceDates(data) {
  const found = {};
  function visit(value, prefix, depth) {
    if (!value || typeof value !== 'object' || depth > 2) return;
    for (const [key, item] of Object.entries(value)) {
      if (/date|updated|modified|timestamp/i.test(key) && (typeof item === 'string' || typeof item === 'number')) found[prefix + key] = item;
      else if (item && typeof item === 'object' && !Array.isArray(item)) visit(item, prefix + key + '.', depth + 1);
    }
  }
  visit(data, '', 0);
  return found; // Raw source values: never substitute audit time for source freshness.
}
function targets(r) {
  if (r.provider === 'vail') return [
    { kind: 'terrain', mode: 'embedded-json', url: r.terrainUrl, variable: 'FR.TerrainStatusFeed' },
    { kind: 'snow', mode: 'embedded-json', url: r.snowReportUrl, variable: 'FR.snowReportData' },
  ].filter(t => t.url);
  const p = r.apiProvider || 'inspector', a = r.apiConfig || {};
  let list = [];
  if (p === 'inspector') list = [{kind: 'combined', mode: p, url: config.inspector.apiUrl + '?bearer_token=' + encodeURIComponent(config.inspector.bearerToken)}];
  if (p === 'dor') list = [{kind: 'terrain', mode: p, url: a.baseUrl + a.endpoint}];
  if (p === 'reportpal') list = [{kind: 'combined', mode: p, url: `${a.baseUrl}/api/reportpal?resortName=${a.resortCode}&useReportPal=true`}];
  if (p === 'zaneray') list = [{kind: 'combined', mode: p, url: a.apiUrl}];
  if (p === 'aspensnowmass') list = ['LiftStatus', 'GroomingReport', 'SnowReport'].map(type => ({kind: type, mode: p, url: `https://www.aspensnowmass.com/AspenSnowmass/${type}/Feed?mountain=${a.mountainId}${type === 'LiftStatus' ? '&areas=&isSummer=False' : ''}`}));
  if (p === 'canadian-big3') {
    const urls = {lakelouise: ['https://ski-louise-status-page.vercel.app/api/ski-data'], banff: ['https://sdds4.intermaps.com/sunshine_village/sunshine_village.aspx?lang=en&region_id=2486', 'https://www.skibanff.com/conditions/'], norquay: ['https://banffnorquay.com/winter/conditions/']};
    list = (urls[r.key] || []).map(url => ({kind: 'combined', mode: 'custom-unvalidated', url}));
  }
  if (r.snowApiProvider === 'snocountry') list.push({kind: 'snow', mode: 'snocountry', url: `http://feeds.snocountry.net/getSnowReport.php?apiKey=${encodeURIComponent(process.env.SNOCOUNTRY_API_KEY || 'SnoCountry.example')}&ids=${r.snowApiConfig.resortId}`});
  return list;
}
async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('node scripts/audit-scrapers.js [--resorts key,key] [--browser key,key]\nOutputs isolated raw samples and report.json/report.txt under .cache/scraper-audit/. No production writes.'); return; }
  const option = name => { const i = args.indexOf(name); if (i < 0) return null; if (!args[i+1] || args[i+1].startsWith('--')) throw Error(`Missing value for ${name}`); return args[i+1].split(','); };
  const selected = option('--resorts'), browserKeys = option('--browser') || [];
  for (const key of [...(selected || []), ...browserKeys]) if (!config.resorts.some(r => r.key === key)) throw Error(`Unknown resort ${key}`);
  const resorts = config.resorts.filter(r => !selected || selected.includes(r.key));
  const startedAt = new Date().toISOString();
  const output = path.join(root, '.cache/scraper-audit', startedAt.replace(/[:.]/g, '-'));
  fs.mkdirSync(path.join(output, 'raw'), {recursive: true});
  const cache = new Map(), results = [];
  async function request(url) {
    if (cache.has(url)) return cache.get(url);
    const promise = (async () => {
      const started = Date.now();
      const id = crypto.createHash('sha256').update(url).digest('hex').slice(0,16);
      try {
        const response = await fetch(url, {signal: AbortSignal.timeout(20000), headers: {'User-Agent': 'SkiRunScraper/1.0', Accept: '*/*'}});
        const body = await response.text();
        const rawFile = `raw/${id}.txt`;
        fs.writeFileSync(path.join(output, rawFile), body);
        return {body, transport: {url: redactURL(url), finalURL: redactURL(response.url), status: response.status, fetchedAt: new Date().toISOString(), ms: Date.now()-started, bytes: Buffer.byteLength(body), contentType: response.headers.get('content-type'), cacheAge: response.headers.get('age'), lastModified: response.headers.get('last-modified'), etag: response.headers.get('etag'), sha256: crypto.createHash('sha256').update(body).digest('hex'), rawFile}};
      } catch(e) { return {transport: {url: redactURL(url), fetchedAt: new Date().toISOString(), ms: Date.now()-started, error: e.cause?.code || e.name}}; }
    })();
    cache.set(url, promise);
    return promise;
  }
  async function audit(r, t) {
    const {body, transport} = await request(t.url);
    const result = {resort: r.key, provider: r.apiProvider || (r.provider === 'vail' ? 'vail' : 'inspector'), kind: t.kind, mode: t.mode, ...transport, outcome: 'unvalidated', browserParity: 'not-tested'};
    try {
      if (transport.error) result.outcome = 'request-failed';
      else if (transport.status < 200 || transport.status >= 300) result.outcome = 'http-error';
      else if (t.mode === 'custom-unvalidated') { result.outcome = 'custom-parser-needed'; result.format = /^\s*</.test(body) ? 'html-or-xml' : 'other'; }
      else {
        let data = t.variable ? extractJSONAssignment(body, t.variable, {last: t.variable === 'FR.TerrainStatusFeed'}) : JSON.parse(body);
        if (!data) result.outcome = 'embedded-feed-missing';
        else {
          if (t.mode === 'inspector') {
            if (!Array.isArray(data.Resorts)) throw Error('Inspector Resorts array missing');
            result.feedResorts = data.Resorts.length;
            data = data.Resorts.find(d => d.Name === (r.inspectorName || r.name));
            if (!data) { result.outcome = 'resort-missing'; return result; }
          }
          result.sourceDates = sourceDates(data);
          if (data.IsSuccessful === false) { result.outcome = 'upstream-error'; result.error = String(data.ErrorDetails || 'Source reported failure').slice(0,200); return result; }
          result.keys = Object.keys(data).slice(0, 35);
          let normalized;
          const methods = {inspector:'normalizeInspectorResort', dor:'normalizeDORResort', reportpal:'normalizeReportPalResort', zaneray:'normalizeZanerayResort'};
          if (t.variable === 'FR.TerrainStatusFeed') normalized = data;
          else if (methods[t.mode]) normalized = normalizers[methods[t.mode]](data, r.key);
          else if (t.mode === 'aspensnowmass' && t.kind !== 'SnowReport') normalized = normalizers.normalizeAspenResort({[t.kind === 'LiftStatus' ? 'liftStatus' : 'groomingReport']:data},r.key);
          if (normalized) {
            result.counts = terrainSummary(normalized);
            result.outcome = result.counts.lifts + result.counts.trails ? 'terrain-extracted-unverified' : 'empty-terrain';
            if (t.mode === 'dor') result.rawCounts = {lifts:data.lift?.length, trails:data.trail?.length};
          } else {
            result.outcome = 'snow-payload-unverified';
            if (t.mode === 'snocountry') { result.items = data.items?.length || 0; if (!result.items) result.outcome = 'empty-snow'; }
          }
        }
      }
    } catch(e) { result.outcome = 'parse-or-schema-error'; result.error = e.message.slice(0,200); }
    return result;
  }
  // Three workers; resorts are sequential within each worker. Shared feeds are fetched once.
  const queue = [...resorts];
  await Promise.all(Array.from({length:3}, async () => {
    while (queue.length) {
      const r = queue.shift();
      for (const t of targets(r)) { const row = await audit(r,t); results.push(row); console.log(`${r.key} ${t.kind}: ${row.outcome}`); }
      await new Promise(resolve => setTimeout(resolve,250));
    }
  }));
  const browserResults = [];
  if (browserKeys.length) {
    const puppeteer = require('puppeteer');
    let browser;
    try {
      browser = await puppeteer.launch({headless:true, args:process.env.CI ? ['--no-sandbox'] : []});
      for (const key of browserKeys) {
        const resort = config.resorts.find(r => r.key === key);
        if (!resort.terrainUrl) { browserResults.push({resort:key,error:'No terrain page configured'}); continue; }
        const page = await browser.newPage();
        const row = {resort:key, fetchedAt:new Date().toISOString()};
        try {
          await page.goto(resort.terrainUrl, {waitUntil:'domcontentloaded',timeout:30000});
          await page.waitForFunction(() => window.FR?.TerrainStatusFeed, {timeout:15000});
          // Allow client-side updates after initial hydration; no claim of operating-hours parity.
          await new Promise(resolve => setTimeout(resolve,5000));
          const data = await page.evaluate(() => window.FR.TerrainStatusFeed);
          row.counts = terrainSummary(data); row.sourceDates = sourceDates(data);
          fs.writeFileSync(path.join(output,'raw',`${key}-browser.json`),JSON.stringify(data,null,2));
          const http = results.find(r => r.resort === key && r.kind === 'terrain');
          const sample = http?.rawFile && fs.readFileSync(path.join(output,http.rawFile),'utf8');
          const httpData = sample && extractVailTerrain(sample);
          const signature = d => JSON.stringify((d?.Lifts || []).map(l => ({name:l.Name,status:l.Status,wait:l.WaitTimeInMinutes})).sort((a,b)=>String(a.name).localeCompare(String(b.name))));
          row.liftValuesMatch = !!httpData && signature(httpData) === signature(data);
          const trailStates = d => (d?.GroomingAreas || []).flatMap(area => (area.Trails || []).map(t => ({area:area.Name,id:t.Id,name:t.Name,open:t.IsOpen,groomed:t.IsGroomed}))).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
          row.terrainComparison = {
            nonempty: trailStates(data).length > 0 && trailStates(httpData).length > 0,
            trailCount: trailStates(data).length,
            identityOpenGroomingMatch: !!httpData && JSON.stringify(trailStates(httpData)) === JSON.stringify(trailStates(data)),
            legacyRecordMatch: !!httpData && JSON.stringify({...httpData,Date:null}) === JSON.stringify({...data,Date:null}),
            note: 'Labeled final page assignment plus browser area order; source timestamps excluded from sequential comparison.'
          };
          if (http) http.browserParity = row.liftValuesMatch ? 'lift-values-match-this-sample' : 'different-or-missing-http-feed';
        } catch(e) { row.error = e.name + ': ' + e.message.slice(0,150); }
        finally { await page.close(); }
        browserResults.push(row); console.log(`browser ${key}: ${row.error || row.liftValuesMatch}`);
      }
    } catch(e) { browserResults.push({error:e.message.slice(0,200)}); }
    finally { if (browser) await browser.close(); }
  }
  results.sort((a,b)=>a.resort.localeCompare(b.resort)||a.kind.localeCompare(b.kind));
  const report = {startedAt,finishedAt:new Date().toISOString(),resorts:resorts.length,uniqueRequests:cache.size,limitations:['Single audit from this machine/network; cloud IP accessibility untested.','Source timestamps are unverified metadata, not proof of current observations.','No production writes; no Hetzner access.','Custom Canadian parsers and snow semantics require further validation.','Browser comparisons are sequential samples, not simultaneous observations.'],results,browserResults};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  const lines = [`Scraper audit ${startedAt}`,`${resorts.length} resorts, ${cache.size} unique HTTP requests`,'',...report.limitations,'','Resort | Feed | HTTP | Outcome | Lifts | Trails | Numeric waits',...results.map(r=>`${r.resort} | ${r.kind} | ${r.status || r.error} | ${r.outcome} | ${r.counts?.lifts ?? '-'} | ${r.counts?.trails ?? '-'} | ${r.counts?.numericWaits ?? '-'}`),'', 'Browser comparisons:',JSON.stringify(browserResults,null,2)];
  fs.writeFileSync(path.join(output,'report.txt'),lines.join('\n')+'\n');
  console.log(`Report: ${output}/report.json`);
}
if (require.main === module) run().catch(e => {console.error(e.message);process.exitCode=1;});
module.exports = {extractJSONAssignment,redactURL,terrainSummary,sourceDates,targets};
