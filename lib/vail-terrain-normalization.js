const { extractJSONAssignment } = require('./embedded-json');

// The page assigns this twice: numeric MVC JSON, then the labeled API JSON.
// The browser uses the latter and adds each area's display order.
function extractVailTerrain(html) {
  const data = extractJSONAssignment(html, 'FR.TerrainStatusFeed', { last: true });
  if (!data || data.IsSuccessful !== true || !Array.isArray(data.GroomingAreas) || !Array.isArray(data.Lifts)) {
    throw Error('Missing or unsuccessful terrain report');
  }
  const result = structuredClone(data);
  const lift = l => {
    if (typeof l.Status !== 'string') throw Error('Terrain lift status is not a legacy label');
  };
  let trails = 0;
  result.GroomingAreas.forEach((area, order) => {
    if (!Array.isArray(area.Trails) || !Array.isArray(area.Lifts)) throw Error('Invalid grooming area');
    area.order = order;
    for (const t of area.Trails) {
      if (typeof t.Difficulty !== 'string' || typeof t.TrailType !== 'string' || typeof t.IsOpen !== 'boolean' || ![true, false, null].includes(t.IsGroomed)) throw Error('Invalid legacy terrain fields');
      trails++;
    }
    area.Lifts.forEach(lift);
  });
  result.Lifts.forEach(lift);
  if (!trails) throw Error('Empty terrain report (not evidence that the resort is closed)');
  return result;
}
function validateTerrainFreshness(data, expectedResortId, now = new Date()) {
  if (data.ResortId !== expectedResortId) throw Error('Wrong terrain resort');
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.Date)) throw Error('Ambiguous terrain timestamp');
  const age = (+now - Date.parse(data.Date)) / 3600000;
  if (!Number.isFinite(age) || age < -0.25 || age > 30) throw Error('Stale or future terrain report');
  // Date is the feed timestamp, not a guarantee of when an operator last changed a trail.
  return age;
}
module.exports = { extractVailTerrain, validateTerrainFreshness };
