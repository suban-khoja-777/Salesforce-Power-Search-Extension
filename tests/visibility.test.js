import test from 'node:test';
import assert from 'node:assert/strict';
import { isManaged, localEntries } from '../lib/visibility.js';
import { prepareEntry, searchEntries, destinationFor } from '../lib/search.js';

test('managed items stay excluded from All, typed search, history and record results', () => {
    const entries = [
        {type:'apex',id:'01p000000000001AAA',apiName:'pkg__Service',label:'Service',namespace:'pkg'},
        {type:'recentcomponent',targetType:'lwc',id:'0Rb000000000001AAA',apiName:'pkg__Widget',label:'Widget'},
        {type:'recentrecord',recordType:'pkg__Invoice__c',id:'a00000000000001AAA',apiName:'Invoice · Managed',label:'Managed'},
        {type:'object',id:'Invoice__c',apiName:'Invoice__c',label:'Local invoices'},
        {type:'object',id:'Account',apiName:'Account',label:'Accounts'}
    ].map(prepareEntry);
    assert.equal(localEntries(entries).length,2);
    for (const category of ['all','apex','recentcomponent','recentrecord']) {
        assert.ok(searchEntries(entries,'',{category,hideManaged:false}).every(entry=>!isManaged(entry)));
    }
    assert.deepEqual(searchEntries(entries,'apex: Service',{hideManaged:false}),[]);
    assert.throws(()=>destinationFor(entries[0]), /Managed package/);
    assert.equal(isManaged({type:'flow',apiName:'Local_Flow',manageableState:'installed'}),true);
    assert.equal(isManaged({type:'object',apiName:'Invoice__c'}),false);
    assert.equal(isManaged({type:'object',apiName:'Settings__mdt'}),false);
});
