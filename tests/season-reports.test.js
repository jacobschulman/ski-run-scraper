const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {seasonFor,summarize,seasonOutputs}=require('../lib/season-reports');
const resort={key:'vail',name:'Vail',timezone:'America/Denver'};
function record(date,open=true,groomed=true,id=1){return {file:date+'.json',data:{Date:date+'T08:00:00-07:00',scrapedAt:date+'T15:00:00Z',IsSuccessful:true,GroomingAreas:[{Name:'Peak',Trails:[{Id:id,Name:'Test Trail',Difficulty:'Blue',IsOpen:open,IsGroomed:groomed}]}],Lifts:[{Id:1,Name:'Test Lift',Status:open?'Open':'Closed',WaitTimeInMinutes:999}]}}}
test('stable season boundaries do not depend on planned opening dates',()=>{
  assert.equal(seasonFor('2026-06-30',resort).id,'2025-2026');
  assert.equal(seasonFor('2026-07-01',resort).id,'2026-2027');
  assert.equal(seasonFor('2027-01-15',resort).id,'2026-2027');
  assert.equal(seasonFor('2026-07-01',{timezone:'Australia/Sydney'}).id,'2026');
});
test('statistics and streaks cannot cross seasons; missing days are not closed observations',()=>{
  const current=seasonFor('2026-11-16',resort);
  const report=summarize(resort,current,[record('2026-04-01'),record('2026-11-12'),record('2026-11-14'),record('2026-11-15')],new Date('2026-11-16T16:00:00Z'));
  assert.equal(report.observedDays,3);
  assert.equal(report.trails[0].observedDays,3);
  assert.equal(report.trails[0].groomedDays,3);
  assert.equal(report.trails[0].currentStreak,2);
  assert.equal(report.lifts[0].waitMinutes,undefined);
  assert.equal(report.trails[0].date,'2026-11-15');
});
test('UTC compatibility copies do not create extra ski days',()=>{
  const r=record('2026-11-15');const copy={...r,file:'2026-11-16.json'};
  const report=summarize(resort,seasonFor('2026-11-16',resort),[r,copy],new Date());
  assert.equal(report.observedDays,1);assert.equal(report.trails[0].observedDays,1);
});
test('missing entities in the latest snapshot are unknown, not carried forward as open',()=>{
  const report=summarize(resort,seasonFor('2026-11-16',resort),[record('2026-11-14'),record('2026-11-15',false,false,2)],new Date());
  assert.equal(report.trails.find(t=>t.id==='1').isOpen,null);
  assert.equal(report.trails.find(t=>t.id==='1').status,'Not reported');
});
test('new season stays empty when only archive observations exist; raw files remain untouched',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ski-seasons-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'vail/terrain'),{recursive:true});
  const raw=JSON.stringify(record('2026-04-01').data);fs.writeFileSync(path.join(root,'vail/terrain/2026-04-01.json'),raw);
  const writes=seasonOutputs(root,resort,new Map(),new Date('2026-11-16T16:00:00Z'));
  assert.equal(writes.get('vail/seasons/2026-2027/report.json').snapshot,null);
  assert.equal(writes.get('vail/seasons/2025-2026/report.json').trails.length,1);
  assert.equal(fs.readFileSync(path.join(root,'vail/terrain/2026-04-01.json'),'utf8'),raw);
  assert.equal([...writes.keys()].filter(p=>!p.includes('/seasons/')).length,0);
  fs.mkdirSync(path.join(root,'vail/seasons'),{recursive:true});fs.writeFileSync(path.join(root,'vail/seasons/index.json'),JSON.stringify(writes.get('vail/seasons/index.json')));
  const current=seasonOutputs(root,resort,new Map(),new Date('2026-11-16T16:00:00Z'),{currentOnly:true});
  assert(!current.has('vail/seasons/2025-2026/report.json'));
});
test('season index classifies UTC boundary copies by their actual resort date',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ski-season-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const r=record('2026-06-30');r.data.scrapedAt='2026-07-01T02:00:00Z';
  const writes=seasonOutputs(root,resort,new Map([['vail/terrain/2026-07-01.json',r.data]]),new Date('2026-07-02T16:00:00Z'));
  assert.equal(writes.get('vail/seasons/2025-2026/report.json').observedDays,1);
  assert.equal(writes.get('vail/seasons/2026-2027/report.json').observedDays,0);
});
