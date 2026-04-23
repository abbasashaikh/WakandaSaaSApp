// tests/phase3.test.js — Phase 3 Browser Pool Tests (15 tests)
// Run: node tests/phase3.test.js
process.env.NODE_ENV  = 'test';
process.env.LOG_LEVEL = 'error';
const assert = require('assert');
let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch(e) { console.log(`  ❌ ${name}\n     ${e.message}`); failed++; }
}
let ctxId = 0;
function createTestPool(size, timeoutMs = 5000) {
  const slots = Array.from({length:size},(_,i)=>({id:i,ctx:null,acquiredAt:null,jobId:null,userId:null}));
  const queue = [];
  const free  = () => slots.find(s => !s.acquiredAt);
  function _assign(slot, jobId, userId) {
    const id = ++ctxId;
    slot.ctx = {_ctxId:id}; slot.acquiredAt=Date.now(); slot.jobId=jobId; slot.userId=userId;
    const release = async () => { slot.ctx=null; slot.acquiredAt=null; slot.jobId=null; slot.userId=null; _dispatch(); };
    return { context:slot.ctx, ctxId:id, slotId:slot.id, release };
  }
  function _dispatch() {
    if (!queue.length) return;
    const slot = free(); if (!slot) return;
    let w; while (queue.length) { const x=queue.shift(); if (!x.done()) {w=x;break;} }
    if (!w) return;
    clearTimeout(w.timer);
    w.resolve(_assign(slot, w.jobId, w.userId));
  }
  async function acquire({jobId,userId}) {
    const slot = free();
    if (slot) return _assign(slot, jobId, userId);
    return new Promise((resolve,reject) => {
      let _done=false;
      const timer = setTimeout(()=>{ _done=true; const i=queue.findIndex(x=>x.jobId===jobId); if(i!==-1)queue.splice(i,1); reject(new Error(`timeout ${timeoutMs}ms`)); }, timeoutMs);
      queue.push({jobId,userId,resolve,reject,timer,done:()=>_done});
    });
  }
  function status() {
    return { size, freeSlots:slots.filter(s=>!s.acquiredAt).length,
      activeSlots:slots.filter(s=>!!s.acquiredAt).map(s=>({id:s.id,jobId:s.jobId,userId:s.userId,heldMs:Date.now()-s.acquiredAt})),
      queueDepth:queue.length, queuedJobs:queue.map(w=>({jobId:w.jobId,userId:w.userId})) };
  }
  function destroy() {
    queue.forEach(w=>{clearTimeout(w.timer);w.reject(new Error('Pool destroyed'));});
    queue.length=0;
    slots.forEach(s=>{s.ctx=null;s.acquiredAt=null;s.jobId=null;s.userId=null;});
  }
  return {acquire,status,destroy};
}


