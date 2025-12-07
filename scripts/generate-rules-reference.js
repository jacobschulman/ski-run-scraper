#!/usr/bin/env node

/**
 * Generate Rules Reference JSON
 *
 * Exports the rules from lib/prose/rules.js as a JSON file that can be
 * consumed by the briefs-overview dashboard for debugging purposes.
 *
 * Usage: node scripts/generate-rules-reference.js
 */

const fs = require('fs');
const path = require('path');
const { rules } = require('../lib/prose/rules');

// Output path
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'rules-reference.json');

// Convert rules to serializable format
const reference = rules.map(rule => ({
  id: rule.id,
  category: rule.category,
  priority: rule.priority,
  headlineTemplate: rule.headlineTemplate || null,
  bodyFragmentTemplate: rule.bodyFragmentTemplate || null,
  fragmentOrder: rule.fragmentOrder || 99,
  // Stringify the condition function for display purposes
  conditionSource: rule.condition.toString()
    // Clean up the function for readability
    .replace(/\s+/g, ' ')
    .trim()
}));

// Sort by priority descending for easy reference
reference.sort((a, b) => b.priority - a.priority);

// Add metadata
const output = {
  generated: new Date().toISOString(),
  count: reference.length,
  rules: reference
};

// Write to file
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log(`Generated rules reference with ${reference.length} rules at ${OUTPUT_PATH}`);
