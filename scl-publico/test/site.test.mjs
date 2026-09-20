import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { properties, publicProperty } from '../src/catalog.mjs';
import { validateSearch, getAvailability } from '../src/availability.mjs';
const tomorrow = new Date(Date.now()+86400000).toISOString().slice(0,10);
const later = new Date(Date.now()+4*86400000).toISOString().slice(0,10);
const params = new URLSearchParams({checkin:tomorrow,checkout:later,guests:'2',property:'403'});
async function withServer(fn, options){const server=createApp(options);server.listen(0,'127.0.0.1');await once(server,'listening');try{await fn(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(r=>server.close(r));}}
test('public routes render five homes and full detail pages',()=>withServer(async base=>{
 for(const path of ['/','/imoveis',...properties.map(p=>`/imoveis/${p.code}`),'/consulta','/privacidade']) { const r=await fetch(base+path);assert.equal(r.status,200,path);assert.match(await r.text(),/<html lang="pt-BR">/); }
 const r=await fetch(base+'/api/site/properties');const body=await r.json();assert.equal(body.length,5);assert.deepEqual(body.map(p=>p.code),['102','103','303','399','403']);
}));
test('internal routes cannot be opened by fake credentials or role flags',()=>withServer(async base=>{
 for(const path of ['/interno','/interno/settings?role=ADMIN','/painel','/admin','/operador','/equipe','/proprietario','/minha-reserva','/api/internal/users','/api/admin','/api/auth']) {
 const r=await fetch(base+path,{headers:{Cookie:'admin=true; session=admin',Authorization:'Bearer admin','X-Role':'ADMIN'}});assert.equal(r.status,404,path);
 }
}));
test('no operational files, secrets or traversal are served',()=>withServer(async base=>{
 for(const path of ['/.env','/package.json','/src/catalog.mjs','/docs/architecture.md','/images/../../src/server.mjs','/%2e%2e%2fsrc/server.mjs','/images/%2e%2e%2f%2e%2e%2f.env']) assert.equal((await fetch(base+path)).status,404,path);
 const malicious={...properties[0],owner_email:'private',token:'secret',door_code:'1234'};assert.equal(JSON.stringify(publicProperty(malicious)).includes('private'),false);assert.equal(JSON.stringify(publicProperty(malicious)).includes('secret'),false);
}));
test('availability fails closed and never creates a reservation',()=>withServer(async base=>{
 const r=await fetch(base+'/api/disponibilidade?'+params);assert.equal(r.status,503);assert.deepEqual(await r.json(),{state:'UNKNOWN',reason:'PROVIDER_NOT_CONFIGURED',checkedAt:null,canBook:false});
 const html=await fetch(base+'/disponibilidade?'+params);assert.equal(html.status,503);assert.match(await html.text(),/Disponibilidade ainda não confirmada/);
 const post=await fetch(base+'/api/reservations',{method:'POST',body:'{}'});assert.equal(post.status,405);
}));
test('provider failure, malformed response and unverified success never become available',async()=>{
 const {query}=validateSearch(params);
 for(const provider of [{readAvailability:async()=>{throw Error('secret upstream exception');}},{readAvailability:async()=>({state:'AVAILABLE'})},{readAvailability:async()=>null}]) { const r=await getAvailability(query,provider);assert.equal(r.state,'UNKNOWN');assert.equal(r.canBook,false);assert.equal(JSON.stringify(r).includes('secret'),false); }
});
test('server rejects invalid dates, duplicate parameters, capacity and unknown properties',()=>withServer(async base=>{
 for(const patch of [{checkin:'2026-02-30'},{checkout:tomorrow},{checkin:'2020-01-01'},{guests:'7'},{guests:'2e0'},{property:'102',guests:'4'},{property:'999'},{checkout:'2099-01-01'}]) {
 const p=new URLSearchParams({...Object.fromEntries(params),...patch});assert.equal((await fetch(base+'/api/disponibilidade?'+p)).status,400,JSON.stringify(patch)); }
 const p=new URLSearchParams(params);p.append('guests','3');assert.equal((await fetch(base+'/api/disponibilidade?'+p)).status,400);
}));
test('consulta preserves criteria but does not claim delivery; escaping blocks markup injection',()=>withServer(async base=>{
 const r=await fetch(base+'/consulta?'+params);const html=await r.text();assert.match(html,/Enviar consulta/);assert.match(html,/registrada apenas neste computador/);assert.match(html,/Estúdio Mezanino Leblon/);assert.match(html,/https:\/\/wa.me\/5521995360322/);
 const evil=new URLSearchParams(params);evil.set('checkin','"><script>alert(1)</script>');const invalid=await fetch(base+'/consulta?'+evil);assert.equal(invalid.status,400);assert.doesNotMatch(await invalid.text(),/<script>alert/);
}));
test('destination comes only from validated server configuration',()=>withServer(async base=>{
 const r=await fetch(base+'/consulta?'+params+'&contact=https://evil.test');const html=await r.text();assert.match(html,/https:\/\/wa.me\/5511000000000\?text=/);assert.doesNotMatch(html,/evil.test/);
},{contact:'5511000000000'}));
test('security headers, HEAD, 404 and legacy redirect',()=>withServer(async base=>{
 const r=await fetch(base+'/',{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow');
 assert.equal((await fetch(base+'/not-found')).status,404);const old=await fetch(base+'/property/403',{redirect:'manual'});assert.equal(old.status,308);assert.equal(old.headers.get('location'),'/imoveis/403');
}));
test('workbench galleries use placeholders, with eight slots for 399',()=>withServer(async base=>{
 for(const p of properties){assert.equal(p.gallery.length,p.code==='399'?8:9);assert.equal(new Set(p.gallery).size,p.gallery.length);for(const path of p.gallery){const r=await fetch(base+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/image\/svg\+xml/);assert.match(await r.text(),/Imagem não incluída/);}}
}));
test('consultation links prefill criteria without enabling checkout or accepting prices',()=>withServer(async base=>{
 const r=await fetch(base+'/consulta?'+params+'&total=1&payment=paid');const html=await r.text();assert.match(html,/Resumo da viagem/);assert.match(html,/Mercado Pago/);assert.match(html,/<button class="button" disabled>Reserva ainda não habilitada/);assert.doesNotMatch(html,/payment=paid|R\$ 0,01/);assert.match(html,/Total<\/dt><dd>A confirmar/);
 const detail=await (await fetch(base+'/imoveis/102?'+params)).text();assert.match(detail,/data-property-navigation="true"/);assert.match(detail,new RegExp(`value="${tomorrow}"`));
}));
test('invalid contact configuration disables contact links',()=>withServer(async base=>{
 const html=await (await fetch(base+'/consulta?'+params)).text();assert.doesNotMatch(html,/https:\/\/wa.me/);
},{contact:'javascript:alert(1)'}));

test('legacy redirect preserves only valid stay criteria for the path property',()=>withServer(async base=>{
 const criteria=new URLSearchParams({checkin:tomorrow,checkout:later,guests:'2'});
 const extra=new URLSearchParams(criteria);extra.set('email','fixture@example.invalid');extra.set('token','fixture');extra.set('total','1');extra.set('property','303');
 for(const method of ['GET','HEAD']) {
  const r=await fetch(base+'/property/102?'+extra,{method,redirect:'manual'});
  assert.equal(r.status,308);assert.equal(r.headers.get('location'),'/imoveis/102?'+criteria);
 }
 const html=await (await fetch(base+'/property/102?'+extra)).text();
 assert.match(html,new RegExp('value="'+tomorrow+'"'));assert.match(html,new RegExp('value="'+later+'"'));
 assert.doesNotMatch(html,/fixture@example|token=fixture|total=1/);
 const onlyUnknown=await fetch(base+'/property/102?email=fixture@example.invalid',{redirect:'manual'});
 assert.equal(onlyUnknown.headers.get('location'),'/imoveis/102');
}));
test('legacy redirect rejects invalid, incomplete, duplicate or over-capacity stay criteria',()=>withServer(async base=>{
 const valid={checkin:tomorrow,checkout:later,guests:'2'};
 for(const patch of [{guests:'6'},{checkin:'2026-02-30'},{checkout:tomorrow},{checkin:'fixture@example.invalid'},{guests:'2e0'},{checkin:'2020-01-01'}]) {
  const r=await fetch(base+'/property/102?'+new URLSearchParams({...valid,...patch}),{redirect:'manual'});
  assert.equal(r.status,400);assert.equal(r.headers.get('location'),null);
 }
 for(const query of ['guests=2',new URLSearchParams(valid)+'&guests=3']) {
  const r=await fetch(base+'/property/102?'+query,{redirect:'manual'});assert.equal(r.status,400);assert.equal(r.headers.get('location'),null);
 }
}));
