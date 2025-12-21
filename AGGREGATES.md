# Aggregates API - Global Leaderboard Data

Daily aggregate data combining all 69 ski resorts into superlatives, rankings, and regional summaries. Perfect for building global leaderboards.

## Endpoints

**Base URL:** `https://jacobschulman.github.io/ski-run-scraper/data/aggregates/`

| Endpoint | Description |
|----------|-------------|
| `latest.json` | Current day's aggregate (updates hourly) |
| `{YYYY-MM-DD}.json` | Historical aggregate for specific date |
| `index.json` | Manifest of all available dates |

### Quick Links
- **Latest:** https://jacobschulman.github.io/ski-run-scraper/data/aggregates/latest.json
- **Index:** https://jacobschulman.github.io/ski-run-scraper/data/aggregates/index.json

---

## Data Structure

```json
{
  "date": "2025-12-21",
  "generated": "2025-12-21T18:30:00.000Z",

  "superlatives": { ... },    // Max/min for each metric
  "rankings": { ... },        // Sorted lists for each metric
  "regions": { ... },         // Regional aggregates
  "resorts": { ... },         // Per-resort data
  "totals": { ... },          // Network-wide totals
  "coverage": { ... }         // Data availability info
}
```

---

## Leaderboard Data

### Superlatives (Best/Worst)

Pre-computed max/min for quick "leader" displays:

```json
{
  "superlatives": {
    "snow_overnight_max": {
      "resort": "whistlerblackcomb",
      "name": "Whistler Blackcomb",
      "region": "Western Canada",
      "value": 3
    },
    "snow_overnight_min": { ... },
    "snow_24h_max": { ... },
    "snow_24h_min": { ... },
    "snow_48h_max": { ... },
    "snow_7day_max": { ... },
    "snow_season_max": { ... },
    "snow_season_min": { ... },
    "base_depth_max": { ... },
    "base_depth_min": { ... },
    "trails_open_count_max": { ... },
    "trails_open_count_min": { ... },
    "trails_open_pct_max": { ... },
    "trails_open_pct_min": { ... },
    "trails_groomed_count_max": { ... },
    "trails_groomed_pct_max": { ... },
    "lifts_open_count_max": { ... },
    "lifts_open_pct_max": { ... }
  }
}
```

**Use cases:**
- "Most snow overnight: Whistler (3")"
- "Best terrain open: Park City (87%)"
- "Deepest base: Big Sky (48")"

### Rankings (Sorted Lists)

Full sorted lists for "Top 10" style leaderboards:

```json
{
  "rankings": {
    "snow_overnight": [
      { "resort": "whistlerblackcomb", "name": "Whistler Blackcomb", "region": "Western Canada", "value": 3 },
      { "resort": "crystal", "name": "Crystal Mountain", "region": "Pacific Northwest", "value": 2 },
      { "resort": "steamboat", "name": "Steamboat", "region": "Colorado", "value": 1 },
      ...
    ],
    "snow_24h": [ ... ],
    "snow_48h": [ ... ],
    "snow_7day": [ ... ],
    "snow_season": [ ... ],
    "base_depth": [ ... ],
    "trails_open_count": [ ... ],
    "trails_open_pct": [ ... ],
    "trails_groomed_count": [ ... ],
    "trails_groomed_pct": [ ... ],
    "lifts_open_count": [ ... ],
    "lifts_open_pct": [ ... ]
  }
}
```

**Use cases:**
- Top 10 fresh snow
- Top 10 most terrain open
- Leaderboard with pagination

---

## Forecast Data (Upcoming Snow)

Each resort includes 5-day forecast for "storm chasers":

