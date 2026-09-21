import test from 'node:test';
import assert from 'node:assert/strict';
import {beginDemo,eventDemo} from '../public/payment-demo.mjs';
import {paymentDemo} from '../src/payment-demo-view.mjs';
import {evaluateDemoQuote} from '../src/checkout-demo.mjs';
const start=()=>beginDemo({totalCents:102000,availability:'SIMULATED_AVAILABLE',id:'DEMO-test'});
const approved={id:'event-1',type:'approved',amountCents:102000,currency:'BRL',reference:'DEMO-test',inventoryVerified:true};
test('unknown availability and invalid amounts block simulation',()=>{
 for(const totalCents of [0,-1,1.5,NaN,Infinity,'102000'])assert.equal(beginDemo({totalCents,availability:'SIMULATED_AVAILABLE'}).state,'BLOCKED');
 assert.equal(beginDemo({totalCents:102000}).state,'BLOCKED');
});
test('browser return alone never confirms; valid fixture confirms only demo',()=>{
 const s=start();assert.deepEqual(eventDemo(s,{id:'return',type:'browser_return'}),s);
 const confirmed=eventDemo(s,approved);assert.equal(confirmed.state,'CONFIRMED_DEMO');assert.equal(confirmed.canPay,false);assert.equal(confirmed.demo,true);
 assert.deepEqual(eventDemo(confirmed,approved),confirmed);
 assert.equal(eventDemo(confirmed,{id:'late',type:'pending'}).state,'CONFIRMED_DEMO');
});
test('wrong amount, currency, reference or unverified inventory requires review',()=>{
 for(const patch of [{amountCents:1},{currency:'USD'},{reference:'different'},{inventoryVerified:false}])assert.equal(eventDemo(start(),{...approved,...patch}).state,'REVIEW_REQUIRED');
});
test('late payment after expiry, refusal or cancellation never confirms automatically',()=>{
 for(const type of ['expired','refused','cancelled']){const s=eventDemo(start(),{id:'prior',type});assert.equal(eventDemo(s,approved).state,'REVIEW_REQUIRED');}
});
test('only valid fixture quote exposes simulator; real integration remains absent',()=>{
 const checkin=new Date(Date.now()+7*86400000).toISOString().slice(0,10),checkout=new Date(Date.now()+9*86400000).toISOString().slice(0,10);
 const params={property:'102',guests:'2',checkin,checkout};
 const html=paymentDemo(evaluateDemoQuote(new URLSearchParams(params)));assert.match(html,/data-payment-demo/);assert.match(html,/SEM COBRANÇA/);assert.doesNotMatch(html,/<input[^>]+(?:email|card|cpf)/i);
 for(const scenario of ['unknown','unavailable','expired','price_changed'])assert.doesNotMatch(paymentDemo(evaluateDemoQuote(new URLSearchParams({...params,scenario}))),/data-payment-demo/);
});
