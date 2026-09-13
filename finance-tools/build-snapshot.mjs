import fs from 'node:fs';
import path from 'node:path';

const sourceDir = path.resolve(process.argv[2] || '..');
const output = path.resolve(process.argv[3] || '../snapshot.private.json');
const configPath = path.join(sourceDir, 'decisions.private.json');
const decisions = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const raw = Object.fromEntries(['opiu','dds','salary','suppliers','ttk'].map(k => {const complete=path.join(sourceDir,`source-${k}-complete.json`);return [k,JSON.parse(fs.readFileSync(fs.existsSync(complete)?complete:path.join(sourceDir,`source-${k}.json`),'utf8'))]}));
const year = 2026;
const asOf = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Moscow'}).format(new Date());
const iso = n => typeof n === 'number' && n > 40000 && n < 150000 ? new Date(Math.round((n-25569)*86400000)).toISOString().slice(0,10) : null;
const num = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
const sum = a => a.reduce((s,x)=>s+(num(x)??0),0);
const round = x => Math.round((x+Number.EPSILON)*100)/100;
const norm = x => String(x??'').trim().replace(/\s+/g,' ');
const safe = x => (decisions.redactNames??[]).reduce((s,n)=>s.split(n).join(''),norm(x)).trim();
const col = n => {let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s};
const grid = s => {const m=new Map(s.cells.map(c=>[`${c.r}:${c.c}`,c]));return {cell:(r,c)=>m.get(`${r}:${c}`),v:(r,c)=>m.get(`${r}:${c}`)?.v??null,t:(r,c)=>m.get(`${r}:${c}`)?.t??'',row:r=>s.cells.filter(c=>c.r===r),max:Math.max(...s.cells.map(c=>c.r))}};
const issue = (source,title,detail,cell,amount=null) => ({source,title,detail,cell,amount});
const sourceInfo = (key,label,detail) => ({key,label,detail,url:`https://docs.google.com/spreadsheets/d/${raw[key].id}/edit`,fetchedAt:raw[key].fetchedAt,modifiedAt:raw[key].modifiedAt,coverage:[]});
const sources = {
 opiu:sourceInfo('opiu','ОПиУ','Начисления. Значения и план взяты из отчёта.'),
 dds:sourceInfo('dds','ДДС','Денежные операции и остатки по кошелькам.'),
 salary:sourceInfo('salary','Зарплаты','Итоги расчётных недель. Ярко-зелёная заливка — выплачено.'),
 suppliers:sourceInfo('suppliers','Поставщики','Итоги АЙК и документы производителя. Зелёная заливка — оплачено.'),
 ttk:sourceInfo('ttk','ТТК и фудкост','Нормативная стоимость по технологическим картам и загруженным продажам.')
};

// P&L: retain source values and do not add overlapping subtotals or AUP twice.
const sections = new Set([36,39,56,150]);
const ratios = new Set([38,41,55,58,62,69,82,88,98,115,119,131,133,135,141,143,155,157]);
const subtotals = new Set([37,40,54,57,61,68,81,87,97,114,118,130,132,134,140,142,154,156,158]);
const articles=[], pnlRows=[], pnlPeriods=[], pnlChecks=[];
for(const s of raw.opiu.sheets.filter(s=>['Свод сети','Героев','Косинка'].includes(s.title))){
 const g=grid(s), entity=s.title==='Свод сети'?'network':s.title==='Героев'?'heroes':'kosinka';
 for(let month=1;month<=12;month++){
  const pc=5+(month-1)*3, ac=pc+1;
  const hasActual=(num(g.v(37,ac))??0)!==0, hasPlan=(num(g.v(37,pc))??0)!==0;
  pnlPeriods.push({entity,month,hasActual,hasPlan});
  for(let row=36;row<=158;row++){
   const label=safe(g.v(row,2)); if(!label)continue;
   const kind=sections.has(row)?'section':ratios.has(row)?'ratio':subtotals.has(row)?'subtotal':row>=134&&row<=139||row===153?'included':'detail';
   if(entity==='network'&&month===1)articles.push({id:String(row),label,kind,unit:kind==='ratio'?'percent':'RUB'});
   if(kind==='section')continue;
   pnlRows.push({entity,month,article:String(row),plan:num(g.v(row,pc)),actual:num(g.v(row,ac)),hasActual,hasPlan,sourceCell:`${s.title}!${col(pc)}${row}:${col(ac)}${row}`});
  }
 }
 if(entity==='network')for(let r=160;r<=163;r++)pnlChecks.push({label:safe(g.v(r,2)),value:num(g.v(r,3)),status:g.v(r,5),cell:`Свод сети!C${r}`});
}
sources.opiu.coverage=pnlPeriods.filter(r=>r.entity==='network'&&r.hasActual).map(r=>`${year}-${String(r.month).padStart(2,'0')}`);
const defaultMonth=Math.max(...pnlPeriods.filter(r=>r.entity==='network'&&r.hasActual).map(r=>r.month));

