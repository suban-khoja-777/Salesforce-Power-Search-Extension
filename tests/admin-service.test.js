import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminService,recordContext,DEFAULT_DEBUG,debugSettings,fieldValue} from '../lib/admin-service.js';
const id='001000000000001AAA',user='005000000000001AAA',conn={cacheKey:'session1',libraryKey:'org:store',orgLabel:'Acme'},tab={id:1,url:`https://acme.lightning.force.com/lightning/r/Account/${id}/view`};
function fixture(){const calls=[],data={};let fail=false,time=Date.parse('2026-10-15T08:00:00Z');const service=createAdminService(async(c,path,method='GET',body,headers)=>{
 calls.push({path,method,body,headers});if(method==='PATCH'){if(fail)throw new Error('Concurrent modification');return {};}
 if(path.includes('/Soap/u/'))return {user_id:user};
 if(path.includes('tooling/query'))return {records:[]};
 if(method==='POST')return {id:path.endsWith('DebugLevel')?'7dl000000000001AAA':'7tf000000000001AAA'};
 if(path.endsWith('/describe/'))return {updateable:true,fields:[{name:'Id',type:'id',updateable:false},{name:'Name',label:'Name',type:'string',updateable:true,nillable:false,length:80},{name:'AnnualRevenue',type:'currency',updateable:true,nillable:true},{name:'Hidden__c',type:'string',updateable:true},{name:'pkg__Value__c',type:'string',updateable:true},{name:'LastModifiedDate',type:'datetime',updateable:false}]};
 return {Id:id,Name:'Acme',AnnualRevenue:100,LastModifiedDate:'2026-10-15T08:00:00Z',pkg__Value__c:'excluded'};
 },{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)},()=>time);return {service,calls,data,fail:()=>fail=true,expire:()=>time+=1000000};}
test('Record context only accepts current Salesforce Lightning record URLs and excludes managed objects',()=>{
 assert.deepEqual(recordContext(tab.url),{objectName:'Account',id});assert.equal(recordContext('https://acme.lightning.force.com/lightning/o/Account/list'),null);
 assert.equal(recordContext(tab.url.replace('Account','pkg__Object__c')),null);assert.throws(()=>recordContext('https://evil.test/lightning/r/Account/'+id+'/view'));
});
test('record reads honor readable fields; save binds session, tab, current record and changed editable fields',async()=>{
 const f=fixture(),loaded=await f.service.read(conn,tab);assert.deepEqual(loaded.fields.map(v=>v.name),['Id','Name','AnnualRevenue','LastModifiedDate']);
 for(const [connection,target] of [[{...conn,cacheKey:'other'},tab],[conn,{...tab,id:2}],[conn,{...tab,url:tab.url.replace(id,'001000000000002AAA')}]])await assert.rejects(f.service.save(connection,target,loaded.snapshot,{Name:'Changed'}),/changed/);
 await assert.rejects(f.service.save(conn,tab,loaded.snapshot,{Id:'bad'}),/read-only/);await assert.rejects(f.service.save(conn,tab,loaded.snapshot,{Name:null}),/cleared/);
 await f.service.save(conn,tab,loaded.snapshot,{Name:'Changed',AnnualRevenue:null});const update=f.calls.at(-1);assert.equal(update.method,'PATCH');assert.deepEqual(update.body,{Name:'Changed',AnnualRevenue:null});assert.equal(update.headers['If-Unmodified-Since'],'Thu, 15 Oct 2026 08:00:00 GMT');
 await assert.rejects(f.service.save(conn,tab,loaded.snapshot,{Name:'Again'}),/changed/);
});
test('expired, failed and uncertain saves require reloading; malformed numbers and fields are rejected',async()=>{
 const f=fixture();let loaded=await f.service.read(conn,tab);f.expire();await assert.rejects(f.service.save(conn,tab,loaded.snapshot,{Name:'Expired'}));
 loaded=await f.service.read(conn,tab);await assert.rejects(f.service.save(conn,tab,loaded.snapshot,{AnnualRevenue:NaN}));assert.throws(()=>fieldValue({type:'boolean',name:'Active'},'false'));
 f.fail();await assert.rejects(f.service.save(conn,tab,loaded.snapshot,{Name:'Changed'}),/Concurrent/);await assert.rejects(f.service.save(conn,tab,loaded.snapshot,{Name:'Retry'}),/changed/);
});
test('debug preferences validate and persist; only authenticated current user gets a trace flag',async()=>{
 const f=fixture();assert.deepEqual(await f.service.settings(conn),DEFAULT_DEBUG);await f.service.settings(conn,{...DEFAULT_DEBUG,minutes:60});
 const result=await f.service.enableDebug(conn);assert.equal(result.userId,user);assert.equal(result.expiration,'2026-10-15T09:00:00.000Z');
 const trace=f.calls.find(c=>c.method==='POST'&&c.path.endsWith('TraceFlag'));assert.equal(trace.body.TracedEntityId,user);assert.equal(trace.body.LogType,'USER_DEBUG');
 assert.throws(()=>debugSettings({...DEFAULT_DEBUG,minutes:999}));assert.throws(()=>debugSettings({minutes:30,levels:{ApexCode:'INVALID'}}));assert.doesNotMatch(JSON.stringify(f.data),/session1|TracedEntityId/);
});
test('existing current-user trace flag is updated without changing a shared debug level',async()=>{
 const calls=[];const service=createAdminService(async(c,path,method='GET',body)=>{calls.push({path,method,body});if(path.includes('/Soap/u/'))return {user_id:user};if(path.includes('tooling/query'))return {records:[{Id:decodeURIComponent(path).includes('FROM DebugLevel')?'7dl000000000001AAA':'7tf000000000001AAA'}]};return {};},{get:async()=>({}),set:async()=>{}});
 await service.enableDebug(conn);assert.equal(calls.filter(c=>c.method==='POST'&&!c.path.includes('/Soap/u/')).length,0);assert.ok(calls.at(-1).path.endsWith('TraceFlag/7tf000000000001AAA'));assert.equal(calls.at(-1).method,'PATCH');
});
