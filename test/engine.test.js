const G = require('../src/git-engine.js');

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  FAIL:', msg); } }
function run(repo, line) { const r = G.exec(repo, line); if (r.error) console.log(`  [${line}] -> ERR: ${r.error.split('\n')[0]}`); return r; }
function seq(rng) { let i = 0; const a = [0.11,0.22,0.33,0.44,0.55,0.66,0.77,0.88,0.99,0.05,0.15,0.25,0.35,0.45,0.65,0.85,0.12,0.34,0.56,0.78,0.9,0.1,0.2,0.3]; return () => a[(i++) % a.length]; }

// Kata 1: first commit
(function () {
  console.log('Kata 1: first commit');
  const r = G.makeRepo(seq());
  G.exec(r, 'git init');
  G.fsWrite(r, 'README.md', 'hello');
  let s = G.exec(r, 'git status');
  assert(s.output.includes('Untracked files'), 'shows untracked');
  G.exec(r, 'git add README.md');
  s = G.exec(r, 'git status');
  assert(s.output.includes('Changes to be committed'), 'staged after add');
  const c = G.exec(r, 'git commit -m "first commit"');
  assert(c.output.includes('first commit'), 'commit output');
  assert(G.headCommitId(r), 'has head commit');
  s = G.exec(r, 'git status');
  assert(s.output.includes('working tree clean'), 'clean after commit');
})();

