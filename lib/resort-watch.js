// Discovery evidence stays separate from published historical conditions.
function classify(rows, now = new Date()) {
  const terrain = rows.filter(row => row.counts?.trails > 0 && row.winterSemanticsQualified);
  for (const row of terrain) {
    const sourceUpdated = row.terrainSourceUpdated;
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(sourceUpdated || '')) continue;
    const age = (+now - Date.parse(sourceUpdated)) / 3600000;
    if (!Number.isFinite(age) || age < -0.25 || age > 30) continue;
    const operating = row.counts.openTrails > 0 || row.counts.openLifts > 0;
    return { status: operating ? 'open-reported' : 'all-closed-reported',
      sourceUpdated, openTrails: row.counts.openTrails, trails: row.counts.trails,
      openLifts: row.counts.openLifts, reason: 'fresh-terrain-feed' };
  }
  return { status: 'unconfirmed', reason: terrain.length ? 'stale-or-ambiguous-source-time' :
    rows.some(row => row.counts?.trails > 0) ? 'provider-needs-qualification' : 'no-valid-terrain-report' };
}
function buildWatch(config, audit, previous = {}, now = new Date()) {
  if (audit.resorts !== config.resorts.length || config.resorts.some(r => !audit.results.some(row => row.resort === r.key))) {
    throw Error('Incomplete all-resort audit');
  }
  const resorts = {};
  for (const resort of config.resorts) {
    const rows = audit.results.filter(row => row.resort === resort.key);
    const current = classify(rows, now);
    const old = previous.resorts?.[resort.key];
    const confirmed = current.status !== 'unconfirmed';
    resorts[resort.key] = { name: resort.name, ...current, checkedAt: audit.finishedAt,
      changed: !!old && old.status !== current.status,
      newlyOpen: current.status === 'open-reported' && !!old && old.status !== 'open-reported',
      lastConfirmed: confirmed ? { status: current.status, checkedAt: audit.finishedAt, sourceUpdated: current.sourceUpdated }
        : old?.lastConfirmed || null,
      sources: rows.map(row => ({kind: row.kind, outcome: row.outcome, httpStatus: row.status || null})) };
  }
  return { checkedAt: audit.finishedAt, resorts,
    note: 'Feed-reported winter operations; announced opening dates and provider qualification are tracked separately.' };
}
module.exports = { classify, buildWatch };
