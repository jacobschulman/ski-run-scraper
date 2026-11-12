const {test}=require('node:test');const assert=require('node:assert/strict');const {fetchSource}=require('../lib/source-http');
test('HTTP 200 with source failure is rejected; valid JSON is preserved',async()=>{
 const original=global.fetch;
 try{
 global.fetch=async()=>new Response(JSON.stringify({IsSuccessful:false,ErrorDetails:'Unavailable'}),{status:200});
 await assert.rejects(fetchSource('https://example.test'),/unsuccessful/);
 global.fetch=async()=>new Response('blocked',{status:403});await assert.rejects(fetchSource('https://example.test'),/403/);
 global.fetch=async()=>new Response('<html>challenge</html>',{status:200});await assert.rejects(fetchSource('https://example.test'));
 global.fetch=async(url,options)=>{assert(options.signal);return new Response('{"snow":0}',{status:200});};assert.deepEqual(await fetchSource('https://example.test'),{snow:0});
 }finally{global.fetch=original;}
});
