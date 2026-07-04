// Minimal, teaching-oriented Git engine. Deterministic enough for katas.
// Runs in the browser; guarded for node testing at the bottom.

function makeRepo(rng) {
  rng = rng || Math.random;
  return {
    initialized: false,
    wd: {},            // working directory: name -> content
    index: {},         // staging area snapshot: name -> content
    commits: {},       // id -> {id, parents:[], message, tree:{}, seq}
    branches: {},      // name -> commitId
    head: null,        // {branch:name} | {detached:id}
    stashes: [],       // [{message, wd, index}]
    tags: {},          // name -> commitId
    remotes: {},       // name -> {url, branches:{name:id}}
    remoteTracking: {},// "origin/main" -> id
    upstream: {},      // localBranch -> "origin/main"
    reflog: [],        // [{id, action}] newest first
    reverting: null,   // {message} while a revert is unresolved
    seq: 0,
    merge: null,       // {theirs:id, label} while a merge is unresolved
    _rng: rng,
  };
}

function logHead(repo, action) {
  repo.reflog.unshift({ id: headCommitId(repo), action });
}

// ---- helpers ---------------------------------------------------------------

function cloneTree(t) { return Object.assign({}, t); }
function treeEqual(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}
function shortId(repo) {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 7; i++) s += hex[Math.floor(repo._rng() * 16)];
  // avoid collision
  if (repo.commits[s]) return shortId(repo);
  return s;
}
function headCommitId(repo) {
  if (!repo.head) return null;
  if (repo.head.branch) return repo.branches[repo.head.branch] || null;
  return repo.head.detached;
}
function commitTree(repo, id) {
  if (!id) return {};
  return repo.commits[id] ? cloneTree(repo.commits[id].tree) : {};
}
function headTree(repo) { return commitTree(repo, headCommitId(repo)); }

function ancestors(repo, id) {
  const seen = new Set();
  const stack = id ? [id] : [];
  while (stack.length) {
    const c = stack.pop();
    if (seen.has(c) || !repo.commits[c]) continue;
    seen.add(c);
    for (const p of repo.commits[c].parents) stack.push(p);
  }
  return seen;
}
function isAncestor(repo, a, b) { // is a an ancestor of b (or equal)?
  return ancestors(repo, b).has(a);
}
function mergeBase(repo, a, b) {
  const A = ancestors(repo, a);
  // BFS from b, first node in A wins (closest)
  const seen = new Set();
  const queue = b ? [b] : [];
  const order = [];
  while (queue.length) {
    const c = queue.shift();
    if (seen.has(c) || !repo.commits[c]) continue;
    seen.add(c);
    order.push(c);
    for (const p of repo.commits[c].parents) queue.push(p);
  }
  for (const c of order) if (A.has(c)) return c;
  return null;
}

// resolve a ref string to a commit id
function resolveRef(repo, ref) {
  if (!ref) return null;
  ref = ref.trim();
  const rl = ref.match(/^HEAD@\{(\d+)\}$/);
  if (rl) { const e = repo.reflog[parseInt(rl[1], 10)]; return e ? e.id : null; }
  let m = ref.match(/^(.*?)([~^]\d*|\^+)?$/);
  let base = ref, suffix = '';
  // parse trailing ~n / ^ chains
  const tilde = ref.match(/~(\d+)$/);
  let steps = 0;
  let core = ref;
  const caretMatch = ref.match(/^(.*?)((?:\^|~\d*)+)$/);
  if (caretMatch) {
    core = caretMatch[1];
    const ops = caretMatch[2];
    // count total first-parent steps
    const re = /(\^|~(\d*))/g; let mm;
    while ((mm = re.exec(ops))) {
      if (mm[1][0] === '^') steps += 1;
      else steps += (mm[2] === '' ? 1 : parseInt(mm[2], 10));
    }
  }
  let id = null;
  if (core === 'HEAD' || core === '') id = headCommitId(repo);
  else if (repo.branches[core] != null) id = repo.branches[core];
  else if (repo.remoteTracking[core] != null) id = repo.remoteTracking[core];
  else if (repo.tags[core] != null) id = repo.tags[core];
  else if (repo.commits[core]) id = core;
  else {
    // prefix match on commit ids
    const hit = Object.keys(repo.commits).filter(c => c.startsWith(core));
    if (hit.length === 1) id = hit[0];
  }
  if (!id) return null;
  for (let i = 0; i < steps; i++) {
    if (repo.commits[id] && repo.commits[id].parents.length) id = repo.commits[id].parents[0];
    else return null;
  }
  return id;
}

// ---- status ----------------------------------------------------------------

