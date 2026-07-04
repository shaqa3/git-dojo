# 🥋 Git Dojo

[![Topics](https://img.shields.io/badge/topics-git%20%C2%B7%20learning%20%C2%B7%20interactive-ef7346?style=flat-square)](https://github.com/shaqa3/git-dojo)
[![License: MIT](https://img.shields.io/badge/license-MIT-ef7346?style=flat-square)](LICENSE)

**▶ Play it live: https://shaqa3.github.io/git-dojo/**

[![Git Dojo — a Fork & Merge speedrun: typing git commands while the commit graph builds live](assets/demo.gif)](https://shaqa3.github.io/git-dojo/)

<sub>▲ A “Fork & Merge” speedrun, solved live — typed commands, a reacting commit graph, and the timer stopping on success.</sub>

An interactive, **fully offline** trainer for learning Git by doing. Practice real
commands in a simulated terminal, watch a live commit graph react, and progress
through 15 guided katas — then race the clock in the speedrun sandbox.

There is **no AI/LLM and no network access** at runtime. The "git" behind the
terminal is a deterministic JavaScript simulator (`src/git-engine.js`) that is
unit-tested; the whole app ships as a single self-contained HTML file.

## Quick start

Open the built file directly in any browser — no server, no dependencies:

```bash
npm run build        # writes dist/git-dojo.html
open dist/git-dojo.html   # macOS (or just double-click the file)
```

`dist/git-dojo.html` is standalone: you can email it, host it on any static
server, or open it from disk offline.

## What's inside

- **9 belt katas** — first commit, staging, branching, merging, reset, stash,
  cherry-pick, rebase, and resolving a merge conflict.
- **6 black-belt "Dan" katas** — revert, tags, reflog recovery, interactive-rebase
  squash, remote sync (fetch/pull/push), and a diverged-push resolution.
- **Speedrun sandbox** — 6 timed challenges with a live timer, command counter,
  and personal bests saved to `localStorage`.
- **Interactive rebase modal** (pick / reword / squash / fixup / drop / reorder),
  a **diff viewer**, tags & remote refs on the graph, and a **challenge mode**
  that hides the hints.

Supported commands include `init, add, status, commit, branch, checkout, switch,
merge, reset, restore, log, stash, cherry-pick, rebase (+ -i), tag, revert,
reflog, diff, remote, fetch, push, pull`, plus shell helpers (`echo >`, `touch`,
`cat`, `ls`, `rm`, `clear`).

## Project layout

```
git-dojo/
├── src/
│   ├── git-engine.js   # the tested git simulator (source of truth)
│   └── ui.html         # UI shell + katas + speedrun; /*__ENGINE__*/ marks the inject point
├── build.js            # inlines the engine into the UI -> dist/git-dojo.html
├── dist/
│   └── git-dojo.html   # built, self-contained app (the deliverable)
└── test/
    ├── engine.test.js  # 36 unit tests for core commands
    ├── advanced.test.js# 46 unit tests for tags/revert/reflog/diff/rebase-i/remotes
    ├── kata-sim.js      # drives every kata to completion via its own hints
    └── dom-smoke.js     # boots the real bundle under a stub DOM (no throws + speedrun)
```

## Development

Edit `src/git-engine.js` (logic) or `src/ui.html` (interface/katas), then:

```bash
npm test     # build + run engine tests, kata simulation, and the DOM smoke test
npm run build
```

The engine is developed test-first: `test/engine.test.js` and
`test/advanced.test.js` exercise it directly in Node. `kata-sim.js` extracts the
real kata definitions from the built HTML and confirms each one is completable by
its suggested commands. `dom-smoke.js` executes the shipped bundle against a
minimal stub DOM to catch render-time errors and to run the full speedrun
lifecycle. All four must pass before shipping.

## License

MIT