// Cash flow comes from the manual register, not from the workbook's accrual-like summary.
const monthNames=['ЯНВАРЬ','ФЕВРАЛЬ','МАРТ','АПРЕЛЬ','МАЙ','ИЮНЬ','ИЮЛЬ','АВГУСТ','СЕНТЯБРЬ','ОКТЯБРЬ','НОЯБРЬ','ДЕКАБРЬ'];
const cashMonths=[],transactions=[],cashIssues=[];
for(const s of raw.dds.sheets){
 const g=grid(s),month=monthNames.findIndex(m=>s.title.startsWith(m))+1;if(!month)continue;
 const header=s.cells.find(c=>c.c===2&&c.v==='Дата')?.r;if(!header)continue;
 const rows=[];
 for(let r=header+1;r<=g.max;r++){
  const amount=num(g.v(r,3));if(amount===null||amount===0)continue;
  const date=iso(g.v(r,2)),wallet=norm(g.v(r,4)),article=safe(g.v(r,5));
  if(!date||!date.startsWith(`${year}-`)||date>asOf){cashIssues.push(issue('dds','Дата операции требует проверки',`${date||g.t(r,2)||'Нет даты'} · ${article}`,`${s.title}!B${r}:E${r}`,amount));continue;}
  const type=/Техническая операция/i.test(article)?'transfer':/Выплата учер|Выплата учре|дивиденд/i.test(article)?'dividend':/Корректиров/i.test(article)?'adjustment':'operating';
  const row={id:`cash-${month}-${r}`,date,month,wallet,article,amount,type,sourceCell:`${s.title}!B${r}:E${r}`};rows.push(row);transactions.push(row);
 }
 const wallets=Array.from({length:5},(_,i)=>({name:norm(g.v(i+4,2)),opening:num(g.v(i+4,3)),closing:num(g.v(i+4,4))})).filter(w=>w.name);
 const opening=num(g.v(9,3)),closing=num(g.v(9,4));
 const total=sum(rows.map(r=>r.amount));
 cashMonths.push({month,hasData:rows.length>0,opening,closing,wallets,lastDate:rows.map(r=>r.date).sort().at(-1)??null,dividends:-sum(rows.filter(r=>r.type==='dividend').map(r=>r.amount)),inflow:sum(rows.filter(r=>r.type==='operating'&&r.amount>0).map(r=>r.amount)),outflow:-sum(rows.filter(r=>r.type==='operating'&&r.amount<0).map(r=>r.amount)),transfers:sum(rows.filter(r=>r.type==='transfer').map(r=>r.amount)),adjustments:sum(rows.filter(r=>r.type==='adjustment').map(r=>r.amount)),net:total,reconciliation:round((closing??0)-(opening??0)-total),sourceCell:`${s.title}!B3:D9`});
}
cashMonths.sort((a,b)=>a.month-b.month);transactions.sort((a,b)=>a.date.localeCompare(b.date));
sources.dds.coverage=cashMonths.filter(m=>m.hasData).map(m=>`${year}-${String(m.month).padStart(2,'0')}`);sources.dds.lastOperationDate=transactions.map(t=>t.date).sort().at(-1);

