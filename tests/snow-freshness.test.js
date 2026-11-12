const {test}=require('node:test');const assert=require('node:assert/strict');
const {checkSnowFreshness,parseSourceTime}=require('../lib/snow-freshness');
const now=new Date('2026-11-05T22:00:00Z');
test('blocks stale Vail payload and admits recent real zeros',()=>{
 assert.equal(checkSnowFreshness('vail',{snowReport:{LastUpdatedText:'Updated June 23, 2026 at 4:22 PM MDT'}},{now}).reason,'stale-snow-report');
 assert.equal(checkSnowFreshness('vail',{snowReport:{LastUpdatedText:'Updated November 5, 2026 at 4:22 AM MST',TwentyFourHourSnowfall:{Inches:'0'}}},{now}).accepted,true);
});
test('Inspector wrapper freshness cannot rescue old or absent snow report',()=>{
 assert.equal(checkSnowFreshness('inspector',{LastUpdate:now.toISOString(),SnowReport:{LastUpdate:'2026-10-01T06:00:00-0700'}},{now}).accepted,false);
 assert.equal(checkSnowFreshness('inspector',{LastUpdate:now.toISOString()},{now}).reason,'missing-snow-timestamp');
});
test('blocks future, absent and ambiguous dates',()=>{
 assert.equal(checkSnowFreshness('reportpal',{updated:'2026-11-06T22:00:00Z'},{now}).reason,'future-snow-timestamp');
 assert.equal(checkSnowFreshness('reportpal',{}, {now}).accepted,false);
 assert.equal(checkSnowFreshness('snocountry',{reportDateTime:'2026-11-05 12:00:00'},{now}).accepted,false);
});
test('provider local timestamps resolve in resort timezone across DST',()=>{
 assert.equal(new Date(parseSourceTime('03:15 AM Nov 05, 2026','aspensnowmass','America/Denver')).toISOString(),'2026-11-05T10:15:00.000Z');
 assert.equal(new Date(parseSourceTime('11/5/26, 9:28 AM','zaneray','America/Denver')).toISOString(),'2026-11-05T16:28:00.000Z');
 assert.equal(new Date(parseSourceTime('03:15 AM Jul 05, 2026','aspensnowmass','America/Denver')).toISOString(),'2026-07-05T09:15:00.000Z');
});
test('publication gate rejects before touching files or database',()=>{
 const saves=require('../snow-scraper');const fs=require('fs');const original=fs.mkdirSync;
 fs.mkdirSync=()=>{throw Error('Attempted filesystem mutation');};
 try{
 assert.equal(saves.saveVailSnowData('breckenridge',{snowReport:{LastUpdatedText:'Updated June 23, 2020 at 4:22 PM MDT'}}),null);
 assert.equal(saves.saveIkonSnowData('mammoth',{LastUpdate:new Date().toISOString(),SnowReport:{LastUpdate:'2020-01-01T00:00:00Z'}}),null);
 }finally{fs.mkdirSync=original;}
});
test('fresh wrapper without measurements is not publishable',()=>{
 const {validateSnowReport}=require('../lib/snow-freshness');
 assert.equal(validateSnowReport('reportpal',{updated:now.toISOString()},{now}).reason,'missing-snow-measurements');
 assert.equal(validateSnowReport('reportpal',{updated:now.toISOString(),currentConditions:{resortLocations:{location:[{snow24Hours:{inches:'0'}}]}}},{now}).accepted,true);
});
test('all alternate snow writers reject stale data before publication',()=>{
 const saves=require('../snow-scraper'),fs=require('fs');const mkdir=fs.mkdirSync;fs.mkdirSync=()=>{throw Error('Unexpected write');};
 try {
 assert.equal(saves.saveZaneraySnowData('jacksonhole',{snow:{lastModified:'1/1/20, 9:00 AM'}}),null);
 assert.equal(saves.saveReportPalSnowData('bigsky',{updated:'2020-01-01T00:00:00Z'}),null);
 assert.equal(saves.saveSnoCountrySnowData('snowbird',{reportDateTime:'2020-01-01T00:00:00Z'}),null);
 assert.equal(saves.saveAspenSnowmassSnowData('aspenmountain',{snowReport:{lastUpdated:'03:15 AM Jan 01, 2020'}}),null);
 }finally{fs.mkdirSync=mkdir;}
});
