#!/usr/bin/env node
// scripts/lift-health-check.js - Monitor lift data health across all resorts
// Run this periodically to catch API changes and scraper issues early

const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const { formatInTimeZone } = require('date-fns-tz');

// Thresholds for alerts
const STALE_DATA_HOURS = 24;  // Alert if lift data is older than this
const SUSPICIOUS_ZERO_OPEN = true;  // Alert if 0 open lifts during operating hours

function getResortLocalHour(timezone) {
  const now = new Date();
  return parseInt(formatInTimeZone(now, timezone, 'H'));
}

function isWithinOperatingHours(timezone) {
  const hour = getResortLocalHour(timezone);
  return hour >= 8 && hour < 17;  // 8 AM to 5 PM
}

function checkResort(resort) {
  const issues = [];
  const liftsDir = path.join('data', resort.key, 'lifts');
  const indexPath = path.join(liftsDir, 'index.json');

  // Check if lift data exists
  if (!fs.existsSync(indexPath)) {
    issues.push({ severity: 'error', message: 'No lift index.json' });
    return { resort: resort.key, name: resort.name, issues };
  }

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  // Check data freshness
  const generated = new Date(index.generated);
  const hoursOld = (Date.now() - generated.getTime()) / (1000 * 60 * 60);

  if (hoursOld > STALE_DATA_HOURS) {
    issues.push({
      severity: 'warning',
      message: `Stale data (${Math.round(hoursOld)}h old)`
    });
  }

  // Check for suspicious 0 open lifts during operating hours
  if (SUSPICIOUS_ZERO_OPEN && isWithinOperatingHours(resort.timezone)) {
    const openLifts = index.lifts?.filter(l => l.status === 'Open').length || 0;
    if (openLifts === 0 && index.lifts?.length > 0) {
      issues.push({
        severity: 'warning',
        message: `0 open lifts during operating hours (${index.lifts.length} total)`
      });
    }
  }

  // Check for unexpected status values
  const statuses = new Set(index.lifts?.map(l => l.status) || []);
  const expectedStatuses = new Set(['Open', 'Closed', 'Hold', 'Scheduled', 'Windhold']);
  const unexpectedStatuses = [...statuses].filter(s => !expectedStatuses.has(s));

  if (unexpectedStatuses.length > 0) {
    issues.push({
      severity: 'info',
      message: `New status values: ${unexpectedStatuses.join(', ')}`
    });
  }

  // Check if resort has ndjson files (real-time scraping)
  const ndjsonFiles = fs.readdirSync(liftsDir).filter(f => f.endsWith('.ndjson'));
  if (ndjsonFiles.length === 0) {
    issues.push({
      severity: 'warning',
      message: 'No ndjson files (using terrain-derived lift data only)'
    });
  }

  return {
    resort: resort.key,
    name: resort.name,
    provider: resort.provider,
    apiProvider: resort.apiProvider || null,
    liftCount: index.lifts?.length || 0,
    openLifts: index.lifts?.filter(l => l.status === 'Open').length || 0,
    dataAge: `${Math.round(hoursOld)}h`,
    hasRealTimeData: ndjsonFiles.length > 0,
    issues
  };
}

function main() {
  console.log('🔍 Lift Data Health Check');
  console.log('='.repeat(60));
  console.log(`Run time: ${new Date().toISOString()}\n`);

  const results = [];
  const inSeasonResorts = config.resorts.filter(r => {
    // Simple season check - can be improved
    const month = new Date().getMonth() + 1;
    return month >= 11 || month <= 4;
  });

  for (const resort of inSeasonResorts) {
    const result = checkResort(resort);
    results.push(result);
  }

  // Report issues
  const resortsWithIssues = results.filter(r => r.issues.length > 0);
  const errors = results.filter(r => r.issues.some(i => i.severity === 'error'));
  const warnings = results.filter(r => r.issues.some(i => i.severity === 'warning'));

  if (errors.length > 0) {
    console.log('❌ ERRORS:');
    errors.forEach(r => {
      r.issues.filter(i => i.severity === 'error').forEach(i => {
        console.log(`   ${r.name}: ${i.message}`);
      });
    });
    console.log();
  }

  if (warnings.length > 0) {
    console.log('⚠️  WARNINGS:');
    warnings.forEach(r => {
      r.issues.filter(i => i.severity === 'warning').forEach(i => {
        console.log(`   ${r.name}: ${i.message}`);
      });
    });
    console.log();
  }

  // Summary table for resorts without real-time lift data
  const noRealTime = results.filter(r => !r.hasRealTimeData && r.liftCount > 0);
  if (noRealTime.length > 0) {
    console.log('📊 Resorts without real-time lift scraping:');
    console.log('-'.repeat(60));
    noRealTime.forEach(r => {
      console.log(`   ${r.name.padEnd(25)} ${r.apiProvider || 'none'.padEnd(15)} ${r.openLifts}/${r.liftCount} open`);
    });
    console.log();
  }

  // Overall summary
  const healthy = results.filter(r => r.issues.length === 0 && r.hasRealTimeData);
  console.log('📈 SUMMARY:');
  console.log(`   Total resorts checked: ${results.length}`);
  console.log(`   Healthy (real-time data): ${healthy.length}`);
  console.log(`   With warnings: ${warnings.length}`);
  console.log(`   With errors: ${errors.length}`);
  console.log('='.repeat(60));

  // Exit with error code if there are issues
  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
