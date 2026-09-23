import { validateSearch } from './availability.mjs';
// Isolated fictitious fixtures. This module must never back a real quotation.
export function evaluateDemoQuote(params) {
 const {errors,query}=validateSearch(params);
 const scenario=params.get('scenario')||'quote';
 if(params.getAll('scenario').length>1||!['quote','price_changed','unavailable','unknown','expired'].includes(scenario))errors.push('Cenário de demonstração inválido.');
 if(errors.length)return {demo:true,canPay:false,state:'INVALID',errors};
 if(!query.property)return {demo:true,canPay:false,state:'INVALID',errors:['Escolha um imóvel para a demonstração.']};
 const nights=(Date.parse(query.checkout)-Date.parse(query.checkin))/86400000;
 const base={demo:true,canPay:false,property:query.property,checkin:query.checkin,checkout:query.checkout,guests:query.guests,nights,currency:'BRL'};
 if(scenario==='unavailable')return {...base,state:'UNAVAILABLE',message:'Neste cenário fictício, as datas deixaram de estar disponíveis. Escolha outras datas.'};
 if(scenario==='unknown')return {...base,state:'UNKNOWN',message:'Neste cenário fictício, não foi possível revalidar a disponibilidade. Tente novamente; nenhum pagamento foi iniciado.'};
 if(scenario==='expired')return {...base,state:'EXPIRED',message:'Esta cotação de demonstração expirou. Uma nova cotação seria necessária antes de pagar.'};
 const nightlyCents=scenario==='price_changed'?45000:42000,cleaningCents=18000;
 return {...base,state:scenario==='price_changed'?'PRICE_CHANGED':'QUOTE',nightlyCents,cleaningCents,accommodationCents:nights*nightlyCents,totalCents:nights*nightlyCents+cleaningCents,previousTotalCents:scenario==='price_changed'?nights*42000+cleaningCents:null};
}
