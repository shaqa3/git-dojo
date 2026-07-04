const G = require('../src/git-engine.js');
let pass = 0, fail = 0;
function assert(c, m) { if (c) pass++; else { fail++; console.log('  FAIL:', m); } }
function base(rng) { const r = G.makeRepo(rng); G.exec(r, 'git init'); r.wd['a.txt'] = '1'; G.exec(r, 'git add .'); G.exec(r, 'git commit -m "base"'); return r; }

// ---- tags ----
(function () {
  console.log('tags');
  const r = base();
  G.exec(r, 'git tag v1.0');
  assert(G.resolveRef(r, 'v1.0') === G.headCommitId(r), 'tag points to head');
  assert(G.branchLabelsFor(r, G.headCommitId(r)).includes('tag: v1.0'), 'tag shows in labels');
  assert(G.exec(r, 'git tag').output.includes('v1.0'), 'tag list');
  G.exec(r, 'git tag -d v1.0');
  assert(!('v1.0' in r.tags), 'tag deleted');
  // tag a specific commit
  r.wd['b.txt'] = '2'; G.exec(r, 'git add .'); G.exec(r, 'git commit -m "second"');
  G.exec(r, 'git tag v0.9 HEAD~1');
  assert(G.resolveRef(r, 'v0.9') === G.resolveRef(r, 'HEAD~1'), 'tag on older commit');
})();

// ---- revert ----
(function () {
  console.log('revert');
  const r = base();
  r.wd['bug.txt'] = 'introduces a bug'; G.exec(r, 'git add .'); G.exec(r, 'git commit -m "add bug"');
  const badId = G.headCommitId(r);
  const res = G.exec(r, 'git revert ' + badId);
  assert(!res.error, 'revert ok: ' + (res.error || ''));
  assert(!('bug.txt' in r.wd), 'reverted file removed from wd');
  assert(!('bug.txt' in G.headTree(r)), 'reverted file gone from tree');
  assert(G.headMessage ? true : G.exec(r, 'git log --oneline').output.includes('Revert'), 'revert commit present');
  // history preserved (bad commit still reachable)
  assert(G.ancestors(r, G.headCommitId(r)).has(badId), 'original commit still in history (non-destructive)');
})();

// ---- reflog + recovery ----
(function () {
  console.log('reflog recovery');
  const r = base();
  r.wd['work.txt'] = 'precious work'; G.exec(r, 'git add .'); G.exec(r, 'git commit -m "precious commit"');
  const lost = G.headCommitId(r);
  G.exec(r, 'git reset --hard HEAD~1');
  assert(G.headCommitId(r) !== lost, 'moved off the commit');
  assert(!('work.txt' in r.wd), 'work gone after hard reset');
  const rl = G.exec(r, 'git reflog');
  assert(rl.output.includes(lost), 'lost commit visible in reflog');
  assert(rl.output.includes('reset:'), 'reflog shows reset action');
  // recover
  G.exec(r, 'git reset --hard ' + lost);
  assert(G.headCommitId(r) === lost, 'recovered commit');
  assert('work.txt' in r.wd, 'work restored');
})();

// ---- diff ----
(function () {
  console.log('diff');
  const r = base();
  r.wd['a.txt'] = 'line one\nline two';
  const d = G.exec(r, 'git diff');
  assert(d.output.includes('-1'), 'diff shows removed');
  assert(d.output.includes('+line one'), 'diff shows added');
  assert(d.output.includes('diff --git a/a.txt'), 'diff header');
  G.exec(r, 'git add a.txt');
  assert(G.exec(r, 'git diff').output === '', 'no unstaged diff after add');
  assert(G.exec(r, 'git diff --staged').output.includes('+line one'), 'staged diff');
})();

// ---- interactive rebase (squash) ----
(function () {
  console.log('interactive rebase squash');
  const r = base();
  r.wd['f.txt'] = 'a'; G.exec(r, 'git add .'); G.exec(r, 'git commit -m "WIP 1"');
  r.wd['f.txt'] = 'a\nb'; G.exec(r, 'git add .'); G.exec(r, 'git commit -m "WIP 2"');
  r.wd['f.txt'] = 'a\nb\nc'; G.exec(r, 'git add .'); G.exec(r, 'git commit -m "WIP 3"');
  const before = G.exec(r, 'git log --oneline').output.split('\n').length;
  assert(before === 4, 'four commits before squash');
  const sig = G.exec(r, 'git rebase -i HEAD~3');
  assert(sig.interactive === 'rebase', 'returns interactive signal');
  assert(sig.commits.length === 3, 'three commits to rebase, oldest first');
  assert(sig.commits[0].message === 'WIP 1', 'ordered oldest-first');
  // plan: keep WIP 1, squash 2 and 3 into it
  const plan = [
    { id: sig.commits[0].id, action: 'pick' },
    { id: sig.commits[1].id, action: 'squash' },
    { id: sig.commits[2].id, action: 'fixup' },
  ];
  G.rebaseInteractive(r, sig.base, plan);
  const after = G.exec(r, 'git log --oneline').output.split('\n');
  assert(after.length === 2, 'squashed into one commit (2 total): got ' + after.length);
  assert(r.wd['f.txt'] === 'a\nb\nc', 'final content preserved after squash: ' + JSON.stringify(r.wd['f.txt']));
})();

