const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('worker activation does not wait for a client navigation that needs the active worker',async()=>{
  const listeners={};let navigated=false;
  const context=vm.createContext({console,self:{addEventListener:(name,fn)=>listeners[name]=fn,clients:{claim:async()=>{},matchAll:async()=>[{url:'https://example.com/data/vail/grooming.html',navigate:()=>{navigated=true;return new Promise(()=>{})}}]}},caches:{keys:async()=>[],delete:async()=>{}}});
  vm.runInContext(fs.readFileSync('data/sw.js','utf8'),context);
  let activation;listeners.activate({waitUntil:p=>activation=p});
  const result=await Promise.race([activation.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),100))]);
  assert.equal(result,true);
  assert.equal(navigated,true);
});
