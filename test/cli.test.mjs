import test from 'node:test';import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const run=promisify(execFile);
test('portable CLI exposes onboarding, resolution, recovery and settlement without local policy',async()=>{
 const r=await run(process.execPath,['src/cli.mjs','help']);for(const s of ['init','doctor','resolve','operations','reconcile','sell'])assert.ok(r.stdout.includes(s),s);
});
test('CLI help exposes read-only preparation and portfolio commands',async()=>{
 const r=await run(process.execPath,['src/cli.mjs','help']);assert.match(r.stdout,/portfolio/);assert.match(r.stdout,/prepare/);assert.match(r.stdout,/--live/);
});
test('test-mode execution guard refuses live buy before loading a config or contacting a wallet',async()=>{
 await assert.rejects(run(process.execPath,['src/cli.mjs','buy','does-not-exist','--live'],{env:{...process.env,FLAP_READ_ONLY:'1'}}),e=>e.stderr.includes('read-only'));
});
test('offline portfolio without a snapshot fails rather than inventing a current value',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'flap-cli-'));
 await assert.rejects(run(process.execPath,['src/cli.mjs','portfolio','--offline','--data-dir',dir]),e=>e.stderr.includes('snapshot'));
});
