// Quick sanity check: every backend .js file must at least parse.   npm run check
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const skip = new Set(['node_modules', 'uploads']);
let failures = 0;

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) {
      try { execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' }); }
      catch (e) { failures++; console.error(`✘ ${path.relative(root, full)}\n${e.stderr}`); }
    }
  }
})(root);

console.log(failures ? `${failures} file(s) failed` : '✔ all backend files parse');
process.exitCode = failures ? 1 : 0;
