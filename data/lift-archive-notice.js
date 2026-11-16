// The archived lift stream must not be mistaken for a current operational report.
(async function () {
    const parts = location.pathname.split('/');
    const resort = parts[parts.indexOf('data') + 1];
    try {
        const response = await fetch(`../${resort}/lifts/index.json`, {cache:'no-store'});
        if (!response.ok) throw Error('Missing lift report');
        const data = await response.json();
        const times = (data.lifts || []).map(l=>Date.parse(l.lastUpdated)).filter(Number.isFinite);
        const time = times.length ? Math.max(...times) : Date.parse(data.generated);
        if (Number.isFinite(time) && Date.now()-time < 3600000 && Date.now() >= time) return;
        const notice = document.createElement('div');
        notice.setAttribute('role','status');
        notice.style.cssText = 'padding:14px 18px;background:#30291b;color:#f3deb2;text-align:center;font:14px system-ui';
        notice.textContent = Number.isFinite(time)
            ? `Archived lift report · ${new Date(time).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric'})}. Live lift polling is paused.`
            : 'Current lift status unavailable. Live lift polling is paused.';
        document.body.prepend(notice);
    } catch {
        const notice=document.createElement('div');
        notice.textContent='Current lift status unavailable. Live lift polling is paused.';
        notice.style.cssText='padding:14px;text-align:center;font:14px system-ui';
        document.body.prepend(notice);
    }
})();
