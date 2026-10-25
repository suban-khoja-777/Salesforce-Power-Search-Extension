import test from 'node:test';
import assert from 'node:assert/strict';
import { salesforceContext, safeApiUrl, readCategory, normalizeRecord, apiError } from '../lib/salesforce.js';

test('Lightning, Setup and sandbox domains map to the same API org', () => {
    for (const url of ['https://acme.lightning.force.com/lightning/page/home', 'https://acme.my.salesforce-setup.com/lightning/setup/SetupOneHome/home', 'https://acme.my.salesforce.com/']) {
        assert.equal(salesforceContext(url).apiOrigin, 'https://acme.my.salesforce.com');
    }
    assert.equal(salesforceContext('https://acme--dev.sandbox.lightning.force.com/').apiOrigin, 'https://acme--dev.sandbox.my.salesforce.com');
});
test('arbitrary, lookalike, insecure and credential-bearing origins are rejected', () => {
    for (const url of ['https://example.com', 'https://acme.my.salesforce.com.evil.test', 'http://acme.my.salesforce.com', 'https://user:pass@acme.my.salesforce.com', 'https://login.salesforce.com', 'https://acme.my.salesforce.com:8443']) assert.throws(() => salesforceContext(url));
});
test('developer org domains work across Lightning, API and Setup', () => {
    const org = 'orgfarm-46a239f8ce-dev-ed.develop';
    for (const domain of ['lightning.force.com', 'my.salesforce.com', 'my.salesforce-setup.com']) {
        const context = salesforceContext(`https://${org}.${domain}/lightning/o/Case/list`);
        assert.equal(context.apiOrigin, `https://${org}.my.salesforce.com`);
        assert.match(context.orgLabel, /developer org/);
    }
    assert.equal(safeApiUrl(`https://${org}.my.salesforce.com`, '/services/data/v65.0/query?q=test'), `https://${org}.my.salesforce.com/services/data/v65.0/query?q=test`);
});
test('API pagination cannot escape its origin or access other resources', () => {
    const origin = 'https://acme.my.salesforce.com';
    assert.equal(safeApiUrl(origin, '/services/data/v65.0/query/abc-2000'), `${origin}/services/data/v65.0/query/abc-2000`);
    for (const path of ['https://evil.test/services/data/v65.0/query', '//other.my.salesforce.com/services/data/v65.0/query', '/services/data/v65.0/sobjects/Account/001abc', '/secur/logout.jsp', '/services/data/v65.0/query/../../sobjects/Account/']) assert.throws(() => safeApiUrl(origin, path));
});
test('Apex pagination returns all pages and never queries source bodies', async () => {
    const calls = [];
    const entries = await readCategory('apex', async (url) => {
        calls.push(url);
        return calls.length === 1 ? { records: [{ Id: '01p000000000001AAA', Name: 'AccountService', NamespacePrefix: null }], done: false, nextRecordsUrl: '/services/data/v65.0/query/next' }
            : { records: [{ Id: '01p000000000002AAA', Name: 'BillingService', NamespacePrefix: 'pkg' }], done: true };
    });
    assert.equal(calls.length, 2);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].apiName, 'AccountService');
    assert.doesNotMatch(decodeURIComponent(calls[0]), /Body/);
});
test('incomplete, looping and malformed pagination is rejected', async () => {
    await assert.rejects(readCategory('apex', async () => ({ records: [], done: false })), /incomplete/);
    await assert.rejects(readCategory('apex', async () => ({ records: [], done: false, nextRecordsUrl: '/same' })), /pagination limit/);
    await assert.rejects(readCategory('apex', async () => ({})), /Unexpected/);
    await assert.rejects(readCategory('flow', async () => ({})), /Unsupported/);
});
test('object normalization, namespace inference and deprecation filtering', async () => {
    const objects = await readCategory('object', async () => ({ sobjects: [{ name: 'pkg__Invoice__c', label: 'Invoices' }, { name: 'Old__c', deprecatedAndHidden: true }, { name: 'Invoice__c', label: 'Local invoices' }] }));
    assert.equal(objects.length, 1);
    assert.equal(objects[0].apiName, 'Invoice__c');
    assert.equal(objects[0].namespace, null);
    assert.equal(normalizeRecord({ name: 'Invoice__c' }, 'object').namespace, null);
});
test('API errors give useful guidance without echoing raw response messages', () => {
    assert.match(apiError(401, [{ message: 'SECRET', errorCode: 'INVALID_SESSION_ID' }]), /session/);
    assert.match(apiError(403, []), /API/);
    assert.match(apiError(429, []), /limit/);
    assert.doesNotMatch(apiError(500, [{ message: 'SECRET' }]), /SECRET/);
});
test('recent records preserve recency and expose only navigation names', async () => {
    const entries = await readCategory('recentrecord', async path => {
        const query = new URL(path,'https://acme.my.salesforce.com').searchParams.get('q');
        assert.match(query,/FROM RecentlyViewed/); assert.match(query,/ORDER BY LastViewedDate DESC LIMIT 100/);
        return {records:[{Id:'500000000000001AAA',Type:'Case',Name:'Intake',LastViewedDate:'2026-10-10',Secret:'DO_NOT_COPY'}]};
    });
    assert.equal(entries[0].recordType,'Case'); assert.equal(entries[0].recentRank,0);
    assert.doesNotMatch(JSON.stringify(entries),/DO_NOT_COPY/);
});
test('queues, public groups and roles use explicit read-only query scopes', async () => {
    for (const [type,scope] of [['queue',"Type = 'Queue'"],['group',"Type = 'Regular'"],['role','FROM UserRole']]) {
        const entries = await readCategory(type,async path => {
            const query = new URL(path,'https://acme.my.salesforce.com').searchParams.get('q');
            assert.ok(query.includes(scope)); assert.doesNotMatch(query,/NamespacePrefix/);
            return {records:[{Id:'00G000000000001AAA',Name:'Support',DeveloperName:'Support_Queue'}],done:true};
        });
        assert.equal(entries[0].apiName,'Support_Queue');
    }
});

