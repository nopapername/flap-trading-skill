import {spawnSync} from 'node:child_process';import {readdirSync} from 'node:fs';
const tests=readdirSync('test').filter(x=>x.endsWith('.test.mjs')).sort().map(x=>'test/'+x);
const r=spawnSync(process.execPath,['--test',...tests],{env:{...process.env,FLAP_READ_ONLY:'1'},stdio:'inherit'});process.exitCode=r.status??1;
