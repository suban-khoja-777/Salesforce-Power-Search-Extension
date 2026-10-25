import {initAdmin} from './admin.js';
import {sampleAdminMessage} from './admin-sample.js';
import {initWorkspaceTabs} from './workspaces.js';
import {initQueryDesk} from './query-desk.js';
import {sampleQueryMessage} from './query-sample.js';
import { displayMode } from '../lib/presentation.js';
import { localEntries } from '../lib/visibility.js';
import { CATEGORIES, prepareEntry, searchEntries, destinationFor, hasDestination, parseQuery } from '../lib/search.js';
import { salesforceContext } from '../lib/salesforce.js';
import { COMMON_TYPES, CORE_TYPES, RECENT_TYPES } from '../lib/catalog.js';

const $ = (selector) => document.querySelector(selector);
const input = $('#search');
const isExtension = location.protocol === 'chrome-extension:';
let parentOrigin;
try { parentOrigin = salesforceContext(new URLSearchParams(location.search).get('parent')).pageOrigin; } catch { parentOrigin = null; }
if (!isExtension && parent !== window) parentOrigin = location.origin;
window.addEventListener('message', (event) => {
    if (event.source === parent && event.origin === parentOrigin && event.data?.type === 'POWER_SEARCH_VIEWPORT' && Number.isFinite(event.data.height)) {
        if (event.data.mode) { document.body.dataset.mode = displayMode(event.data.mode); $('#view-mode').value = displayMode(event.data.mode); $('.palette').setAttribute('aria-modal', String(event.data.mode !== 'sidebar')); }
        document.documentElement.style.setProperty('--palette-height', `${Math.max(1, event.data.height)}px`);
    }
    if (event.source === parent && event.origin === parentOrigin && event.data?.type === 'POWER_SEARCH_FOCUS') (document.body.dataset.workspace==='query' ? (queryWorkspace.editor||$('#query-open')) : input).focus();
});
const state = { entries: [], results: [], recentKeys: [], category: 'all', active: 0, loading: true, errors: [], generation: 0,
    catalog: CATEGORIES, loadedTypes: new Set(), categoryErrors: new Map(), indexing: false, stopIndexing: false, requests: new Map() };
let detailEntry;
const icons = {
    apex: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18"/>',
    trigger: '<path d="m13 2-8 12h6l-1 8 9-13h-7z"/>',
    object: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>'
};
function make(tag, className, text) { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node; }
function mergeEntries(existing, added) {
    return [...new Map(localEntries([...existing, ...added]).map((entry) => [`${entry.type}:${entry.apiName}`, entry])).values()];
}

for (const category of CATEGORIES) {
    const button = make('button', 'filter', category.label);
    button.dataset.category = category.key;
    button.onclick = () => selectCategory(category.key);
    $('#filters').append(button);
}

