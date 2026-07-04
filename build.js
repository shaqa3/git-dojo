// Build step: inline the tested git engine into the UI shell to produce a
// single self-contained HTML file (dist/git-dojo.html) plus a bundle for tests.
const fs = require('fs');
const path = require('path');

const root = __dirname;
const engineSrc = fs.readFileSync(path.join(root, 'src/git-engine.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '')   // strip the node-only exports block
  .trimEnd();
const ui = fs.readFileSync(path.join(root, 'src/ui.html'), 'utf8');

const out = ui.replace('/*__ENGINE__*/', engineSrc);
if (out.includes('/*__ENGINE__*/')) throw new Error('engine placeholder was not replaced');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/git-dojo.html'), out);

// extract the inlined <script> so tests can require/execute it in isolation
const m = out.match(/<script>([\s\S]*)<\/script>/);
fs.writeFileSync(path.join(root, 'dist/_bundle.js'), m[1]);

console.log('built dist/git-dojo.html  (' + (out.length / 1024).toFixed(1) + ' kb)');