```json
{
  "resorts": {
    "vail": {
      "forecast": {
        "today": {
          "high_f": 46,
          "low_f": 27,
          "description": "Partly Cloudy",
          "snow_inches": 0
        },
        "upcoming_days": [
          { "date": "2025-12-21", "high_f": 46, "low_f": 27, "description": "Partly Cloudy", "snow_inches": 0 },
          { "date": "2025-12-22", "high_f": 49, "low_f": 34, "description": "Clear", "snow_inches": 0 },
          { "date": "2025-12-23", "high_f": 48, "low_f": 29, "description": "Clear", "snow_inches": 0 },
          { "date": "2025-12-24", "high_f": 45, "low_f": 32, "description": "Partly Cloudy", "snow_inches": 0 },
          { "date": "2025-12-25", "high_f": 44, "low_f": 33, "description": "Partly Cloudy", "snow_inches": 0 }
        ],
        "total_snow_expected": 0
      }
    }
  }
}
```

**Use cases:**
- "Most snow expected this week" leaderboard
- Storm tracker / powder alerts
- Trip planning recommendations

---

## Regional Aggregates

Data grouped by 14 regions:

```json
{
  "regions": {
    "Colorado": {
      "resorts": ["vail", "beavercreek", "breckenridge", "keystone", ...],
      "resort_count": 10,
      "resorts_reporting": 10,
      "totals": {
        "trails_open": 892,
        "trails_groomed": 234,
        "trails_total": 1456,
        "lifts_open": 87,
        "snow_24h": 12
      },
      "averages": {
        "base_depth": 32.5,
        "trails_open_pct": 0.61,
        "trails_groomed_pct": 0.26,
        "snow_overnight": 0.8
      }
    },
    "Utah": { ... },
    "California": { ... },
    "Pacific Northwest": { ... },
    "Vermont": { ... },
    ...
  }
}
```

**Regions available:**
- Colorado, Utah, California, Pacific Northwest
- Vermont, New Hampshire, Maine
- New York, Pennsylvania, Mid-Atlantic
- Ohio, Michigan, Minnesota
- Wyoming/Montana, New Mexico
- Western Canada, Eastern Canada

**Use cases:**
- "Best region right now" comparison
- Regional snow totals
- Trip planning by area

---

## Per-Resort Data

Complete snapshot for each of 69 resorts:

```json
{
  "resorts": {
    "vail": {
      "name": "Vail",
      "region": "Colorado",
      "has_data": true,
      "snow": {
        "overnight": 0,
        "24h": 0,
        "48h": 0,
        "7day": 0,
        "season": 48,
        "base_depth": 28
      },
      "terrain": {
        "trails_open": 89,
        "trails_total": 195,
        "trails_open_pct": 0.456,
        "trails_groomed": 34,
        "trails_groomed_pct": 0.382,
        "lifts_open": 18,
        "lifts_total": 31,
        "lifts_open_pct": 0.581
      },
      "forecast": { ... },
      "lastSnowDate": "2025-12-21",
      "lastTerrainDate": "2025-12-21"
    }
  }
}
```

---

## Network Totals

Aggregate counts across all resorts:

```json
{
  "totals": {
    "resorts_total": 69,
    "resorts_reporting": 63,
    "trails_open": 3456,
    "trails_total": 8234,
    "trails_groomed": 987,
    "lifts_open": 423,
    "snow_24h_sum": 45
  }
}
```

---

## Data Coverage

Track which resorts have data:

```json
{
  "coverage": {
    "with_snow_data": ["vail", "breckenridge", ...],      // 63 resorts
    "with_terrain_data": ["vail", "breckenridge", ...],   // 57 resorts
    "missing_snow_data": ["alta", "taos", ...],           // 6 resorts
    "missing_terrain_data": ["alta", "taos", ...],        // 12 resorts
    "stale_data": []                                       // Resorts with data >2 days old
  }
}
```

---

## Example: Building a Leaderboard

### Swift/iOS

```swift
struct LeaderboardEntry: Codable {
    let resort: String
    let name: String
    let region: String
    let value: Double
}

struct Aggregates: Codable {
    let date: String
    let superlatives: [String: LeaderboardEntry]
    let rankings: [String: [LeaderboardEntry]]
}

func fetchLeaderboard() async throws -> Aggregates {
    let url = URL(string: "https://jacobschulman.github.io/ski-run-scraper/data/aggregates/latest.json")!
    let (data, _) = try await URLSession.shared.data(from: url)
    return try JSONDecoder().decode(Aggregates.self, from: data)
}

// Get top 10 for fresh snow
let aggregates = try await fetchLeaderboard()
let top10Snow = Array(aggregates.rankings["snow_overnight"]?.prefix(10) ?? [])
```