function computeStatus(repo) {
  const ht = headTree(repo);
  const idx = repo.index;
  const wd = repo.wd;
  const staged = [];   // {type, file}
  const unstaged = [];
  const untracked = [];
  const all = new Set([...Object.keys(ht), ...Object.keys(idx), ...Object.keys(wd)]);
  for (const f of all) {
    const inH = f in ht, inI = f in idx, inW = f in wd;
    // staged = index vs HEAD
    if (inI && !inH) staged.push({ type: 'new', file: f });
    else if (!inI && inH) staged.push({ type: 'deleted', file: f });
    else if (inI && inH && idx[f] !== ht[f]) staged.push({ type: 'modified', file: f });
    // unstaged = wd vs index (tracked only)
    if (inI && inW && wd[f] !== idx[f]) unstaged.push({ type: 'modified', file: f });
    else if (inI && !inW) unstaged.push({ type: 'deleted', file: f });
    // untracked = wd, not in index, not in head
    if (inW && !inI && !inH) untracked.push({ file: f });
  }
  const clean = staged.length === 0 && unstaged.length === 0 && untracked.length === 0;
  return { staged, unstaged, untracked, clean };
}

// ---- command implementations ----------------------------------------------

const ERR = (m) => ({ error: m });
const OUT = (m) => ({ output: m == null ? '' : m });

function requireRepo(repo) {
  if (!repo.initialized) return ERR('fatal: not a git repository (or any of the parent directories): .git');
  return null;
}

function cmd_init(repo) {
  if (repo.initialized) return OUT('Reinitialized existing Git repository in .git/');
  repo.initialized = true;
  repo.branches = {};
  repo.head = { branch: 'main' };
  return OUT('Initialized empty Git repository in .git/\nOn branch main');
}

function cmd_status(repo) {
  const r = requireRepo(repo); if (r) return r;
  const branch = repo.head.branch ? repo.head.branch : `HEAD detached at ${repo.head.detached}`;
  const s = computeStatus(repo);
  let out = repo.head.branch ? `On branch ${repo.head.branch}` : branch;
  const hc0 = headCommitId(repo);
  const up = repo.head.branch && repo.upstream[repo.head.branch];
  if (up && repo.remoteTracking[up] != null && hc0) {
    const { ahead, behind } = aheadBehind(repo, hc0, repo.remoteTracking[up]);
    if (ahead && behind) out += `\nYour branch and '${up}' have diverged,\nand have ${ahead} and ${behind} different commits each, respectively.`;
    else if (ahead) out += `\nYour branch is ahead of '${up}' by ${ahead} commit${ahead > 1 ? 's' : ''}.`;
    else if (behind) out += `\nYour branch is behind '${up}' by ${behind} commit${behind > 1 ? 's' : ''}, and can be fast-forwarded.`;
    else out += `\nYour branch is up to date with '${up}'.`;
  }
  if (repo.merge) out += `\nYou have unmerged paths (fix conflicts and run "git commit").`;
  if (repo.reverting) out += `\nYou are currently reverting a commit (fix conflicts and run "git commit").`;
  const hc = headCommitId(repo);
  if (!hc && s.staged.length === 0 && s.untracked.length === 0)
    return OUT(out + '\n\nNo commits yet\n\nnothing to commit (create/copy files and use "git add" to track)');
  if (!hc) out += '\n\nNo commits yet';
  if (s.staged.length) {
    out += '\n\nChanges to be committed:';
    for (const x of s.staged) out += `\n        ${x.type}:   ${x.file}`;
  }
  if (s.unstaged.length) {
    out += '\n\nChanges not staged for commit:';
    for (const x of s.unstaged) out += `\n        ${x.type}:   ${x.file}`;
  }
  if (s.untracked.length) {
    out += '\n\nUntracked files:';
    for (const x of s.untracked) out += `\n        ${x.file}`;
  }
  if (s.clean) out += '\n\nnothing to commit, working tree clean';
  return OUT(out);
}

function cmd_add(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  if (!args.length) return ERR("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?");
  let targets = [];
  if (args.includes('.') || args.includes('-A') || args.includes('--all')) {
    targets = new Set([...Object.keys(repo.wd), ...Object.keys(repo.index)]);
  } else {
    targets = args.filter(a => a[0] !== '-');
  }
  let touched = 0;
  for (const f of targets) {
    if (f in repo.wd) { repo.index[f] = repo.wd[f]; touched++; }
    else if (f in repo.index) { delete repo.index[f]; touched++; } // staged deletion
    else return ERR(`fatal: pathspec '${f}' did not match any files`);
  }
  return OUT('');
}

function cmd_restore(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const staged = args.includes('--staged');
  const files = args.filter(a => a[0] !== '-');
  const ht = headTree(repo);
  for (const f of files) {
    if (staged) {
      if (f in ht) repo.index[f] = ht[f]; else delete repo.index[f];
    } else {
      if (f in repo.index) repo.wd[f] = repo.index[f]; else delete repo.wd[f];
    }
  }
  return OUT('');
}