// Kata 2: branch + commit + switch back
(function () {
  console.log('Kata 2: branching');
  const r = G.makeRepo(seq());
  G.exec(r, 'git init');
  G.fsWrite(r, 'a.txt', '1'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "base"');
  G.exec(r, 'git checkout -b feature');
  assert(r.head.branch === 'feature', 'on feature');
  G.fsWrite(r, 'b.txt', '2'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "feat"');
  assert('b.txt' in r.wd, 'b.txt present on feature');
  G.exec(r, 'git checkout main');
  assert(!('b.txt' in r.wd), 'b.txt gone on main');
  assert(r.head.branch === 'main', 'back on main');
})();

// Kata 3: merge (fast-forward + true merge)
(function () {
  console.log('Kata 3: merge');
  const r = G.makeRepo(seq());
  G.exec(r, 'git init');
  G.fsWrite(r, 'a.txt', '1'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "base"');
  G.exec(r, 'git checkout -b feature');
  G.fsWrite(r, 'b.txt', '2'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "feat"');
  G.exec(r, 'git checkout main');
  const m = G.exec(r, 'git merge feature');
  assert(m.output.includes('Fast-forward'), 'fast-forward merge');
  assert('b.txt' in r.wd, 'feature file merged');

  // true merge
  const r2 = G.makeRepo(seq());
  G.exec(r2, 'git init');
  G.fsWrite(r2, 'a.txt', '1'); G.exec(r2, 'git add .'); G.exec(r2, 'git commit -m "base"');
  G.exec(r2, 'git checkout -b feature');
  G.fsWrite(r2, 'b.txt', '2'); G.exec(r2, 'git add .'); G.exec(r2, 'git commit -m "feat"');
  G.exec(r2, 'git checkout main');
  G.fsWrite(r2, 'c.txt', '3'); G.exec(r2, 'git add .'); G.exec(r2, 'git commit -m "main work"');
  const m2 = G.exec(r2, 'git merge feature');
  assert(m2.output && m2.output.includes('Merge made'), 'true merge commit');
  const head = r2.commits[G.headCommitId(r2)];
  assert(head.parents.length === 2, 'merge has 2 parents');
  assert('b.txt' in r2.wd && 'c.txt' in r2.wd, 'both files present');
})();

// Kata 4: undo with reset
(function () {
  console.log('Kata 4: reset');
  const r = G.makeRepo(seq());
  G.exec(r, 'git init');
  G.fsWrite(r, 'a.txt', '1'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "good"');
  const good = G.headCommitId(r);
  G.fsWrite(r, 'oops.txt', 'bad'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "oops"');
  assert(G.headCommitId(r) !== good, 'moved forward');
  G.exec(r, 'git reset --hard HEAD~1');
  assert(G.headCommitId(r) === good, 'back to good commit');
  assert(!('oops.txt' in r.wd), 'oops file gone (hard reset)');
})();

// Kata 5: reset --soft keeps changes staged
(function () {
  console.log('Kata 5: soft reset');
  const r = G.makeRepo(seq());
  G.exec(r, 'git init');
  G.fsWrite(r, 'a.txt', '1'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "one"');
  G.fsWrite(r, 'a.txt', '2'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "two"');
  G.exec(r, 'git reset --soft HEAD~1');
  const s = G.exec(r, 'git status');
  assert(s.output.includes('Changes to be committed'), 'soft reset keeps staged');
  assert(r.wd['a.txt'] === '2', 'wd retains new content');
})();

// Kata 6: stash
(function () {
  console.log('Kata 6: stash');
  const r = G.makeRepo(seq());
  G.exec(r, 'git init');
  G.fsWrite(r, 'a.txt', '1'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "base"');
  G.fsWrite(r, 'a.txt', 'work in progress');
  G.exec(r, 'git stash');
  assert(r.wd['a.txt'] === '1', 'stash reverts wd');
  assert(r.stashes.length === 1, 'stash saved');
  G.exec(r, 'git stash pop');
  assert(r.wd['a.txt'] === 'work in progress', 'stash pop restores');
})();

// Kata 7: cherry-pick
(function () {
  console.log('Kata 7: cherry-pick');
  const r = G.makeRepo(seq());
  G.exec(r, 'git init');
  G.fsWrite(r, 'a.txt', '1'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "base"');
  G.exec(r, 'git checkout -b feature');
  G.fsWrite(r, 'fix.txt', 'important fix'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "fix"');
  const fixCommit = G.headCommitId(r);
  G.exec(r, 'git checkout main');
  assert(!('fix.txt' in r.wd), 'fix not on main yet');
  const cp = G.exec(r, 'git cherry-pick ' + fixCommit);
  assert('fix.txt' in r.wd, 'cherry-pick brought fix');
})();

// Kata 8: rebase (linear replay)
(function () {
  console.log('Kata 8: rebase');
  const r = G.makeRepo(seq());
  G.exec(r, 'git init');
  G.fsWrite(r, 'a.txt', '1'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "base"');
  G.exec(r, 'git checkout -b feature');
  G.fsWrite(r, 'b.txt', '2'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "feat"');
  G.exec(r, 'git checkout main');
  G.fsWrite(r, 'c.txt', '3'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "main work"');
  const mainTip = G.headCommitId(r);
  G.exec(r, 'git checkout feature');
  const reb = G.exec(r, 'git rebase main');
  assert(!reb.error, 'rebase ok');
  // feature tip parent chain should include mainTip
  const anc = G.ancestors(r, G.headCommitId(r));
  assert(anc.has(mainTip), 'feature now based on main tip');
  assert('b.txt' in r.wd && 'c.txt' in r.wd, 'both files present after rebase');
})();

// Kata 9: merge conflict resolution
(function () {
  console.log('Kata 9: conflict');
  const r = G.makeRepo(seq());
  G.exec(r, 'git init');
  G.fsWrite(r, 'file.txt', 'line one'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "base"');
  G.exec(r, 'git checkout -b feature');
  G.fsWrite(r, 'file.txt', 'feature version'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "feat"');
  G.exec(r, 'git checkout main');
  G.fsWrite(r, 'file.txt', 'main version'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "main"');
  const m = G.exec(r, 'git merge feature');
  assert(m.error && m.error.includes('CONFLICT'), 'conflict detected');
  assert(r.merge, 'merge in progress');
  assert(r.wd['file.txt'].includes('<<<<<<<'), 'conflict markers in file');
  // resolve
  G.fsWrite(r, 'file.txt', 'resolved version');
  G.exec(r, 'git add file.txt');
  const c = G.exec(r, 'git commit -m "merge resolved"');
  assert(!c.error, 'commit after resolve');
  assert(!r.merge, 'merge cleared');
  const head = r.commits[G.headCommitId(r)];
  assert(head.parents.length === 2, 'merge commit has 2 parents');
})();

// resolveRef checks
(function () {
  console.log('resolveRef');
  const r = G.makeRepo(seq());
  G.exec(r, 'git init');
  G.fsWrite(r, 'a', '1'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "c1"');
  const c1 = G.headCommitId(r);
  G.fsWrite(r, 'a', '2'); G.exec(r, 'git add .'); G.exec(r, 'git commit -m "c2"');
  assert(G.resolveRef(r, 'HEAD~1') === c1, 'HEAD~1');
  assert(G.resolveRef(r, 'HEAD^') === c1, 'HEAD^');
  assert(G.resolveRef(r, 'main') === G.headCommitId(r), 'branch ref');
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
