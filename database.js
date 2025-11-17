const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'ski-data.db');

/**
 * Initialize the SQLite database and create tables if they don't exist
 */
function initializeDatabase() {
  const db = new sqlite3.Database(DB_PATH);

  db.serialize(() => {
    // Create resorts table
    db.run(`
      CREATE TABLE IF NOT EXISTS resorts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        timezone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create terrain_status table for daily trail/lift/grooming data
    db.run(`
      CREATE TABLE IF NOT EXISTS terrain_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resort_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        item_name TEXT NOT NULL,
        item_type TEXT,
        status TEXT,
        grooming_status TEXT,
        grooming_type TEXT,
        raw_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (resort_id) REFERENCES resorts(id),
        UNIQUE(resort_id, date, item_name)
      )
    `);

    // Create snow_conditions table for daily snow reports
    db.run(`
      CREATE TABLE IF NOT EXISTS snow_conditions (
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
        raw_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (resort_id) REFERENCES resorts(id),
        UNIQUE(resort_id, date)
      )
    `);

    // Create indices for common queries
    db.run(`CREATE INDEX IF NOT EXISTS idx_terrain_resort_date ON terrain_status(resort_id, date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_terrain_name ON terrain_status(item_name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_terrain_grooming ON terrain_status(grooming_status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_snow_resort_date ON snow_conditions(resort_id, date)`);
  });

  return db;
}

/**
 * Get or create a resort by key
 */
function getOrCreateResort(db, resortKey, resortName, timezone, callback) {
  db.get(
    'SELECT id FROM resorts WHERE key = ?',
    [resortKey],
    (err, row) => {
      if (err) return callback(err);

      if (row) {
        callback(null, row.id);
      } else {
        db.run(
          'INSERT INTO resorts (key, name, timezone) VALUES (?, ?, ?)',
          [resortKey, resortName, timezone],
          function(err) {
            if (err) return callback(err);
            callback(null, this.lastID);
          }
        );
      }
    }
  );
}

/**
 * Insert or update terrain status data
 */
function saveTerrainStatus(db, resortId, date, terrainData, callback) {
  if (!terrainData || !terrainData.FMR || !terrainData.FMR.GroomingAreas) {
    return callback(null);
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO terrain_status
    (resort_id, date, item_name, item_type, status, grooming_status, grooming_type, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let insertCount = 0;

  // Process all grooming areas
  terrainData.FMR.GroomingAreas.forEach(area => {
    if (area.Trails) {
      area.Trails.forEach(trail => {
        // Map Vail API properties to database fields
        const status = trail.Status || (trail.IsOpen ? 'Open' : 'Closed');
        const groomingStatus = trail.GroomingStatus || (trail.IsGroomed ? 'Groomed' : null);
        const groomingType = trail.Type || trail.TrailType || null;

        stmt.run(
          resortId,
          date,
          trail.Name || 'Unknown',
          'trail',
          status,
          groomingStatus,
          groomingType,
          JSON.stringify(trail)
        );
        insertCount++;
      });
    }

    if (area.Lifts) {
      area.Lifts.forEach(lift => {
        // Map lift status
        const liftStatus = lift.Status || (lift.IsOpen ? 'Open' : 'Closed');

        stmt.run(
          resortId,
          date,
          lift.Name || 'Unknown',
          'lift',
          liftStatus,
          null,
          null,
          JSON.stringify(lift)
        );
        insertCount++;
      });
    }
  });

  stmt.finalize((err) => {
    if (err) return callback(err);
    callback(null, insertCount);
  });
}

/**
 * Insert or update snow conditions data
 */
function saveSnowConditions(db, resortId, date, snowData, callback) {
  if (!snowData) {
    return callback(null);
  }

  db.run(
    `INSERT OR REPLACE INTO snow_conditions
     (resort_id, date, overnight_snowfall_inches, base_depth_inches,
      new_snow_24h_inches, new_snow_48h_inches, new_snow_7day_inches,
      season_total_inches, weather_condition, temperature, raw_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      resortId,
      date,
      snowData.overnightSnowfall?.inches || null,
      snowData.baseDepth?.inches || null,
      snowData.newSnow24Hours?.inches || null,
      snowData.newSnow48Hours?.inches || null,
      snowData.newSnow7Days?.inches || null,
      snowData.seasonTotal?.inches || null,
      snowData.currentConditions?.weather || null,
      snowData.currentConditions?.temperature || null,
      JSON.stringify(snowData)
    ],
    function(err) {
      if (err) return callback(err);
      callback(null, this.lastID);
    }
  );
}

/**
 * Get database connection
 */
function getDatabase() {
  return new sqlite3.Database(DB_PATH);
}

/**
 * Close database connection
 */
function closeDatabase(db) {
  db.close();
}

module.exports = {
  initializeDatabase,
  getOrCreateResort,
  saveTerrainStatus,
  saveSnowConditions,
  getDatabase,
  closeDatabase,
  DB_PATH
};