async function main() {
console.log('\n[Phase 3 Tests] Pool Basics');
await test('T1: Pool initialises with correct slot count', async () => {
  const p=createTestPool(3); const s=p.status();
  assert.equal(s.size,3); assert.equal(s.freeSlots,3); assert.equal(s.queueDepth,0); assert.equal(s.activeSlots.length,0);
});
await test('T2: Sequential acquires give unique slot IDs', async () => {
  const p=createTestPool(3);
  const [r1,r2,r3]=await Promise.all([p.acquire({jobId:'j1',userId:1}),p.acquire({jobId:'j2',userId:2}),p.acquire({jobId:'j3',userId:3})]);
  assert.equal(new Set([r1.slotId,r2.slotId,r3.slotId]).size,3);
  await r1.release();await r2.release();await r3.release();
});
await test('T3: Contexts are distinct objects (isolated per job)', async () => {
  const p=createTestPool(2);
  const r1=await p.acquire({jobId:'iso1',userId:1}); const r2=await p.acquire({jobId:'iso2',userId:2});
  assert.notStrictEqual(r1.context,r2.context); assert.notEqual(r1.ctxId,r2.ctxId);
  await r1.release();await r2.release();
});

console.log('\n[Phase 3 Tests] Slot Lifecycle');
await test('T4: Release makes slot available for next waiter immediately', async () => {
  const p=createTestPool(1); const r1=await p.acquire({jobId:'l1',userId:1});
  assert.equal(p.status().freeSlots,0);
  let done=false;
  const p2=p.acquire({jobId:'l2',userId:2}).then(r=>{done=true;return r;});
  assert.equal(p.status().queueDepth,1);
  await r1.release();
  const r2=await p2;
  assert.equal(done,true); assert.equal(p.status().queueDepth,0);
  await r2.release(); assert.equal(p.status().freeSlots,1);
});
await test('T5: Slot released even when job throws (finally guarantee)', async () => {
  const p=createTestPool(1); let released=false;
  try { const {release}=await p.acquire({jobId:'err',userId:1}); try{throw new Error('job fail');}finally{await release();released=true;} } catch{}
  assert.equal(released,true); assert.equal(p.status().freeSlots,1);
});

console.log('\n[Phase 3 Tests] Concurrency');
await test('T6: N concurrent acquires all get unique slots', async () => {
  const N=4; const p=createTestPool(N);
  const results=await Promise.all(Array.from({length:N},(_,i)=>p.acquire({jobId:`c${i}`,userId:i})));
  assert.equal(new Set(results.map(r=>r.slotId)).size,N);
  assert.equal(p.status().freeSlots,0);
  for(const r of results)await r.release();
  assert.equal(p.status().freeSlots,N);
});
await test('T7: N+1th job queues and gets slot when first releases', async () => {
  const p=createTestPool(2);
  const r1=await p.acquire({jobId:'p1a',userId:1}); const r2=await p.acquire({jobId:'p1b',userId:2});
  let thirdDone=false;
  const p3=p.acquire({jobId:'p1c',userId:3}).then(async r=>{thirdDone=true;await r.release();});
  await new Promise(r=>setImmediate(r));
  assert.equal(thirdDone,false); assert.equal(p.status().queueDepth,1);
  await r1.release(); await p3;
  assert.equal(thirdDone,true);
  await r2.release();
});
await test('T8: Pool queues multiple waiters and serves all', async () => {
  const p=createTestPool(2);
  const r1=await p.acquire({jobId:'qa',userId:1}); const r2=await p.acquire({jobId:'qb',userId:2});
  const served=[];
  const ws=['qc','qd','qe'].map(id=>p.acquire({jobId:id,userId:id}).then(async r=>{served.push(id);await r.release();}));
  await new Promise(r=>setImmediate(r));
  assert.equal(p.status().queueDepth,3);
  await r1.release(); await r2.release();
  await Promise.all(ws);
  assert.equal(served.length,3); assert.equal(p.status().freeSlots,2);
});

console.log('\n[Phase 3 Tests] Timeout & Error Handling');
await test('T9: Acquire times out when pool stays full', async () => {
  const p=createTestPool(1,200); const r1=await p.acquire({jobId:'to1',userId:1});
  let timedOut=false;
  try{await p.acquire({jobId:'to2',userId:2});}catch(e){timedOut=e.message.includes('timeout');}
  assert.equal(timedOut,true); assert.equal(p.status().queueDepth,0);
  await r1.release();
});
await test('T10: Destroyed pool rejects all pending acquires', async () => {
  const p=createTestPool(1,30000); const r1=await p.acquire({jobId:'dh',userId:1});
  let rej=0;
  const pend=Promise.all([p.acquire({jobId:'dw1',userId:2}).catch(()=>rej++),p.acquire({jobId:'dw2',userId:3}).catch(()=>rej++)]);
  await new Promise(r=>setImmediate(r));
  assert.equal(p.status().queueDepth,2);
  p.destroy(); await pend;
  assert.equal(rej,2); assert.equal(p.status().queueDepth,0);
});

console.log('\n[Phase 3 Tests] Status & Observability');
await test('T11: getPoolStatus reflects correct live counts', async () => {
  const p=createTestPool(4);
  const r1=await p.acquire({jobId:'obs1',userId:10}); const r2=await p.acquire({jobId:'obs2',userId:11});
  const s=p.status();
  assert.equal(s.size,4); assert.equal(s.freeSlots,2); assert.equal(s.activeSlots.length,2);
  assert.ok(s.activeSlots.some(a=>a.jobId==='obs1'&&a.userId===10));
  assert.ok(s.activeSlots.some(a=>a.jobId==='obs2'&&a.userId===11));
  for(const sl of s.activeSlots)assert.ok(sl.heldMs>=0&&sl.heldMs<5000);
  await r1.release(); assert.equal(p.status().freeSlots,3);
  await r2.release(); assert.equal(p.status().freeSlots,4);
});

console.log('\n[Phase 3 Tests] User Isolation');
await test('T12: Two users never receive the same slot simultaneously', async () => {
  const p=createTestPool(2); const violations=[];
  for(let i=0;i<5;i++){
    const [rA,rB]=await Promise.all([p.acquire({jobId:`a${i}`,userId:'alice'}),p.acquire({jobId:`b${i}`,userId:'bob'})]);
    if(rA.slotId===rB.slotId)violations.push(i);
    await rA.release();await rB.release();
  }
  assert.equal(violations.length,0,`Slot collision in rounds: ${violations}`);
});
await test('T13: User A holding pool does not block User B from queuing', async () => {
  const p=createTestPool(1,500); const rA=await p.acquire({jobId:'ia',userId:'alice'});
  let bDone=false;
  const pB=p.acquire({jobId:'ib',userId:'bob'}).then(r=>{bDone=true;return r;});
  await new Promise(r=>setImmediate(r));
  assert.equal(p.status().queueDepth,1);
  await rA.release();
  const rB=await pB; assert.equal(bDone,true); await rB.release();
});
await test('T14: Slot metadata (jobId, userId) tracked per slot', async () => {
  const p=createTestPool(3);
  const jobs=[{jobId:'m1',userId:'alpha'},{jobId:'m2',userId:'beta'},{jobId:'m3',userId:'gamma'}];
  const results=await Promise.all(jobs.map(j=>p.acquire(j)));
  const s=p.status();
  for(const j of jobs){
    const slot=s.activeSlots.find(a=>a.jobId===j.jobId);
    assert.ok(slot,`slot for ${j.jobId} not found`);
    assert.equal(slot.userId,j.userId);
  }
  for(const r of results)await r.release();
});

console.log('\n[Phase 3 Tests] Queue Behaviour');
await test('T15: Waiters served FIFO (first queued = first served)', async () => {
  const p=createTestPool(1); const r1=await p.acquire({jobId:'fh',userId:0});
  const order=[];
  const ws=['f1','f2','f3'].map(id=>p.acquire({jobId:id,userId:id}).then(async r=>{order.push(id);await r.release();}));
  await new Promise(r=>setTimeout(r,50));
  assert.equal(p.status().queueDepth,3);
  await r1.release(); await Promise.all(ws);
  assert.deepStrictEqual(order,['f1','f2','f3'],`FIFO violated: ${order}`);
});



  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Phase 3: ${passed} passed, ${failed} failed`);
  process.exit(failed>0?1:0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