function cmd_commit(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const mi = args.indexOf('-m');
  const amend = args.includes('--amend');
  let message = mi >= 0 ? args[mi + 1] : null;
  if (mi >= 0 && (message == null)) return ERR('error: switch `m\' requires a value');
  const s = computeStatus(repo);
  const ht = headTree(repo);
  if (!repo.merge && !amend && treeEqual(repo.index, ht)) {
    // nothing staged
    let out = `On branch ${repo.head.branch || 'HEAD'}`;
    if (s.unstaged.length || s.untracked.length)
      return ERR(out + '\nnothing added to commit but untracked files present (use "git add" to track)');
    return ERR(out + '\nnothing to commit, working tree clean');
  }
  if (!message) return ERR('Aborting commit due to empty commit message. Use -m "message".');
  const parent = headCommitId(repo);
  let parents = parent ? [parent] : [];
  if (repo.merge) { parents = [parent, repo.merge.theirs].filter(Boolean); }
  if (amend && parent) { parents = repo.commits[parent].parents.slice(); if (!message) message = repo.commits[parent].message; }
  const id = shortId(repo);
  repo.commits[id] = { id, parents, message, tree: cloneTree(repo.index), seq: repo.seq++ };
  if (repo.head.branch) repo.branches[repo.head.branch] = id;
  else repo.head.detached = id;
  const wasMerge = !!repo.merge;
  repo.merge = null; repo.reverting = null;
  logHead(repo, `commit: ${message}`);
  return OUT(`[${repo.head.branch || 'detached'} ${id}] ${message}`);
}

function cmd_branch(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const del = args.find(a => a === '-d' || a === '-D');
  if (del) {
    const name = args.filter(a => a[0] !== '-')[0];
    if (!repo.branches[name]) return ERR(`error: branch '${name}' not found.`);
    if (repo.head.branch === name) return ERR(`error: Cannot delete branch '${name}' checked out.`);
    delete repo.branches[name];
    return OUT(`Deleted branch ${name}.`);
  }
  const names = args.filter(a => a[0] !== '-');
  if (!names.length) {
    // list
    const list = Object.keys(repo.branches).sort();
    return OUT(list.map(b => (repo.head.branch === b ? `* ${b}` : `  ${b}`)).join('\n') || '(no branches yet)');
  }
  const name = names[0];
  const start = names[1] ? resolveRef(repo, names[1]) : headCommitId(repo);
  if (!start) return ERR(`fatal: not a valid object name: '${names[1] || 'HEAD'}'`);
  if (repo.branches[name]) return ERR(`fatal: a branch named '${name}' already exists`);
  repo.branches[name] = start;
  return OUT('');
}

function captureUntracked(repo) {
  // files present in working dir that git isn't tracking (not staged, not committed)
  const ht = headTree(repo);
  const untracked = {};
  for (const f of Object.keys(repo.wd)) {
    if (!(f in repo.index) && !(f in ht)) untracked[f] = repo.wd[f];
  }
  return untracked;
}

function checkoutTo(repo, targetTree, untracked) {
  // preserve untracked files; replace tracked contents. Untracked must be
  // captured BEFORE any pointer/index mutation, else formerly-tracked files leak.
  if (!untracked) untracked = captureUntracked(repo);
  repo.index = cloneTree(targetTree);
  repo.wd = Object.assign(cloneTree(targetTree), untracked);
}

function cmd_checkout(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const create = args.includes('-b') || args.includes('-B');
  const names = args.filter(a => a[0] !== '-');
  const name = names[0];
  const untracked = captureUntracked(repo);
  if (create) {
    const start = names[1] ? resolveRef(repo, names[1]) : headCommitId(repo);
    if (repo.branches[name]) return ERR(`fatal: a branch named '${name}' already exists`);
    repo.branches[name] = start || null;
    repo.head = { branch: name };
    if (start) checkoutTo(repo, commitTree(repo, start), untracked);
    return OUT(`Switched to a new branch '${name}'`);
  }
  if (repo.branches[name] != null || name in repo.branches) {
    repo.head = { branch: name };
    checkoutTo(repo, commitTree(repo, repo.branches[name]), untracked);
    logHead(repo, `checkout: moving to ${name}`);
    return OUT(`Switched to branch '${name}'`);
  }
  const id = resolveRef(repo, name);
  if (id) {
    repo.head = { detached: id };
    checkoutTo(repo, commitTree(repo, id), untracked);
    logHead(repo, `checkout: moving to ${name}`);
    return OUT(`Note: switching to '${name}'.\nYou are in 'detached HEAD' state. HEAD is now at ${id}`);
  }
  return ERR(`error: pathspec '${name}' did not match any file(s) known to git`);
}

function cmd_switch(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const create = args.includes('-c') || args.includes('-C');
  const names = args.filter(a => a[0] !== '-');
  if (create) return cmd_checkout(repo, ['-b', ...names]);
  return cmd_checkout(repo, names);
}

function applyDelta(base, from, to, target) {
  // apply change (from->to) onto target tree; returns {tree, conflicts:[]}
  const out = cloneTree(target);
  const conflicts = [];
  const files = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const f of files) {
    const a = from[f], b = to[f];
    if (a === b) continue; // unchanged by this commit
    const cur = out[f];
    if (b === undefined) { // deleted in commit
      if (cur === a || cur === undefined) delete out[f];
      else conflicts.push(f);
    } else if (cur === a || cur === undefined) {
      out[f] = b;
    } else if (cur === b) {
      // already there
    } else {
      conflicts.push(f);
      out[f] = `<<<<<<< HEAD\n${cur || ''}\n=======\n${b}\n>>>>>>> theirs`;
    }
  }
  return { tree: out, conflicts };
}

