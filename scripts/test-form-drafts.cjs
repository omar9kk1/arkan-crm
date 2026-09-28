// No browser or network required. Exercises the actual hook with a small hook lifecycle harness.
const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
const storage={getItem(k){return this[k]??null},setItem(k,v){this[k]=v},removeItem(k){delete this[k]}};
const persistent={...storage}; let lastDelay=0;
const win=new EventTarget(),doc=new EventTarget();doc.visibilityState='visible';
let user={id:'one',role:'employee'},route='/employee/clients',timers=new Map(),sequence=0,active;
const react={useRef(v){const i=active.cursor++;return active.slots[i]??(active.slots[i]={current:v})},useState(v){const h=active,i=h.cursor++;if(!h.slots[i])h.slots[i]={value:typeof v==='function'?v():v};return [h.slots[i].value,n=>{h.slots[i].value=typeof n==='function'?n(h.slots[i].value):n}]},useCallback(fn,deps){const h=active,i=h.cursor++;const old=h.slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))h.slots[i]={fn,deps};return h.slots[i].fn},useEffect(fn,deps){const h=active,i=h.cursor++,old=h.slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){h.effects.push(()=>{old?.cleanup?.();h.slots[i]={deps,cleanup:fn()}})}}};
function load(file,requireFn){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:requireFn,sessionStorage:storage,localStorage:persistent,window:win,document:doc,Date,CustomEvent, setTimeout:(fn,delay)=>{lastDelay=delay;timers.set(++sequence,fn);return sequence},clearTimeout:id=>timers.delete(id)});return exports;}
const model=load('apps/frontend/lib/drafts/draft-storage.ts');
const hooks=load('apps/frontend/lib/drafts/use-form-draft.ts',name=>name==='react'?react:name==='next/navigation'?{usePathname:()=>route}:name.includes('auth-provider')?{useAuth:()=>({user})}:model);
function mount(fn){const h={slots:[],effects:[],cursor:0};const render=()=>{active=h;h.cursor=0;const result=fn();const effects=h.effects.splice(0);effects.forEach(f=>f());return result};return {render,unmount(){h.slots.forEach(s=>s?.cleanup?.())}};}
let h=mount(()=>hooks.useFormDraft('client:bundle',{name:'',step:0}));h.render();let d=h.render();d.saveDraft({name:'أحمد',step:3,password:'never',accessToken:'never',nested:{refreshToken:'never',value:'keep'}});assert.equal(Object.keys(persistent).filter(k=>k.startsWith('arkan:')).length,0);assert.equal(lastDelay,500);win.dispatchEvent(new Event('pagehide'));let raw=Object.keys(persistent).filter(k=>k.startsWith('arkan:')).map(k=>persistent[k]).join('');assert.ok(raw.includes('أحمد'));assert.ok(!raw.includes('never'));h.unmount();
// Closing the browser removes sessionStorage, but keeps the saved fields.
Object.keys(storage).filter(k=>k.startsWith('arkan:')).forEach(k=>delete storage[k]);
h=mount(()=>hooks.useFormDraft('client:bundle',{name:'',step:0}));h.render();d=h.render();assert.equal(d.value.name,'أحمد');assert.equal(d.value.step,3);assert.equal(d.hasDraft,true);
let tools=mount(()=>hooks.useDraftScope('client'));tools.render();const scope=tools.render();scope.clear();d=h.render();assert.equal(d.value.name,'');assert.equal(d.hasDraft,false);win.dispatchEvent(new Event('pagehide'));h.unmount();assert.equal(Object.keys(persistent).filter(k=>k.startsWith('arkan:')).length,0);tools.unmount();
user={id:'two',role:'manager'};h=mount(()=>hooks.useFormDraft('client:bundle',{name:'',step:0}));h.render();d=h.render();assert.equal(d.value.name,'');d.saveDraft({name:'manager',step:2});for(const fn of [...timers.values()])fn();h.unmount();user={id:'one',role:'employee'};h=mount(()=>hooks.useFormDraft('client:bundle',{name:'',step:0}));h.render();assert.equal(h.render().value.name,'');h.unmount();
assert.equal(model.decodeDraft('{broken',{}),undefined);assert.equal(model.decodeDraft(JSON.stringify({version:1,updatedAt:0,data:{name:'old'}}),{}).name,'old');
console.log('PASS: reload + step restore, debounce/pagehide flush, recursive secret exclusion, clear survives unmount, user isolation, invalid records and browser-close persistence.');

// Earlier session-only data is migrated and isn't erased by cancellation.
const legacyKey=model.draftPrefix('one','employee',route,'legacy:fields');
storage.setItem(legacyKey,JSON.stringify({version:1,updatedAt:Date.now(),data:{name:'legacy'}}));
h=mount(()=>hooks.useFormDraft('legacy:fields',{name:''}));h.render();assert.equal(h.render().value.name,'legacy');h.unmount();assert.ok(persistent.getItem(legacyKey));assert.equal(storage.getItem(legacyKey),null);
h=mount(()=>hooks.useFormDraft('legacy:fields',{name:''}));h.render();assert.equal(h.render().value.name,'legacy');h.unmount();
const write=persistent.setItem;persistent.setItem=()=>{throw Error('blocked')};model.writeStoredDraft('arkan:draft:v1:fallback',JSON.stringify({version:1,updatedAt:Date.now(),data:'safe'}));assert.ok(storage.getItem('arkan:draft:v1:fallback'));persistent.setItem=write;model.removeStoredDraft('arkan:draft:v1:fallback');assert.equal(storage.getItem('arkan:draft:v1:fallback'),null);
console.log('PASS: legacy migration, cancel retains fields, safe session fallback.');