// Payroll: exact weekly total and colour are the payment status; ambiguous totals are explicit exceptions.
const payments=[],salaryNotes=[],salaryIssues=[];
for(const s of raw.salary.sheets){
 const g=grid(s),role=s.title;
 const totalRows=s.cells.filter(c=>c.c===1&&norm(c.v).toLowerCase()==='итого').map(c=>c.r);
 for(const r of totalRows){
  const start=r-7, hr=r-8;
  const dates=Array.from({length:7},(_,i)=>({r:start+i,date:iso(g.v(start+i,1))}));
  const isTransition=dates[0]?.date==='2026-12-29'&&dates.at(-1)?.date==='2027-01-04';
  if(isTransition&&decisions.correctSalaryTransition)dates.forEach(x=>x.date=iso(g.v(x.r,1)-365));
  const valid=dates.filter(d=>d.date?.startsWith(`${year}-`)&&d.date<=asOf);
  if(!valid.length){if(isTransition)salaryIssues.push(issue('salary','Начало года требует уточнения','В блоке 2026 указана неделя 29.12.2026–04.01.2027.',`${role}!A${start}:A${r-1}`));continue;}
  let site='Не распределено';const headers=g.row(hr).filter(c=>c.c>1&&typeof c.v==='string');
  const boundary=role==='Повара'?16:role==='Курьеры'?9:null;
  for(const c of g.row(r).filter(c=>c.c>1&&num(c.v)!==null&&c.v>0)){
   if(c.c===boundary)continue;
   const name=norm(g.v(hr,c.c));
   const sourceCell=`${role}!${col(c.c)}${r}`;
   if(!name||typeof g.v(hr,c.c)!=='string'||name==='Итого'||/долг|отдал|залог|выдал|должен|\d{3,}/i.test(name)){
    salaryIssues.push(issue('salary','Итог без имени','Сумма не распределена на сотрудника.',sourceCell,c.v));continue;
   }
   let overlaps=false;
   if(c.f){
    const refs=[...c.f.matchAll(/\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/g)];
    for(const m of refs){const lo=+m[2],hi=m[4]?+m[4]:lo;if(totalRows.some(tr=>tr<r&&tr>=lo&&tr<=hi&&(num(g.v(tr,c.c))??0)>0))overlaps=true;}
   }
   if(overlaps&&!decisions.includeOverlappingSalary){salaryIssues.push(issue('salary','Повторный итог в формуле',`${name}: формула захватывает ранее подведённый итог.`,sourceCell,c.v));continue;}
   if(boundary)site=norm(g.v(hr,c.c<boundary?1:boundary))||'Не распределено';else site='Не распределено';
   const allDates=dates.filter(d=>d.date),crossYear=allDates.some(d=>!d.date.startsWith(`${year}-`));
   const weights=allDates.map(d=>({...d,weight:num(g.v(d.r,c.c))??0}));const base=sum(weights.map(d=>d.weight));
   const monthKeys=[...new Set(valid.map(d=>d.date.slice(0,7)))];
   if((monthKeys.length>1||crossYear)&&base<=0){salaryIssues.push(issue('salary','Нельзя разделить по месяцам','Нет дневных значений для распределения недельного итога.',sourceCell,c.v));continue;}
   const groups=monthKeys.map(key=>{const days=valid.filter(d=>d.date.startsWith(key));return {days,weight:sum(weights.filter(d=>d.date.startsWith(key)).map(d=>d.weight))}}).filter(group=>monthKeys.length===1&&!crossYear||group.weight>0);
   const target=crossYear?round(c.v*sum(weights.filter(d=>d.date.startsWith(`${year}-`)&&d.date<=asOf).map(d=>d.weight))/base):round(c.v);let allocated=0;
   groups.forEach((group,index)=>{const amount=index===groups.length-1?round(target-allocated):round(c.v*group.weight/base);allocated+=amount;if(amount<=0)return;const month=+group.days[0].date.slice(5,7);payments.push({id:`salary-${role}-${r}-${c.c}-${month}`,name,personKey:`${role}|${site}|${name.toLowerCase()}`,role,site,periodStart:group.days[0].date,periodEnd:group.days.at(-1).date,weekStart:dates[0].date,weekEnd:dates.at(-1).date,month,amount,sourceAmount:c.v,paid:c.b==='#00ff00',sourceColor:c.b,sourceCell,crossYear,monthlySplit:monthKeys.length>1||crossYear});});
  }
 }
 for(const c of s.cells){if(typeof c.v==='string'&&/\d/.test(c.v)&&/долг|отдал|залог|выдал|должен/i.test(c.v))salaryNotes.push({role,text:safe(c.v),cell:`${role}!${col(c.c)}${c.r}`});}
}
sources.salary.coverage=[...new Set(payments.map(r=>`${year}-${String(r.month).padStart(2,'0')}`))].sort();
sources.salary.lastOperationDate=payments.map(p=>p.periodEnd).sort().at(-1);

