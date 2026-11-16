(async function () {
  const parts=location.pathname.split('/');
  const resort=parts[parts.indexOf('data')+1];
  const filename=parts.at(-1);
  const kind=filename.startsWith('lift')?'lifts':'trails';
  const detail=filename==='trail.html'||filename==='lift.html';
  const params=new URLSearchParams(location.search);
  const $=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const json=async url=>{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error(`Report unavailable (HTTP ${response.status})`);return response.json()};
  const timestamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Unavailable';
  try {
    const catalog=await json('seasons/index.json');
    const selected=params.get('season')||catalog.currentSeason;
    if(!catalog.seasons.some(s=>s.id===selected))throw Error('No data for that season');
    $('season').innerHTML=catalog.seasons.map(s=>`<option value="${escape(s.id)}" ${s.id===selected?'selected':''}>${escape(s.label)}${s.id===catalog.currentSeason?'':' · archive'}</option>`).join('');
    $('season').onchange=()=>{params.set('season',$('season').value);location.search=params.toString()};
    $('trailNav').href=`trails.html?season=${encodeURIComponent(selected)}`;
    $('liftNav').href=`lifts.html?season=${encodeURIComponent(selected)}`;
    if(selected!==catalog.currentSeason){ document.querySelector('nav a').textContent='Current overview';document.querySelector('nav a[href="snow.html"]').textContent='Current snow'; }
    const report=await json(`seasons/${encodeURIComponent(selected)}/report.json`);
    const archive=selected!==catalog.currentSeason;
    const age=report.snapshot?.sourceUpdated?(Date.now()-Date.parse(report.snapshot.sourceUpdated))/3600000:Infinity;
    const stale=!archive&&(!Number.isFinite(age)||age>30||age<-.25);
    const snapshot=report.snapshot;
    $('heading').textContent=`${report.resortName} ${kind==='trails'?'Trails':'Lifts'}`;
    document.title=$('heading').textContent+` · ${report.season.label}`;
    $('status').textContent=`${report.season.label}${archive?' archive':''} · ${snapshot?'Snapshot: '+timestamp(snapshot.sourceUpdated):'No observations collected for this season.'}${stale&&snapshot?' · Stale snapshot':''}${kind==='lifts'?' · Live lift waits are not being collected.':''}`;
    const rows=report[kind]||[];
    const selectedEntity=params.get('id')?rows.find(r=>r.id===params.get('id')):rows.find(r=>r.slug===params.get('name')||r.name===params.get('name'));
    const status=e=>e.status==='Not reported'?'Not reported in latest snapshot':e.status;
    const link=e=>`${kind==='trails'?'trail':'lift'}.html?season=${encodeURIComponent(selected)}&id=${encodeURIComponent(e.id)}`;
    function entityStats(e){return `<div class="stats"><div><strong>${e.observedDays}</strong><span class="muted">Observed days</span></div><div><strong>${e.openDays}</strong><span class="muted">Days reported open</span></div>${kind==='trails'?`<div><strong>${e.groomedDays}</strong><span class="muted">Days reported groomed</span></div>`:''}</div>`;}
    if(detail) {
      $('filters').innerHTML=`<a href="${kind}.html?season=${encodeURIComponent(selected)}">← ${kind==='trails'?'All trails':'All lifts'}</a>`;
      if(!selectedEntity){$('content').innerHTML='<div class="card">No observation of this trail or lift in the selected season.</div>';return;}
      const e=selectedEntity;
      $('heading').textContent=e.name;
      $('content').innerHTML=`<section class="card"><h2>${escape(status(e))}${e.isGroomed===true?' · Groomed':''}</h2><p class="muted">${escape(e.area)} · Last observed ${escape(e.date)}</p>${entityStats(e)}${kind==='trails'?`<p class="muted">Grooming streak as of the snapshot: ${e.currentStreak} days · Longest observed: ${e.longestStreak} days</p>`:''}</section><p class="muted">Counts use recorded days only. Missing observations are not counted as closed.</p><a href="seasons/${escape(selected)}/index.json">Season data index</a>`;
      return;
    }
    let filter=kind==='trails'&&!archive?'groomed':'all';
    const options=kind==='trails'?[['all','All'],['open','Open'],['groomed','Groomed']]:[['all','All'],['open','Open']];
    function render(){
      $('filters').innerHTML=options.map(([id,label])=>`<button data-filter="${id}" aria-pressed="${filter===id}">${label}</button>`).join('');
      $('filters').querySelectorAll('button').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render()});
      const filtered=rows.filter(r=>filter==='all'||filter==='open'&&r.isOpen===true||filter==='groomed'&&r.isGroomed===true);
      const groups=new Map();for(const e of filtered){const area=e.area||'Mountain';if(!groups.has(area))groups.set(area,[]);groups.get(area).push(e);}
      const open=rows.filter(e=>e.isOpen===true).length;
      const groomed=rows.filter(e=>e.isGroomed===true).length;
      const summary=snapshot?`<div class="stats"><div><strong>${open}/${rows.length}</strong><span class="muted">Reported open</span></div>${kind==='trails'?`<div><strong>${groomed}</strong><span class="muted">Reported groomed</span></div>`:''}<div><strong>${report.observedDays}</strong><span class="muted">Observed days this season</span></div></div>`:'';
      $('content').innerHTML=(summary?`<section class="card">${summary}</section>`:'')+(!filtered.length?`<section class="card">${rows.length?'No matching '+kind+' in this snapshot.':'No '+kind+' observations collected for '+escape(report.season.label)+'.'}</section>`:[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([area,entities])=>`<section class="card"><h2>${escape(area)}</h2>${entities.sort((a,b)=>a.name.localeCompare(b.name)).map(e=>`<a class="row" href="${link(e)}"><span><span class="name">${escape(e.name)}</span>${kind==='trails'?`<span class="muted">${escape(e.difficulty)}</span>`:''}</span><span class="badge ${e.isOpen===true?'open':''}">${escape(status(e))}${e.isGroomed===true?' · Groomed':''}</span></a>`).join('')}</section>`).join(''))+`<p class="muted">Counts use recorded observations within ${escape(report.season.label)} only.</p><a href="seasons/${escape(selected)}/index.json">Season data index</a>${archive&&report.legacyIndexes?.[kind]?`<p><a href="seasons/${escape(selected)}/${escape(report.legacyIndexes[kind])}">Legacy unpartitioned ${kind} data</a></p>`:''}${report.errors.length?`<p class="notice muted">${report.errors.length} source files could not be read; see season report diagnostics.</p>`:''}`;
    }
    render();
  }catch(error){$('status').textContent=error.message+' · No previous-season data has been substituted.';}
})();
