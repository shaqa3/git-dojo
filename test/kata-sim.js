// Extract the ACTUAL KATAS block from the shipped HTML and simulate every kata
// end-to-end using the tested engine. This validates checks + suggested commands.
const fs = require('fs');
const G = require('../src/git-engine.js');

// expose engine fns as globals so the extracted block resolves them
Object.assign(global, G);

const html = fs.readFileSync(require('path').join(__dirname,'..','dist','git-dojo.html'), 'utf8');
// grab from `const BELTS` up to the end of the KATAS array `];`
const start = html.indexOf('const BELTS');
const marker = html.indexOf('/* ============================ APP STATE');
const block = html.slice(start, marker);
// eval it: defines BELTS, committed, headMsg, headParents, KATAS in this scope
let KATAS, BELTS;
eval(block.replace(/const KATAS/, 'KATAS').replace(/const BELTS/, 'BELTS')
        .replace(/const committed/, 'committed').replace(/const headMsg/, 'headMsg')
        .replace(/const headParents/, 'headParents'));

let pass = 0, fail = 0;
for (let i = 0; i < KATAS.length; i++) {
  const k = KATAS[i];
  const r = makeRepo();
  if (k.setup) k.setup(r);
  let stepIndex = 0;
  // advance for any setup-satisfied steps
  while (stepIndex < k.steps.length && k.steps[stepIndex].check(r)) stepIndex++;
  const startStep = stepIndex;
  // run each remaining step's suggested commands in order
  const log = [];
  for (let s = startStep; s < k.steps.length; s++) {
    for (const cmd of k.steps[s].cmds) {
      const res = exec(r, cmd);
      if (res && res.interactive === 'rebase') {
        // simulate the modal: keep first, squash the rest into one clean commit
        const plan = res.commits.map((c, idx) => ({ id: c.id, action: idx === 0 ? 'pick' : 'squash' }));
        rebaseInteractive(r, res.base, plan);
        log.push(`  $ ${cmd}   (modal: pick + squash×${res.commits.length - 1})`);
      } else {
        log.push(`  $ ${cmd}` + (res.error ? `   ! ${res.error.split('\n')[0]}` : ''));
      }
    }
    // advance
    while (stepIndex < k.steps.length && k.steps[stepIndex].check(r)) stepIndex++;
  }
  const done = stepIndex >= k.steps.length;
  if (done) { pass++; console.log(`✓ Kata ${i + 1} [${k.belt}] ${k.title} — ${k.steps.length} steps`); }
  else {
    fail++;
    console.log(`✗ Kata ${i + 1} [${k.belt}] ${k.title} — stuck at step ${stepIndex + 1}/${k.steps.length}: "${k.steps[stepIndex].text}"`);
    console.log(log.join('\n'));
  }
}
console.log(`\n${pass}/${KATAS.length} katas completable via their hints. ${fail} failed.`);
process.exit(fail ? 1 : 0);
