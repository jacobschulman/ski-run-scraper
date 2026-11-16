const {test} = require('node:test');
const assert = require('node:assert/strict');
const {classify, buildWatch} = require('../lib/resort-watch');
const now = new Date('2026-11-16T17:00:00Z');
const row = {resort:'test', counts:{trails:3, openTrails:1, openLifts:0}, winterSemanticsQualified:true, terrainSourceUpdated:now.toISOString()};
test('fresh nonempty terrain distinguishes open and all closed', () => {
 assert.equal(classify([row],now).status,'open-reported');
 assert.equal(classify([{...row,counts:{trails:3,openTrails:0,openLifts:0}}],now).status,'all-closed-reported');
});
test('stale, future, empty and unqualified reports cannot establish operations', () => {
 for(const r of [{...row,terrainSourceUpdated:'2026-05-01T00:00:00Z'}, {...row,terrainSourceUpdated:'2026-11-17T00:00:00Z'}, {...row,counts:{trails:0}}, {...row,winterSemanticsQualified:false}]) assert.equal(classify([r],now).status,'unconfirmed');
});
test('failed recheck preserves prior evidence without calling it current', () => {
 const config={resorts:[{key:'test',name:'Test'}]};
 const previous=buildWatch(config,{resorts:1,results:[row],finishedAt:now.toISOString()},{},now);
 const next=buildWatch(config,{resorts:1,results:[{resort:'test',outcome:'http-error'}],finishedAt:now.toISOString()},previous,now);
 assert.equal(next.resorts.test.status,'unconfirmed');
 assert.equal(next.resorts.test.lastConfirmed.status,'open-reported');
 assert.throws(()=>buildWatch(config,{resorts:0,results:[]},{},now),/Incomplete/);
});
