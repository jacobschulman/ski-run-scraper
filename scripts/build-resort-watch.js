#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config.json');
const { buildWatch } = require('../lib/resort-watch');
const dir = '.cache/scraper-audit';
const latest = fs.readdirSync(dir).sort().at(-1);
const audit = JSON.parse(fs.readFileSync(path.join(dir, latest, 'report.json')));
if (Date.now() - Date.parse(audit.finishedAt) > 3600000) throw Error('Audit is too old');
const destination = 'data/resort-watch.json';
const previous = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination)) : {};
const report = buildWatch(config, audit, previous);
fs.mkdirSync('data', {recursive: true});
fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
const counts = {};
for (const r of Object.values(report.resorts)) counts[r.status] = (counts[r.status] || 0) + 1;
console.log(JSON.stringify(counts));
