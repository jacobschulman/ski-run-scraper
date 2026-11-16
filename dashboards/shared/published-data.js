/* Shared readers for published dashboard data; never rewrite historical records. */
const DashboardData = (() => {
  const dateKey = value => {
    const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})(?:\.json)?$/);
    return match ? match[1] : null;
  };
  const dates = values => [...new Set((values || []).map(dateKey).filter(Boolean))].sort().reverse();
  const previousDay = value => new Date(Date.parse(value + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const recent = (value, now = Date.now()) => {
    const time = Date.parse(value);
    return Number.isFinite(time) && time <= now + 900000 && now - time <= 30 * 3600000;
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function observation(entry, kind) {
    const data = entry?.data;
    const exists = kind === 'terrain'
      ? data?.GroomingAreas?.some(area => area.Trails?.length)
      : data && (data.snowfall || data.baseDepth);
    if (!exists) return { available: false, recent: false };
    const timestamp = kind === 'terrain' ? data.Date : data.timestamp;
    return { available: true, recent: recent(timestamp), timestamp, date: entry.date,
      source: kind === 'snow' ? data.lastUpdated : data.Date };
  }
  return { dateKey, dates, previousDay, recent, escape, observation };
})();
if (typeof module !== 'undefined') module.exports = DashboardData;
