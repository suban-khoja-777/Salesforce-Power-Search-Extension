import test from 'node:test';
import assert from 'node:assert/strict';
import { launchPalette } from '../lib/launcher.js';
const tab = { id: 17, url: 'https://acme.lightning.force.com/lightning/setup/SetupOneHome/home' };

test('toolbar opens an already-initialized content script in the top frame', async () => {
    let injected = false;
    const browser = {
        tabs: { sendMessage: async (id, message, options) => {
            assert.equal(id, 17); assert.ok(['POWER_SEARCH_VERSION','TOGGLE_POWER_SEARCH_V080'].includes(message.type)); assert.equal(options.frameId, 0);
            return { ok: true, version: '0.11.0' };
        } },
        scripting: { executeScript: async () => { injected = true; } }
    };
    assert.deepEqual(await launchPalette(browser, tab), { ok: true });
    assert.equal(injected, false);
});
test('pre-install tabs get a script injected and a retried launch', async () => {
    let sends = 0, injections = 0;
    const browser = {
        tabs: { sendMessage: async () => { if (++sends === 1) throw new Error('Receiving end does not exist.'); return { ok: true, version: '0.11.0' }; } },
        scripting: { executeScript: async (options) => { injections++; assert.deepEqual(options, { target: { tabId: 17, frameIds: [0] }, files: ['content.js'] }); } }
    };
    await launchPalette(browser, tab);
    assert.equal(sends, 2); assert.equal(injections, 1);
});
test('old scripts that never acknowledged the request are upgraded', async () => {
    let sends = 0, injected = false;
    await launchPalette({
        tabs: { sendMessage: async () => (++sends === 1 ? undefined : { ok: true }) },
        scripting: { executeScript: async () => { injected = true; } }
    }, tab);
    assert.equal(injected, true);
});
test('unsupported tabs and withheld site access produce actionable errors', async () => {
    await assert.rejects(launchPalette({}, { id: 17, url: 'http://127.0.0.1:4175' }), /Salesforce Lightning or Setup/);
    await assert.rejects(launchPalette({
        tabs: { sendMessage: async () => { throw new Error('No receiver'); } },
        scripting: { executeScript: async () => { throw new Error('Permission withheld'); } }
    }, tab), /Allow the extension access/);
});
test('a failed second handshake is reported instead of silently succeeding', async () => {
    await assert.rejects(launchPalette({ tabs: { sendMessage: async () => undefined }, scripting: { executeScript: async () => {} } }, tab), /did not respond/);
});
test('toolbar recognizes the reported developer-org Lightning hostname', async () => {
    let requested = false;
    await launchPalette({ tabs: { sendMessage: async () => { requested = true; return { ok: true, version: '0.11.0' }; } } }, {
        id: 17, url: 'https://orgfarm-46a239f8ce-dev-ed.develop.lightning.force.com/lightning/o/Case/list'
    });
    assert.equal(requested, true);
});

test('legacy hosts that acknowledge launches are still upgraded by version',async()=>{
 const sent=[];let injected=false;
 await launchPalette({tabs:{sendMessage:async(_id,message)=>{sent.push(message.type);return {ok:true};}},scripting:{executeScript:async()=>{injected=true;}}},tab);
 assert.equal(injected,true);assert.deepEqual(sent,['POWER_SEARCH_VERSION','TOGGLE_POWER_SEARCH_V080']);
});
