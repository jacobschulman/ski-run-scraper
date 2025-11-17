# SQLite Database Documentation

The ski scraper now includes a **SQLite database** for queryable historical data analysis. This complements the existing JSON files with a powerful query interface for building features like historical grooming pattern analysis.

## Overview

### Dual Storage Strategy
- **JSON files**: Continue to work as your public API (served via GitHub Pages)
- **SQLite database**: Enables complex queries for historical pattern analysis
- **Both are updated simultaneously** when scraping

### Database Location
```
data/ski-data.db
```
- Size: ~2.3MB (will grow over the season)
- Committed to git alongside JSON files
- Can be served via GitHub Pages for download

---

## Database Schema

### Tables

#### `resorts`
Stores resort metadata
```sql
CREATE TABLE resorts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,           -- e.g., 'vail', 'breckenridge'
  name TEXT NOT NULL,                 -- e.g., 'Vail', 'Breckenridge'
  timezone TEXT,                      -- e.g., 'America/Denver'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

#### `terrain_status`
Daily trail, lift, and grooming data
```sql
CREATE TABLE terrain_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resort_id INTEGER NOT NULL,         -- Foreign key to resorts
  date TEXT NOT NULL,                 -- YYYY-MM-DD
  item_name TEXT NOT NULL,            -- Trail or lift name
  item_type TEXT,                     -- 'trail' or 'lift'
  status TEXT,                        -- 'Open', 'Closed', 'Scheduled', etc.
  grooming_status TEXT,               -- 'Fresh Corduroy', 'Groomed', etc.
  grooming_type TEXT,                 -- Additional grooming details
  raw_data TEXT,                      -- Full JSON data for the item
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resort_id, date, item_name)
)
```

#### `snow_conditions`
Daily snow reports
```sql
CREATE TABLE snow_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resort_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  overnight_snowfall_inches REAL,
  base_depth_inches REAL,
  new_snow_24h_inches REAL,
  new_snow_48h_inches REAL,
  new_snow_7day_inches REAL,
  season_total_inches REAL,
  weather_condition TEXT,
  temperature REAL,
  raw_data TEXT,                      -- Full JSON snow data
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resort_id, date)
)
```

---

## Usage

### Initial Setup

Import existing JSON files into the database:
```bash
npm run db:import
```

This will:
- Create `data/ski-data.db`
- Import all existing terrain and snow data from JSON files
- Currently imports ~7,000 terrain records and ~30 snow records

### Automatic Updates

The scraper now **automatically writes to both JSON and SQLite** when running:
```bash
npm run scrape:all
```

No additional steps needed! The database stays in sync with JSON files.

### Example Queries

Run the example query script to see various analysis patterns:
```bash
npm run db:query
```

This demonstrates:
- Grooming history for specific runs
- Most frequently groomed trails
- Snow condition trends
- Cross-resort comparisons
- Lift status history

---

## Query Examples

### 1. Get grooming history for a specific run
```javascript
const { getDatabase, closeDatabase } = require('./database');
const db = getDatabase();

db.all(`
  SELECT
    r.name as resort,
    t.date,
    t.item_name as run_name,
    t.grooming_status,
    t.grooming_type
  FROM terrain_status t
  JOIN resorts r ON t.resort_id = r.id
  WHERE r.key = 'vail'
    AND t.item_name = 'Born Free'
  ORDER BY t.date DESC
  LIMIT 30
`, [], (err, rows) => {
  console.table(rows);
  closeDatabase(db);
});
```

### 2. Find most frequently groomed runs
```sql
SELECT
  r.name as resort,
  t.item_name as run_name,
  COUNT(DISTINCT t.date) as days_groomed
FROM terrain_status t
JOIN resorts r ON t.resort_id = r.id
WHERE r.key = 'vail'
  AND t.grooming_status IN ('Fresh Corduroy', 'Groomed')
  AND t.item_type = 'trail'
GROUP BY r.name, t.item_name
ORDER BY days_groomed DESC
LIMIT 20
```

### 3. Compare snow totals across resorts
```sql
SELECT
  r.name as resort,
  s.date,
  s.season_total_inches as season_total,
  s.base_depth_inches as base_depth
FROM snow_conditions s
JOIN resorts r ON s.resort_id = r.id
WHERE s.date = '2025-11-17'
ORDER BY s.season_total_inches DESC
```

### 4. Track a run's grooming pattern over the season
```sql
SELECT
  date,
  grooming_status,
  grooming_type,
  status
FROM terrain_status t
JOIN resorts r ON t.resort_id = r.id
WHERE r.key = 'breckenridge'
  AND t.item_name = 'Peak 8 SuperConnect'
