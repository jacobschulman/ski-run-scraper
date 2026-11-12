#!/usr/bin/env node
// Compare raw snow observations, not fetch timestamps, from HTTP and local Chrome.
const fs=require('fs'),path=require('path');
const {fetchSource}=require('../lib/source-http');
const {extractJSONAssignment}=require('../lib/embedded-json');
const {validateSnowReport}=require('../lib/snow-freshness');
async function main(){
 const key=process.argv[2]||'keystone';const r=require('../config.json').resorts.find(r=>r.key===key&&r.provider==='vail');if(!r)throw Error('Unknown Vail resort');
 const dir=path.resolve(__dirname,'../.cache/scraper-recovery',`${Date.now()}-${key}-parity`);fs.mkdirSync(dir,{recursive:true});
 const browser=await require('puppeteer').launch({headless:true, args:process.env.CI ? ['--no-sandbox'] : []});const report={resort:key,checkedAt:new Date().toISOString(),limitations:['Local network only; sequential samples; forecast not compared.']};
 try{
  const page=await browser.newPage();
  try{await page.goto(r.snowReportUrl,{waitUntil:'domcontentloaded',timeout:30000});}catch(e){report.navigationWarning=e.name;}
  await page.waitForFunction(()=>window.FR?.snowReportData,{timeout:15000});
  await new Promise(resolve=>setTimeout(resolve,5000));
  const observed=await page.evaluate(()=>window.FR.snowReportData);
  const html=await fetchSource(r.snowReportUrl,{json:false});const direct=extractJSONAssignment(html,'FR.snowReportData');
  fs.writeFileSync(path.join(dir,'browser.json'),JSON.stringify(observed,null,2));fs.writeFileSync(path.join(dir,'http.json'),JSON.stringify(direct,null,2));
  const canonical=v=>v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  report.rawSnowMatches=JSON.stringify(canonical(observed))===JSON.stringify(canonical(direct));
  report.http=validateSnowReport('vail',{snowReport:direct},{timezone:r.timezone});
  report.browser=validateSnowReport('vail',{snowReport:observed},{timezone:r.timezone});
  if(!report.rawSnowMatches||!report.http.accepted||!report.browser.accepted)process.exitCode=1;
 }catch(e){report.error=e.message;process.exitCode=1;}
 finally{await browser.close();fs.writeFileSync(path.join(dir,'parity.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log(dir);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
