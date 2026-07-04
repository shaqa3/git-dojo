// Execute the REAL shipped bundle under a stub DOM to catch runtime throws
// in rendering (canvas graph, nav, steps, files, rebase modal, editor).
const fs = require('fs');
const vm = require('vm');

function chainNoop() { return new Proxy(function () { return chainNoop(); }, { get: () => chainNoop(), apply: () => chainNoop() }); }

function makeEl(tag) {
  const base = {
    tag: tag || 'div', style: {}, dataset: {}, children: [],
    value: '', textContent: '', innerHTML: '', className: '', id: '',
    disabled: false, selected: false, checked: false,
    width: 0, height: 0, scrollTop: 0, scrollHeight: 0, offsetWidth: 300,
    classList: { _s: new Set(),
      add(...x){x.forEach(v=>this._s.add(v))}, remove(...x){x.forEach(v=>this._s.delete(v))},
      toggle(x,f){const has=this._s.has(x); const want=f===undefined?!has:f; if(want)this._s.add(x);else this._s.delete(x); return want;},
      contains(x){return this._s.has(x)} },
    appendChild(c){this.children.push(c); return c},
    insertBefore(c){this.children.push(c); return c},
    removeChild(c){const i=this.children.indexOf(c); if(i>=0)this.children.splice(i,1); return c},
    remove(){}, append(...cs){cs.forEach(c=>this.children.push(c))},
    setAttribute(k,v){this.dataset[k]=v}, getAttribute(k){return this.dataset[k]!==undefined?this.dataset[k]:null},
    removeAttribute(){}, addEventListener(){}, removeEventListener(){}, focus(){}, blur(){}, click(){},
    querySelector(){return makeEl('div')}, querySelectorAll(){return []},
    getContext(){return ctxStub()}, getBoundingClientRect(){return {width:300,height:200,left:0,top:0}},
    onclick:null, onchange:null, oninput:null, onkeydown:null,
  };
  return new Proxy(base, { get(t,p){ if(p in t) return t[p]; return chainNoop(); },
    set(t,p,v){ t[p]=v; return true; } });
}
function ctxStub() {
  const props = { strokeStyle:'', fillStyle:'', lineWidth:1, lineCap:'', font:'', textAlign:'', globalAlpha:1 };
  return new Proxy(props, { get(t,p){ if(p in t) return t[p]; return ()=>{}; }, set(t,p,v){t[p]=v; return true;} });
}

const registry = {};
const documentStub = {
  createElement: (t) => makeEl(t),
  createTextNode: (s) => ({ nodeType: 3, textContent: String(s) }),
  querySelector: (s) => { if(!registry[s]) registry[s]=makeEl('div'); return registry[s]; },
  querySelectorAll: () => [],
  getElementById: (s) => makeEl('div'),
  addEventListener: () => {},
  documentElement: makeEl('html'),
  body: makeEl('body'),
};
const store = {};
const windowStub = {
  innerWidth: 1400, devicePixelRatio: 2,
  matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
  localStorage: { getItem:(k)=>store[k]||null, setItem:(k,v)=>{store[k]=v;}, removeItem:(k)=>{delete store[k];} },
  MutationObserver: class { observe(){} disconnect(){} },
  requestAnimationFrame: (cb)=>cb(),
  addEventListener: ()=>{}, prompt:()=>'test.txt', alert:()=>{}, setTimeout:(cb)=>{cb&&cb();},
};

let clock = 1000;
const ctx = {
  document: documentStub, window: windowStub, localStorage: windowStub.localStorage,
  matchMedia: windowStub.matchMedia, MutationObserver: windowStub.MutationObserver,
  setTimeout: windowStub.setTimeout, requestAnimationFrame: windowStub.requestAnimationFrame,
  prompt: windowStub.prompt, alert: windowStub.alert, console,
  performance: { now: () => (clock += 137) }, // advances each call; no real wall clock
  setInterval: () => 42, clearInterval: () => {}, // don't actually loop in the test
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);

let bundle = fs.readFileSync(require('path').join(__dirname,'..','dist','_bundle.js'), 'utf8');
bundle += '\n;globalThis.__api={loadKata:loadKata, runLine:runLine, openRebase:openRebase, startRebase:startRebase, KATAS:KATAS, CHALLENGES:CHALLENGES, startSpeedrun:startSpeedrun, exitSpeedrun:exitSpeedrun, openEditor:openEditor, saveEditor:saveEditor, get repo(){return repo;}, get stepIndex(){return stepIndex;}, get speedrun(){return speedrun;}, get rebaseState(){return rebaseState;}, setChallenge(v){challengeMode=v;}};';

let errors = 0;
try {
  vm.runInContext(bundle, ctx, { filename: 'bundle.js' });
  console.log('✓ boot ran without throwing');
} catch (e) { errors++; console.log('✗ boot threw:', e.stack.split('\n').slice(0,3).join('\n')); }

const api = ctx.__api;
// load every kata
for (let i = 0; i < api.KATAS.length; i++) {
  try { api.loadKata(i); }
  catch (e) { errors++; console.log(`✗ loadKata(${i}) [${api.KATAS[i].title}] threw:`, e.message); }
}
console.log(`✓ loaded all ${api.KATAS.length} katas`);

