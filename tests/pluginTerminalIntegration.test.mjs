import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import { parseTerminalSurfaceMessage } from '../.tmp-agent-tests/src/features/plugins/terminal/surfaceProtocol.js';
import { registerTerminalPane, handleTerminalWorkerMessage } from '../.tmp-agent-tests/src/features/plugins/terminal/paneBridge.js';

test('surface rejects replay, foreign offers, invalid geometry and authority fields', () => {
  const valid = { type: 'zync:terminal:surface', nonce: 'doc', offerId: 'offer', revision: 1, dispose: false, rect: { x: 0, y: 0, width: 300, height: 200 } };
  assert.ok(parseTerminalSurfaceMessage(valid, 'doc', 'offer', 0));
  for (const override of [{nonce:'old'}, {offerId:'other'}, {revision:0}, {revision:NaN}, {dispose:1}, {rect:{x:0,y:0,width:Infinity,height:1}}, {nativeId:'stolen'}]) {
    assert.equal(parseTerminalSurfaceMessage({...valid,...override}, 'doc', 'offer', 0), null);
  }
  assert.equal(parseTerminalSurfaceMessage(valid,'doc','offer',1),null);
});

test('worker routing requires a mounted owned pane and old cleanup cannot remove replacement', async () => {
  await assert.rejects(handleTerminalWorkerMessage('p','r','api:terminal:context',{paneInstanceId:'missing'}));
  const target = { context: async runtime => { assert.equal(runtime,'r'); return {connectionToken:'token'}; }, prepare: async () => ({offerId:'public',expiresInMs:60000}) };
  const old = registerTerminalPane('p','pane',target);
  const current = registerTerminalPane('p','pane',target);
  // Same target object isn't a distinct owner; exercise replacement identity.
  const replacement = registerTerminalPane('p','pane',{...target});
  old(); current();
  assert.deepEqual(await handleTerminalWorkerMessage('p','r','api:terminal:context',{paneInstanceId:'pane'}),{connectionToken:'token'});
  await assert.rejects(handleTerminalWorkerMessage('other','r','api:terminal:context',{paneInstanceId:'pane'}));
  replacement();
});

function sdkHarness() {
  const listeners = new Map(), frames = new Map(), timers = new Map(), posts = [], observers = [];
  let id = 0;
  class Element { isConnected = true; parentElement = null; getBoundingClientRect() { return {x:1,y:2,width:300,height:200}; } }
  class Observer { constructor(callback) { this.callback=callback; observers.push(this); } observe() {} disconnect() {this.disconnected=true;} }
  const parent = { postMessage: message => posts.push(message) };
  const window = { parent, addEventListener: (type, fn) => {if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);}, removeEventListener: (type,fn) => listeners.get(type)?.delete(fn) };
  const context = { window, HTMLElement:Element, ResizeObserver:Observer, MutationObserver:Observer,
    getComputedStyle: () => ({transform:'none',visibility:'visible',display:'block'}),
    requestAnimationFrame: fn => {frames.set(++id,fn);return id;}, cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => {timers.set(++id,fn);return id;}, clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(readFileSync(new URL('../packages/plugin-sdk/terminal.js',import.meta.url),'utf8').replaceAll('export function','function')+'\nglobalThis.mount = mountTerminalSurface; globalThis.overlay = registerTerminalOverlay;',context);
  const dispatch = (data,source=parent) => {for(const fn of listeners.get('message')??[])fn({source,data});};
  const flush = () => {const scheduled=[...frames.values()];frames.clear();scheduled.forEach(fn=>fn());};
  return {context,slot:new Element(),posts,observers,listeners,frames,timers,dispatch,flush};
}

