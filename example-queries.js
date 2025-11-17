const { getDatabase, closeDatabase } = require('./database');

/**
 * Example queries demonstrating how to use the SQLite database
 * for historical ski data analysis
 */

function runQuery(db, query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function exampleQueries() {
  const db = getDatabase();

  console.log('🎿 Ski Data Historical Query Examples');
  console.log('='.repeat(80));

  try {
    // Example 1: Get grooming history for a specific run
    console.log('\n1️⃣  Grooming History for a Specific Run');
    console.log('-'.repeat(80));
    const groomingHistory = await runQuery(db, `
      SELECT
        r.name as resort,
        t.date,
        t.item_name as run_name,
        t.grooming_status,
        t.grooming_type
      FROM terrain_status t
      JOIN resorts r ON t.resort_id = r.id
      WHERE r.key = ?
        AND t.item_name LIKE ?
        AND t.grooming_status IS NOT NULL
      ORDER BY t.date DESC
      LIMIT 10
    `, ['vail', '%Game Creek%']);

    console.log('Run: Game Creek runs at Vail');
    console.table(groomingHistory);

    // Example 2: Find most frequently groomed runs at a resort
    console.log('\n2️⃣  Most Frequently Groomed Runs (All Time)');
    console.log('-'.repeat(80));
    const mostGroomed = await runQuery(db, `
      SELECT
        r.name as resort,
        t.item_name as run_name,
        COUNT(DISTINCT t.date) as days_groomed,
        GROUP_CONCAT(DISTINCT t.grooming_type) as grooming_types
      FROM terrain_status t
      JOIN resorts r ON t.resort_id = r.id
      WHERE r.key = ?
        AND t.grooming_status IN ('Fresh Corduroy', 'Groomed', 'groomed')
        AND t.item_type = 'trail'
      GROUP BY r.name, t.item_name
      ORDER BY days_groomed DESC
      LIMIT 10
    `, ['breckenridge']);

    console.log('Resort: Breckenridge');
    console.table(mostGroomed);

    // Example 3: Snow conditions over time for a resort
    console.log('\n3️⃣  Snow Conditions History');
    console.log('-'.repeat(80));
    const snowHistory = await runQuery(db, `
      SELECT
        r.name as resort,
        s.date,
        s.base_depth_inches as base_depth,
        s.new_snow_24h_inches as "24h_snow",
        s.new_snow_7day_inches as "7day_snow",
        s.season_total_inches as season_total,
        s.weather_condition
      FROM snow_conditions s
      JOIN resorts r ON s.resort_id = r.id
      WHERE r.key = ?
      ORDER BY s.date DESC
      LIMIT 10
    `, ['vail']);

    console.log('Resort: Vail');
    console.table(snowHistory);

    // Example 4: Compare snowfall across resorts
    console.log('\n4️⃣  Latest Snow Report - All Resorts');
    console.log('-'.repeat(80));
    const latestSnow = await runQuery(db, `
      SELECT
        r.name as resort,
        s.date,
        s.base_depth_inches as base,
        s.new_snow_24h_inches as "24h",
        s.season_total_inches as season_total
      FROM snow_conditions s
      JOIN resorts r ON s.resort_id = r.id
      WHERE s.date = (
        SELECT MAX(date) FROM snow_conditions WHERE resort_id = s.resort_id
      )
      ORDER BY s.base_depth_inches DESC
    `);

    console.table(latestSnow);

    // Example 5: Find runs that are open but not groomed
    console.log('\n5️⃣  Open But Not Groomed Runs (Latest Data)');
    console.log('-'.repeat(80));
    const openNotGroomed = await runQuery(db, `
      SELECT
        r.name as resort,
        t.date,
        t.item_name as run_name,
        t.status,
        t.grooming_status
      FROM terrain_status t
      JOIN resorts r ON t.resort_id = r.id
      WHERE r.key = ?
        AND t.date = (SELECT MAX(date) FROM terrain_status WHERE resort_id = t.resort_id)
        AND t.item_type = 'trail'
        AND t.status = 'Open'
        AND (t.grooming_status IS NULL OR t.grooming_status NOT IN ('Fresh Corduroy', 'Groomed'))
      ORDER BY t.item_name
      LIMIT 15
    `, ['vail']);

    console.log('Resort: Vail (Latest date)');
    console.table(openNotGroomed);

    // Example 6: Lift status history
    console.log('\n6️⃣  Lift Status History');
    console.log('-'.repeat(80));
    const liftHistory = await runQuery(db, `
      SELECT
        r.name as resort,
        t.date,
        t.item_name as lift_name,
        t.status
      FROM terrain_status t
      JOIN resorts r ON t.resort_id = r.id
      WHERE r.key = ?
        AND t.item_type = 'lift'
      ORDER BY t.date DESC, t.item_name
      LIMIT 20
    `, ['vail']);

    console.log('Resort: Vail');
    console.table(liftHistory);

    // Example 7: Statistics summary
    console.log('\n7️⃣  Database Statistics');
    console.log('-'.repeat(80));
    const stats = await runQuery(db, `
      SELECT
        'Resorts' as category,
        COUNT(*) as count
      FROM resorts
      UNION ALL
      SELECT
        'Terrain Records' as category,
        COUNT(*) as count
      FROM terrain_status
      UNION ALL
      SELECT
        'Snow Records' as category,
        COUNT(*) as count
      FROM snow_conditions
      UNION ALL
      SELECT
        'Date Range' as category,
        (julianday(MAX(date)) - julianday(MIN(date))) + 1 as count
      FROM terrain_status
    `);

    console.table(stats);

    // Example 8: Custom query - Best snow day
    console.log('\n8️⃣  Best 24hr Snowfall Days');
    console.log('-'.repeat(80));
    const bestSnowDays = await runQuery(db, `
      SELECT
        r.name as resort,
        s.date,
        s.new_snow_24h_inches as "24h_snowfall",
        s.base_depth_inches as base_depth,
        s.weather_condition
      FROM snow_conditions s
      JOIN resorts r ON s.resort_id = r.id
      WHERE s.new_snow_24h_inches > 0
      ORDER BY s.new_snow_24h_inches DESC
      LIMIT 10
    `);

    console.table(bestSnowDays);

    console.log('\n' + '='.repeat(80));
    console.log('✅ Example queries complete!');
    console.log('='.repeat(80));
    console.log('\n💡 Pro Tips:');
    console.log('   - Use GROUP BY to aggregate data over time');
    console.log('   - Use JOIN to combine resort, terrain, and snow data');
    console.log('   - Filter by date ranges: WHERE date BETWEEN "2025-11-01" AND "2025-11-30"');
    console.log('   - Use COUNT, AVG, MAX, MIN for statistics');
    console.log('   - Check raw_data column for full JSON details\n');

  } catch (err) {
    console.error('Query error:', err);
  } finally {
    closeDatabase(db);
  }
}

// Run examples
exampleQueries();
