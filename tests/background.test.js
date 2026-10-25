import test from 'node:test';
import assert from 'node:assert/strict';

let sameTabUpdates = 0;
let listener, sessionToken = 'FAKE_TEST_SESSION', fetchCount = 0;
const storage = {}, preferences = {}, navigations = [];
const tab = { id: 1, url: 'https://acme.lightning.force.com/lightning/page/home' };
globalThis.chrome = {
    runtime: { id: 'test-extension', getURL: (path) => `chrome-extension://test-extension/${path}`, onMessage: { addListener: (fn) => { listener = fn; } } },
    cookies: { getAllCookieStores: async () => [{ id: 'default', tabIds: [1] }], get: async () => ({ value: sessionToken }) },
    storage: { local: {get:async key => ({[key]:preferences[key]}), set:async value => Object.assign(preferences,value)}, session: { get: async (key) => key == null ? { ...storage } : ({ [key]: storage[key] }), set: async (value) => Object.assign(storage, value), remove: async (keys) => keys.forEach((key) => delete storage[key]) } },
    tabs: { get: async () => tab, query: async () => [tab], sendMessage: async () => ({ ok: true, version: '0.11.0' }), update: async (id, options) => { sameTabUpdates++; navigations.push(options.url); }, create: async (options) => navigations.push(options.url) },
    action: { onClicked: { addListener() {} } }, commands: { onCommand: { addListener() {} } }
};
globalThis.fetch = async (url, options) => {
    fetchCount++;
    assert.equal(new URL(url).origin, 'https://acme.my.salesforce.com');
    assert.equal(options.redirect, 'error');
    if (url.includes('/services/Soap/')) {
        assert.match(options.body, new RegExp(sessionToken));
        assert.equal(options.method, 'POST');
        const operation = options.headers.SOAPAction;
        assert.ok(['describeMetadata', 'listMetadata'].includes(operation));
        const body = operation === 'describeMetadata' ? '<metadataObjects><xmlName>NewPlatformType</xmlName><inFolder>false</inFolder></metadataObjects>' : '<fullName>Account_Widget</fullName><id>0ZZ000000000001AAA</id>';
        return { ok: true, text: async () => `<Envelope><Body><${operation}Response><result>${body}</result></${operation}Response></Body></Envelope>` };
    }
    assert.equal(options.headers.Authorization, `Bearer ${sessionToken}`);
    return { ok: true, json: async () => url.includes('/sobjects/') ? { sobjects: [{ name: 'Account', label: 'Accounts' }] }
        : { records: [{ Id: url.includes('ApexTrigger') ? '01q000000000001AAA' : '01p000000000001AAA', Name: 'AccountService' }], done: true } };
};
await import('../background.js');
const sender = { id: 'test-extension', tab: { id: 1 }, url: 'chrome-extension://test-extension/app/palette.html?parent=x' };
const send = (message, from = sender) => new Promise((resolve) => {
    const accepted = listener(message, from, resolve);
    if (!accepted) resolve(undefined);
});

