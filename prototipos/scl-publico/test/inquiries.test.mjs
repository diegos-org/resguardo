import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.mjs';
import { createInquiryStore, formSigner } from '../src/inquiries.mjs';
const dates={property:'102',checkin:new Date(Date.now()+86400000).toISOString().slice(0,10),checkout:new Date(Date.now()+3*86400000).toISOString().slice(0,10),guests:'2'};
async function context(fn,customStore) {
 const dir=await mkdtemp(join(tmpdir(),'scl-inquiries-test-')), signer=formSigner(),store=customStore||createInquiryStore(dir),app=createApp({inquiryStore:store,signer});app.listen(0,'127.0.0.1');await once(app,'listening');const base=`http://127.0.0.1:${app.address().port}`;
 const fields=()=>new URLSearchParams({...dates,...signer.issue(),name:'Pessoa Teste',email:'teste@example.invalid',message:'Esta é uma consulta sintética de teste.'});
 const post=(body,path='/consultas',extra={})=>fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json',...extra},body});
 try{await fn({dir,signer,store,base,fields,post});}finally{await new Promise(r=>app.close(r));await rm(dir,{recursive:true,force:true});}
}
test('inquiry persists privately and double submission, including concurrency and restart, is idempotent',()=>context(async({dir,post,fields,store})=>{
 const body=fields(),responses=await Promise.all([post(body),post(body)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);const payloads=await Promise.all(responses.map(r=>r.json()));assert.equal(payloads[0].code,payloads[1].code);
 const files=await readdir(dir);assert.equal(files.length,1);const path=join(dir,files[0]),record=JSON.parse(await readFile(path));assert.equal(record.state,'RECEIVED_LOCAL');assert.equal(record.email,'teste@example.invalid');assert.match(record.code,/^SCL-Q-[A-F0-9]{12}$/);assert.equal((await stat(path)).mode&0o777,0o600);
 const restarted=createInquiryStore(dir);const {fingerprint,id,code,state,createdAt,...input}=record;assert.equal((await restarted.submit(id,input)).code,code);
 body.set('message','Outra mensagem com a mesma tentativa.');assert.equal((await post(body)).status,409);
}));
test('cross-origin, missing or tampered tokens cannot write',()=>context(async({post,fields,dir})=>{
 assert.equal((await post(fields(),'/consultas',{Origin:'https://evil.example'})).status,403);
 const bad=fields();bad.set('token','broken');assert.equal((await post(bad)).status,403);bad.delete('token');assert.equal((await post(bad)).status,403);assert.deepEqual(await readdir(dir),[]);
}));
test('invalid contact, duplicate fields, capacity and oversized bodies do not persist',()=>context(async({post,fields,dir})=>{
 for(const [key,value] of [['email','not-email'],['name',''],['message',''],['guests','6']]){const data=fields();data.set(key,value);assert.equal((await post(data)).status,400);}
 const dup=fields();dup.append('email','other@example.invalid');assert.equal((await post(dup)).status,400);
 const huge=fields();huge.set('message','a'.repeat(17000));assert.equal((await post(huge)).status,413);assert.deepEqual(await readdir(dir),[]);
}));
test('storage failure does not claim receipt',()=>context(async({post,fields})=>{
 const r=await post(fields());assert.equal(r.status,503);const data=await r.json();assert.equal(data.code,undefined);assert.match(data.error,/Não foi possível registrar/);
},{submit:async()=>{throw Error('private-path-or-secret');}}));
test('private inbox has no public retrieval endpoint',()=>context(async({post,fields,base})=>{
 const body=fields();await post(body);
 for(const path of ['/consultas','/consultas/'+body.get('submissionId'),'/work/private/scl-inquiries/'+body.get('submissionId')+'.json','/api/inquiries','/painel'])assert.equal((await fetch(base+path)).status,404);
}));
test('portal invitation records only explicit interest and requires receipt-scoped token',()=>context(async({post,fields,dir,signer})=>{
 const body=fields();await post(body);const id=body.get('submissionId');const wrong=new URLSearchParams(signer.issue('inquiry',id));assert.equal((await post(wrong,'/consultas/convite')).status,403);
 const valid=new URLSearchParams(signer.issue('invitation',id));assert.equal((await post(valid,'/consultas/convite')).status,200);assert.equal((await post(valid,'/consultas/convite')).status,200);const invitation=JSON.parse(await readFile(join(dir,`${id}.portal-interest.json`)));assert.equal(invitation.purpose,'PORTAL_LAUNCH_INVITATION');assert.equal((await readdir(dir)).length,2);
}));
test('rendered form uses POST and never echoes personal data into URL or receipt',()=>context(async({base,post,fields})=>{
 const html=await (await fetch(base+'/consulta?'+new URLSearchParams(dates))).text();assert.match(html,/method="post" action="\/consultas"/);assert.match(html,/name="token"/);assert.doesNotMatch(html,/copy-message/);
 const body=fields();body.set('name','<script>alert(1)</script>');const data=await (await post(body)).json();assert.doesNotMatch(data.html,/<script>|teste@example/);
}));