test('overlay capability preserves geometry, legacy hosts hide safely, and cleanup restores it', async () => {
  for (const supported of [false, true]) {
    const h = sdkHarness(), surface = h.context.mount(h.slot, 'offer');
    h.dispatch({type:'zync:terminal:host', version:1, nonce:'doc', overlays:supported});
    await surface.ready; h.flush();
    const original = h.posts.at(-1).rect;
    const overlay = h.context.overlay(new h.context.HTMLElement()); h.flush();
    if (supported) {
      assert.deepEqual(h.posts.at(-1).rect, original);
      assert.equal(h.posts.at(-1).overlays.length, 1);
    } else {
      assert.equal(h.posts.at(-1).rect, null);
      assert.equal('overlays' in h.posts.at(-1), false);
    }
    assert.equal(h.posts.at(-1).dispose, false);
    overlay.dispose(); overlay.dispose(); h.flush();
    assert.deepEqual(h.posts.at(-1).rect, original);
    surface.dispose();
    assert.ok(h.observers.every(observer => observer.disconnected));
  }
});

test('overlay protocol rejects oversized, malformed and authority-bearing rectangles', () => {
  const rect = {x:0,y:50,width:100,height:20};
  const message = {type:'zync:terminal:surface',nonce:'doc',offerId:'offer',revision:1,dispose:false,rect};
  assert.equal(parseTerminalSurfaceMessage({...message,overlays:[rect]},'doc','offer',0).overlays.length,1);
  for (const overlays of [[...Array(9)].map(()=>rect), [null], [{...rect,width:Infinity}], [{...rect,command:'ls'}], {}])
    assert.equal(parseTerminalSurfaceMessage({...message,overlays},'doc','offer',0),null);
});