ORDER BY date DESC
```

---

## Building Features with the Database

### Example: Grooming Pattern Analyzer

You mentioned wanting to analyze grooming patterns for specific runs. Here's how:

```javascript
async function getGroomingPattern(resortKey, runName) {
  const db = getDatabase();

  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        date,
        grooming_status,
        grooming_type,
        status as run_status
      FROM terrain_status t
      JOIN resorts r ON t.resort_id = r.id
      WHERE r.key = ?
        AND t.item_name = ?
        AND t.item_type = 'trail'
      ORDER BY date DESC
    `, [resortKey, runName], (err, rows) => {
      if (err) reject(err);
      else {
        const analysis = {
          run: runName,
          totalDays: rows.length,
          groomedDays: rows.filter(r => r.grooming_status).length,
          groomingFrequency: rows.filter(r => r.grooming_status).length / rows.length,
          history: rows
        };
        resolve(analysis);
      }
      closeDatabase(db);
    });
  });
}

// Usage
const pattern = await getGroomingPattern('vail', 'Born Free');
console.log(`${pattern.run} is groomed ${(pattern.groomingFrequency * 100).toFixed(1)}% of the time`);
```

### Example: Best Snow Day Finder

```javascript
function getBestSnowDays(minSnowfall = 6) {
  const db = getDatabase();

  db.all(`
    SELECT
      r.name as resort,
      s.date,
      s.new_snow_24h_inches as snowfall,
      s.base_depth_inches as base,
      s.weather_condition
    FROM snow_conditions s
    JOIN resorts r ON s.resort_id = r.id
    WHERE s.new_snow_24h_inches >= ?
    ORDER BY s.new_snow_24h_inches DESC, s.date DESC
  `, [minSnowfall], (err, rows) => {
    console.log(`Found ${rows.length} powder days with ${minSnowfall}+ inches!`);
    console.table(rows);
    closeDatabase(db);
  });
}
```

---

## Accessing in Web Apps

### Option 1: SQL.js (Browser-based)
Download the database file and query it in the browser using [sql.js](https://github.com/sql-js/sql.js/):

```javascript
// In your web app
const SQL = await initSqlJs();
const dbResponse = await fetch('https://yourdomain.github.io/ski-run-scraper/data/ski-data.db');
const buffer = await dbResponse.arrayBuffer();
const db = new SQL.Database(new Uint8Array(buffer));

const results = db.exec(`
  SELECT * FROM terrain_status
  WHERE resort_id = 1
  ORDER BY date DESC
`);
```

### Option 2: Build a REST API
Create a simple Node.js API that queries the database:

```javascript
// api.js
const express = require('express');
const { getDatabase } = require('./database');

const app = express();
const db = getDatabase();

app.get('/api/grooming/:resort/:run', (req, res) => {
  db.all(`
    SELECT * FROM terrain_status t
    JOIN resorts r ON t.resort_id = r.id
    WHERE r.key = ? AND t.item_name = ?
    ORDER BY date DESC
  `, [req.params.resort, req.params.run], (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

app.listen(3000);
```

---

## Maintenance

### Rebuilding the Database
If you ever need to rebuild from scratch:
```bash
rm data/ski-data.db
npm run db:import
```

### Database Size
- Current: ~2.3MB (12 days of data)
- Projected: ~20-30MB for a full season (150 days)
- Still very manageable for git and GitHub Pages

### Backing Up
The database is automatically committed to git along with JSON files. Full history is preserved in git commits.

---

## Tips

1. **Use indices**: The database has indices on common query patterns (resort_id, date, item_name, grooming_status)

2. **Check raw_data**: For detailed information, the `raw_data` column contains the full JSON blob:
   ```sql
   SELECT raw_data FROM terrain_status WHERE item_name = 'Born Free' LIMIT 1
   ```

3. **Date filtering**: SQLite has great date functions:
   ```sql
   -- Last 7 days
   WHERE date >= date('now', '-7 days')

   -- Specific month
   WHERE date BETWEEN '2025-12-01' AND '2025-12-31'

   -- Day of week
   WHERE strftime('%w', date) = '6'  -- Saturdays
   ```

4. **Aggregations**: Use GROUP BY for pattern analysis:
   ```sql
   -- Average grooming frequency by day of week
   SELECT
     strftime('%w', date) as day_of_week,
     COUNT(*) as groomed_count
   FROM terrain_status
   WHERE grooming_status IS NOT NULL
   GROUP BY day_of_week
   ```

---

## Future Enhancements

Potential additions:
- Analytics dashboard (web-based SQL.js + Charts)
- Weekly grooming reports
- Snow forecast tracking
- Push notifications for powder days
- Grooming prediction ML model

---

## Questions?

See [example-queries.js](./example-queries.js) for more query patterns and ideas!
