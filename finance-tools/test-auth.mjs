import fs from 'node:fs';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const e=JSON.parse(fs.readFileSync('finance/data/snapshot.enc.json','utf8')),s=JSON.parse(fs.readFileSync(process.argv[2]||'../access.private.json','utf8'));
const bytes=x=>Buffer.from(x,'base64');
async function decode(password,envelope=e){const base=await webcrypto.subtle.importKey('raw',Buffer.from(password),'PBKDF2',false,['deriveKey']);const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(envelope.salt),iterations:envelope.iterations,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']);const plain=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv),additionalData:Buffer.from('WSM_FINANCE_V1')},key,bytes(envelope.ciphertext));return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text())}
const d=await decode(s.password);assert.equal(d.schemaVersion,1);await assert.rejects(()=>decode('incorrect-test-password'));
const changed=bytes(e.ciphertext);changed[50]^=1;await assert.rejects(()=>decode(s.password,{...e,ciphertext:changed.toString('base64')}));
const publicFiles=['finance/index.html','finance/app.js','finance/styles.css','finance/reference.css','finance/data/snapshot.enc.json'];for(const p of publicFiles){const text=fs.readFileSync(p,'utf8');assert.ok(!text.includes(s.password));assert.ok(!text.includes(d.sources.opiu.url));assert.ok(!text.includes(d.salary.payments[0].personKey));}
console.log(JSON.stringify({passed:true,validPassword:true,wrongPasswordRejected:true,tamperRejected:true,noPlaintextInPublicAssets:true}));
