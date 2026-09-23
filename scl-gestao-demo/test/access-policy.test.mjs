import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../access-policy.mjs';
const session = {subjectId:'DEMO-USER', organizationId:'DEMO-ORG', role:'owner', revoked:false, expiresAt:2000, propertyIds:['DEMO-01']};
const resource = {organizationId:'DEMO-ORG', propertyId:'DEMO-01'};
const decide = (s=session,r=resource,action='finance:read',now=1000) => authorize({session:s,resource:r,action,now}).allowed;
test('owner reads assigned property but cannot read another property or organization',()=>{
 assert.equal(decide(),true);
 assert.equal(decide(session,{...resource,propertyId:'DEMO-02'}),false);
 assert.equal(decide(session,{...resource,organizationId:'OTHER'}),false);
 assert.equal(decide({...session,propertyIds:['*']}),false);
});
test('operator cannot read finance or edit property; admin is still organization scoped',()=>{
 assert.equal(decide({...session,role:'operator'}),false);
 assert.equal(decide({...session,role:'operator'},resource,'reservation:read'),true);
 assert.equal(decide({...session,role:'operator'},resource,'property:edit'),false);
 assert.equal(decide({...session,role:'admin'},resource,'property:edit'),true);
 assert.equal(decide({...session,role:'admin'},{...resource,organizationId:'OTHER'}),false);
});
test('revoked, expired and incomplete sessions deny access',()=>{
 for(const patch of [{revoked:true},{revoked:undefined},{expiresAt:1000},{expiresAt:NaN},{subjectId:''},{organizationId:''},{role:'guest'},{role:'constructor'},{role:'__proto__'}]) assert.equal(decide({...session,...patch}),false);
 assert.equal(authorize().allowed,false);
 assert.equal(decide(session,resource,'unknown'),false);
 assert.equal(decide(session,resource,'finance:read',NaN),false);
});
test('owner writes remain denied pending authorized mutation and audit design',()=>{
 for(const action of ['property:edit','reservation:cancel','calendar:write','pricing:write','payment:refund']) assert.equal(decide(session,resource,action),false);
});

test('malformed roles cannot be coerced into privileges or bypass owner scope',()=>{
 for(const role of [['admin'],['owner'],new String('owner'),{toString:()=> 'admin'}]) {
  assert.equal(decide({...session,role}, {...resource,propertyId:'DEMO-OTHER'}),false);
 }
});