function cmd_merge(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const name = args.filter(a => a[0] !== '-')[0];
  const theirs = resolveRef(repo, name);
  if (!theirs) return ERR(`merge: ${name} - not something we can merge`);
  const ours = headCommitId(repo);
  if (!ours) { // no commits yet -> fast forward
    if (repo.head.branch) repo.branches[repo.head.branch] = theirs;
    checkoutTo(repo, commitTree(repo, theirs));
    logHead(repo, `merge ${name}: Fast-forward`);
    return OUT(`Fast-forward`);
  }
  if (isAncestor(repo, theirs, ours)) return OUT('Already up to date.');
  if (isAncestor(repo, ours, theirs)) {
    if (repo.head.branch) repo.branches[repo.head.branch] = theirs;
    else repo.head.detached = theirs;
    checkoutTo(repo, commitTree(repo, theirs));
    logHead(repo, `merge ${name}: Fast-forward`);
    return OUT(`Updating ${ours.slice(0, 7)}..${theirs.slice(0, 7)}\nFast-forward`);
  }
  const base = mergeBase(repo, ours, theirs);
  const baseT = commitTree(repo, base);
  const ourT = commitTree(repo, ours);
  const theirT = commitTree(repo, theirs);
  // three-way merge
  const merged = cloneTree(ourT);
  const conflicts = [];
  const files = new Set([...Object.keys(baseT), ...Object.keys(ourT), ...Object.keys(theirT)]);
  for (const f of files) {
    const bV = baseT[f], oV = ourT[f], tV = theirT[f];
    if (oV === tV) continue;
    if (oV === bV) { // only theirs changed
      if (tV === undefined) delete merged[f]; else merged[f] = tV;
    } else if (tV === bV) { // only ours changed
      // keep ours
    } else {
      conflicts.push(f);
      merged[f] = `<<<<<<< HEAD\n${oV || ''}\n=======\n${tV || ''}\n>>>>>>> ${name}`;
    }
  }
  if (conflicts.length) {
    repo.wd = Object.assign(cloneTree(repo.wd), merged);
    for (const f of conflicts) repo.wd[f] = merged[f];
    // stage non-conflicts
    for (const f of Object.keys(merged)) if (!conflicts.includes(f)) repo.index[f] = merged[f];
    repo.merge = { theirs, label: name };
    return ERR(`Auto-merging\nCONFLICT (content): Merge conflict in ${conflicts.join(', ')}\nAutomatic merge failed; fix conflicts and then commit the result.`);
  }
  // clean merge commit
  const id = shortId(repo);
  repo.commits[id] = { id, parents: [ours, theirs], message: `Merge branch '${name}'`, tree: merged, seq: repo.seq++ };
  if (repo.head.branch) repo.branches[repo.head.branch] = id;
  else repo.head.detached = id;
  checkoutTo(repo, merged);
  logHead(repo, `merge ${name}: Merge made by the 'ort' strategy.`);
  return OUT(`Merge made by the 'ort' strategy.`);
}

function cmd_reset(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  let mode = 'mixed';
  if (args.includes('--soft')) mode = 'soft';
  else if (args.includes('--hard')) mode = 'hard';
  else if (args.includes('--mixed')) mode = 'mixed';
  const ref = args.filter(a => a[0] !== '-')[0] || 'HEAD';
  const id = resolveRef(repo, ref);
  if (id === null) return ERR(`fatal: ambiguous argument '${ref}': unknown revision`);
  const untracked = captureUntracked(repo);
  if (repo.head.branch) repo.branches[repo.head.branch] = id;
  else repo.head.detached = id;
  const t = commitTree(repo, id);
  if (mode === 'soft') { /* keep index & wd */ }
  else if (mode === 'mixed') { repo.index = cloneTree(t); }
  else { checkoutTo(repo, t, untracked); }
  repo.merge = null;
  logHead(repo, `reset: moving to ${ref}`);
  return OUT(mode === 'hard' ? `HEAD is now at ${id} ${repo.commits[id] ? repo.commits[id].message : ''}` : '');
}

function cmd_cherry(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const ref = args.filter(a => a[0] !== '-')[0];
  const id = resolveRef(repo, ref);
  if (!id) return ERR(`fatal: bad revision '${ref}'`);
  const c = repo.commits[id];
  const parentT = commitTree(repo, c.parents[0]);
  const res = applyDelta(repo, parentT, c.tree, headTree(repo));
  if (res.conflicts.length) {
    repo.wd = Object.assign(repo.wd, res.tree);
    return ERR(`error: could not apply ${id}... ${c.message}\nCONFLICT in ${res.conflicts.join(', ')}`);
  }
  const nid = shortId(repo);
  const parent = headCommitId(repo);
  repo.commits[nid] = { id: nid, parents: parent ? [parent] : [], message: c.message, tree: res.tree, seq: repo.seq++ };
  if (repo.head.branch) repo.branches[repo.head.branch] = nid;
  else repo.head.detached = nid;
  checkoutTo(repo, res.tree);
  logHead(repo, `cherry-pick: ${c.message}`);
  return OUT(`[${repo.head.branch || 'detached'} ${nid}] ${c.message}`);
}

