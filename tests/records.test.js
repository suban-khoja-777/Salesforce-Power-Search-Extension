import test from 'node:test';
import assert from 'node:assert/strict';
import {baseQuery,validateQuery,fieldSuggestions,insertField,flattenRecord,resultColumns,filterRows,csvText,recordUrl} from '../lib/records.js';
import {createQueryService} from '../lib/query-service.js';
const id='001000000000001AAA',id2='001000000000002AAA';
const conn={cacheKey:'session-one',pageOrigin:'https://acme.lightning.force.com',orgLabel:'Acme'};
function fixture(){let time=100,calls=[],response={records:[{Id:id,Name:'Acme',attributes:{type:'Account'}}],done:true,totalSize:1};const service=createQueryService(async(c,path,method)=>{calls.push({path,method});if(method==='DELETE')return [{id,success:true}];if(path.endsWith('/sobjects/'))return {sobjects:[{name:'Account',queryable:true},{name:'pkg__Thing__c',queryable:true}]};if(path.endsWith('/describe/'))return {keyPrefix:'001',deletable:true,fields:[{name:'Id',type:'id'},{name:'Name',type:'string'},{name:'pkg__Field__c',type:'string'}]};return response;},()=>time);return {service,calls,setResponse:r=>response=r,expire:()=>time+=1000000};}
test('SOQL validation binds outer object, skips literals/comments, blocks managed fields and mutations',()=>{
 assert.equal(baseQuery('Account'),'SELECT Id FROM Account');assert.ok(validateQuery("SELECT Id,(SELECT Id FROM Contacts) FROM Account WHERE Name='FROM Contact; FOR UPDATE'",'Account'));
 for(const q of ['DELETE FROM Account','SELECT Id FROM Contact','SELECT Id FROM Account FOR UPDATE','SELECT Id FROM Account FOR VIEW','SELECT pkg__Value__c FROM Account','SELECT Id FROM Account;','SELECT Id FROM Account WHERE Name = \'oops'])assert.throws(()=>validateQuery(q,'Account'));
 assert.throws(()=>baseQuery('pkg__Thing__c'));assert.ok(validateQuery('/* FROM Contact */ SELECT Id FROM Account','Account'));
});
test('field suggestions and caret replacement exclude literals and object position',()=>{
 const fields=[{name:'Name',label:'Account Name'},{name:'Id',label:'ID'}];assert.deepEqual(fieldSuggestions('SELECT Na',9,fields),[fields[0]]);assert.deepEqual(insertField('SELECT Na FROM Account',9,'Name'),{query:'SELECT Name FROM Account',caret:11});assert.deepEqual(fieldSuggestions('SELECT Id FROM Ac',17,fields),[]);assert.deepEqual(fieldSuggestions("SELECT Id FROM Account WHERE Name = 'Na",38,fields),[]);
});
test('relationships flatten, values search, CSV escapes and record URLs stay on Salesforce',()=>{
 const row=flattenRecord({Id:id,attributes:{type:'Account'},Owner:{Name:'Alex'},Enabled:false,Amount:0,Description:'=1+1'}),columns=resultColumns([row]);assert.ok(columns.includes('Owner.Name'));assert.ok(!columns.includes('attributes.type'));assert.equal(filterRows([row],'false',columns).length,1);assert.equal(filterRows([row],'alex',columns).length,1);
 const csv=csvText([row,{Description:'a,"b"\nc'}],['Description','Amount']);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('"a,""b""\nc"'));assert.ok(csv.includes('"0"'));assert.equal(recordUrl(conn.pageOrigin,'Account',id),`${conn.pageOrigin}/lightning/r/Account/${id}/view`);assert.throws(()=>recordUrl('https://evil.test','Account',id));assert.throws(()=>recordUrl('https://user@acme.lightning.force.com','Account',id));
});
test('deletion requires loaded IDs, owner tab/session, typed and one-use confirmation',async()=>{
 const f=fixture(),s=f.service;assert.deepEqual((await s.objects(conn)).map(o=>o.name),['Account']);assert.deepEqual((await s.describe(conn,'Account')).fields.map(f=>f.name),['Id','Name']);const run=await s.run(conn,1,'Account','SELECT Id, Name FROM Account');assert.deepEqual(run.selectableIds,[id]);
 assert.throws(()=>s.prepareDelete(conn,2,run.queryId,[id]));assert.throws(()=>s.prepareDelete({...conn,cacheKey:'other'},1,run.queryId,[id]));assert.throws(()=>s.prepareDelete(conn,1,run.queryId,[id2]));assert.throws(()=>s.prepareDelete(conn,1,run.queryId,[id,id]));
 const review=s.prepareDelete(conn,1,run.queryId,[id]);await assert.rejects(s.remove(conn,1,review.ticket,'yes'));assert.equal(f.calls.some(c=>c.method==='DELETE'),false);const replacement=s.prepareDelete(conn,1,run.queryId,[id]);await assert.rejects(s.remove(conn,1,review.ticket,'DELETE'));assert.deepEqual((await s.remove(conn,1,replacement.ticket,'DELETE')).results,[{id,success:true}]);await assert.rejects(s.remove(conn,1,replacement.ticket,'DELETE'));assert.throws(()=>s.prepareDelete(conn,1,run.queryId,[id]));
});
test('pagination validates cursors and root records; sessions expire',async()=>{
 const f=fixture(),s=f.service;f.setResponse({records:[],done:false,nextRecordsUrl:'https://evil.test/x'});await assert.rejects(s.run(conn,1,'Account','SELECT Id FROM Account'),/cursor/);f.setResponse({records:[{Id:id,attributes:{type:'Account'}}],done:false,nextRecordsUrl:'/services/data/v65.0/query/cursor-1',totalSize:2});const run=await s.run(conn,1,'Account','SELECT Id FROM Account');f.setResponse({records:[{Id:id2,attributes:{type:'Contact'}}],done:true,totalSize:2});assert.deepEqual((await s.more(conn,1,run.queryId)).selectableIds,[]);f.expire();assert.throws(()=>s.prepareDelete(conn,1,run.queryId,[id]),/expired/);
});
test('10,000 row cap and ticket expiry prevent further requests',async()=>{
 const f=fixture(),s=f.service;f.setResponse({records:Array.from({length:10001},()=>({Id:id,attributes:{type:'Account'}})),done:true,totalSize:10001});const run=await s.run(conn,1,'Account','SELECT Id FROM Account');assert.equal(run.records.length,10000);assert.equal(run.capped,true);await assert.rejects(s.more(conn,1,run.queryId));const ticket=s.prepareDelete(conn,1,run.queryId,[id]);f.expire();await assert.rejects(s.remove(conn,1,ticket.ticket,'DELETE'));assert.equal(f.calls.some(c=>c.method==='DELETE'),false);
});
test('delete errors remain per-record and uncertain outcomes consume the ticket',async()=>{
 let fail=false;const service=createQueryService(async(_conn,path,method)=>{if(method==='DELETE'){if(fail)throw new Error('Network response unavailable');return [{id,success:false,errors:[{statusCode:'INSUFFICIENT_ACCESS_OR_READONLY',message:'private detail'}]}];}if(path.endsWith('/sobjects/'))return {sobjects:[{name:'Account',queryable:true}]};if(path.endsWith('/describe/'))return {keyPrefix:'001',deletable:true,fields:[{name:'Id'}]};return {records:[{Id:id,attributes:{type:'Account'}}],done:true,totalSize:1};});
 const run=await service.run(conn,1,'Account','SELECT Id FROM Account');const first=service.prepareDelete(conn,1,run.queryId,[id]);assert.deepEqual((await service.remove(conn,1,first.ticket,'DELETE')).results,[{id,success:false,error:'INSUFFICIENT_ACCESS_OR_READONLY'}]);const second=service.prepareDelete(conn,1,run.queryId,[id]);fail=true;await assert.rejects(service.remove(conn,1,second.ticket,'DELETE'),/Network/);await assert.rejects(service.remove(conn,1,second.ticket,'DELETE'),/Confirm/);
});

