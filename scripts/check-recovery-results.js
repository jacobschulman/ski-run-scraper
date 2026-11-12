const fs=require('fs'),path=require('path');
const root=path.resolve('.cache/scraper-recovery');
const reports=fs.existsSync(root)?fs.readdirSync(root).map(d=>path.join(root,d,'run.json')).filter(p=>fs.existsSync(p)):[];
if(!reports.length)throw Error('No recovery run reports');
const latest=reports.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
const report=JSON.parse(fs.readFileSync(latest));
if(!report.outcomes.length||report.outcomes.some(r=>!r.accepted)){console.error('Selected sources are not all ready; inspect run.json for rejection reasons.');process.exitCode=1;}
else console.log(`${report.outcomes.length} selected sources passed source freshness and payload checks.`);