function cmd_stash(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const sub = args[0] || 'push';
  if (sub === 'pop' || sub === 'apply') {
    if (!repo.stashes.length) return ERR('No stash entries found.');
    const st = repo.stashes[0];
    repo.wd = Object.assign(cloneTree(repo.wd), st.wd);
    repo.index = Object.assign(cloneTree(repo.index), st.index);
    if (sub === 'pop') repo.stashes.shift();
    return OUT(`On branch ${repo.head.branch}\nChanges restored from stash.`);
  }
  if (sub === 'list') {
    return OUT(repo.stashes.map((s, i) => `stash@{${i}}: WIP on ${repo.head.branch}: ${s.message}`).join('\n'));
  }
  // push
  const s = computeStatus(repo);
  if (s.clean) return OUT('No local changes to save');
  const ht = headTree(repo);
  const savedWd = {}, savedIndex = {};
  for (const f of Object.keys(repo.wd)) if (repo.wd[f] !== ht[f]) savedWd[f] = repo.wd[f];
  for (const f of Object.keys(ht)) if (!(f in repo.wd)) savedWd[f] = undefined;
  for (const f of Object.keys(repo.index)) if (repo.index[f] !== ht[f]) savedIndex[f] = repo.index[f];
  repo.stashes.unshift({ message: 'WIP', wd: cloneTree(repo.wd), index: cloneTree(repo.index) });
  repo.wd = cloneTree(ht);
  repo.index = cloneTree(ht);
  return OUT(`Saved working directory and index state WIP on ${repo.head.branch}`);
}

function commitsToRebase(repo, base, tip) {
  const baseSet = ancestors(repo, base);
  const reach = [...ancestors(repo, tip)].filter(c => !baseSet.has(c));
  reach.sort((a, b) => repo.commits[a].seq - repo.commits[b].seq);
  return reach;
}

function cmd_rebase(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const interactive = args.includes('-i') || args.includes('--interactive');
  const onto = args.filter(a => a[0] !== '-')[0];
  const target = resolveRef(repo, onto);
  if (!target) return ERR(`fatal: invalid upstream '${onto}'`);
  const ours = headCommitId(repo);
  if (interactive) {
    // Determine base. `HEAD~n` -> that commit; a branch/upstream -> merge-base.
    let base = target;
    if (!(onto === 'HEAD' || /^HEAD[~^]/.test(onto) || repo.commits[onto])) {
      // named upstream: rebase everything since the merge base
      base = mergeBase(repo, ours, target) || target;
    }
    const list = commitsToRebase(repo, base, ours).map(id => ({
      id, message: repo.commits[id].message,
    }));
    if (!list.length) return OUT('noop — nothing to rebase.');
    return { interactive: 'rebase', base, commits: list };
  }
  if (isAncestor(repo, ours, target)) {
    // fast-forward
    if (repo.head.branch) repo.branches[repo.head.branch] = target;
    checkoutTo(repo, commitTree(repo, target));
    logHead(repo, `rebase finished: returning to ${repo.head.branch}`);
    return OUT(`Successfully rebased and updated ${repo.head.branch}.`);
  }
  const base = mergeBase(repo, ours, target);
  if (isAncestor(repo, target, ours) && base === target) return OUT('Current branch is up to date.');
  const reach = commitsToRebase(repo, base, ours);
  let tip = target;
  for (const cid of reach) {
    const c = repo.commits[cid];
    const parentT = commitTree(repo, c.parents[0]);
    const res = applyDelta(repo, parentT, c.tree, commitTree(repo, tip));
    const nid = shortId(repo);
    repo.commits[nid] = { id: nid, parents: [tip], message: c.message, tree: res.tree, seq: repo.seq++ };
    tip = nid;
  }
  if (repo.head.branch) repo.branches[repo.head.branch] = tip;
  else repo.head.detached = tip;
  checkoutTo(repo, commitTree(repo, tip));
  logHead(repo, `rebase finished: returning to ${repo.head.branch}`);
  return OUT(`Successfully rebased and updated ${repo.head.branch}.`);
}