// Supplier registers: one weekly total per AYK block; no addition of its intermediate subtotals.
const weekly=[],invoices=[],supplierIssues=[];
const goods=raw.suppliers.sheets.find(s=>s.title==='Товар');
function addWeek(g,selected,dates,previous,breakdown=[]){
 const endDate=dates.at(-1);if(!endDate||endDate>asOf||endDate<`${year}-01-01`)return;
 let amount=selected.v,startDate=dates[0],crossYear=startDate<`${year}-01-01`;
 if(crossYear){
  const lines=[];for(let r=previous+1;r<=selected.r;r++)for(const [dc,ac] of [[1,2],[3,4]]){const d=iso(g.v(r,dc)),v=num(g.v(r,ac));if(d&&v!==null&&g.cell(r,dc)?.fmt==='DATE')lines.push({date:d,amount:v});}
  const base=sum(lines.map(x=>x.amount));
  if(Math.abs(base-selected.v)>.02){supplierIssues.push(issue('suppliers','Переходящая неделя','Не удалось отделить 2026 год с точной сверкой.',`Товар!C${selected.r}`,selected.v));return;}
  amount=round(sum(lines.filter(x=>x.date>=`${year}-01-01`).map(x=>x.amount)));startDate=lines.filter(x=>x.date>=`${year}-01-01`).map(x=>x.date).sort()[0];
 }
 weekly.push({id:`ayk-${selected.r}`,date:endDate,startDate,month:+endDate.slice(5,7),amount,paid:selected.b==='#00ff00',sourceColor:selected.b,sourceCell:`Товар!C${selected.r}`,breakdown,crossYear,sourceAmount:selected.v});
}
if(goods){const g=grid(goods);const heads=goods.cells.filter(c=>c.c===1&&/^(Дата|Дата накладной)$/i.test(norm(c.v))).map(c=>c.r).sort((a,b)=>a-b);heads.push(g.max+1);
 for(let i=0;i<heads.length-1;i++){
  const h=heads[i],end=heads[i+1]-1;
 const candidates=goods.cells.filter(c=>c.r>h&&c.r<=end&&c.c===3&&num(c.v)!==null&&c.v>0&&c.fmt!=='DATE'&&(c.f||c.fmt==='CURRENCY'));
  if(!candidates.length)continue;
  if(i===0){
   for(let j=0;j<candidates.length;j++){
    const selected=candidates[j],prev=j?candidates[j-1].r:h;
    const dates=goods.cells.filter(c=>c.r>prev&&c.r<=selected.r&&[1,3].includes(c.c)&&c.fmt==='DATE').map(c=>iso(c.v)).filter(Boolean).sort();const endDate=dates.at(-1);
    if(!endDate||endDate>asOf)continue;
    addWeek(g,selected,dates,prev);
   }
   continue;
  }
  const selected=candidates.findLast(c=>c.b==='#00ff00')??candidates.at(-1);
  const dates=goods.cells.filter(c=>c.r>h&&c.r<=selected.r&&[1,3].includes(c.c)&&c.fmt==='DATE').map(c=>iso(c.v)).filter(Boolean).sort();
  const endDate=dates.at(-1);if(!endDate||endDate>asOf)continue;
  const breakdown=[];
  for(const [column,site] of [[2,'Героев'],[4,'Косинка']]){const totals=goods.cells.filter(c=>c.r>h&&c.r<=end&&c.c===column&&num(c.v)!==null&&c.f&&/^=SUM\(/i.test(c.f));if(totals.length)breakdown.push({site,amount:totals.at(-1).v});}
  addWeek(g,selected,dates,h,breakdown);
 }
}
const prod=raw.suppliers.sheets.find(s=>s.title==='Товар от производителя');
if(prod){const g=grid(prod);for(let r=3;r<=g.max;r++){
 const amount=num(g.v(r,6));if(amount===null||amount<=0)continue;
 const date=iso(g.v(r,2)),due=iso(g.v(r,3)),paidDate=iso(g.v(r,7)),supplier=safe(g.v(r,5)),document=norm(g.v(r,1));
 if(date&&date<`${year}-01-01`)continue;
 if(!supplier||!date){supplierIssues.push(issue('suppliers','Документ требует проверки','Не заполнен поставщик или дата.',`Товар от производителя!A${r}:F${r}`,amount));continue;}
 if(date>asOf){supplierIssues.push(issue('suppliers','Будущая дата документа',`${date} · ${supplier}`,`Товар от производителя!B${r}`,amount));continue;}
 const paid=g.cell(r,6)?.b==='#00ff00';
 invoices.push({id:`invoice-${r}`,date,due,paidDate,supplier,document,amount,paid,month:+date.slice(5,7),overdue:!paid&&!!due&&due<asOf,sourceCell:`Товар от производителя!A${r}:I${r}`});
}}
sources.suppliers.coverage=[...new Set([...weekly,...invoices].filter(r=>r.date.startsWith(`${year}-`)).map(r=>r.date.slice(0,7)))].sort();sources.suppliers.lastOperationDate=[...weekly,...invoices].map(r=>r.date).sort().at(-1);

const tg=title=>grid(raw.ttk.sheets.find(s=>s.title===title));
const sg=tg('Сводка'), dg=tg('С/с готовых блюд'), pg=tg('Цены ПФ'), cg=tg('Проверки'), vg=tg('Продажи ОПИУ');
const dishes=[],ingredients=[],ttkChecks=[],sales=[],recipes=[];
for(let r=3;r<=dg.max;r++){const id=num(dg.v(r,1)),name=norm(dg.v(r,2));if(!id||!name)continue;dishes.push({id,name,yieldGrams:num(dg.v(r,3)),cost:num(dg.v(r,4)),status:dg.v(r,5),missingPrice:dg.v(r,6),missingQuantity:dg.v(r,7),coverage:num(dg.v(r,8)),sourceCell:`С/с готовых блюд!A${r}:H${r}`});}
for(let r=3;r<=pg.max;r++){const name=norm(pg.v(r,1));if(!name)continue;ingredients.push({name,type:pg.v(r,2),price:num(pg.v(r,8)),unit:pg.v(r,9),date:iso(pg.v(r,5)),status:pg.v(r,10),note:safe(pg.v(r,11)),sourceCell:`Цены ПФ!A${r}:L${r}`});}
for(let r=4;r<=cg.max;r++){const name=norm(cg.v(r,2));if(!name)continue;ttkChecks.push({type:cg.v(r,1),name,status:cg.v(r,3),variants:num(cg.v(r,5)),different:cg.v(r,6),sourceCell:`Проверки!A${r}:G${r}`});}
for(let r=3;r<=vg.max;r++){const date=iso(vg.v(r,1)),name=norm(vg.v(r,3));if(!date||!name)continue;sales.push({date,month:+date.slice(5,7),site:vg.v(r,2),name,quantity:num(vg.v(r,4)),unitCost:num(vg.v(r,5)),cost:num(vg.v(r,6)),status:vg.v(r,7),sourceCell:`Продажи ОПИУ!A${r}:H${r}`});}
const rg=tg('ТТК единая');for(let r=4;r<=rg.max;r++){const dishId=num(rg.v(r,1)),name=norm(rg.v(r,5));if(!dishId||!name)continue;recipes.push({dishId,name,gross:num(rg.v(r,6)),net:num(rg.v(r,7)),unit:rg.v(r,9),price:num(rg.v(r,10)),quantity:num(rg.v(r,12)),cost:num(rg.v(r,13)),status:rg.v(r,14),sourceCell:`ТТК единая!A${r}:N${r}`});}
sources.ttk.coverage=[...new Set(sales.map(r=>r.date.slice(0,7)))].sort();
const catalogCards=new Set(recipes.map(r=>r.dishId)).size;
const snapshot={schemaVersion:1,brand:'ВИДИМ ДЕНЬГИ',title:'Финансовый кабинет',year,asOf,generatedAt:new Date().toISOString(),defaultMonth,sources,decisions:{correctSalaryTransition:!!decisions.correctSalaryTransition,includeOverlappingSalary:!!decisions.includeOverlappingSalary},pnl:{articles,rows:pnlRows,periods:pnlPeriods,checks:pnlChecks},cash:{months:cashMonths,transactions,issues:cashIssues},salary:{payments,notes:[],issues:salaryIssues,periodRule:'По календарным месяцам смен; недельный итог распределяется пропорционально дневным значениям.'},suppliers:{weekly,invoices,issues:supplierIssues},ttk:{summary:{cards:catalogCards,rows:recipes.length,ingredients:ingredients.length,invoicePrices:sg.v(4,5),nested:ingredients.filter(r=>r.type==='Вложенная карта').length,calculatedDishes:dishes.filter(r=>r.status==='РАССЧИТАНО').length,conflicts:ttkChecks.filter(r=>r.different==='Да').length,sourceSummaryCards:sg.v(4,2),sourceSummaryDishes:sg.v(18,4)},dishes,ingredients,checks:ttkChecks,sales,recipes}};
fs.writeFileSync(output,JSON.stringify(snapshot),{mode:0o600});
const latest=cashMonths.filter(m=>m.hasData).at(-1);
if(!process.env.FINANCE_QUIET)console.log(JSON.stringify({output,generatedAt:snapshot.generatedAt,pnlActual:sources.opiu.coverage,cash:{lastOperation:sources.dds.lastOperationDate,balance:latest?.closing,dividends:round(sum(cashMonths.filter(m=>m.hasData).map(m=>m.dividends))),reconciliation:cashMonths.filter(m=>m.hasData).map(m=>({month:m.month,difference:m.reconciliation}))},salary:{records:payments.length,paid:round(sum(payments.filter(p=>p.paid).map(p=>p.amount))),debt:round(sum(payments.filter(p=>!p.paid).map(p=>p.amount))),issues:salaryIssues.length},suppliers:{weekly:weekly.length,invoices:invoices.length,debt:round(sum([...weekly,...invoices].filter(r=>!r.paid).map(r=>r.amount)))},ttk:{dishes:dishes.length,ingredients:ingredients.length,sales:sales.length}},null,2));
