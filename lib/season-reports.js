const fs = require('node:fs');
const path = require('node:path');
const {formatInTimeZone} = require('date-fns-tz');

function seasonFor(date, resort = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Expected local YYYY-MM-DD date');
  const year = +date.slice(0,4);
  if (resort.timezone?.startsWith('Australia/')) return {id:String(year),label:String(year),start:`${year}-01-01`,end:`${year}-12-31`};
  const start = +date.slice(5,7) >= 7 ? year : year-1;
  return {id:`${start}-${start+1}`,label:`${start}/${String(start+1).slice(2)}`,start:`${start}-07-01`,end:`${start+1}-06-30`};
}
function slug(name) { return String(name).toLowerCase().replace(/[^\w\s-]/g,'').replace(/\s+/g,'-').replace(/--+/g,'-').trim(); }
function datedFiles(root, key, kind, planned, trackedFiles = []) {
  const dir=path.join(root,key,kind);
  const files=new Set(fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>/^\d{4}-\d{2}-\d{2}\.(json|ndjson)$/.test(f)):[]);
  for(const file of trackedFiles) if(file.startsWith(`${key}/${kind}/`) && /^\d{4}-\d{2}-\d{2}\.(json|ndjson)$/.test(path.basename(file))) files.add(path.basename(file));
  for(const file of planned.keys()) if(file.startsWith(`${key}/${kind}/`)) {
    const name=path.basename(file);if(/^\d{4}-\d{2}-\d{2}\.(json|ndjson)$/.test(name))files.add(name);
  }
  return [...files].sort();
}
function summarize(resort, season, records, now) {
  const byDate=new Map();const errors=[];
  for(const {file,data,error} of records) {
    if(error){errors.push({file,error});continue;}
    if(!Array.isArray(data.GroomingAreas)||!Array.isArray(data.Lifts)||data.IsSuccessful===false){errors.push({file,error:'Invalid terrain schema'});continue;}
    let localDate=file.slice(0,10);
    if(data.scrapedAt && Number.isFinite(Date.parse(data.scrapedAt)))localDate=formatInTimeZone(new Date(data.scrapedAt),resort.timezone,'yyyy-MM-dd');
    if(seasonFor(localDate,resort).id!==season.id)continue;
    // The UTC compatibility copy represents the same observation, not another ski day.
    const old=byDate.get(localDate);
    if(!old||Date.parse(data.scrapedAt||data.Date)>Date.parse(old.data.scrapedAt||old.data.Date))byDate.set(localDate,{file,data});
  }
  const days=[...byDate.keys()].sort();const latestDate=days.at(-1)||null;
  const latest=latestDate?byDate.get(latestDate):null;
  const trails=new Map(),lifts=new Map();
  function add(map,entity,date,area,type) {
    const id=String(entity.Id??`${area}:${entity.Name}`);
    const entry=map.get(id)||{id,slug:slug(entity.Name),name:entity.Name,area,difficulty:entity.Difficulty??null,observedDays:0,openDays:0,groomedDays:0,currentStreak:0,longestStreak:0,lastGroomedDate:null};
    const open=type==='trail'?(typeof entity.IsOpen==='boolean'?entity.IsOpen:null):entity.Status==='Open'?true:entity.Status==='Closed'?false:null;
    const groomed=type==='trail'?(typeof entity.IsGroomed==='boolean'?entity.IsGroomed:null):null;
    // Some feeds repeat the same entity in more than one area.
    if(entry.date!==date){entry.observedDays++;if(open===true)entry.openDays++;if(groomed===true)entry.groomedDays++;}
    const consecutive=entry.date&&(+new Date(date+'T12:00:00Z')-+new Date(entry.date+'T12:00:00Z')===86400000);
    if(entry.date!==date){entry.currentStreak=groomed===true?(consecutive?entry.currentStreak+1:1):0;entry.longestStreak=Math.max(entry.longestStreak,entry.currentStreak);}
    if(groomed===true)entry.lastGroomedDate=date;
    Object.assign(entry,{date,isOpen:open,isGroomed:groomed,status:type==='lift'?entity.Status:(open===true?'Open':open===false?'Closed':'Unknown')});
    map.set(id,entry);
  }
  for(const date of days){const {data}=byDate.get(date);for(const area of data.GroomingAreas)for(const trail of area.Trails||[])add(trails,trail,date,area.Name,'trail');for(const lift of data.Lifts)add(lifts,lift,date,lift.Mountain||lift.GroomingArea||'','lift');}
  for(const map of [trails,lifts])for(const e of map.values())if(e.date!==latestDate)Object.assign(e,{lastReportedStatus:e.status,status:'Not reported',isOpen:null,isGroomed:null,currentStreak:0});
  return {resort:resort.key,resortName:resort.name,timezone:resort.timezone,season,generatedAt:now.toISOString(),observedDays:days.length,snapshot:latest?{date:latestDate,sourceUpdated:latest.data.sourceLastUpdated||latest.data.Date,collectedAt:latest.data.scrapedAt||null,file:`../../terrain/${latest.file}`}:null,trails:[...trails.values()],lifts:[...lifts.values()],liftWaits:'not-collected-in-terrain-snapshots',errors};
}
function seasonOutputs(root,resort,planned=new Map(),now=new Date(),{currentOnly=false,trackedFiles=[]}={}) {
  const current=seasonFor(formatInTimeZone(now,resort.timezone,'yyyy-MM-dd'),resort);
  const groups=new Map();
  const group=id=>{if(!groups.has(id))groups.set(id,{season:seasonFor(id.length===4?`${id}-07-01`:`${id.slice(0,4)}-07-01`,resort),terrain:[],snow:[],lifts:[]});return groups.get(id)};
  const terrainRecords=new Map();
  for(const kind of ['terrain','snow','lifts'])for(const file of datedFiles(root,resort.key,kind,planned,trackedFiles)) {
    let date=file.slice(0,10);
    if(kind==='terrain'&&file.endsWith('.json')&&(!currentOnly||date>=current.start)) {
      const key=`${resort.key}/terrain/${file}`;
      try {
        const data=planned.has(key)?planned.get(key):JSON.parse(fs.readFileSync(path.join(root,key),'utf8'));
        terrainRecords.set(file,{file,data});
        if(data.scrapedAt&&Number.isFinite(Date.parse(data.scrapedAt)))date=formatInTimeZone(new Date(data.scrapedAt),resort.timezone,'yyyy-MM-dd');
      }catch(e){terrainRecords.set(file,{file,error:'Invalid or unreadable terrain JSON'});}
    }
    group(seasonFor(date,resort).id)[kind].push(file);
  }
  group(current.id);
  const out=new Map();const entries=[];
  for(const {season,terrain,snow,lifts} of groups.values()) {
    entries.push({...season,terrainFiles:terrain.length,snowFiles:snow.length,liftFiles:lifts.length,index:`${season.id}/index.json`,report:`${season.id}/report.json`});
    if(currentOnly&&season.id!==current.id)continue;
    const records=terrain.filter(f=>f.endsWith('.json')).map(file=>terrainRecords.get(file)||{file,error:'Terrain file not loaded'});
    const legacyIndexes=Object.fromEntries(['trails','lifts'].filter(kind=>trackedFiles.includes(`${resort.key}/${kind}/index.json`)).map(kind=>[kind,`../../${kind}/index.json`]));
    const manifest={resort:resort.key,season,legacyIndexes,raw:{terrain:terrain.map(f=>`../../terrain/${f}`),snow:snow.map(f=>`../../snow/${f}`),lifts:lifts.map(f=>`../../lifts/${f}`)},report:'report.json'};
    out.set(`${resort.key}/seasons/${season.id}/index.json`,manifest);
    out.set(`${resort.key}/seasons/${season.id}/report.json`,{...summarize(resort,season,records,now),legacyIndexes});
  }
  const catalogPath=path.join(root,resort.key,'seasons/index.json');
  if(currentOnly&&fs.existsSync(catalogPath)) {
    const previous=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
    for(const e of previous.seasons||[]) if(e.id!==current.id) { const i=entries.findIndex(n=>n.id===e.id); if(i<0)entries.push(e);else entries[i]=e; }
  }
  out.set(`${resort.key}/seasons/index.json`,{resort:resort.key,currentSeason:current.id,seasons:entries.sort((a,b)=>b.id.localeCompare(a.id))});
  return out;
}
module.exports={seasonFor,summarize,seasonOutputs};
