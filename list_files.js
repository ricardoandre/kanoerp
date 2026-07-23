#!/usr/bin/env node
// list_files.js — recursively lists every file in the repo (excluding .git),
// so you can paste the output back into a Claude chat as the current file
// structure. No dependencies, just Node's built-in fs/path.
//
// Usage:
//   node list_files.js                 # defaults to ./kanoerp
//   node list_files.js /path/to/repo   # or point it anywhere else

const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || './kanoerp';

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

if (!fs.existsSync(ROOT)) {
  console.error('Path not found: ' + ROOT);
  console.error('Usage: node list_files.js [path-to-repo]');
  process.exit(1);
}

const files = walk(ROOT, []).sort();
console.log('# File structure — ' + path.resolve(ROOT) + ' (' + files.length + ' files)');
console.log('');
files.forEach(f => console.log(f));
