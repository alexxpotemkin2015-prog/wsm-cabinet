import fs from 'node:fs';
import path from 'node:path';
import {createSign} from 'node:crypto';

// Read-only ingestion. Credentials and document IDs are supplied through private runner secrets.
const output=path.resolve(process.argv[2]||'../refresh-private');
const account=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON||'null');
const config=JSON.parse(process.env.FINANCE_SOURCES_JSON||'null');
if(!account?.client_email||!account.private_key||!config?.sources)throw Error('Google read-only connection has not been configured.');
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const now=Math.floor(Date.now()/1000);
const body={iss:account.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600};
const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64(body),signer=createSign('RSA-SHA256');signer.update(unsigned);
const assertion=unsigned+'.'+signer.sign(account.private_key,'base64url');
const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
if(!tokenResponse.ok)throw Error('Could not authenticate the Google read-only connection.');const token=(await tokenResponse.json()).access_token;
async function get(url,label){let response;for(let attempt=0;attempt<3;attempt++){response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});if(response.ok)return response.json();if(![429,500,502,503,504].includes(response.status))break;await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));}throw Error(`${label}: HTTP ${response.status}. The last published snapshot was not changed.`);}
const hex=rgb=>rgb?'#'+['red','green','blue'].map(k=>Math.round((rgb[k]??0)*255).toString(16).padStart(2,'0')).join(''):undefined;
function rangesFor(key,sheets){const dims=title=>{const s=sheets.find(s=>s.properties.title===title);if(!s)throw Error(`${key}: required sheet missing.`);return s.properties.gridProperties};const range=(title,cols,start=1,end)=>{const d=dims(title),last=end??d.rowCount;return `'${title}'!${cols[0]}${start}:${cols[1]}${Math.min(last,d.rowCount)}`};
 if(key==='opiu')return ['Свод сети','Героев','Косинка','АУП'].map(t=>range(t,['A','AN'],34,t==='Свод сети'?163:158));
 if(key==='dds')return sheets.filter(s=>/^.+ 2026$/.test(s.properties.title)).map(s=>range(s.properties.title,['B','J']));
 if(key==='salary')return [range('Повара',['A','Z'],1550),range('Курьеры',['A','AW'],1550),range('Админы',['A','X'],1570)];
 if(key==='suppliers')return [range('Товар',['A','J']),range('Товар от производителя',['A','I'])];
 if(key==='ttk')return [range('Сводка',['A','F'],1,30),range('Цены ПФ',['A','N']),range('Себестоимость блюд',['A','L']),range('С/с готовых блюд',['A','H']),range('Проверки',['A','L']),range('Продажи ОПИУ',['A','R']),range('ТТК единая',['A','Q'])];
 throw Error('Unknown source key.');
}
fs.mkdirSync(output,{recursive:true,mode:0o700});
for(const key of ['opiu','dds','salary','suppliers','ttk']){
 const id=config.sources[key];if(typeof id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(id))throw Error(`Missing ${key} source.`);
 const metadata=await get(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties,sheets(properties)`,key);
 const file=await get(`https://www.googleapis.com/drive/v3/files/${id}?fields=modifiedTime`,key);
 const ranges=rangesFor(key,metadata.sheets),byTitle=new Map();
 for(const range of ranges){
  const u=new URL(`https://sheets.googleapis.com/v4/spreadsheets/${id}`);u.searchParams.set('ranges',range);u.searchParams.set('includeGridData','true');u.searchParams.set('fields','sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(formattedValue,effectiveValue,userEnteredValue,effectiveFormat(backgroundColor,numberFormat),note))))');
  const response=await get(u,key);
  for(const s of response.sheets??[]){const title=s.properties.title,current=byTitle.get(title)??{title,id:s.properties.sheetId,cells:[]};
   for(const data of s.data??[])for(const [ri,row] of (data.rowData??[]).entries())for(const [ci,cell] of (row.values??[]).entries()){
    const value=cell.effectiveValue??cell.userEnteredValue??{},v=value.numberValue??value.stringValue??value.boolValue??null,f=cell.userEnteredValue?.formulaValue;
    if(v===null&&!f&&!cell.note&&!value.errorValue)continue;
    current.cells.push({r:(data.startRow??0)+ri+1,c:(data.startColumn??0)+ci+1,v,t:cell.formattedValue??'',...(f?{f}:{}),b:hex(cell.effectiveFormat?.backgroundColor),fmt:cell.effectiveFormat?.numberFormat?.type,...(cell.note?{note:cell.note}:{}),...(value.errorValue?{error:value.errorValue.type}:{})});
   }byTitle.set(title,current);
  }
 }
 const source={key,id,ranges,fetchedAt:new Date().toISOString(),modifiedAt:file.modifiedTime,sheets:[...byTitle.values()]};
 fs.writeFileSync(path.join(output,`source-${key}.json`),JSON.stringify(source),{mode:0o600});
 console.log(`${key}: loaded read-only.`);
}
fs.writeFileSync(path.join(output,'decisions.private.json'),JSON.stringify(config.decisions??{}),{mode:0o600});