function render() {
    state.results = searchEntries(state.entries, input.value, state);
    state.active = Math.max(0, Math.min(state.active, state.results.length - 1));
    for (const button of $('#filters').children) {
        const selected = button.dataset.category === state.category;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
    }
    $('#heading').textContent = input.value.trim() ? 'BEST MATCHES' : state.category === 'all' && state.entries.some(entry => entry.type === 'recentcomponent') ? 'RECENT & SUGGESTED' : state.category === 'recentrecord' ? 'RECENTLY VIEWED RECORDS' : 'EXPLORE YOUR ORG';
    $('#count').textContent = state.loading ? 'Loading metadata…' : `${new Set(state.entries.map(entry => `${entry.targetType || entry.type}:${entry.id}`)).size.toLocaleString()} items${state.errors.length ? ' · partial index' : ''}`;
    $('#refresh').disabled = state.loading;
    $('#results').setAttribute('aria-busy', String(state.loading));
    const issues = [...state.errors, ...state.categoryErrors.values()];
    $('#notice').hidden = !issues.length;
    $('#notice').textContent = issues.slice(0, 1).join(' · ') + (issues.length > 1 ? ` · ${issues.length - 1} more notices in Metadata coverage.` : '');
    $('#coverage-count').textContent = `${state.loadedTypes.size}/${state.catalog.length - 1} types indexed${state.indexing ? ' · indexing…' : ''}`;
    $('#index-all').textContent = state.indexing ? 'Pause indexing' : 'Index all types';
    $('#index-all').disabled = state.loading;
    if (!$('#coverage').hidden) {
    const counts = new Map();
    for (const entry of state.entries) counts.set(entry.type, (counts.get(entry.type) || 0) + 1);
    $('#coverage-list').replaceChildren(...state.catalog.filter((type) => type.key !== 'all').map((type) => {
        const count = counts.get(type.key) || 0;
        const status = state.categoryErrors.get(type.key) || (state.loadedTypes.has(type.key) ? `${count} items indexed` : 'Not indexed yet');
        return make('li', '', `${type.label}: ${status}`);
    }));
    }
    $('#results').replaceChildren(...state.results.map((entry, index) => {
        const row = make('div', 'result'); row.id = `result-${index}`; row.role = 'option';
        const icon = make('span', entry.iconClass);
        // Icon markup is a fixed local constant, never Salesforce data.
        icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[entry.targetType || entry.type] || '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>'}</svg>`;
        const copy = make('span', 'result-copy');
        copy.append(make('span', 'result-title', entry.label), make('span', 'result-subtitle', entry.apiName));
        const audit=make('span','result-audit');
        for(const [label,key] of [['Created Date','createdDate'],['Created By','createdBy'],['Last Modified Date','lastModifiedDate'],['Last Modified By','lastModifiedBy']]){const raw=entry[key];const value=raw&&key.endsWith('Date')&&!Number.isNaN(Date.parse(raw))?new Date(raw).toLocaleString():raw||'Unavailable';audit.append(make('span','',`${label}: ${value}`));}
        copy.append(audit);row.append(icon, copy);
        if (entry.recentRank != null && state.category === 'all') copy.append(make('span','recent-badge','Recently opened'));
        if (entry.type === 'user' && entry.isActive === false) copy.append(make('span','recent-badge','Inactive user'));
        if (entry.namespace) row.append(make('span', 'namespace', entry.namespace));
        row.append(make('span', 'result-type', entry.typeLabel), make('span', 'return-symbol', '↵'));
        row.title = hasDestination(entry) ? 'Open this item in a new tab' : 'Show metadata details — direct item link unavailable';
        row.onclick = () => openEntry(entry);
        row.onmousemove = () => { if (state.active !== index) { state.active = index; updateSelection(); } };
        return row;
    }));
    if (!state.results.length) {
        const empty = make('div', 'empty');
        const title = state.loading ? 'Getting to know your org…' : state.errors.length ? 'Couldn’t load your metadata' : state.category === 'recentcomponent' ? 'Your recent components will appear here' : 'No matches yet';
        const activeCategory = parseQuery(input.value, state.category, state.catalog).category;
        const notLoaded = activeCategory !== 'all' && !state.loadedTypes.has(activeCategory);
        const description = state.loading ? 'Loading names from your Salesforce session.' : state.errors.length ? 'Check the connection message above, then refresh to retry.' : notLoaded ? 'This type is loading or could not be indexed. Check Metadata coverage.' : state.category === 'recentcomponent' ? 'Open a component from any category to add it to this session’s recent history.' : 'Try a shorter name or another category. Managed package components are excluded.';
        empty.append(make('span', 'empty-symbol', '⌕'), make('strong', '', title), make('p', '', description));
        $('#results').append(empty);
    }
    updateSelection();
    $('#announcement').textContent = `${state.results.length} results${state.loading ? '. Loading metadata.' : ''}`;
}
function updateSelection() {
    for (const [index, row] of [...document.querySelectorAll('[role="option"]')].entries()) {
        row.classList.toggle('selected', index === state.active);
        row.setAttribute('aria-selected', String(index === state.active));
    }
    if (state.results.length) input.setAttribute('aria-activedescendant', `result-${state.active}`);
    else input.removeAttribute('aria-activedescendant');
}

async function load(force = false) {
    const generation = ++state.generation;
    state.stopIndexing = true; state.indexing = false; state.requests = new Map();
    state.loading = true; state.errors = []; state.entries = []; state.loadedTypes = new Set(); state.categoryErrors = new Map(); render();
    $('#status').textContent = 'Connecting to Salesforce';
    try {
        let result;
        if (isExtension) result = await chrome.runtime.sendMessage({ type: 'GET_INDEX', force });
        else {
            const { sampleIndex } = await import('./sample.js');
            result = { ok: true, entries: sampleIndex, errors: [], orgLabel: 'Sample org', loadedAt: Date.now() };
        }
        if (generation !== state.generation) return;
        if (!result?.ok) throw new Error(result?.error || 'The extension background worker did not respond. Reload the Salesforce tab.');
        state.entries = localEntries(result.entries).filter(entry => entry.type === 'recentcomponent' || COMMON_TYPES.some(type => type.key === entry.type)).map(prepareEntry); state.errors = result.errors;
        CORE_TYPES.forEach((type) => { if (!result.errors.some((error) => error.startsWith(`${type}:`))) state.loadedTypes.add(type); });
        if (Array.isArray(result.recentKeys)) state.recentKeys = result.recentKeys;
        $('#status').textContent = isExtension ? `${result.orgLabel}${result.cached ? ' · cached' : ''}` : 'Preview · sample metadata';
        $('#status').title = `Index loaded ${new Date(result.loadedAt).toLocaleTimeString()}`;
        let catalogResult;
        if (isExtension) catalogResult = await chrome.runtime.sendMessage({ type: 'GET_CATALOG', force });
        else catalogResult = { ok: true, catalog: COMMON_TYPES, cachedEntries: [], loadedTypes: COMMON_TYPES.map((type) => type.key), errors: [] };
        if (generation !== state.generation) return;
        if (catalogResult?.ok) {
            state.catalog = [{ key: 'all', label: 'All' }, ...catalogResult.catalog];
            state.errors.push(...catalogResult.errors);
            for (const type of catalogResult.loadedTypes) state.loadedTypes.add(type);
            state.entries = mergeEntries(state.entries, catalogResult.cachedEntries.map(prepareEntry));
        } else state.errors.push(catalogResult?.error || 'Could not discover additional metadata types.');
        await ensureCategory('recentcomponent', true);
    } catch (error) {
        if (generation !== state.generation) return;
        state.errors = [error.message || 'Could not connect to Salesforce.'];
        $('#status').textContent = 'Connection unavailable';
    } finally {
        if (generation === state.generation) { state.loading = false; render(); }
    }
    if(generation===state.generation&&isExtension&&state.loadedTypes.has('object'))chrome.runtime.sendMessage({type:'GET_OBJECT_AUDIT',force}).then(result=>{
        if(!result?.ok||generation!==state.generation)return;const audit=new Map(result.entries.map(entry=>[entry.apiName,entry]));
        state.entries=state.entries.map(entry=>entry.type==='object'&&audit.has(entry.apiName)?prepareEntry({...entry,...audit.get(entry.apiName)}):entry);render();
    }).catch(()=>{});
    if (generation === state.generation && isExtension && state.loadedTypes.size) indexTypes(COMMON_TYPES.filter((type) => !CORE_TYPES.includes(type.key)).map((type) => type.key));
}

function selectCategory(category) {
    state.category = category; input.value = ''; state.active = 0; hideDetail(); render(); input.focus();
    $('#filters').querySelector(`[data-category="${category}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    ensureCategory(category, RECENT_TYPES.includes(category));
}
async function ensureCategory(category, force = false) {
    if (category === 'all' || CORE_TYPES.includes(category) || (!force && state.loadedTypes.has(category))) return;
    if (state.requests.has(category)) return state.requests.get(category);
    const generation = state.generation;
    const task = (async () => {
        try {
            const result = isExtension ? await chrome.runtime.sendMessage({ type: 'GET_CATEGORY', category, force }) : { ok: true, entries: (await import('./sample.js')).sampleIndex.filter(entry => entry.type === category), warnings: [] };
            if (generation !== state.generation) return;
            if (!result?.ok) throw new Error(result?.error || 'No response from metadata provider.');
            if (RECENT_TYPES.includes(category)) state.entries = state.entries.filter(entry => entry.type !== category);
            state.entries = mergeEntries(state.entries, result.entries.map(prepareEntry));
            if (category !== 'recentcomponent') state.loadedTypes.add(category);
            state.categoryErrors.delete(category);
            if (result.warnings?.length) state.categoryErrors.set(category, result.warnings.join(' · '));
        } catch (error) {
            if (generation === state.generation) state.categoryErrors.set(category, `${state.catalog.find((type) => type.key === category)?.label || category}: ${error.message}`);
        } finally {
            if (generation === state.generation) { state.requests.delete(category); render(); }
        }
    })();
    state.requests.set(category, task);
    return task;
}
async function indexTypes(types) {
    if (state.indexing) return;
    const generation = state.generation;
    state.indexing = true; state.stopIndexing = false; render();
    const remaining = types.filter((type) => !state.loadedTypes.has(type));
    const worker = async () => {
        while (remaining.length && !state.stopIndexing && generation === state.generation) await ensureCategory(remaining.shift());
    };
    await Promise.all([worker(), worker(), worker()]);
    if (generation === state.generation) { state.indexing = false; render(); }
}

function hideDetail() { detailEntry = null; $('#detail').hidden = true; $('#results').hidden = false; }
function showDetail(entry) {
    detailEntry = entry; $('#detail').hidden = false; $('#results').hidden = true;
    $('#detail-name').textContent = entry.label;
    $('#detail-type').textContent = `Type: ${entry.metadataType || entry.typeLabel}`;
    $('#detail-api').textContent = `API name: ${entry.apiName}`;
    $('#detail-id').textContent = `Identifier: ${entry.id}`;
    $('#copy-status').textContent = 'Direct item navigation is unavailable for this item. You can copy its API name below.'; $('#detail-back').focus();
}
async function openEntry(entry, newTab = true) {
    if (!entry) return;
    try {
        if (!hasDestination(entry)) { showDetail(entry); return; }
        if (isExtension) {
            const result = await chrome.runtime.sendMessage({ type: 'OPEN_ENTRY', entry: { createdDate:entry.createdDate,createdBy:entry.createdBy,lastModifiedDate:entry.lastModifiedDate,lastModifiedBy:entry.lastModifiedBy,id: entry.id, type: entry.type, apiName: entry.apiName, parentObject: entry.parentObject, namespace: entry.namespace, label: entry.label, targetType: entry.targetType, recordType: entry.recordType }, newTab });
            if (!result?.ok) throw new Error(result?.error || 'Unable to open metadata.');
            close();
        } else {
            $('#status').textContent = `Would open ${entry.label}${newTab ? ' in a new tab' : ''}`;
            if (!RECENT_TYPES.includes(entry.type)) {
                for (const item of state.entries) if (item.type === 'recentcomponent') item.recentRank = (item.recentRank ?? 0) + 1;
                state.entries = mergeEntries(state.entries, [prepareEntry({...entry,type:'recentcomponent',targetType:entry.type,recentRank:0})]);
            }
        }
        state.recentKeys = [entry.key, ...state.recentKeys.filter((key) => key !== entry.key)].slice(0, 10);
        render();
    } catch (error) { state.errors = [error.message]; render(); }
}
function close() {
    if (parentOrigin && parent !== window) parent.postMessage({ type: 'POWER_SEARCH_CLOSE' }, parentOrigin);
    else if (!isExtension) { $('#status').textContent = 'Preview: Escape closes the overlay in Salesforce'; }
}
input.addEventListener('input', () => { state.active = 0; hideDetail(); render(); ensureCategory(parseQuery(input.value, state.category, state.catalog).category); });
$('#refresh').onclick = () => load(true);
$('#close').onclick = close;
$('#coverage-toggle').onclick = () => { $('#coverage').hidden = !$('#coverage').hidden; $('#coverage-toggle').setAttribute('aria-expanded', String(!$('#coverage').hidden)); render(); };
$('#index-all').onclick = () => { if (state.indexing) { state.stopIndexing = true; $('#index-all').textContent = 'Pausing…'; } else indexTypes(state.catalog.filter((type) => type.key !== 'all').map((type) => type.key)); };
$('#detail-back').onclick = () => { hideDetail(); input.focus(); };
$('#copy-name').onclick = async () => {
    try { await navigator.clipboard.writeText(detailEntry.apiName); $('#copy-status').textContent = 'Copied'; }
    catch { $('#copy-status').textContent = 'Copy unavailable; select the API name above.'; }
};
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || (event.ctrlKey && event.code === 'Space' && !event.altKey && !event.shiftKey && !event.metaKey)) { event.preventDefault(); close(); }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && (event.target === input || $('#results').contains(event.target))) {
        event.preventDefault();
        if (state.results.length) state.active = (state.active + (event.key === 'ArrowDown' ? 1 : -1) + state.results.length) % state.results.length;
        updateSelection(); document.getElementById(`result-${state.active}`)?.scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter' && event.target === input) { event.preventDefault(); openEntry(state.results[state.active]); }
    if (event.key === 'Tab' && document.body.dataset.mode !== 'sidebar') {
        const focusable = [...document.querySelectorAll('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],button:not(:disabled)')].filter((node) => node.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
});
new ResizeObserver(() => {
    if (parentOrigin && parent !== window) parent.postMessage({ type: 'POWER_SEARCH_RESIZE', height: Math.ceil($('.palette').getBoundingClientRect().height) }, parentOrigin);
}).observe($('.palette'));
load();

function applyView(mode) {
    mode = displayMode(mode);
    document.body.dataset.mode = mode;
    $('.palette').setAttribute('aria-modal', String(mode !== 'sidebar'));
    $('#view-mode').value = mode;
    if (parentOrigin && parent !== window) parent.postMessage({type:'POWER_SEARCH_MODE',mode},parentOrigin);
}
async function loadView() {
    try {
        const result = isExtension ? await chrome.runtime.sendMessage({type:'GET_VIEW'}) : {ok:true,mode:window.localStorage.getItem('displayMode')};
        if (!result?.ok) throw new Error(result?.error || 'Could not load view preference.');
        applyView(result.mode);
    } catch { applyView('popup'); }
}
$('#view-mode').onchange = async () => {
    const previous = document.body.dataset.mode || 'popup', mode = $('#view-mode').value;
    try {
        if (isExtension) {
            const result = await chrome.runtime.sendMessage({type:'SET_VIEW',mode});
            if (!result?.ok) throw new Error(result?.error || 'Could not save the view preference.');
        } else window.localStorage.setItem('displayMode',mode);
        applyView(mode); $('#view-status').textContent = 'View preference saved.';
    } catch (error) { applyView(previous); $('#view-status').textContent = error.message; }
};
loadView();

const queryWorkspace=initQueryDesk({root:$('#query-workspace'),isPreview:!isExtension,send:message=>isExtension?chrome.runtime.sendMessage(message):sampleQueryMessage(message)});
const adminWorkspace=initAdmin({recordRoot:$('#record-workspace'),settingsRoot:$('#settings-workspace'),send:message=>isExtension?chrome.runtime.sendMessage(message):sampleAdminMessage(message)});
const workspaceTabs=initWorkspaceTabs({tablist:$('.workspace-tabs'),canSwitch:()=>!queryWorkspace.state.review,hooks:{
    search:{focus:()=>input},
    record:adminWorkspace.record,settings:adminWorkspace.settings,
    query:{open:()=>queryWorkspace.open(),close:()=>queryWorkspace.close(),focus:()=>queryWorkspace.editor||$('#query-open')}
}});

$('#debug-enable').onclick=async()=>{$('#view-status').textContent=await adminWorkspace.quickDebug($('#debug-enable'));$('#status').textContent=$('#view-status').textContent;};
let contextPending=false;
async function refreshRecordContext(){
    if(contextPending)return;contextPending=true;
    try{const result=isExtension?await chrome.runtime.sendMessage({type:'RECORD_CONTEXT'}):await sampleAdminMessage({type:'RECORD_CONTEXT'});if(!result?.ok)return;
        const tab=$('#record-tab');tab.hidden=!result.context;workspaceTabs.refresh();
        if(tab.hidden&&document.body.dataset.workspace==='record')workspaceTabs.activate('search');
        adminWorkspace.setContext(result.context);
    }catch{}finally{contextPending=false;}
}
refreshRecordContext();
if(isExtension){const contextTimer=setInterval(refreshRecordContext,2000);window.addEventListener('pagehide',()=>clearInterval(contextTimer),{once:true});}
// Announce readiness only after the iframe has its extension origin and message handlers.
if (parentOrigin && parent !== window) parent.postMessage({type:'POWER_SEARCH_READY'},parentOrigin);

$('#coding-launch').onclick=async()=>{
    if(!isExtension){window.open('coding.html','_blank','noopener');return;}
    $('#coding-launch').disabled=true;
    try{const result=await chrome.runtime.sendMessage({type:'OPEN_CODING'});$('#coding-launch-status').textContent=result?.ok?'Coding opened in a new tab.':result?.error||'Could not open Coding.';}
    catch(error){$('#coding-launch-status').textContent=error.message;}
    finally{$('#coding-launch').disabled=false;}
};