test('occlusion preserves uncovered header and bounds overlapping popup cutouts', async () => {
  const result=await build({entryPoints:['src/features/plugins/terminal/surfaceOcclusion.ts'],bundle:true,write:false,format:'esm',platform:'node'});
  const {terminalOcclusion}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const slot={x:10,y:20,width:400,height:300};
  assert.deepEqual(terminalOcclusion(slot,[]),{hidden:false});
  const headerOverlap = terminalOcclusion(slot,[{x:20,y:25,width:100,height:60}]);
  assert.equal(headerOverlap.hidden,false);
  assert.ok(headerOverlap.clipPath);
  const cut=terminalOcclusion(slot,[{x:20,y:80,width:100,height:60},{x:30,y:90,width:100,height:60}]);
  assert.equal(cut.hidden,false);
  assert.match(cut.clipPath,/^path\('/);
  assert.deepEqual(terminalOcclusion(slot,[{x:500,y:80,width:100,height:60}]),{hidden:false});
});

test('SDK handshakes only with parent, coalesces geometry and cleans observers', async () => {
  const h=sdkHarness();const surface=h.context.mount(h.slot,'offer');
  h.dispatch({type:'zync:terminal:host',version:1,nonce:'doc'},{});h.flush();
  assert.equal(h.posts.length,1);
  h.dispatch({type:'zync:terminal:host',version:1,nonce:'doc'});
  assert.equal(await surface.ready,true);
  for(let i=0;i<100;i++)surface.refresh();
  assert.equal(h.frames.size,1);h.flush();
  assert.equal(h.posts.at(-1).type,'zync:terminal:surface');
  assert.equal(h.posts.at(-1).nonce,'doc');
  surface.dispose();surface.dispose();
  assert.equal(h.posts.at(-1).dispose,true);
  assert.ok(h.observers.every(o=>o.disconnected));
  assert.ok([...h.listeners.values()].every(set=>!set.size));
  assert.equal(h.frames.size,0);
});

test('SDK older-host timeout and replaced-document nonce safely dispose', async () => {
  const h=sdkHarness();const surface=h.context.mount(h.slot,'offer');
  [...h.timers.values()][0](); assert.equal(await surface.ready,false);
  const next=sdkHarness();const mounted=next.context.mount(next.slot,'offer');
  next.dispatch({type:'zync:terminal:host',version:1,nonce:'doc'});await mounted.ready;
  next.dispatch({type:'zync:terminal:host',version:1,nonce:'replacement'});
  assert.equal(next.posts.at(-1).dispose,true);
});

const bundle=await build({entryPoints:['src/features/plugins/terminal/nativeTransport.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{
  name:'fake-native',setup(build){build.onResolve({filter:/^@tauri-apps\/api\/core$/},()=>({path:'core',namespace:'fake'}));build.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export class Channel { onmessage = () => {}; } export const invoke = (name,args) => globalThis.terminalInvoke(name,args);'}));}
}]});
const {NativeTerminalTransport,NativeTerminalPane}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('handshake bursts receive a trailing reply, respect rate limits and cancel on cleanup', async () => {
  const compiled = await build({entryPoints:['src/features/plugins/terminal/handshakeReply.ts'],bundle:true,write:false,format:'iife',globalName:'handshake'});
  let now = 0, id = 0;
  const timers = new Map(), replies = [];
  const context = {
    performance: {now: () => now},
    setTimeout: (callback, delay) => { timers.set(++id, {callback, due: now + delay}); return id; },
    clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(compiled.outputFiles[0].text, context);
  const hello = context.handshake.createTerminalHandshakeReply(() => replies.push(now));
  hello.request();
  assert.deepEqual(replies, [0]);
  now = 10;
  for (let i = 0; i < 100; i++) hello.request();
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].due, 100);
  // An early timer wakeup must reschedule, not violate the minimum interval.
  const fire = () => { const [id, timer] = [...timers][0]; timers.delete(id); timer.callback(); };
  now = 99; fire();
  assert.deepEqual(replies, [0]);
  now = 100; fire();
  assert.deepEqual(replies, [0, 100]);
  now = 101; hello.request();
  const staleCallback = [...timers.values()][0].callback;
  hello.dispose(); hello.dispose();
  assert.equal(timers.size, 0);
  now = 200; staleCallback(); hello.request();
  assert.deepEqual(replies, [0, 100]);
  const replacement = context.handshake.createTerminalHandshakeReply(() => replies.push(now));
  replacement.request();
  assert.deepEqual(replies, [0, 100, 200]);
  replacement.dispose();
});

test('automatic confirmation waits for a usable focused surface and prompts once per proposal', async () => {
  const compiled = await build({entryPoints:['src/features/plugins/terminal/promptGate.ts'],bundle:true,write:false,format:'esm',platform:'node'});
  const {TerminalPromptGate} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const gate=new TerminalPromptGate(), offer={};
  const state={active:true,focused:true,closed:false,busy:false,rect:{x:0,y:0,width:300,height:200},viewport:{width:500,height:400}};
  for(const override of [{active:false},{focused:false},{closed:true},{busy:true},{rect:null},{rect:{x:400,y:0,width:300,height:200}}])
    assert.equal(gate.take(offer,{...state,...override}),false);
  assert.equal(gate.take(offer,state),true);
  assert.equal(gate.take(offer,{...state,active:false}),false);
  assert.equal(gate.take(offer,state),false, 'returning from confirmation or resizing must not prompt again');
  assert.equal(gate.take({},state),true, 'a new explicit proposal may request confirmation');
});

test('failed startup releases native authority and distinguishes failure from close', async () => {
  const changes=[],calls=[];
  globalThis.terminalInvoke=async(name,args)=>{
    calls.push({name,args});
    if(name.endsWith('_register'))return {documentId:'doc',connectionToken:'token'};
    if(name==='plugins_terminal_start')throw new Error('Startup rejected');
    return 'native-offer';
  };
  const pane=new NativeTerminalPane('runtime','pane',(offer,reason)=>changes.push({offer,reason}));
  await pane.prepare('runtime',{program:'tool',args:[],expectedConnectionToken:'token'});
  await assert.rejects(pane.start(changes[0].offer,{cols:80,rows:24},{write:()=>{}},()=>{},()=>{}),/Startup rejected/);
  await tick();
  assert.deepEqual(changes.at(-1),{offer:null,reason:'failed'});
  assert.ok(calls.some(call=>call.name==='plugins_terminal_document_dispose'));
  await pane.close();
  assert.deepEqual(changes.at(-1),{offer:null,reason:'closed'});
});

test('expired proposals report expiry while releasing their native lease', async () => {
  const changes=[];
  globalThis.terminalInvoke=async(name)=>name.endsWith('_register')?{documentId:'doc',connectionToken:'token'}:'native-offer';
  const original=globalThis.setTimeout;
  let expire;
  globalThis.setTimeout=callback=>{expire=callback;return undefined;};
  const pane=new NativeTerminalPane('runtime','pane',(offer,reason)=>changes.push({offer,reason}));
  try {
    await pane.prepare('runtime',{program:'tool',args:[],expectedConnectionToken:'token'});
    expire();await tick();
    assert.deepEqual(changes.at(-1),{offer:null,reason:'expired'});
  } finally {globalThis.setTimeout=original;pane.dispose();await tick();}
});

test('closing a preparing pane cannot resurrect an offer and a later request gets a new document', async () => {
  const changes=[], calls=[];let resolveOffer, registration=0;
  globalThis.terminalInvoke=(name,args)=>{
    calls.push({name,args});
    if(name.endsWith('_register'))return Promise.resolve({documentId:`doc${++registration}`,connectionToken:'token'});
    if(name==='plugins_terminal_prepare')return new Promise(resolve=>{resolveOffer=resolve;});
    return Promise.resolve();
  };
  const pane=new NativeTerminalPane('runtime','pane',value=>changes.push(value));
  const preparing=pane.prepare('runtime',{program:'tool',args:[],expectedConnectionToken:'token'});
  await tick();await pane.close();resolveOffer('late-offer');
  await assert.rejects(preparing);
  assert.deepEqual(changes,[null]);
  assert.ok(calls.some(c=>c.name==='plugins_terminal_close'&&c.args.terminalId==='late-offer'));
  await pane.context('runtime');assert.equal(registration,2);pane.dispose();await tick();
});

test('native output acknowledges after writes and never delivers after detach', async () => {
  const calls=[],writes=[];globalThis.terminalInvoke=async(name,args)=>{calls.push({name,args});};
  const stream=new NativeTerminalTransport('doc','native',{write:(bytes,done)=>writes.push({bytes,done})},()=>{});
  const frame=new Uint8Array([1,0,0,0,65]);stream.output.onmessage(frame.buffer);
  assert.equal(calls.length,0);assert.equal(writes[0].bytes[0],65);
  writes[0].done();await tick();assert.equal(calls[0].name,'plugins_terminal_ack');
  const backing=new Uint8Array([99,2,0,0,0,66,99]);
  stream.output.onmessage(backing.subarray(1,6));
  assert.equal(writes[1].bytes[0],66);
  stream.detach();stream.output.onmessage(frame.buffer);assert.equal(writes.length,2);
});

test('native input remains ordered and large paste fails closed', async () => {
  const calls=[],errors=[];globalThis.terminalInvoke=async(name,args)=>calls.push({name,args});
  const stream=new NativeTerminalTransport('doc','native',{write:()=>{}},error=>errors.push(error));
  stream.markStarted();stream.write('abc');stream.write('def');await tick();
  assert.deepEqual(calls.filter(c=>c.name.endsWith('_write')).map(c=>c.args.data),[[97,98,99],[100,101,102]]);
  stream.write('x'.repeat(65537));await tick();assert.equal(stream.active,false);assert.equal(errors.length,1);
});

test('native preparation snapshots argv and disposal cleans late registrations', async () => {
  const calls=[];let register;
  globalThis.terminalInvoke=(name,args)=>{calls.push({name,args});if(name.endsWith('_register'))return new Promise(resolve=>{register=resolve;});return Promise.resolve('native-offer');};
  const pane=new NativeTerminalPane('runtime','pane',()=>{});
  const pending=pane.context('runtime');pane.dispose();register({documentId:'doc',connectionToken:'token'});
  await assert.rejects(pending);await tick();assert.ok(calls.some(c=>c.name==='plugins_terminal_document_dispose'));
  const proposal={program:'tool',args:['original'],expectedConnectionToken:'token'};
  let offer;
  globalThis.terminalInvoke=async(name,args)=>{calls.push({name,args});return name.endsWith('_register')?{documentId:'doc2',connectionToken:'token'}:'native-offer';};
  const next=new NativeTerminalPane('runtime','pane',value=>{offer=value;});
  const preparing=next.prepare('runtime',proposal);proposal.args[0]='mutated';await preparing;
  assert.deepEqual(offer.launch.args,['original']);assert.notEqual(offer.offerId,'native-offer');
  await assert.rejects(next.context('other'));next.dispose();await tick();
});