// Execute an interactive-rebase plan produced by the UI.
// plan: [{id, action:'pick'|'reword'|'squash'|'fixup'|'drop', message}]
function rebaseInteractive(repo, base, plan) {
  const groups = [];
  for (const item of plan) {
    if (item.action === 'drop') continue;
    if (item.action === 'pick' || item.action === 'reword') {
      groups.push({ ids: [item.id], message: item.action === 'reword' && item.message != null ? item.message : repo.commits[item.id].message });
    } else if (item.action === 'squash' || item.action === 'fixup') {
      if (!groups.length) { groups.push({ ids: [item.id], message: repo.commits[item.id].message }); continue; }
      const g = groups[groups.length - 1];
      g.ids.push(item.id);
      if (item.action === 'squash') g.message = g.message + '\n' + repo.commits[item.id].message;
    }
  }
  let tip = base;
  for (const g of groups) {
    let tree = commitTree(repo, tip);
    for (const cid of g.ids) {
      const c = repo.commits[cid];
      const res = applyDelta(repo, commitTree(repo, c.parents[0]), c.tree, tree);
      tree = res.tree;
    }
    const nid = shortId(repo);
    repo.commits[nid] = { id: nid, parents: [tip], message: g.message, tree, seq: repo.seq++ };
    tip = nid;
  }
  if (repo.head.branch) repo.branches[repo.head.branch] = tip;
  else repo.head.detached = tip;
  checkoutTo(repo, commitTree(repo, tip));
  logHead(repo, `rebase -i finished: returning to ${repo.head.branch}`);
  return OUT(`Successfully rebased and updated ${repo.head.branch || 'HEAD'}.`);
}

function cmd_log(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const all = args.includes('--all');
  const oneline = args.includes('--oneline');
  const named = args.filter(a => a[0] !== '-');
  let roots = [];
  if (all) roots = [...Object.values(repo.branches), ...Object.values(repo.remoteTracking)];
  else if (named.length) { const id = resolveRef(repo, named[0]); if (id) roots = [id]; }
  else { const h = headCommitId(repo); if (h) roots = [h]; }
  const seen = new Set();
  for (const rt of roots) for (const a of ancestors(repo, rt)) seen.add(a);
  const list = [...seen].map(id => repo.commits[id]).sort((a, b) => b.seq - a.seq);
  if (!list.length) return ERR(`fatal: your current branch '${repo.head.branch}' does not have any commits yet`);
  const first = s => s.split('\n')[0];
  if (oneline) {
    return OUT(list.map(c => {
      const refs = branchLabelsFor(repo, c.id);
      return `${c.id}${refs ? ' (' + refs + ')' : ''} ${first(c.message)}`;
    }).join('\n'));
  }
  return OUT(list.map(c => {
    const refs = branchLabelsFor(repo, c.id);
    return `commit ${c.id}${refs ? ' (' + refs + ')' : ''}\n    ${c.message.replace(/\n/g, '\n    ')}`;
  }).join('\n\n'));
}

function cmd_tag(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const del = args.includes('-d');
  const named = args.filter(a => a[0] !== '-' && a !== 'v0');
  // support -m for annotated (cosmetic) — strip -m and its value
  const mi = args.indexOf('-m');
  let posArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-m') { i++; continue; }
    if (args[i][0] === '-') continue;
    posArgs.push(args[i]);
  }
  if (del) {
    const name = posArgs[0];
    if (!(name in repo.tags)) return ERR(`error: tag '${name}' not found.`);
    delete repo.tags[name];
    return OUT(`Deleted tag '${name}'`);
  }
  if (!posArgs.length) {
    const names = Object.keys(repo.tags).sort();
    return OUT(names.join('\n'));
  }
  const name = posArgs[0];
  const target = posArgs[1] ? resolveRef(repo, posArgs[1]) : headCommitId(repo);
  if (!target) return ERR(`fatal: Failed to resolve '${posArgs[1] || 'HEAD'}' as a valid ref.`);
  if (name in repo.tags) return ERR(`fatal: tag '${name}' already exists`);
  repo.tags[name] = target;
  return OUT('');
}

function cmd_revert(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const noCommit = args.includes('--no-commit') || args.includes('-n');
  const ref = args.filter(a => a[0] !== '-')[0];
  const id = resolveRef(repo, ref);
  if (!id) return ERR(`fatal: bad revision '${ref}'`);
  const c = repo.commits[id];
  // inverse: apply change from c.tree back to its parent tree, onto current HEAD
  const parentT = commitTree(repo, c.parents[0]);
  const res = applyDelta(repo, c.tree, parentT, headTree(repo));
  if (res.conflicts.length) {
    repo.wd = Object.assign(repo.wd, res.tree);
    repo.reverting = { message: `Revert "${c.message}"` };
    return ERR(`error: could not revert ${id}... ${c.message}\nCONFLICT in ${res.conflicts.join(', ')}\nhint: fix conflicts and run "git commit"`);
  }
  const msg = `Revert "${c.message}"`;
  if (noCommit) {
    repo.index = Object.assign(repo.index, res.tree);
    repo.wd = Object.assign(repo.wd, res.tree);
    repo.reverting = { message: msg };
    return OUT('');
  }
  const nid = shortId(repo);
  const parent = headCommitId(repo);
  repo.commits[nid] = { id: nid, parents: parent ? [parent] : [], message: msg, tree: res.tree, seq: repo.seq++ };
  if (repo.head.branch) repo.branches[repo.head.branch] = nid;
  else repo.head.detached = nid;
  checkoutTo(repo, res.tree);
  logHead(repo, `revert: ${msg}`);
  return OUT(`[${repo.head.branch || 'detached'} ${nid}] ${msg}`);
}

