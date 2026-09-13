import fs from 'node:fs';
import assert from 'node:assert/strict';
const d=JSON.parse(fs.readFileSync(process.argv[2]||'../snapshot.private.json','utf8'));
const sum=a=>a.reduce((s,x)=>s+x,0),close=(a,b)=>assert.ok(Math.abs(a-b)<.021,`${a} != ${b}`);
assert.equal(d.schemaVersion,1);assert.equal(d.brand,'ВИДИМ ДЕНЬГИ');
for(const source of Object.values(d.sources))assert.ok(source.fetchedAt&&source.modifiedAt&&source.url.startsWith('https://docs.google.com/spreadsheets/d/'));
for(const r of d.cash.transactions)assert.ok(r.date>=`${d.year}-01-01`&&r.date<=d.asOf);
for(const m of d.cash.months.filter(m=>m.hasData)){const rows=d.cash.transactions.filter(r=>r.month===m.month);close(m.opening+sum(rows.map(r=>r.amount)),m.closing);close(sum(m.wallets.map(w=>w.closing)),m.closing);close(m.dividends,-sum(rows.filter(r=>r.type==='dividend').map(r=>r.amount)));}
for(const r of [...d.suppliers.weekly,...d.suppliers.invoices])assert.ok(r.date>=`${d.year}-01-01`&&r.date<=d.asOf);
for(const r of d.salary.payments){assert.ok(r.periodStart>=`${d.year}-01-01`&&r.periodEnd<=d.asOf);assert.equal(r.paid,r.sourceColor==='#00ff00');assert.ok(r.name&&r.sourceCell&&r.amount>0);}
for(const a of d.pnl.articles.filter(a=>['103','105'].includes(a.id)))assert.equal(a.unit,'RUB');
const p=(id,m,mode)=>d.pnl.rows.find(r=>r.entity==='network'&&r.article===String(id)&&r.month===m)?.[mode];
for(const m of d.pnl.periods.filter(r=>r.entity==='network'))for(const mode of ['actual','plan'])if(m[mode==='plan'?'hasPlan':'hasActual']){close(p(37,m.month,mode)-p(40,m.month,mode),p(54,m.month,mode));close(p(54,m.month,mode)-p(130,m.month,mode),p(140,m.month,mode));}
for(const month of [10,11,12])close(p(37,month,'plan'),p(37,month-1,'plan')*1.03);
for(const month of [9,10,11,12]){close(p(43,month,'plan'),p(37,month,'plan')*.03);close(p(53,month,'plan'),p(37,month,'plan')*.02);}
assert.equal(new Set(d.ttk.dishes.map(r=>r.id)).size,d.ttk.dishes.length);for(const dish of d.ttk.dishes)if(dish.status==='РАССЧИТАНО')close(sum(d.ttk.recipes.filter(r=>r.dishId===dish.id).map(r=>r.cost??0)),dish.cost);
for(const collection of [d.pnl.rows,d.cash.transactions,d.salary.payments,d.suppliers.weekly,d.suppliers.invoices]){const ids=collection.map(r=>r.id??`${r.entity}-${r.month}-${r.article}`);assert.equal(new Set(ids).size,ids.length);}
assert.ok(!d.client&&!d.organization,'Only neutral branding is allowed.');
if(!process.env.FINANCE_QUIET)console.log(JSON.stringify({passed:true,checks:['2026 scope','payment colours','cash reconciliation','P&L gross profit and EBITDA','forecast growth and rates','recipe totals','unique records','neutral branding'],knownSourceIssues:{pnl:d.pnl.checks.filter(c=>c.status!=='OK'),salary:d.salary.issues.length,suppliers:d.suppliers.issues.length}}));
