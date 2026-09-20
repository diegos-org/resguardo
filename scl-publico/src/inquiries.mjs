import { randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open, link, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const defaultInquiryDirectory=fileURLToPath(new URL('../private-data/scl-inquiries/',import.meta.url));
export function formSigner(secret=randomUUID()) {
 const sign=(id,time,purpose)=>createHmac('sha256',secret).update(`${purpose}:${id}:${time}`).digest('hex');
 return {
  issue(purpose='inquiry',id=randomUUID()) {const time=Date.now().toString();return {submissionId:id,token:`${time}.${sign(id,time,purpose)}`};},
  verify(id,token,purpose='inquiry') {if(!/^[a-f0-9-]{36}$/.test(id||'')||!/^\d{13}\.[a-f0-9]{64}$/.test(token||''))return false;const [time,digest]=token.split('.');if(Date.now()-Number(time)>7200000||Number(time)>Date.now()+60000)return false;return timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(sign(id,time,purpose),'hex'));}
 };
}
export function validateInquiry(fields) {
 const errors=[];
 const name=(fields.get('name')||'').trim(),email=(fields.get('email')||'').trim(),message=(fields.get('message')||'').trim();
 if(name.length<2||name.length>100||/[\x00-\x1f\x7f]/.test(name))errors.push('Informe seu nome (até 100 caracteres).');
 if(email.length>254||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))errors.push('Informe um e-mail válido para respondermos.');
 if(message.length<5||message.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message))errors.push('Escreva sua pergunta entre 5 e 2.000 caracteres.');
 return {errors,contact:{name,email,message}};
}
export function createInquiryStore(directory=defaultInquiryDirectory) {
 // Private local inbox. No GET route or public asset path exposes these records.
 async function atomicFile(filename,data) {
  await mkdir(directory,{recursive:true,mode:0o700});
  const temp=join(directory,`.${randomUUID()}.tmp`),dest=join(directory,filename);
  try {const handle=await open(temp,'wx',0o600);try{await handle.writeFile(JSON.stringify(data));await handle.sync();}finally{await handle.close();}await link(temp,dest);return true;}
  catch(error){if(error.code==='EEXIST')return false;throw error;}
  finally{await unlink(temp).catch(()=>{});}
 }
 return {
  async submit(id,input) {
   if(!/^[a-f0-9-]{36}$/.test(id))throw Error('INVALID_ID');
   const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
   const record={id,code:'SCL-Q-'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),state:'RECEIVED_LOCAL',createdAt:new Date().toISOString(),fingerprint,...input};
   if(await atomicFile(`${id}.json`,record))return {code:record.code,created:true};
   const existing=JSON.parse(await readFile(join(directory,`${id}.json`),'utf8'));
   if(existing.fingerprint!==fingerprint){const error=Error('SUBMISSION_CONFLICT');error.status=409;throw error;}
   return {code:existing.code,created:false};
  },
  async requestInvitation(id) {
   if(!/^[a-f0-9-]{36}$/.test(id))throw Error('INVALID_ID');
   await readFile(join(directory,`${id}.json`),'utf8');
   await atomicFile(`${id}.portal-interest.json`,{inquiryId:id,purpose:'PORTAL_LAUNCH_INVITATION',requestedAt:new Date().toISOString()});
  }
 };
}