function cmd_reflog(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  if (!repo.reflog.length) {
    const h = headCommitId(repo);
    if (!h) return ERR('fatal: your current branch does not have any commits yet');
  }
  const lines = repo.reflog.map((e, i) => {
    const id = e.id || '0000000';
    return `${id} HEAD@{${i}}: ${e.action}`;
  });
  return OUT(lines.join('\n') || '(no reflog yet)');
}

// --- simple line diff ---
function lineDiff(oldStr, newStr) {
  const a = (oldStr == null ? '' : oldStr).split('\n');
  const b = (newStr == null ? '' : newStr).split('\n');
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: ' ', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', s: a[i] }); i++; }
    else { out.push({ t: '+', s: b[j] }); j++; }
  }
  while (i < n) { out.push({ t: '-', s: a[i++] }); }
  while (j < m) { out.push({ t: '+', s: b[j++] }); }
  return out;
}

function cmd_diff(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const staged = args.includes('--staged') || args.includes('--cached');
  const files = args.filter(a => a[0] !== '-');
  const from = staged ? headTree(repo) : repo.index;
  const to = staged ? repo.index : repo.wd;
  const names = files.length ? files : [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
  let blocks = [];
  for (const f of names) {
    const oldC = from[f], newC = to[f];
    if (oldC === newC) continue;
    if (oldC === undefined && newC === undefined) continue;
    let head = `diff --git a/${f} b/${f}`;
    if (oldC === undefined) head += `\nnew file`; else if (newC === undefined) head += `\ndeleted file`;
    head += `\n--- ${oldC === undefined ? '/dev/null' : 'a/' + f}\n+++ ${newC === undefined ? '/dev/null' : 'b/' + f}`;
    const d = lineDiff(oldC, newC).filter(x => x.t !== ' ' || true)
      .map(x => x.t + (x.s === '' && x.t === ' ' ? '' : x.s)).join('\n');
    blocks.push(head + '\n' + d);
  }
  if (!blocks.length) return OUT('');
  return OUT(blocks.join('\n'));
}

/* ------- remotes ------- */
function cmd_remote(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  if (args[0] === 'add') {
    const name = args[1], url = args[2] || 'origin.git';
    if (repo.remotes[name]) return ERR(`error: remote ${name} already exists.`);
    repo.remotes[name] = { url, branches: {} };
    return OUT('');
  }
  if (args[0] === '-v' || args[0] === 'show' || args.length === 0) {
    const names = Object.keys(repo.remotes);
    if (args[0] === '-v') return OUT(names.map(n => `${n}\t${repo.remotes[n].url} (fetch)\n${n}\t${repo.remotes[n].url} (push)`).join('\n'));
    return OUT(names.join('\n'));
  }
  return ERR(`error: unknown subcommand: ${args[0]}`);
}

function aheadBehind(repo, localId, remoteId) {
  const la = ancestors(repo, localId), ra = ancestors(repo, remoteId);
  let ahead = 0, behind = 0;
  for (const c of la) if (!ra.has(c)) ahead++;
  for (const c of ra) if (!la.has(c)) behind++;
  return { ahead, behind };
}

function cmd_fetch(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const rname = args.filter(a => a[0] !== '-')[0] || 'origin';
  const remote = repo.remotes[rname];
  if (!remote) return ERR(`fatal: '${rname}' does not appear to be a git repository`);
  let updates = [];
  for (const [b, id] of Object.entries(remote.branches)) {
    const key = `${rname}/${b}`;
    if (repo.remoteTracking[key] !== id) {
      updates.push(`   ${(repo.remoteTracking[key] || '').slice(0, 7) || 'new'}..${id.slice(0, 7)}  ${b} -> ${key}`);
      repo.remoteTracking[key] = id;
    }
  }
  if (!updates.length) return OUT('');
  return OUT(`From ${rname}\n` + updates.join('\n'));
}

function cmd_push(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const force = args.includes('-f') || args.includes('--force');
  const setUp = args.includes('-u') || args.includes('--set-upstream');
  const pos = args.filter(a => a[0] !== '-');
  const rname = pos[0] || 'origin';
  const branch = pos[1] || (repo.head.branch);
  const remote = repo.remotes[rname];
  if (!remote) return ERR(`fatal: '${rname}' does not appear to be a git repository`);
  if (!branch) return ERR('fatal: You are not currently on a branch.');
  const localId = repo.branches[branch];
  if (localId == null) return ERR(`error: src refspec ${branch} does not match any`);
  const remoteId = remote.branches[branch];
  if (remoteId && !force && !isAncestor(repo, remoteId, localId)) {
    return ERR(`To ${rname}\n ! [rejected]        ${branch} -> ${branch} (non-fast-forward)\nerror: failed to push some refs to '${rname}'\nhint: Updates were rejected because the remote contains work that you do\nhint: not have locally. Integrate the remote changes (e.g. 'git pull') first.`);
  }
  const before = remoteId ? remoteId.slice(0, 7) : 'new branch';
  remote.branches[branch] = localId;
  repo.remoteTracking[`${rname}/${branch}`] = localId;
  if (setUp) repo.upstream[branch] = `${rname}/${branch}`;
  return OUT(`To ${rname}\n   ${before}..${localId.slice(0, 7)}  ${branch} -> ${branch}`);
}

function cmd_pull(repo, args) {
  const r = requireRepo(repo); if (r) return r;
  const pos = args.filter(a => a[0] !== '-');
  const rname = pos[0] || 'origin';
  const branch = pos[1] || repo.head.branch;
  const fr = cmd_fetch(repo, [rname]);
  const merged = cmd_merge(repo, [`${rname}/${branch}`]);
  const pre = (fr.output ? fr.output + '\n' : '');
  if (merged.error) return { error: pre + merged.error };
  return OUT(pre + (merged.output || ''));
}

function branchLabelsFor(repo, id) {
  const labels = [];
  for (const [b, cid] of Object.entries(repo.branches)) if (cid === id) {
    if (repo.head && repo.head.branch === b) labels.unshift(`HEAD -> ${b}`);
    else labels.push(b);
  }
  if (repo.head && repo.head.detached === id) labels.unshift('HEAD');
  for (const [rt, cid] of Object.entries(repo.remoteTracking)) if (cid === id) labels.push(rt);
  for (const [t, cid] of Object.entries(repo.tags)) if (cid === id) labels.push('tag: ' + t);
  return labels.join(', ');
}

// ---- write / edit helpers used by the UI (not real git) --------------------

function fsWrite(repo, name, content) { repo.wd[name] = content; }
function fsDelete(repo, name) { delete repo.wd[name]; }

// ---- dispatcher ------------------------------------------------------------

function tokenize(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

function exec(repo, line) {
  line = line.trim();
  if (!line) return OUT('');
  const toks = tokenize(line);
  if (toks[0] === 'clear' || toks[0] === 'cls') return { output: '', clear: true };
  // --- shell conveniences (not git, but natural in a terminal) ---
  if (toks[0] === 'echo') {
    const gt = toks.indexOf('>'), gtgt = toks.indexOf('>>');
    if (gt === -1 && gtgt === -1) return OUT(toks.slice(1).join(' '));
    const op = gtgt !== -1 ? '>>' : '>';
    const at = gtgt !== -1 ? gtgt : gt;
    const file = toks[at + 1];
    if (!file) return ERR('bash: syntax error near unexpected token `newline\'');
    const content = toks.slice(1, at).join(' ');
    if (!repo.initialized && false) {}
    if (op === '>>' && repo.wd[file] != null) repo.wd[file] = repo.wd[file] + '\n' + content;
    else repo.wd[file] = content;
    return OUT('');
  }
  if (toks[0] === 'touch') { for (const f of toks.slice(1)) if (!(f in repo.wd)) repo.wd[f] = ''; return OUT(''); }
  if (toks[0] === 'rm') {
    const files = toks.slice(1).filter(a => a[0] !== '-');
    for (const f of files) { if (!(f in repo.wd)) return ERR(`rm: ${f}: No such file or directory`); delete repo.wd[f]; }
    return OUT('');
  }
  if (toks[0] === 'cat') {
    const f = toks[1];
    if (!(f in repo.wd)) return ERR(`cat: ${f}: No such file or directory`);
    return OUT(repo.wd[f] === '' ? '' : repo.wd[f]);
  }
  if (toks[0] === 'ls') {
    const names = Object.keys(repo.wd).sort();
    return OUT(names.join('  '));
  }
  if (toks[0] === 'pwd') return OUT('/dojo/repo');
  if (toks[0] === 'help') return OUT('Sandbox commands: git <cmd>, echo "text" > file, touch, cat, ls, rm, clear');

  if (toks[0] !== 'git')
    return ERR(`command not found: ${toks[0]} (this is a git sandbox — try a "git ..." command)`);

  const sub = toks[1];
  const args = toks.slice(2);
  const table = {
    init: cmd_init, status: cmd_status, add: cmd_add, commit: cmd_commit,
    branch: cmd_branch, checkout: cmd_checkout, switch: cmd_switch, merge: cmd_merge,
    reset: cmd_reset, log: cmd_log, 'cherry-pick': cmd_cherry, stash: cmd_stash,
    rebase: cmd_rebase, restore: cmd_restore, tag: cmd_tag, revert: cmd_revert,
    reflog: cmd_reflog, diff: cmd_diff, remote: cmd_remote, fetch: cmd_fetch,
    push: cmd_push, pull: cmd_pull,
  };
  const fn = table[sub];
  if (!fn) return ERR(`git: '${sub}' is not supported in this sandbox`);
  try { return fn(repo, args); }
  catch (e) { return ERR('error: ' + (e && e.message ? e.message : String(e))); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeRepo, exec, computeStatus, headCommitId, headTree, commitTree, isAncestor, resolveRef, cloneTree, fsWrite, fsDelete, ancestors, branchLabelsFor, rebaseInteractive, aheadBehind, lineDiff, mergeBase };
}
