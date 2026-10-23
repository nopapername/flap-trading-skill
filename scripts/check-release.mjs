import {readdir,readFile,lstat} from 'node:fs/promises';import {join} from 'node:path';
const roots=['src','bin','references','test','scripts'];let count=0;
const forbidden=[/\/Users\/[^/\s]+\//,/gh[pousr]_[a-zA-Z0-9]{24,}/,/-----BEGIN .*PRIVATE KEY-----/,/sessionToken\s*[:=]\s*["'][^"']+["']/];
async function visit(p){const st=await lstat(p);if(st.isSymbolicLink())throw new Error('Release must not include symlinks: '+p);if(st.isDirectory()){for(const name of await readdir(p))await visit(join(p,name));return;}
 const text=await readFile(p,'utf8');if(p!=='scripts/check-release.mjs'&&forbidden.some(x=>x.test(text)))throw new Error('Sensitive or personal content: '+p);count++;}
// This scanner contains patterns, not secrets. It also validates all script files.
for(const root of roots)await visit(root);for(const p of ['SKILL.md','README.md','LICENSE','package.json','npm-shrinkwrap.json'])await visit(p);
const pkg=JSON.parse(await readFile('package.json','utf8'));
if(!pkg.files||pkg.files.some(x=>/^(data|\.env|node_modules|docs)(\/|$)/.test(x)))throw new Error('Unsafe package allowlist');
if(!/^---\nname: flap-trading\ndescription: Use when/.test(await readFile('SKILL.md','utf8')))throw new Error('Invalid skill frontmatter');
console.log('Release source checks passed: '+count+' files; runtime data excluded by allowlist.');
