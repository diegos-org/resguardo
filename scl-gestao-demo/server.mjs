import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']],['/app.mjs',['app.mjs','text/javascript; charset=utf-8']],['/model.mjs',['model.mjs','text/javascript; charset=utf-8']]]);
export function createServer(){return http.createServer(async(req,res)=>{
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Referrer-Policy','no-referrer');
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
 const path=new URL(req.url,'http://localhost').pathname,asset=assets.get(path);
 if(!asset){res.writeHead(404);res.end('Não encontrado');return;}
 try{const body=await readFile(new URL('./public/'+asset[0],import.meta.url));res.writeHead(200,{'Content-Type':asset[1]});res.end(req.method==='HEAD'?undefined:body);}catch{res.writeHead(500);res.end('Prévia indisponível');}
});}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))createServer().listen(Number(process.env.PORT||4177),'127.0.0.1',()=>console.log('Demonstração fictícia: http://127.0.0.1:4177'));