// exercise challenge mode + render
try { api.setChallenge(true); api.loadKata(0); api.setChallenge(false); console.log('✓ challenge toggle render ok'); }
catch (e) { errors++; console.log('✗ challenge toggle threw:', e.message); }

// drive interactive rebase on the squash kata (index 12: "Squash Your Mess")
try {
  const idx = api.KATAS.findIndex(k => k.title === 'Squash Your Mess');
  api.loadKata(idx);
  api.runLine('git rebase -i HEAD~3'); // opens modal (renderRebase)
  api.startRebase();                    // default plan all-pick -> runs rebaseInteractive
  console.log('✓ interactive rebase modal open+start ok');
} catch (e) { errors++; console.log('✗ rebase modal threw:', e.stack.split('\n').slice(0,3).join('\n')); }

// drive terminal commands + graph render on a remote kata
try {
  const idx = api.KATAS.findIndex(k => k.title === 'Sync With a Remote');
  api.loadKata(idx);
  ['git status','git fetch origin','git log --oneline --all','git pull origin main','git diff','git reflog','git tag'].forEach(c=>api.runLine(c));
  console.log('✓ terminal + graph render across remote/tag/reflog/diff ok');
} catch (e) { errors++; console.log('✗ terminal drive threw:', e.stack.split('\n').slice(0,4).join('\n')); }

// editor save (conflict resolution path)
try {
  const idx = api.KATAS.findIndex(k => k.title === 'Resolve a Conflict');
  api.loadKata(idx);
  api.runLine('git merge feature');   // conflict
  api.openEditor('config.txt');
  ctx.__api; // ensure editingFile set via openEditor
  console.log('✓ conflict + editor open ok');
} catch (e) { errors++; console.log('✗ editor threw:', e.message); }

// speedrun: start each challenge, solve it via its own goal-satisfying commands, confirm timer stops
try {
  const sbIdx = api.KATAS.findIndex(k => k.sandbox);
  api.loadKata(sbIdx);
  // solve "First Blood"
  api.startSpeedrun(api.CHALLENGES.find(c => c.id === 'first-blood'));
  ['git init', 'echo "hi" > a.txt', 'git add a.txt', 'git commit -m "go"'].forEach(c => api.runLine(c));
  if (!api.speedrun.finished) throw new Error('first-blood did not finish');
  if (!(api.speedrun.commands === 4)) throw new Error('command count wrong: ' + api.speedrun.commands);
  // retry a different one and exit
  api.startSpeedrun(api.CHALLENGES.find(c => c.id === 'reflog-rescue'));
  api.runLine('git reset --hard HEAD@{1}');
  if (!api.speedrun.finished) throw new Error('reflog-rescue did not finish');
  api.exitSpeedrun();
  if (api.speedrun.active) throw new Error('exit did not clear speedrun');
  console.log('✓ speedrun start/solve/timer-stop/retry/exit ok');
} catch (e) { errors++; console.log('✗ speedrun threw:', e.stack.split('\n').slice(0,4).join('\n')); }

// every challenge solvable by a scripted solution (mirrors goal)
const SOLUTIONS = {
  'first-blood': ['git init', 'echo "x" > a.txt', 'git add .', 'git commit -m c'],
  'ship-it': ['git init', 'echo "x" > a.txt', 'git add .', 'git commit -m c', 'git tag v1.0.0'],
  'fork-merge': ['git checkout -b feature', 'echo "f" > f.txt', 'git add .', 'git commit -m feat', 'git switch main', 'git merge feature'],
  'clean-history': ['__rebase__'],
  'conflict-crusher': ['git merge feature', 'echo "port = 8080" > config.txt', 'git add config.txt', 'git commit -m merge'],
  'reflog-rescue': ['git reset --hard HEAD@{1}'],
};
try {
  let solved = 0;
  for (const ch of api.CHALLENGES) {
    api.startSpeedrun(ch);
    for (const cmd of SOLUTIONS[ch.id]) {
      if (cmd === '__rebase__') {
        api.runLine('git rebase -i HEAD~3');       // opens the real modal
        api.rebaseState.items.forEach((it, i) => { it.action = i === 0 ? 'pick' : 'squash'; });
        api.startRebase();                          // real UI path -> rebaseInteractive + afterStateChange
      } else api.runLine(cmd);
    }
    if (api.speedrun.finished) solved++;
    else console.log('  ✗ challenge not solved by scripted solution:', ch.id);
  }
  if (solved === api.CHALLENGES.length) console.log(`✓ all ${solved} speedrun challenges solvable`);
  else { errors++; console.log(`✗ only ${solved}/${api.CHALLENGES.length} challenges solved`); }
} catch (e) { errors++; console.log('✗ challenge solve loop threw:', e.stack.split('\n').slice(0,4).join('\n')); }

console.log(errors ? `\n${errors} runtime error(s)` : '\nAll DOM smoke checks passed.');
process.exit(errors ? 1 : 0);