test('users query names and usernames with status, paginates, and strips other attributes', async () => {
    const calls = [];
    const users = await readCategory('user', async path => {
        calls.push(path);
        if (calls.length === 1) {
            const query = new URL(path,'https://acme.my.salesforce.com').searchParams.get('q');
            assert.equal(query,'SELECT Id, Name, Username, IsActive, CreatedDate, CreatedBy.Name, LastModifiedDate, LastModifiedBy.Name FROM User ORDER BY Id');
            return {records:[{Id:'005000000000001AAA',Name:'Alex Morgan',Username:'alex@example.test',IsActive:true,Secret:'DO_NOT_COPY'}],done:false,nextRecordsUrl:'/services/data/v65.0/query/next-users'};
        }
        return {records:[{Id:'005000000000002AAA',Name:'Taylor Reed',Username:'taylor@example.test',IsActive:false}],done:true};
    });
    assert.equal(users.length,2); assert.equal(users[1].isActive,false);
    assert.equal(users[0].apiName,'alex@example.test'); assert.doesNotMatch(JSON.stringify(users),/DO_NOT_COPY/);
});

test('recent records enrich audit values in bounded object queries and retain entries on denied audit access',async()=>{
 const entries=await readCategory('recentrecord',async path=>{const q=new URL(path,'https://a.test').searchParams.get('q');if(q.includes('FROM RecentlyViewed'))return {records:[{Id:'001000000000001AAA',Type:'Account',Name:'Acme'},{Id:'003000000000001AAA',Type:'Contact',Name:'Private'}]};if(q.includes('FROM Contact'))throw new Error('Denied');assert.match(q,/WHERE Id IN/);return {records:[{Id:'001000000000001AAA',CreatedDate:'2026-10-01',CreatedBy:{Name:'Alex'},LastModifiedDate:'2026-10-15',LastModifiedBy:{Name:'Taylor'}}]};});
 assert.equal(entries.length,2);assert.equal(entries[0].createdBy,'Alex');assert.equal(entries[0].lastModifiedBy,'Taylor');assert.equal(entries[1].id,'003000000000001AAA');
});
