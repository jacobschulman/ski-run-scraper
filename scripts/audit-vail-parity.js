#!/usr/bin/env node
// Focused public-page diagnostic; no production scraper imports or writes.
const fs = require('node:fs');
const path = require('node:path');
const {extractJSONAssignment,redactURL,terrainSummary,sourceDates} = require('./audit-scrapers');
async function main() {
  const key = process.argv[2] || 'keystone';
  const resort = require('../config.json').resorts.find(r=>r.key===key && r.provider==='vail');
  if (!resort) throw Error('Expected a configured Vail resort key');
  const dir=path.resolve(__dirname,'../.cache/scraper-audit',`${new Date().toISOString().replace(/[:.]/g,'-')}-${key}-parity`);
  fs.mkdirSync(dir,{recursive:true});
  const browser=await require('puppeteer').launch({headless:true});
  const pending=[];
  const report={resort:key,startedAt:new Date().toISOString(),network:[],limitations:['Sequential local-network samples; no proof of ongoing freshness or cloud access.','Numeric status codes are preserved; exact differences may be representation changes.']};
  try {
    const page=await browser.newPage();
    page.on('response',res=>{
      if (!/\/api\/TerrainApi\/GetTerrainStatus/i.test(res.url())) return;
      const request=res.request();
      const headers=Object.fromEntries(Object.entries(request.headers()).filter(([k])=>['content-type','origin','referer'].includes(k)));
      const entry={url:redactURL(res.url()),status:res.status(),method:request.method(),headers,body:request.postData()};
      report.network.push(entry);
      pending.push((async()=>{
        try {
          const browserBody=await res.text();
          fs.writeFileSync(path.join(dir,'browser-api.json'),browserBody);
          try {const data=JSON.parse(browserBody);entry.browserPayload={successful:data.IsSuccessful,error:data.ErrorDetails,counts:terrainSummary(data)};}catch{}
          const replay=await fetch(res.url(),{method:request.method(),headers,body:request.postData(),signal:AbortSignal.timeout(20000)});
          const body=await replay.text();
          fs.writeFileSync(path.join(dir,'http-api.txt'),body);
          entry.directReplay={status:replay.status,bytes:Buffer.byteLength(body)};
          try {const data=JSON.parse(body);entry.directReplay.keys=Object.keys(data);entry.directReplay.successful=data.IsSuccessful;entry.directReplay.error=data.ErrorDetails;entry.directReplay.sourceDates=sourceDates(data);if(data.Lifts)entry.directReplay.counts=terrainSummary(data);}catch{}
        }catch(e){entry.error=e.name;}
      })());
    });
    try {await page.goto(resort.terrainUrl,{waitUntil:'domcontentloaded',timeout:30000});}catch(e){report.navigationError=e.name;}
    await page.waitForFunction(()=>window.FR?.TerrainStatusFeed,{timeout:15000});
    await new Promise(resolve=>setTimeout(resolve,5000));
    const before=await page.evaluate(()=>window.FR.TerrainStatusFeed);
    const response=await fetch(resort.terrainUrl,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'SkiRunScraper/1.0'}});
    const html=await response.text();
    fs.writeFileSync(path.join(dir,'http.html'),html);
    const http=extractJSONAssignment(html,'FR.TerrainStatusFeed');
    const after=await page.evaluate(()=>window.FR.TerrainStatusFeed);
    for(const [name,data] of Object.entries({before,http,after})) {
      fs.writeFileSync(path.join(dir,`${name}.json`),JSON.stringify(data,null,2));
      report[name]={counts:data?terrainSummary(data):null,sourceDates:sourceDates(data)};
    }
    report.http.status=response.status;
    report.http.fetchedAt=new Date().toISOString();
    const old=new Map((http?.Lifts||[]).map(l=>[l.Name,l]));
    report.differences=(after.Lifts||[]).filter(l=>JSON.stringify([l.Status,l.WaitTimeInMinutes])!==JSON.stringify([old.get(l.Name)?.Status,old.get(l.Name)?.WaitTimeInMinutes])).map(l=>({name:l.Name,http:{status:old.get(l.Name)?.Status,wait:old.get(l.Name)?.WaitTimeInMinutes},browser:{status:l.Status,wait:l.WaitTimeInMinutes}}));
  } catch(e) {report.error=e.name+': '+e.message.slice(0,200);process.exitCode=1;}
  finally {await Promise.allSettled(pending);await browser.close();fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(path.join(dir,'report.json'));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
