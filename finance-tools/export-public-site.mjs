import fs from 'node:fs';
import path from 'node:path';
const target=path.resolve(process.argv[2]||'_site');
fs.mkdirSync(target,{recursive:true});
for(const file of ['index.html','site.html','teplo-hleba/index.html','finance/index.html','finance/app.js','finance/styles.css','finance/reference.css','finance/rubik-regular.ttf','finance/rubik-bold.ttf','finance/Rubik-OFL.txt','finance/data/snapshot.enc.json']){
 const dest=path.join(target,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);
}
console.log('Public site exported. Only encrypted financial data included.');
