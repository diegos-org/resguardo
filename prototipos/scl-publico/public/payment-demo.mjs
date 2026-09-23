// Browser-only simulation. NEVER use this as a payment or reservation authority.
export function beginDemo({ totalCents, availability = 'UNKNOWN', id = 'DEMO-LOCAL' }) {
 if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || availability !== 'SIMULATED_AVAILABLE') return {state:'BLOCKED',demo:true,canPay:false};
 return {state:'PENDING',demo:true,canPay:false,id,totalCents,currency:'BRL',events:[]};
}
export function eventDemo(previous,event) {
 if(previous.state==='BLOCKED'||!event||typeof event.id!=='string'||!event.id||previous.events.includes(event.id))return previous;
 if(!['browser_return','pending','approved','refused','expired','cancelled'].includes(event.type))return previous;
 // A return URL is not a payment notification, even in this simulation.
 if(event.type==='browser_return')return previous;
 const next={...previous,events:[...previous.events,event.id]};
 if(event.type==='approved') {
  if(previous.state==='CONFIRMED_DEMO')return next;
  if(event.amountCents!==previous.totalCents||event.currency!==previous.currency||event.reference!==previous.id||event.inventoryVerified!==true||previous.state!=='PENDING')return {...next,state:'REVIEW_REQUIRED'};
  return {...next,state:'CONFIRMED_DEMO'};
 }
 if(previous.state!=='PENDING')return next;
 return {...next,state:{pending:'PENDING',refused:'REFUSED',expired:'EXPIRED',cancelled:'CANCELLED'}[event.type]};
}
