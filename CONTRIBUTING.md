# Contributing to Git Dojo

Thanks for your interest! Contributions are welcome — bug fixes, new katas, new
speedrun challenges, new simulated git commands, or documentation improvements.

This project is intentionally **dependency-free**: no runtime libraries and no
build framework — just Node (for the tests and `build.js`) and a single
self-contained HTML app that must keep working **offline, with no network calls
at runtime**. Please keep it that way.

## Getting set up

```bash
git clone https://github.com/shaqa3/git-dojo.git
cd git-dojo
npm test          # builds + runs every suite; should be all green
npm run build     # writes dist/git-dojo.html
open dist/git-dojo.html   # macOS — or just open the file in any browser
```

There is nothing to install: `npm test` and `npm run build` use only Node's
standard library.

## Project layout

```
src/
  git-engine.js   # the git simulator — source of truth for all git behaviour
  ui.html         # UI shell + KATAS + CHALLENGES; /*__ENGINE__*/ marks the inject point
build.js          # inlines the engine into the UI -> dist/git-dojo.html
dist/git-dojo.html# generated, self-contained app (never edit by hand)
test/
  engine.test.js  # unit tests for core commands
  advanced.test.js# unit tests for tags/revert/reflog/diff/rebase -i/remotes
  kata-sim.js      # drives every kata to completion via its own hints
  dom-smoke.js     # boots the real bundle under a stub DOM + runs speedruns
```

## Ground rules

- **Never hand-edit `dist/git-dojo.html`.** It is generated from `src/`. Make your
  change in `src/git-engine.js` or `src/ui.html`, then `npm run build`.
- **`npm test` must pass** before you open a pull request.
- **Add coverage** for anything you change: a new command, kata, or challenge
  should come with a test (or be exercised by the existing simulators).
- **Match the surrounding style:** small functions, clear names, no dependencies,
  and no runtime network access. The whole app must remain openable from disk.

## How to make common changes

### Add a git command

1. Implement `cmd_<name>(repo, args)` in `src/git-engine.js`, returning
   `OUT(text)` on success or `ERR(text)` on failure.
2. Register it in the dispatcher `table` near the bottom of the file.
3. Add a unit test in `test/advanced.test.js` covering the happy path and at
   least one edge case.

### Add a kata

Append an entry to the `KATAS` array in `src/ui.html`:

```js
{
  belt: 'green', title: 'My Kata',
  story: 'One or two sentences of context (HTML allowed).',
  setup: r => { exec(r, 'git init'); /* prepare a starting repo, or null */ },
  steps: [
    { text: 'What the learner should do.',
      why: 'Why it works / a nudge.',
      cmds: ['git ...'],                 // exact command(s) revealed by “Show me how”
      check: r => /* boolean: is this step satisfied? */ },
  ],
}
```

`test/kata-sim.js` runs each kata's `cmds` in order and asserts every `check`
eventually passes — so a broken kata fails the build.

### Add a speedrun challenge

Append to the `CHALLENGES` array in `src/ui.html`:

```js
{ id: 'my-challenge', icon: '🎯', name: 'My Challenge', par: '~5 cmds',
  desc: 'One-line goal shown to the player.',
  setup: r => { /* prepare the repo, or null for an empty folder */ },
  goal: r => /* boolean: has the goal state been reached? */ }
```

The DOM smoke test confirms each challenge is solvable through the real UI.

## Testing

`npm test` runs, in order:

1. `build.js` — regenerate `dist/git-dojo.html` and `dist/_bundle.js`.
2. `engine.test.js` + `advanced.test.js` — unit tests against the engine in Node.
3. `kata-sim.js` — every kata is completable from its own hints.
4. `dom-smoke.js` — the shipped bundle boots under a stub DOM without throwing,
   and every speedrun challenge is solvable.

All four must be green.

## Pull requests

```bash
git switch -c my-change
# edit src/…
npm test                       # all suites green
git commit -am "Describe your change"
git push -u origin my-change   # then open a PR against main
```

- Keep PRs focused; one logical change per PR is easiest to review.
- Describe **what** changed and **why**, and mention any new tests.
- Regenerate the build (`npm run build`) so `dist/git-dojo.html` reflects your
  source changes in the diff.

## Reporting bugs & ideas

Open an issue: https://github.com/shaqa3/git-dojo/issues

Helpful details for bugs: the kata or challenge, the exact command sequence, what
you expected, and what happened (a screenshot of the commit graph is great).

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
