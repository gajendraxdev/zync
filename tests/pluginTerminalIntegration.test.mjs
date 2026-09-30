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
  vm.runInNewContext(readFileSync(new URL('../packages/plugin-sdk/terminal.js',import.meta.url),'utf8').replace('export function','function')+'\nglobalThis.mount = mountTerminalSurface;',context);
  const dispatch = (data,source=parent) => {for(const fn of listeners.get('message')??[])fn({source,data});};
  const flush = () => {const scheduled=[...frames.values()];frames.clear();scheduled.forEach(fn=>fn());};
  return {context,slot:new Element(),posts,observers,listeners,frames,timers,dispatch,flush};
}

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
