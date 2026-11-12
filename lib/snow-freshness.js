// Publication gate uses snow-source timestamps, never collection time or wrapper updates.
const { fromZonedTime } = require('date-fns-tz');
function sourceTimestamp(provider, raw) {
  switch (provider) {
    case 'vail': return raw?.snowReport?.LastUpdatedText;
    case 'inspector': return raw?.SnowReport?.LastUpdate;
    case 'zaneray': return raw?.snow?.lastModified;
    case 'reportpal': return raw?.updated;
    case 'snocountry': return raw?.reportDateTime;
    case 'aspensnowmass': return raw?.snowReport?.lastUpdated;
    default: return null;
  }
}
function parseSourceTime(value, provider, timezone) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const text = value.trim().replace(/[\u202f\u00a0]/g,' ');
  // Explicit offsets/UTC only; never let the machine timezone decide.
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return Date.parse(text);
  if (provider === 'vail') {
    const zones = {MST:'-0700',MDT:'-0600',PST:'-0800',PDT:'-0700',EST:'-0500',EDT:'-0400',CST:'-0600',CDT:'-0500',AEST:'+1000',AEDT:'+1100'};
    const match = /^Updated (.+) at (.+) ([A-Z]{3,4})$/.exec(text);
    if (match && zones[match[3]]) return Date.parse(`${match[1]} ${match[2]} ${zones[match[3]]}`);
  }
  let parts;
  if (provider === 'zaneray') {
    const m=/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}), (\d{1,2}):(\d{2}) (AM|PM)$/.exec(text);
    if(m) parts={year:Number(m[3])+(m[3].length===2?2000:0),month:+m[1],day:+m[2],hour:+m[4],minute:+m[5],ampm:m[6]};
  }
  if (provider === 'aspensnowmass') {
    const m=/^(\d{1,2}):(\d{2}) (AM|PM) ([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(text);
    if(m) parts={year:+m[6],month:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[4])+1,day:+m[5],hour:+m[1],minute:+m[2],ampm:m[3]};
  }
  if(parts && timezone) {
    const p=parts;if(p.month<1||p.month>12||p.day<1||p.day>31||p.hour<1||p.hour>12||p.minute>59)return NaN;
    const pad=x=>String(x).padStart(2,'0');const hour=p.hour%12+(p.ampm==='PM'?12:0);
    return fromZonedTime(`${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(hour)}:${pad(p.minute)}:00`,timezone).getTime();
  }
  // SnoCountry's offset-free timestamps remain blocked until its timezone is verified.
  return NaN;
}
function checkSnowFreshness(provider, raw, {timezone, now=new Date(),maxAgeHours=30}={}) {
  const sourceUpdated=sourceTimestamp(provider,raw);
  if(!sourceUpdated)return {accepted:false,reason:'missing-snow-timestamp',sourceUpdated:null};
  const time=parseSourceTime(sourceUpdated,provider,timezone);
  if(!Number.isFinite(time))return {accepted:false,reason:'unparseable-or-ambiguous-snow-timestamp',sourceUpdated};
  const ageHours=(new Date(now).getTime()-time)/3600000;
  if(!Number.isFinite(ageHours)||!Number.isFinite(maxAgeHours)||maxAgeHours<=0)throw Error('Invalid freshness policy');
  const reason=ageHours < -0.25 ? 'future-snow-timestamp' : ageHours > maxAgeHours ? 'stale-snow-report' : 'fresh';
  return {accepted:reason==='fresh',reason,sourceUpdated,sourceUpdatedAt:new Date(time).toISOString(),ageHours,maxAgeHours};
}
function validateSnowReport(provider, raw, options) {
  const freshness=checkSnowFreshness(provider,raw,options);
  if(!freshness.accepted)return freshness;
  if(raw?.IsSuccessful===false)return {...freshness,accepted:false,reason:'source-reports-failure'};
  const container={vail:raw?.snowReport,inspector:raw?.SnowReport,zaneray:raw?.snow,reportpal:raw?.currentConditions?.resortLocations?.location,aspensnowmass:raw?.snowReport,snocountry:raw}[provider];
  function hasMeasurement(value,withinSnowField=false) {
    if(value===null||value===undefined||(typeof value==='string'&&!value.trim()))return false;
    if(typeof value==='object')return Object.entries(value).some(([key,item])=>hasMeasurement(item,withinSnowField||/snow|depth|base|last24|last48|last7|sinceLifts|seasonTotal/i.test(key)));
    return withinSnowField && (typeof value==='number'||typeof value==='string') && Number.isFinite(Number(value)) && Number(value)>=0;
  }
  return hasMeasurement(container)?freshness:{...freshness,accepted:false,reason:'missing-snow-measurements'};
}
module.exports={sourceTimestamp,parseSourceTime,checkSnowFreshness,validateSnowReport};