test('worker validates senders, isolates sessions, caches names, and keeps tokens private', async () => {
    assert.equal(await send({ type: 'GET_INDEX' }, { ...sender, id: 'other-extension' }), undefined);
    assert.equal(await send({ type: 'GET_INDEX' }, { ...sender, url: 'https://acme.lightning.force.com/' }), undefined);
    const popupSender = { id: 'test-extension', url: 'chrome-extension://test-extension/app/launcher.html' };
    assert.deepEqual(await send({ type: 'OPEN_PALETTE' }, popupSender), { ok: true });
    assert.equal(await send({ type: 'GET_INDEX' }, popupSender), undefined);
    assert.equal((await send({type:'GET_VIEW'})).mode, 'popup');
    assert.equal((await send({type:'SET_VIEW',mode:'sidebar'})).ok, true);
    assert.equal((await send({type:'GET_VIEW'})).mode, 'sidebar');
    assert.equal((await send({type:'SET_VIEW',mode:'external-url'})).ok, false);
    assert.equal(preferences.displayMode, 'sidebar');
    const first = await send({ type: 'GET_INDEX' });
    assert.equal(first.ok, true); assert.equal(first.entries.length, 3); assert.equal(fetchCount, 3);
    assert.doesNotMatch(JSON.stringify(first), /FAKE_TEST_SESSION|Bearer|accessToken/);
    assert.doesNotMatch(JSON.stringify(storage), /FAKE_TEST_SESSION|Bearer/);
    assert.equal((await send({ type: 'GET_INDEX' })).cached, true); assert.equal(fetchCount, 3);
    await send({ type: 'GET_INDEX', force: true }); assert.equal(fetchCount, 6);
    sessionToken = 'FAKE_DIFFERENT_USER';
    await send({ type: 'GET_INDEX' }); assert.equal(fetchCount, 9);
    const opened = await send({ type: 'OPEN_ENTRY', entry: { id: 'Account', apiName: 'Account', type: 'object' }, newTab: false });
    assert.equal(opened.ok, true); assert.equal(sameTabUpdates, 0);
    assert.equal(navigations.at(-1), 'https://acme.lightning.force.com/lightning/setup/ObjectManager/Account/Details/view');
    assert.deepEqual((await send({ type: 'GET_INDEX' })).recentKeys, ['object:Account']);
    const catalog = await send({ type: 'GET_CATALOG' });
    assert.equal(catalog.ok, true); assert.ok(catalog.catalog.some((type) => type.key === 'lwc'));
    const metadata = await send({ type: 'GET_CATEGORY', category: 'lwc' });
    assert.equal(metadata.ok, true); assert.equal(metadata.entries[0].apiName, 'Account_Widget');
    const recent = await send({ type: 'GET_CATEGORY', category: 'recentcomponent' });
    assert.equal(recent.entries[0].targetType, 'object');
    assert.equal(recent.entries[0].apiName, 'Account');
    const foreignSession = sessionToken; sessionToken = 'FAKE_THIRD_USER';
    assert.deepEqual((await send({ type: 'GET_CATEGORY', category: 'recentcomponent' })).entries, []);
    sessionToken = foreignSession;
    assert.equal((await send({ type: 'GET_CATEGORY', category: 'field' })).ok, false);
    assert.equal((await send({ type: 'GET_OBJECT_MEMBERS', objectName: 'Account' })).ok, false);
    const restored = await send({ type: 'GET_CATALOG' });
    assert.ok(restored.loadedTypes.includes('lwc'));
    assert.doesNotMatch(JSON.stringify(restored), /FAKE_DIFFERENT_USER|Bearer|sessionId/);
    const managed = { id:'01p000000000009AAA', type:'apex', targetType:'apex', label:'ManagedService', apiName:'pkg__ManagedService', namespace:'pkg' };
    for (const value of Object.values(storage)) if (Array.isArray(value?.entries)) value.entries.push(managed);
    const historyKey = Object.keys(storage).find(key => key.startsWith('components:'));
    storage[historyKey].push(managed);
    assert.ok(!(await send({type:'GET_INDEX'})).entries.some(entry => entry.namespace));
    assert.ok(!(await send({type:'GET_CATALOG'})).cachedEntries.some(entry => entry.namespace));
    assert.ok(!(await send({type:'GET_CATEGORY',category:'lwc'})).entries.some(entry => entry.namespace));
    assert.ok(!(await send({type:'GET_CATEGORY',category:'recentcomponent'})).entries.some(entry => entry.namespace));
    assert.equal(storage[historyKey].length, 1);
    const beforeManaged = navigations.length;
    assert.equal((await send({type:'OPEN_ENTRY',entry:managed})).ok, false);
    assert.equal(navigations.length, beforeManaged);
    const refreshed = await send({ type: 'GET_CATALOG', force: true });
    assert.deepEqual(refreshed.cachedEntries, []);
    assert.deepEqual(refreshed.loadedTypes, []);
    assert.equal(Object.keys(storage).some((key) => key.includes(':category:v3:')), false);
    assert.equal((await send({ type: 'GET_CATEGORY', category: 'arbitrary' })).ok, false);
    const malicious = await send({ type: 'OPEN_ENTRY', entry: { type: 'object', apiName: '//evil.test' } });
    assert.equal(malicious.ok, false);
    const count = navigations.length;
    tab.url = 'https://evil.test';
    assert.equal((await send({ type: 'GET_INDEX' })).ok, false);
    assert.equal(navigations.length, count);
});
