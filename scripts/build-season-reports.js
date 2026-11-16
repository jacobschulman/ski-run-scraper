const fs=require('node:fs'),path=require('node:path');
const {seasonOutputs}=require('../lib/season-reports');
const resorts=require('../config.json').resorts;
const selected=process.argv.includes('--pilot')?require('../lib/pilot-resorts').keys:null;
const trackedFiles=require('node:child_process').execFileSync('git',['ls-files','-z','data'],{encoding:'utf8',maxBuffer:30*1024*1024}).split('\0').map(f=>f.replace(/^data\//,''));
const now=new Date();let count=0;
for(const resort of resorts.filter(r=>!selected||selected.includes(r.key))) {
  const writes=seasonOutputs(path.resolve('data'),resort,new Map(),now,{trackedFiles});
  for(const[file,value]of writes){const dest=path.join('data',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(value,null,2));count++;}
  console.log(`${resort.key}: seasons generated`);
}
console.log(`${count} season files; raw history unchanged`);