test('field browser adds to the outer SELECT while preserving relationship subqueries and filters',async()=>{
 const {addSelectField}=await import('../lib/records.js');
 assert.equal(addSelectField("SELECT Id, (SELECT Id FROM Contacts) FROM Account WHERE Name = 'FROM elsewhere'",'Name'),"SELECT Id, (SELECT Id FROM Contacts), Name FROM Account WHERE Name = 'FROM elsewhere'");
 assert.equal(addSelectField('SELECT Id, Name FROM Account','Name'),'SELECT Id, Name FROM Account');
 assert.throws(()=>addSelectField('SELECT Id','Name'),/Complete/);
});

test('query metadata requests coalesce across tabs, expire, and isolate sessions',async()=>{
 const f=fixture(),s=f.service;
 await Promise.all([s.objects(conn),s.describe(conn,'Account'),s.describe(conn,'Account')]);
 assert.equal(f.calls.length,2,'one global describe and one object describe for concurrent consumers');
 await s.run(conn,1,'Account','SELECT Id FROM Account');await s.run(conn,2,'Account','SELECT Id FROM Account');
 assert.equal(f.calls.length,4,'warm runs only request query results');
 await s.describe({...conn,cacheKey:'session-two'},'Account');assert.equal(f.calls.length,6);
 f.expire();await s.describe(conn,'Account');assert.equal(f.calls.length,8);
});
test('failed coalesced metadata loads can be retried',async()=>{
 let calls=0;const s=createQueryService(async()=>{calls++;if(calls===1)throw new Error('offline');return {sobjects:[{name:'Account',queryable:true}]};});
 const failures=await Promise.allSettled([s.objects(conn),s.objects(conn)]);assert.ok(failures.every(r=>r.status==='rejected'));assert.equal(calls,1);
 assert.equal((await s.objects(conn))[0].name,'Account');assert.equal(calls,2);
});
