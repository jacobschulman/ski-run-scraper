const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function page(fetch) {
  const nodes={};
  const document={createElement:()=>({set textContent(value){this.innerHTML=String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}}),getElementById:id=>nodes[id]??=( {innerHTML:'',textContent:'',style:{display:'none'}}),addEventListener:()=>{}};
  const RealDate=Date;
  const FixedDate=class extends RealDate {constructor(...a){super(...(a.length?a:['2026-11-16T05:00:00Z']))}static now(){return Date.parse('2026-11-16T05:00:00Z')}};
  const context=vm.createContext({Date:FixedDate,Intl,document,window:{addEventListener:()=>{}},RESORT_KEY:'vail',fetch,localStorage:{getItem:()=>null},console});
  vm.runInContext(fs.readFileSync('data/resort.js','utf8'),context);
  return {context,nodes,run:code=>vm.runInContext(code,context)};
}
test('current resort index wins over the stale global index and future UTC copies',async()=>{
  const p=page(async url=>({ok:true,json:async()=>url.includes('/terrain/')?{files:['2026-11-16','2026-11-15','2026-04-27']}:{resorts:{vail:{files:['2026-04-27.json']}}}}));
  p.run('loadDate = async date => { currentDate=date; }');
  await p.run('loadIndex()');
  assert.equal(p.run('currentDate'),'2026-11-15');
});
test('historical missing snow never falls forward to current snow',async()=>{
  const calls=[];const p=page(async url=>{calls.push(url);return {ok:false}});
  await p.run("loadWeatherData('2026-04-09')");
  assert.equal(calls.length,1);
  assert(!calls[0].includes('latest'));
  assert.equal(p.run('weatherData'),null);
});
test('April brief is hidden rather than relabeled with today',async()=>{
  const p=page(async()=>({ok:true,json:async()=>({date:'2026-04-27',generated:'2026-04-27T16:00:00Z',morningBrief:{headline:'Waiting for Opening Day'}})}));
  p.run("currentDate='2026-11-15'");
  await p.run('loadMorningBrief()');
  assert.equal(p.nodes.briefWidget.style.display,'none');
});
test('lift snapshot uses terrain data and never advertises archived waits',async()=>{
  const p=page(()=>{throw Error('Must not fetch archived lift index')});
  p.run("terrainData={Date:'2026-11-16T04:30:00Z',Lifts:[{Name:'Test Lift',Status:'Open',WaitTimeInMinutes:2}]} ");
  await p.run('loadLiftData()');
  const html=p.run('renderLiftStatusWidget()');
  assert(html.includes('Open in snapshot'));
  assert(html.includes('Live lift waits are not being collected'));
  assert(!html.includes('2 min'));
});
test('snow source time is explicit and forecast high is not labeled as Now',()=>{
  const p=page(()=>{});
  assert.equal(p.run("snowSourceTimestamp({lastUpdated:'Updated November 15, 2026 at 5:34 AM MST'})"),'2026-11-15T12:34:00.000Z');
  p.run("terrainData={GroomingAreas:[{Trails:[{IsOpen:true}]}]}; weatherData={date:'2026-11-15',timestamp:'2026-11-16T04:00:00Z',lastUpdated:'Updated November 15, 2026 at 5:34 AM MST',forecast:{locations:[{today:{high_f:43,low_f:32}}]}};");
  const html=p.run('renderSnowConditionsWidget(1)');
  assert(html.includes('--°'));
  assert(html.includes('32°/43°'));
  assert(html.includes('Open trails'));
});
