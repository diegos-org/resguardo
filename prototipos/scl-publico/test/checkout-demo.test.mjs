import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDemoQuote } from '../src/checkout-demo.mjs';
const values={property:'102',checkin:new Date(Date.now()+86400000*7).toISOString().slice(0,10),checkout:new Date(Date.now()+86400000*9).toISOString().slice(0,10),guests:'2'};
test('fictitious quotation calculates integer totals from server fixtures, ignoring URL prices',()=>{
 const q=evaluateDemoQuote(new URLSearchParams({...values,total:'1',nightlyCents:'1'}));assert.equal(q.totalCents,102000);assert.equal(q.nights,2);assert.equal(q.canPay,false);assert.equal(q.demo,true);
});
test('revalidation scenarios never enable payments or create bookings',()=>{
 for(const [scenario,state] of [['price_changed','PRICE_CHANGED'],['unavailable','UNAVAILABLE'],['unknown','UNKNOWN'],['expired','EXPIRED']]){const q=evaluateDemoQuote(new URLSearchParams({...values,scenario}));assert.equal(q.state,state);assert.equal(q.canPay,false);if(scenario==='price_changed'){assert.equal(q.totalCents,108000);assert.equal(q.previousTotalCents,102000);}else assert.equal(q.totalCents,undefined);}
});
test('demo validates capacity, dates and duplicate scenario',()=>{
 assert.equal(evaluateDemoQuote(new URLSearchParams({...values,guests:'6'})).state,'INVALID');assert.equal(evaluateDemoQuote(new URLSearchParams({...values,checkout:values.checkin})).state,'INVALID');const p=new URLSearchParams(values);p.append('scenario','quote');p.append('scenario','unknown');assert.equal(evaluateDemoQuote(p).state,'INVALID');
});
