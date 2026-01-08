#!/usr/bin/env node
// Converts CodeRabbit JSON to markdown for memory bank indexing

import fs from 'fs';

const jsonPath = process.argv[2];

if (!jsonPath || !fs.existsSync(jsonPath)) {
  console.error('Usage: node generate-review-summary.js <path-to-review.json>');
  process.exit(1);
}

try {
  const review = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  console.log(`# CodeRabbit Review - ${review.commit_hash || 'uncommitted'}\n`);
  // Use review timestamp if available, otherwise current time
  const timestamp = review.timestamp ? new Date(review.timestamp).toISOString() : new Date().toISOString();
  console.log(`**Date:** ${timestamp}\n`);
  console.log(`**Files Reviewed:** ${review.files_count || 0}\n`);
  console.log(`**Issues Found:** ${review.issues?.length || 0}\n\n`);

  if (review.issues && review.issues.length > 0) {
    console.log('## Issues\n');
    review.issues.forEach((issue, idx) => {
      console.log(`### ${idx + 1}. ${issue.title} (${issue.severity})\n`);
      console.log(`**File:** \`${issue.file}:${issue.line}\`\n`);
      console.log(`**Category:** ${issue.category}\n`);
      console.log(`**Description:** ${issue.description}\n`);
      if (issue.suggestion) {
        console.log(`**Suggested Fix:**\n\`\`\`\n${issue.suggestion}\n\`\`\`\n`);
      }
      console.log('');
    });
  } else {
    console.log('✓ No issues found!\n');
  }

  if (review.summary) {
    console.log('## Summary\n');
    console.log(review.summary);
    console.log('');
  }
} catch (error) {
  console.error('Error parsing CodeRabbit JSON:', error.message);
  process.exit(1);
}