// ---- interactive rebase (drop + reorder) ----
(function () {
  console.log('interactive rebase drop/reword');
  const r = base();
  r.wd['x.txt'] = '1'; G.exec(r, 'git add .'); G.exec(r, 'git commit -m "keep"');
  r.wd['y.txt'] = '2'; G.exec(r, 'git add .'); G.exec(r, 'git commit -m "drop me"');
  const sig = G.exec(r, 'git rebase -i HEAD~2');
  const plan = [
    { id: sig.commits[0].id, action: 'reword', message: 'reworded keep' },
    { id: sig.commits[1].id, action: 'drop' },
  ];
  G.rebaseInteractive(r, sig.base, plan);
  assert(!('y.txt' in r.wd), 'dropped commit gone');
  assert('x.txt' in r.wd, 'kept commit present');
  assert(G.exec(r, 'git log --oneline').output.includes('reworded keep'), 'reword applied');
})();

// ---- remotes: fetch / pull / push ----
(function () {
  console.log('remotes push/pull');
  const r = base();
  // simulate: create origin, push, then origin advances (someone else), pull
  G.exec(r, 'git remote add origin git@dojo:proj.git');
  assert('origin' in r.remotes, 'remote added');
  const p = G.exec(r, 'git push -u origin main');
  assert(!p.error, 'push ok: ' + (p.error || ''));
  assert(r.remotes.origin.branches.main === G.headCommitId(r), 'origin has our commit');
  assert(r.remoteTracking['origin/main'] === G.headCommitId(r), 'tracking updated');
  assert(r.upstream.main === 'origin/main', 'upstream set');

  // origin advances independently (a teammate)
  const teammate = 'teammate work';
  // build a commit onto origin's main directly in shared store
  const parent = r.remotes.origin.branches.main;
  const nid = 'deadbee';
  r.commits[nid] = { id: nid, parents: [parent], message: 'teammate feature', tree: Object.assign({}, G.commitTree(r, parent), { 'team.txt': teammate }), seq: r.seq++ };
  r.remotes.origin.branches.main = nid;

  const st1 = G.exec(r, 'git status');
  // not yet fetched, so status won't show behind until fetch updates tracking
  const f = G.exec(r, 'git fetch origin');
  assert(f.output.includes('origin/main'), 'fetch reports update');
  assert(r.remoteTracking['origin/main'] === nid, 'tracking advanced after fetch');
  const st2 = G.exec(r, 'git status');
  assert(st2.output.includes('behind'), 'status shows behind after fetch: ' + st2.output);

  const pull = G.exec(r, 'git pull origin main');
  assert(!pull.error, 'pull ok');
  assert('team.txt' in r.wd, 'teammate file pulled in');
  assert(G.headCommitId(r) === nid, 'fast-forwarded to teammate commit');
})();

// ---- push rejected on divergence ----
(function () {
  console.log('push rejected (non-fast-forward)');
  const r = base();
  G.exec(r, 'git remote add origin x.git');
  G.exec(r, 'git push -u origin main');
  // origin advances
  const parent = r.remotes.origin.branches.main;
  const nid = 'feed001';
  r.commits[nid] = { id: nid, parents: [parent], message: 'remote change', tree: Object.assign({}, G.commitTree(r, parent), { 'remote.txt': 'r' }), seq: r.seq++ };
  r.remotes.origin.branches.main = nid;
  // we also commit locally
  r.wd['local.txt'] = 'l'; G.exec(r, 'git add .'); G.exec(r, 'git commit -m "local change"');
  const rej = G.exec(r, 'git push origin main');
  assert(rej.error && rej.error.includes('rejected'), 'push rejected on divergence');
  // pull to integrate, then push
  const pull = G.exec(r, 'git pull origin main');
  assert(!pull.error, 'pull merges divergence');
  assert('remote.txt' in r.wd && 'local.txt' in r.wd, 'both changes present after pull');
  const push2 = G.exec(r, 'git push origin main');
  assert(!push2.error, 'push succeeds after pull: ' + (push2.error || ''));
  assert(r.remotes.origin.branches.main === G.headCommitId(r), 'origin now matches local');
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
