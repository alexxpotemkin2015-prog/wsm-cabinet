import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../finance');
const snapshot=path.resolve(process.argv[2]||'../snapshot.private.json');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const host=req.headers.host?.split(':')[0];if(!['localhost','127.0.0.1'].includes(host)){res.writeHead(403);res.end();return}
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 const file=pathname==='/__preview-data'?snapshot:path.resolve(root,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));
 if(file!==snapshot&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});fs.createReadStream(file).pipe(res);
});
server.listen(4178,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4178/?preview=1'));
