import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../app/palette.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://127.0.0.1:4175/app/palette.html', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, parent: dom.window, ResizeObserver: class { observe() {} } });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
await import('../app/palette.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const loaded = async () => { for (let i = 0; i < 100 && document.querySelector('#status').textContent !== 'Preview · sample metadata'; i++) await tick(); await tick(); };
await loaded();

test('palette defaults to All with recent components first with actual types, supplied icon, and no autofocus', () => {
    assert.equal(document.querySelector('[data-category="all"]').getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelector('#heading').textContent, 'RECENT & SUGGESTED');
    assert.equal(document.querySelector('#results .result-type').textContent, 'Apex class');
    assert.equal(document.querySelector('#search').hasAttribute('autofocus'), false);
    assert.equal(document.querySelector('.brand-logo').getAttribute('src'), '../assets/logo.png');
    assert.equal(document.querySelectorAll('#filters button').length, 19);
    assert.equal(document.querySelector('#filters button').dataset.category, 'all');
    assert.equal(document.querySelector('#local'), null);
    assert.equal(document.querySelector('[data-category="recentcomponent"]'), null);
    assert.ok(document.querySelector('[data-category="user"]'));
    const serviceRows = [...document.querySelectorAll('#results .result')].filter(row => row.textContent.includes('AccountService') && !row.textContent.includes('AccountServiceTest'));
    assert.equal(serviceRows.length, 1);
    assert.equal(document.querySelector('[data-category="field"]'), null);
    assert.equal(document.querySelector('#load-object'), null);
});
test('category tabs filter results and clicking a component defaults to a new tab', async () => {
    document.querySelector('[data-category="flow"]').click();
    assert.equal(document.querySelector('#results .result-type').textContent, 'Flow');
    document.querySelector('#results .result').click(); await tick();
    assert.match(document.querySelector('#status').textContent, /Would open Account_Onboarding in a new tab/);
    document.querySelector('[data-category="recentrecord"]').click(); await tick(); await tick();
    assert.match(document.querySelector('#results').textContent, /RFQ intake request/);
    document.querySelector('[data-category="all"]').click(); await tick(); await tick();
    assert.equal(document.querySelector('#results .result-type').textContent, 'Flow');
});
test('Ctrl+Space closes the palette while the search input is focused', () => {
    const event = new dom.window.KeyboardEvent('keydown', { code: 'Space', key: ' ', ctrlKey: true, bubbles: true, cancelable: true });
    document.querySelector('#search').dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.match(document.querySelector('#status').textContent, /Escape closes the overlay/);
});

test('users search names and usernames and all three view choices are saved', async () => {
    document.querySelector('[data-category="user"]').click();
    const input = document.querySelector('#search'); input.value = 'taylor.reed'; input.dispatchEvent(new dom.window.Event('input'));
    assert.match(document.querySelector('#results').textContent, /Taylor Reed/);
    assert.match(document.querySelector('#results').textContent, /Inactive user/);
    for (const mode of ['sidebar','fullpage','popup']) {
        const selector = document.querySelector('#view-mode'); selector.value = mode; selector.dispatchEvent(new dom.window.Event('change')); await tick();
        assert.equal(document.body.dataset.mode,mode);
        assert.equal(window.localStorage.getItem('displayMode'),mode);
    }
});

test('Query Records opens from palette and returns to metadata search',async()=>{
 globalThis.Option=dom.window.Option;
 document.querySelector('#query-open').click();await tick();await tick();assert.equal(document.body.dataset.workspace,'query');assert.equal(document.querySelector('#query-open').getAttribute('aria-selected'),'true');assert.equal(document.querySelector('#search-tab').getAttribute('aria-selected'),'false');assert.equal(document.querySelector('#query-workspace').hidden,false);assert.equal(document.querySelector('#query-object').options.length,3);
 document.querySelector('#search-tab').click();assert.equal(document.body.dataset.workspace,'search');assert.equal(document.querySelector('#query-workspace').hidden,true);
});
