async function fetchSource(url, {json=true}={}) {
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'SkiRunScraper/1.0',Accept:json?'application/json':'text/html'}});
  if(!response.ok)throw Error(`Source HTTP ${response.status}`);
  const body=await response.text();
  if(!json)return body;
  const data=JSON.parse(body);
  if(data?.IsSuccessful===false)throw Error('Source reports unsuccessful response');
  return data;
}
module.exports={fetchSource};
