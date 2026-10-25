import test from 'node:test';
import assert from 'node:assert/strict';
import {whereValueSuggestions,insertWhereValue} from '../lib/records.js';
import {createQueryService} from '../lib/query-service.js';
const fields=[{name:'Industry',type:'picklist',picklistValues:[{value:'Technology',label:'Tech'},{value:"Partner's \\ Choice",label:'Partner'},{value:'Legacy',label:'Old',active:false}]},{name:'IsDeleted',type:'boolean'},{name:'Name',type:'string'},{name:'Amount',type:'currency'},{name:'Tags__c',type:'multipicklist',picklistValues:[{value:'A',label:'Alpha'}]}];
const suggest=(query)=>whereValueSuggestions(query,query.length,fields);
test('WHERE suggestions follow field types, with all described picklist values',()=>{
 assert.deepEqual(suggest('SELECT Id FROM Account WHERE Industry').map(s=>s.name),['Technology',"Partner's \\ Choice",'Legacy']);
 for(const operator of ['=','!=','<>'])assert.deepEqual(suggest(`SELECT Id FROM Account WHERE IsDeleted ${operator} `).map(s=>s.name),['true','false']);
 for(const name of ['Name','Amount'])assert.deepEqual(suggest(`SELECT Id FROM Account WHERE ${name} = `).map(s=>s.name),['null']);
 assert.equal(suggest('SELECT Id FROM Account WHERE Industry = Le')[0].name,'Legacy');
 assert.equal(suggest("SELECT Id FROM Account WHERE Industry = 'Par")[0].name,"Partner's \\ Choice");
});
test('completion inserts operators, escaped picklist API values and unquoted boolean/null',()=>{
 for(const [query,expected] of [['SELECT Id FROM Account WHERE Industry',"SELECT Id FROM Account WHERE Industry = 'Technology'"],['SELECT Id FROM Account WHERE IsDeleted ','SELECT Id FROM Account WHERE IsDeleted = true'],['SELECT Id FROM Account WHERE Name = n','SELECT Id FROM Account WHERE Name = null'],['SELECT Id FROM Account WHERE Tags__c',"SELECT Id FROM Account WHERE Tags__c INCLUDES ('A')"]])assert.equal(insertWhereValue(query,suggest(query)[0]).query,expected);
 const q='SELECT Id FROM Account WHERE Industry = ';
 assert.equal(insertWhereValue(q,suggest(q)[1]).query,q+"'Partner\\'s \\\\ Choice'");
 const edit="SELECT Id FROM Account WHERE Industry = 'Technolgy' AND Name = null",caret=edit.indexOf('Technolgy')+4;
 assert.equal(insertWhereValue(edit,whereValueSuggestions(edit,caret,fields)[0]).query,"SELECT Id FROM Account WHERE Industry = 'Technology' AND Name = null");
});
test('completion respects WHERE scope, grouped conditions, IN lists, strings and comments',()=>{
 assert.equal(suggest('SELECT Industry FROM Account'),null);
 assert.equal(suggest('SELECT Id FROM Account ORDER BY Industry'),null);
 assert.equal(suggest('SELECT Id, (SELECT Id FROM Contacts WHERE Industry = '),null);
 assert.deepEqual(suggest('SELECT Id FROM Account WHERE Industry = /* typing'),[]);
 assert.deepEqual(suggest("SELECT Id FROM Account WHERE Name = 'WHERE Industry = "),[]);
 assert.equal(suggest('SELECT Id FROM Account WHERE (IsDeleted = f')[0].name,'false');
 assert.equal(suggest("SELECT Id FROM Account WHERE Industry IN ('Legacy', 'Te")[0].name,'Technology');
 assert.equal(suggest('SELECT Id FROM Account WHERE Owner.Industry = '),null);
});
test('describe preserves only picklist option names, labels and active state',async()=>{
 const service=createQueryService(async(_conn,path)=>path.endsWith('/sobjects/')?{sobjects:[{name:'Account',queryable:true}]}:{fields:[{name:'Industry',type:'picklist',picklistValues:[{value:'API',label:'Display',active:false,validFor:'private',other:'ignored'}]}]});
 const schema=await service.describe({cacheKey:'test'},'Account');assert.deepEqual(schema.fields[0].picklistValues,[{value:'API',label:'Display',active:false}]);
});
