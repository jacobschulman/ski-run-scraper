#!/usr/bin/env node

/**
 * Smart commit checker - only commits when there's NEW data
 *
 * For GitHub Actions workflows to avoid committing when:
 * - Only timestamps changed (resorts still closed, no new data)
 * - Only aggregate files regenerated from same source data
 * - No resorts have new/changed data points
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function log(msg) {
  console.error(`[smart-commit-check] ${msg}`);
}

/**
 * Get git diff to see what changed
 */
function getChangedFiles() {
  try {
    const diff = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim().split('\n');
    return diff.filter(f => f.length > 0);
  } catch (err) {
    log(`Error getting diff: ${err.message}`);
    return [];
  }
}

/**
 * Get git diff stats for a specific file
 */
function getFileDiff(filePath) {
  try {
    const diff = execSync(`git diff --cached "${filePath}"`, { encoding: 'utf8' });
    return diff;
  } catch (err) {
    return '';
  }
}

/**
 * Check if NDJSON files have NEW lines (actual data added)
 * Skip if only timestamps/metadata changed
 */
function checkNDJSONForNewData(filePath) {
  const diff = getFileDiff(filePath);
  if (!diff) return false;

  // Count added vs removed lines
  const addedLines = diff.split('\n').filter(l => l.startsWith('+')).length;
  const removedLines = diff.split('\n').filter(l => l.startsWith('-')).length;

  // If only adding new lines (appending), that's new data
  if (addedLines > 0 && removedLines <= 1) {
    // Parse actual data to check if it's meaningful
    const addedContent = diff.split('\n')
      .filter(l => l.startsWith('+') && !l.startsWith('+++'))
      .map(l => l.substring(1));

    for (const line of addedContent) {
      if (line.trim().length === 0) continue;
      try {
        const record = JSON.parse(line);
        // Check if this is a real data record (not just metadata)
        if (record.name || record.status || record.waitMinutes !== undefined) {
          return true; // New actual data found
        }
      } catch (e) {
        // Not JSON, skip
      }
    }
  }

  return false;
}

/**
 * Check if JSON snapshot files have MEANINGFUL changes
 * Skip if only timestamps or forecast dates changed
 */
function checkJSONForMeaningfulChanges(filePath) {
  const diff = getFileDiff(filePath);
  if (!diff) return false;

  // For snow/terrain data, look for substantive changes:
  // - new snowfall, base depth, trail counts, status changes
  // - NOT just timestamp or forecast updates

  const meaningfulKeys = [
    'snowfall', 'baseDepth', 'depth', 'trails', 'status',
    'groomed', 'open', 'closed', 'temperature', 'conditions'
  ];

  const lines = diff.split('\n');
  for (const line of lines) {
    if (!line.startsWith('+') && !line.startsWith('-')) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;

    // Check if this line contains meaningful data
    for (const key of meaningfulKeys) {
      if (line.includes(`"${key}"`) || line.includes(`'${key}'`)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Main check logic
 */
function shouldCommit() {
  const changedFiles = getChangedFiles();

  if (changedFiles.length === 0) {
    log('No staged changes found');
    return false;
  }

  log(`Checking ${changedFiles.length} changed files for new data...`);

  let hasNewData = false;

  // Check each changed file
  for (const file of changedFiles) {
    // Skip code files, config files, etc - these should always be committed
    if (file.endsWith('.js') || file.endsWith('.yml') || file.endsWith('.json') && !file.startsWith('data/')) {
      log(`  ${file}: code file, always commit`);
      return true;
    }

    // NDJSON time-series data (lift wait times, snow conditions, etc)
    if (file.endsWith('.ndjson')) {
      if (checkNDJSONForNewData(file)) {
        log(`  ${file}: new data added ✓`);
        hasNewData = true;
      } else {
        log(`  ${file}: no new data (timestamp-only update)`);
      }
      continue;
    }

    // JSON snapshot files (terrain, snow reports, brief, etc)
    if (file.endsWith('.json') && file.startsWith('data/')) {
      if (checkJSONForMeaningfulChanges(file)) {
        log(`  ${file}: meaningful changes found ✓`);
        hasNewData = true;
      } else {
        log(`  ${file}: no meaningful changes (likely aggregate regeneration)`);
      }
      continue;
    }

    // Unknown data file - be conservative and commit it
    if (file.startsWith('data/')) {
      log(`  ${file}: data file, committing`);
      hasNewData = true;
    }
  }

  return hasNewData;
}

// Run check
const commitNeeded = shouldCommit();

if (commitNeeded) {
  log('✓ New data detected - proceeding with commit');
  console.log('new_data=true');
  process.exit(0);
} else {
  log('✗ No new data - skipping commit');
  console.log('new_data=false');
  process.exit(0);
}
