import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,pbkdf2Sync,createCipheriv,createDecipheriv} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';

const input=path.resolve(process.argv[2]||'../snapshot.private.json');
const secretFile=path.resolve(process.argv[3]||'../access.private.json');
const output=path.resolve(process.argv[4]||'finance/data/snapshot.enc.json');
const supplied=process.env.FINANCE_ENCRYPTION_JSON;
let secret=supplied?JSON.parse(supplied):fs.existsSync(secretFile)?JSON.parse(fs.readFileSync(secretFile,'utf8')):null;
if(!secret){secret={password:randomBytes(24).toString('base64url'),salt:randomBytes(32).toString('base64'),iterations:600000};fs.writeFileSync(secretFile,JSON.stringify(secret),{mode:0o600,flag:'wx'});}
if(typeof secret.password!=='string'||secret.password.length<24||Buffer.from(secret.salt||'','base64').length<16)throw Error('Strong encryption configuration is required.');
const iterations=secret.iterations??600000;if(iterations<600000||iterations>2000000)throw Error('Invalid KDF work factor.');
const payload=fs.readFileSync(input),snapshot=JSON.parse(payload);if(snapshot.schemaVersion!==1)throw Error('Invalid snapshot schema.');
const key=pbkdf2Sync(secret.password,Buffer.from(secret.salt,'base64'),iterations,32,'sha256'),iv=randomBytes(12),aad=Buffer.from('WSM_FINANCE_V1');
const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);
const encrypted=Buffer.concat([cipher.update(gzipSync(payload,{level:9})),cipher.final(),cipher.getAuthTag()]);
const envelope={format:'wsm-aes-gcm-v1',kdf:'PBKDF2-SHA256',iterations,salt:secret.salt,iv:iv.toString('base64'),compression:'gzip',ciphertext:encrypted.toString('base64')};
const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(aad);decipher.setAuthTag(encrypted.subarray(-16));
const checked=gunzipSync(Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]));if(!checked.equals(payload))throw Error('Encryption round-trip failed.');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(envelope));
if(!supplied){const note=path.join(path.dirname(secretFile),'Доступ к кабинету.txt');fs.writeFileSync(note,`ВИДИМ ДЕНЬГИ · финансовый кабинет\n\nАдрес: https://alexxpotemkin2015-prog.github.io/wsm-cabinet/finance/\nПароль: ${secret.password}\n\nХраните этот файл отдельно от публичного репозитория.\nПароль не отправляется на сервер и не сохраняется в браузере.\n`,{mode:0o600});}
console.log(JSON.stringify({encrypted:true,roundTrip:true,plainBytes:payload.length,encryptedBytes:fs.statSync(output).size,output}));