### React Native / JavaScript

```javascript
const fetchLeaderboard = async () => {
  const response = await fetch(
    'https://jacobschulman.github.io/ski-run-scraper/data/aggregates/latest.json'
  );
  return response.json();
};

// Example component
const Leaderboard = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchLeaderboard().then(setData);
  }, []);

  if (!data) return <Loading />;

  return (
    <View>
      {/* Best snow overnight */}
      <Text>Most Fresh Snow: {data.superlatives.snow_overnight_max.name}</Text>
      <Text>{data.superlatives.snow_overnight_max.value}" overnight</Text>

      {/* Top 10 list */}
      {data.rankings.snow_overnight.slice(0, 10).map((resort, i) => (
        <Text key={resort.resort}>
          {i + 1}. {resort.name} - {resort.value}"
        </Text>
      ))}
    </View>
  );
};
```

---

## Leaderboard Ideas

### Snow Leaders
- **Fresh Pow:** `rankings.snow_overnight` - Most new snow last night
- **Storm Total:** `rankings.snow_48h` - 2-day storm totals
- **Week's Haul:** `rankings.snow_7day` - Weekly accumulation
- **Season Champs:** `rankings.snow_season` - Season-to-date leaders
- **Deepest Base:** `rankings.base_depth` - Most established base

### Terrain Leaders
- **Most to Explore:** `rankings.trails_open_count` - Raw trail count
- **Best Coverage:** `rankings.trails_open_pct` - % of terrain open
- **Freshly Groomed:** `rankings.trails_groomed_count` - Corduroy lovers
- **Groom Rate:** `rankings.trails_groomed_pct` - % of open trails groomed

### Forecast Leaders
- **Storm Incoming:** Sort resorts by `forecast.total_snow_expected`
- **Powder Tomorrow:** Filter `forecast.upcoming_days[0].snow_inches > 0`

### Regional Comparisons
- **Best Region:** Compare `regions[*].averages.snow_overnight`
- **Most Open:** Compare `regions[*].totals.trails_open`

---

## Trending (Day-over-Day)

Compare today's data with yesterday's for "biggest movers":

```javascript
const today = await fetch('.../aggregates/latest.json').then(r => r.json());
const yesterday = await fetch('.../aggregates/2025-12-20.json').then(r => r.json());

// Calculate snow change
const trending = Object.keys(today.resorts).map(key => ({
  resort: key,
  name: today.resorts[key].name,
  snowToday: today.resorts[key].snow?.['24h'] || 0,
  snowYesterday: yesterday.resorts[key]?.snow?.['24h'] || 0,
  change: (today.resorts[key].snow?.['24h'] || 0) - (yesterday.resorts[key]?.snow?.['24h'] || 0)
})).sort((a, b) => b.change - a.change);

// Top gainers
const topGainers = trending.slice(0, 5);
```

---

## Update Frequency

- **Aggregates regenerate:** Every workflow run (multiple times daily)
- **Snow data updates:** Every hour
- **Terrain data updates:** Daily + on-change
- **Forecast data updates:** With snow data (hourly)

---

## All Available Metrics

| Metric Key | Description | Unit |
|------------|-------------|------|
| `snow_overnight` | New snow since last night | inches |
| `snow_24h` | Last 24 hours snowfall | inches |
| `snow_48h` | Last 48 hours snowfall | inches |
| `snow_7day` | Last 7 days snowfall | inches |
| `snow_season` | Season total snowfall | inches |
| `base_depth` | Current base depth | inches |
| `trails_open_count` | Number of trails open | count |
| `trails_open_pct` | Percentage of trails open | 0-1 |
| `trails_groomed_count` | Number of groomed trails | count |
| `trails_groomed_pct` | Percentage of open trails groomed | 0-1 |
| `lifts_open_count` | Number of lifts running | count |
| `lifts_open_pct` | Percentage of lifts running | 0-1 |
