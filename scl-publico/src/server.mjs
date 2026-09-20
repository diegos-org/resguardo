import http from 'node:http';
import { evaluateDemoQuote } from './checkout-demo.mjs';
import { createInquiryStore, formSigner, validateInquiry } from './inquiries.mjs';
import { businessWhatsapp } from './site-config.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { properties, findProperty, publicProperty } from './catalog.mjs';
import { validateSearch, getAvailability } from './availability.mjs';
import * as view from './views.mjs';
const publicDir = new URL('../public/', import.meta.url);
const assets = new Map([['/styles.css','text/css'],['/app.js','text/javascript'],['/images/logo-blue.png','image/png'],['/images/leblon-beach.jpg','image/jpeg'],...['102','103','303','403'].map(c=>[`/images/${c}.jpeg`,'image/jpeg'])]);
for (const property of properties) for (const image of property.gallery) assets.set(image, 'image/jpeg');
for (const place of ['talho','argumento','shopping']) assets.set(`/images/places/${place}.jpg`,'image/jpeg');
const headers = {
 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=()', 'X-Robots-Tag':'noindex, nofollow',
 'Cache-Control':'no-store'
};
export function createApp({provider, inquiryStore = createInquiryStore(), signer = formSigner(), contact = process.env.SCL_CONTACT_WHATSAPP ?? businessWhatsapp} = {}) {
 // Contact destination must be explicitly configured; never take it from request parameters.
 const requests = [];
 const safeContact = /^[1-9][0-9]{9,14}$/.test(contact) ? contact : '';
 return http.createServer(async (req,res) => {
  const send=(status,body,type='text/html; charset=utf-8')=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(req.method==='HEAD'?undefined:body);};
  const json=(status,data)=>send(status,JSON.stringify(data),'application/json; charset=utf-8');
  try {

   if ((req.url||'').length>2048) return json(414,{error:'REQUEST_TOO_LONG'});
   const url=new URL(req.url,'http://localhost');
   let path; try { path=decodeURIComponent(url.pathname); } catch { return json(400,{error:'INVALID_PATH'}); }
   if(req.method==='POST' && ['/consultas','/consultas/convite'].includes(path)) {
    const host=req.headers.host||'';
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)||req.headers.origin!==`http://${host}`||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'ORIGIN_NOT_ALLOWED'});
    if((req.headers['content-type']||'').split(';')[0]!=='application/x-www-form-urlencoded')return json(415,{error:'FORM_REQUIRED'});
    const now=Date.now();while(requests.length&&requests[0]<now-60000)requests.shift();if(requests.length>=20)return json(429,{error:'Tente novamente em um minuto.'});requests.push(now);
    let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)return json(413,{error:'Mensagem muito longa.'});body+=chunk.toString('utf8');}
    const fields=new URLSearchParams(body),id=fields.get('submissionId'),purpose=path.endsWith('/convite')?'invitation':'inquiry';
    if([...new Set(fields.keys())].some(key=>fields.getAll(key).length!==1))return json(400,{error:'Campos duplicados.'});
    if(!signer.verify(id,fields.get('token'),purpose))return json(403,{error:'A página expirou. Atualize antes de enviar.'});
    if(purpose==='invitation'){
     await inquiryStore.requestInvitation(id);
     return req.headers.accept?.includes('application/json')?json(200,{message:'Interesse registrado. O convite será enviado quando o portal e o e-mail estiverem ativos.'}):send(200,view.layout('Interesse registrado','<section class="section narrow"><h1>Combinado.</h1><p>Seu interesse foi registrado. O convite será enviado quando o portal e o e-mail estiverem ativos.</p><a href="/" class="button">Voltar ao início</a></section>'));
    }
    const criteria=new URLSearchParams();for(const key of ['property','checkin','checkout','guests'])if(fields.has(key))criteria.set(key,fields.get(key));
    const {errors,query}=validateSearch(criteria),validation=validateInquiry(fields);errors.push(...validation.errors);
    if(errors.length)return req.headers.accept?.includes('application/json')?json(400,{error:errors.join(' ')}):send(400,view.consultation(criteria,errors,query,safeContact,{submissionId:id,token:fields.get('token')},fields));
    try {
     const receipt=await inquiryStore.submit(id,{criteria:{property:query.property?.code||null,checkin:query.checkin,checkout:query.checkout,guests:query.guests},...validation.contact});
     const invitation=signer.issue('invitation',id),html=view.inquiryReceipt(receipt.code,invitation);
     return req.headers.accept?.includes('application/json')?json(receipt.created?201:200,{code:receipt.code,html}):send(receipt.created?201:200,view.layout('Consulta registrada',`<section class="section narrow">${html}</section>`));
    }catch(error){return json(error.status===409?409:503,{error:error.status===409?'Esta tentativa já foi usada. Atualize a página para uma nova consulta.':'Não foi possível registrar sua consulta. Seus dados não foram confirmados; tente novamente.'});}
   }
   if (!['GET','HEAD'].includes(req.method)) { res.setHeader('Allow','GET, HEAD'); return json(405,{error:'METHOD_NOT_ALLOWED'}); }
   // Workbench omits all original media pending rights review. Known image URLs use an explicit placeholder.
   if (assets.has(path) && path.startsWith('/images/')) return send(200,await readFile(new URL('images/placeholder.svg',publicDir)),'image/svg+xml');
   if (assets.has(path)) return send(200,await readFile(new URL(path.slice(1),publicDir)),assets.get(path));
   if (path==='/robots.txt') return send(200,'User-agent: *\nDisallow: /\n','text/plain');
   // No session, query parameter, cookie or spoofed role can enable these routes.
   if (/^\/(?:interno|painel|admin|operador|equipe|proprietario|minha-reserva)(?:\/|$)/i.test(path) || /^\/api\/(?:internal|admin|auth)(?:\/|$)/i.test(path)) return send(404,view.errorPage('Página indisponível','Esta área não está disponível nesta versão.'));
   if(path==='/') return send(200,view.home(safeContact));
   if(path==='/demo/checkout'){const quote=evaluateDemoQuote(url.searchParams);return send(quote.state==='INVALID'?400:200,view.checkoutDemo(url.searchParams,quote));}
   if(path==='/imoveis') return send(200,view.listing(safeContact));
   if(path==='/api/site/properties') return json(200,properties.map(publicProperty));
   const match=path.match(/^\/(imoveis|property)\/([a-z0-9-]+)$/);
   if(match) {
    const property=findProperty(match[2]);
    if(!property) return send(404,view.errorPage('Casa não encontrada','Conheça os imóveis disponíveis no catálogo.'));
    if(match[1]==='property') {res.setHeader('Location',`/imoveis/${property.code}`); return send(308,'');}
    return send(200,view.detail(property,url.searchParams,safeContact));
   }
   if(path==='/api/disponibilidade' || path==='/disponibilidade') {
    const {errors,query}=validateSearch(url.searchParams);
    if(errors.length) return path.startsWith('/api/')?json(400,{state:'UNKNOWN',canBook:false,errors}):send(400,view.results(url.searchParams,errors,query));
    const availability=await getAvailability(query,provider);
    return path.startsWith('/api/')?json(503,availability):send(503,view.results(url.searchParams,[],query));
   }
   if(path==='/consulta') {
    const submitted=url.searchParams.has('checkin')||url.searchParams.has('checkout')||url.searchParams.has('guests');
    const {errors,query}=submitted?validateSearch(url.searchParams):{errors:[],query:null};
    return send(errors.length?400:200,view.consultation(url.searchParams,errors,query,safeContact,signer.issue()));
   }
   if(path==='/privacidade') return send(200,view.layout('Privacidade da prévia', '<section class="section narrow"><h1>Uma prévia sem cadastro.</h1><p>Ao enviar uma consulta, esta prévia registra nome, e-mail, pergunta, imóvel, datas e quantidade de hóspedes em uma caixa privada neste computador, para tratar a solicitação. Não solicita documentos ou pagamento. Não há envio de e-mail, integração com a Lia ou acesso público aos registros. Não usa cookies nem analytics. Os links de atendimento e do guia do bairro abrem serviços externos apenas quando você clica.</p><p>As datas e a quantidade de hóspedes aparecem na URL e podem ficar no histórico do seu navegador. Nome, e-mail e pergunta são enviados no corpo do formulário, nunca na URL. O interesse opcional em receber um convite para o portal é registrado separadamente e não autoriza campanhas de marketing. Retenção e atendimento dos direitos serão definidos antes da produção; nesta prévia, use dados de teste e solicite a Diego a remoção de registros de teste quando necessário.</p><p>Abrir o WhatsApp leva você ao atendimento comercial em um serviço externo. Nada é enviado automaticamente.</p><p>A política para o site publicado será definida antes de sua abertura ao público.</p></section>'));
   return send(404,view.errorPage('Página não encontrada','Você pode voltar ao catálogo para escolher sua casa.'));
  } catch { return json(500,{error:'INTERNAL_ERROR'}); }
 });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
 const port=Number(process.env.PORT||4173);
 createApp().listen(port,'127.0.0.1',()=>console.log(`SCL preview: http://127.0.0.1:${port}`));
}
