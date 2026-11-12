const {test}=require('node:test');
const assert=require('node:assert/strict');
const historical=require('./fixtures/breckenridge-snow-2025-11-15.json');
const {normalizeVailSnowReport}=require('../lib/vail-snow-normalization');
const resort={name:'Breckenridge',provider:'vail'};
const raw={snowReport:{LastUpdatedText:'Updated November 15, 2026 at 4:33 AM MST',OverallSnowConditions:'Snow Groomed',OvernightSnowfall:{Inches:'2',Centimeters:'5'},TwentyFourHourSnowfall:{Inches:'3',Centimeters:'8'},FortyEightHourSnowfall:{Inches:'4',Centimeters:'10'},SevenDaySnowfall:{Inches:'8',Centimeters:'20'},CurrentSeason:{Inches:'20',Centimeters:'51'},BaseDepth:{Inches:'18',Centimeters:'45'}},forecasts:[{Location:'Breck',Elevation:'9600',ForecastData:[{Date:'2026-11-15T07:00:00Z',HighTempStandard:'30',HighTempMetric:'-1',LowTempStandard:'20',LowTempMetric:'-7',WeatherShortDescription:'Snow',Wind:'W',WindSpeed:4,SnowFallDayStandard:'2',SnowFallNightStandard:'1'}]}]};
const sample=()=>normalizeVailSnowReport('breckenridge',resort,raw,'2026-11-15',new Date('2026-11-16T01:00:00Z'));
test('retains all historical snow/forecast field names; provider is additive',()=>{
 const current=sample();
 function compare(old,value){if(Array.isArray(old)){assert(Array.isArray(value));if(old.length)compare(old[0],value[0]);}else if(old&&typeof old==='object'){for(const k of Object.keys(old)){assert(Object.hasOwn(value,k),`Missing historical key ${k}`);compare(old[k],value[k]);}}else if(old!==null)assert.equal(typeof value,typeof old);}
 compare(historical,current);
 assert.deepEqual(Object.keys(current).sort(),[...Object.keys(historical),'provider'].sort());
 assert.deepEqual(Object.keys(current.snowfall).sort(),Object.keys(historical.snowfall).sort());
});
test('preserves supplied local date, UTC observation time, and source update separately',()=>{
 const current=sample();assert.equal(current.date,'2026-11-15');assert.equal(current.timestamp,'2026-11-16T01:00:00.000Z');assert.equal(current.lastUpdated,raw.snowReport.LastUpdatedText);
});
test('preserves source-reported inch/cm values and snowfall period meanings',()=>{
 const current=sample();assert.deepEqual(current.snowfall,{overnight_inches:2,overnight_cm:5,'24hour_inches':3,'24hour_cm':8,'48hour_inches':4,'48hour_cm':10,'7day_inches':8,'7day_cm':20,season_total_inches:20,season_total_cm:51});assert.deepEqual(current.baseDepth,{inches:18,cm:45});
});
test('does not refresh stale source timestamps during serialization',()=>{
 const current=normalizeVailSnowReport('breckenridge',resort,{snowReport:{LastUpdatedText:'Updated June 23, 2026 at 4:22 PM MDT'}},'2026-11-05',new Date('2026-11-05T22:00:00Z'));
 assert.equal(current.lastUpdated,'Updated June 23, 2026 at 4:22 PM MDT');assert.equal(current.forecast,null);
 // Legacy zero defaults are retained for compatibility. Freshness validation belongs before publication.
 assert.equal(current.snowfall['24hour_inches'],0);
});
