import {createCodingService,codingEnvelope} from './lib/coding-service.js';
import {createQueryLibrary} from './lib/query-library.js';
import {createAdminService,recordContext} from './lib/admin-service.js';
import {createQueryService} from './lib/query-service.js';
import { displayMode } from './lib/presentation.js';
import { localEntries, localResult } from './lib/visibility.js';
import { salesforceContext, safeApiUrl, readCategory, apiError, CACHE_TTL } from './lib/salesforce.js';
import { destinationFor } from './lib/search.js';
import { launchPalette } from './lib/launcher.js';
import { COMMON_TYPES, CORE_TYPES, RECENT_TYPES, descriptorFor } from './lib/catalog.js';
import { soapEnvelope, parseSoap, listMetadataCategory, escapeXml } from './lib/metadata.js';

const inFlight = new Map();
const queryLibrary=createQueryLibrary(chrome.storage.local);
const coding=createCodingService({storage:chrome.storage.session,rest:async(conn,path)=>{
    const url=new URL(path,conn.apiOrigin);
    if(url.origin!==conn.apiOrigin||!/^\/services\/data\/v65\.0\/tooling\/query(?:\/[A-Za-z0-9_-]+)?$/.test(url.pathname))throw new Error('Unsupported code listing request.');
    const response=await fetch(url,{headers:{Authorization:`Bearer ${conn.token}`},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`Could not list code components (${response.status}). Check Tooling API permissions.`);
    return response.json();
},soap:async(conn,operation,body)=>{
    const response=await fetch(conn.apiOrigin+'/services/Soap/m/65.0',{method:'POST',headers:{'Content-Type':'text/xml; charset=UTF-8',SOAPAction:operation},body:codingEnvelope(operation,conn.token,body),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
    const text=await response.text();if(text.length>16*1024*1024)throw new Error('Code response exceeds the workspace limit.');
    const result=parseSoap(text,operation);if(!response.ok)throw new Error(`Code operation failed (${response.status}).`);
    // Compilation diagnostics may echo source; redact the session token before returning any result.
    return JSON.parse(JSON.stringify(result??{}).split(conn.token).join('[redacted]'));
}});
async function adminRequest(conn,path,method='GET',body,extraHeaders={}) {
    if(path==='/services/Soap/u/65.0'&&method==='POST'){
        const xml=`<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns="urn:partner.soap.sforce.com"><env:Header><SessionHeader><sessionId>${escapeXml(conn.token)}</sessionId></SessionHeader></env:Header><env:Body><getUserInfo/></env:Body></env:Envelope>`;
        const response=await fetch(conn.apiOrigin+path,{method:'POST',headers:{Authorization:`Bearer ${conn.token}`,'Content-Type':'text/xml; charset=UTF-8',SOAPAction:'getUserInfo'},body:xml,credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
        const result=parseSoap(await response.text(),'getUserInfo');
        if(!response.ok)throw new Error('Could not identify your current Salesforce user.');
        return {user_id:result?.userId||result?.userID};
    }
    const url=new URL(path,conn.apiOrigin);
    const allowed=/^\/services\/data\/v65\.0\/(?:sobjects\/[A-Za-z][A-Za-z0-9_]*\/(?:describe\/|[A-Za-z0-9]{15,18})|tooling\/query|tooling\/sobjects\/(?:DebugLevel|TraceFlag)(?:\/[A-Za-z0-9]{15,18})?)$/.test(url.pathname);
    if(url.origin!==conn.apiOrigin||!allowed||!['GET','POST','PATCH'].includes(method))throw new Error('Unsupported Salesforce operation.');
    const response=await fetch(url.href,{method,headers:{Authorization:`Bearer ${conn.token}`,Accept:'application/json','Content-Type':'application/json',...extraHeaders},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
    if(response.status===412)throw new Error('This record changed in Salesforce. Reload its fields before saving.');
    if(response.status===204)return {};
    let data;try{data=await response.json();}catch{throw new Error('Salesforce returned an unexpected response. Reload before retrying a save.');}
    if(!response.ok){const code=String(data?.[0]?.errorCode||'').replace(/[^A-Z_]/g,'');throw new Error(`Salesforce rejected the operation (${code||response.status}). Check permissions, field values, validation rules, and debug-log limits. Reload before retrying a save.`);}
    return data;
}
const admin=createAdminService(adminRequest,chrome.storage.local);

async function restRequest(conn, path) {
    const response = await fetch(safeApiUrl(conn.apiOrigin, path), {
        method: 'GET', headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/json' },
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000)
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('Salesforce returned an unexpected response. Check your connection and sign-in.'); }
    if (!response.ok) throw new Error(apiError(response.status, data));
    return data;
}

async function recordRequest(conn, path, method='GET') {
    const url = new URL(path,conn.apiOrigin);
    const get = /^\/services\/data\/v65\.0\/(?:sobjects\/$|sobjects\/[A-Za-z][A-Za-z0-9_]*\/describe\/$|query$|query\/[A-Za-z0-9_-]+$)/.test(url.pathname);
    const remove = url.pathname === '/services/data/v65.0/composite/sobjects' && url.searchParams.get('allOrNone') === 'false' && /^[A-Za-z0-9,]+$/.test(url.searchParams.get('ids') || '');
    if(url.origin !== conn.apiOrigin || url.username || url.password || !(method === 'GET' && get || method === 'DELETE' && remove)) throw new Error('Unsupported records API request.');
    const response = await fetch(url.href,{method,headers:{Authorization:`Bearer ${conn.token}`,Accept:'application/json','Sforce-Query-Options':'batchSize=2000'},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
    let data; try {data=await response.json();} catch {throw new Error(method==='DELETE'?'Delete outcome is unknown. Run the query again before retrying.':'Salesforce returned an unexpected query response.');}
    if(!response.ok) {
        const code=Array.isArray(data)?data[0]?.errorCode:'';
        if(['MALFORMED_QUERY','INVALID_FIELD','INVALID_TYPE','INVALID_QUERY_FILTER_OPERATOR'].includes(code)) throw new Error(`${code}: ${String(data[0].message || '').split(conn.token).join('[redacted]').slice(0,1000)}`);
        throw new Error(apiError(response.status,data));
    }
    return data;
}
const queries = createQueryService(recordRequest);

async function soapRequest(conn, operation, queries) {
    const response = await fetch(`${conn.apiOrigin}/services/Soap/m/65.0`, {
        method: 'POST', headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: operation },
        body: soapEnvelope(operation, conn.token, queries), credentials: 'omit', redirect: 'error',
        cache: 'no-store', signal: AbortSignal.timeout(20000)
    });
    const text = await response.text();
    if (text.length > 20000000) throw new Error('Metadata response exceeded the size limit.');
    // Parse SOAP faults even for HTTP 500, without echoing the raw fault body.
    const result = parseSoap(text, operation);
    if (!response.ok) throw new Error(`Salesforce Metadata API returned HTTP ${response.status}.`);
    return result;
}

async function catalogForConnection(conn, force = false) {
    return { catalog: COMMON_TYPES, loadedAt: Date.now(), errors: [] };
}

async function getCatalog(tab, force) {
    const conn = await connection(tab);
    const catalog = await catalogForConnection(conn, force);
    const storage = await chrome.storage.session.get(null);
    if (force) {
        const keys = Object.keys(storage).filter((key) => key.startsWith(`${conn.cacheKey}:category:v2:`) || key.startsWith(`${conn.cacheKey}:category:v3:`) || key.startsWith(`${conn.cacheKey}:object:v2:`));
        if (keys.length) await chrome.storage.session.remove(keys);
        return { ...catalog, cachedEntries: [], loadedTypes: [] };
    }
    const cached = Object.entries(storage).filter(([key, value]) => key.startsWith(`${conn.cacheKey}:category:v3:`) && value && value.auditVersion===1 && descriptorFor(value.category) && Date.now() - value.loadedAt < (value.category === 'recentrecord' ? 60000 : CACHE_TTL)).map(([, value]) => value);
    return { ...catalog, catalog: COMMON_TYPES, cachedEntries: localEntries(cached.flatMap((result) => result.entries)).filter(entry => descriptorFor(entry.type)), loadedTypes: cached.map((result) => result.category) };
}

async function loadCategory(tab, category, force) {
    if (!descriptorFor(category)) throw new Error('This category is not enabled in Power Search.');
    if (CORE_TYPES.includes(category)) throw new Error('Core categories are loaded by the main index.');
    const conn = await connection(tab);
    const catalog = COMMON_TYPES;
    const descriptor = descriptorFor(category);
    if (!descriptor) throw new Error('Unknown metadata category. Refresh the type catalog.');
    if (category === 'recentcomponent') {
        const entries = (await chrome.storage.session.get(`components:${conn.cacheKey}`))[`components:${conn.cacheKey}`] || [];
        const visible = localEntries(entries);
        if (visible.length !== entries.length) try { await chrome.storage.session.set({ [`components:${conn.cacheKey}`]: visible }); } catch { /* Filtering does not require storage. */ }
        return { category, entries: visible.filter(entry => descriptorFor(entry.targetType) && !RECENT_TYPES.includes(entry.targetType)).map((entry, recentRank) => ({ ...entry, type: 'recentcomponent', recentRank })), warnings: [], loadedAt: Date.now() };
    }
    const key = `${conn.cacheKey}:category:v3:${category}`;
    const cached = (await chrome.storage.session.get(key))[key];
    if (!force && cached && cached.auditVersion===1 && Date.now() - cached.loadedAt < (category === 'recentrecord' ? 60000 : CACHE_TTL)) return { ...localResult(cached), cached: true };
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
        const listing = ['queue', 'group', 'role', 'recentrecord', 'user'].includes(category)
            ? { entries: await readCategory(category, path => restRequest(conn, path)), warnings: [] }
            : await listMetadataCategory(descriptor, (operation, queries) => soapRequest(conn, operation, queries));
        if(['queue','group','role'].includes(category))listing.entries=await enrichAudit(conn,listing.entries,category);
        const result = { ...listing, category, auditVersion:1, loadedAt: Date.now() };
        if (!listing.warnings.length) try { await chrome.storage.session.set({ [key]: result }); } catch { /* Live results still work. */ }
        return result;
    })();
    inFlight.set(key, task);
    try { return await task; } finally { inFlight.delete(key); }
}

async function connection(tab) {
    const context = salesforceContext(tab.url);
    const stores = await chrome.cookies.getAllCookieStores();
    const store = stores.find((item) => item.tabIds.includes(tab.id));
    if (!store) throw new Error('Cannot locate the Salesforce browser session. Reload the tab and try again.');
    // Read only this org's API-host session. Never enumerate or forward tokens to the page.
    const cookie = await chrome.cookies.get({ url: context.apiOrigin, name: 'sid', storeId: store.id });
    if (!cookie?.value) throw new Error('No API-host Salesforce session was found. Sign in to this org’s My Domain, then retry. Sessions that require OAuth are not supported yet.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cookie.value));
    const sessionKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return { ...context, libraryKey:`${context.apiOrigin}:${store.id}`, token: cookie.value, cacheKey: `index:${context.apiOrigin}:${store.id}:${sessionKey}` };
}

async function enrichAudit(conn,entries,category){
    try{const listed=await listMetadataCategory(descriptorFor(category),(operation,queries)=>soapRequest(conn,operation,queries));
        const byName=new Map(listed.entries.map(item=>[item.apiName,item]));
        return entries.map(entry=>{const match=byName.get(entry.apiName);return match?{...entry,createdDate:match.createdDate,createdBy:match.createdBy,lastModifiedDate:match.lastModifiedDate,lastModifiedBy:match.lastModifiedBy}:entry;});
    }catch{return entries;}
}
async function loadIndex(tab, force) {
    const conn = await connection(tab);
    const recentKeys = (await chrome.storage.session.get(`recents:${conn.cacheKey}`))[`recents:${conn.cacheKey}`] || [];
    const cached = (await chrome.storage.session.get(conn.cacheKey))[conn.cacheKey];
    if (!force && cached && cached.auditVersion===1 && Date.now() - cached.loadedAt < CACHE_TTL) return { ...localResult(cached), recentKeys, cached: true };
    if (inFlight.has(conn.cacheKey)) return inFlight.get(conn.cacheKey);
    const task = (async () => {
        const request = (path) => restRequest(conn, path);
        const types = ['apex', 'trigger', 'object'];
        const outcomes = await Promise.allSettled(types.map(type=>readCategory(type,request)));
        const entries = [], errors = [];
        outcomes.forEach((result, index) => {
            if (result.status === 'fulfilled') entries.push(...result.value);
            else errors.push(`${types[index]}: ${friendlyError(result.reason)}`);
        });
        const result = { entries, errors, auditVersion:1, loadedAt: Date.now(), orgLabel: conn.orgLabel, recentKeys };
        // Never cache a failed catalog as a successful empty result.
        if (!errors.length) {
            try { await chrome.storage.session.set({ [conn.cacheKey]: result }); }
            catch { /* Storage quota must not prevent a live search. */ }
        }
        return result;
    })();
    inFlight.set(conn.cacheKey, task);
    try { return await task; } finally { inFlight.delete(conn.cacheKey); }
}

function friendlyError(error) {
    if (error?.name === 'TimeoutError') return 'Salesforce took too long to respond. Try refreshing.';
    if (error instanceof TypeError) return 'Could not reach Salesforce. Check your connection and sign-in.';
    // All explicit errors in this worker are authored locally, never raw HTTP bodies.
    return error?.message || 'Unable to load metadata.';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !sender.url) return false;
    let senderPage;
    try { senderPage = new URL(sender.url); } catch { return false; }
    if (senderPage.protocol !== 'chrome-extension:' || senderPage.hostname !== chrome.runtime.id) return false;
    if(senderPage.pathname==='/app/coding.html'&&sender.tab?.id){
        (async()=>{
            const binding=(await chrome.storage.session.get(`coding-tab:${sender.tab.id}`))[`coding-tab:${sender.tab.id}`];
            if(!binding)throw new Error('Open Coding from Power Search on your Salesforce tab.');
            const tab=await chrome.tabs.get(binding.sourceTab),conn=await connection(tab);
            if(conn.libraryKey!==binding.orgKey)throw new Error('The original Salesforce tab changed org or browser session. Reopen Coding from Power Search.');
            if(message.type==='CODE_CATALOG'){await coding.cleanup();return {ok:true,...await coding.catalog(conn)};}
            if(message.type==='CODE_OPEN')return {ok:true,...await coding.start(conn,sender.tab.id,message.selection)};
            if(message.type==='CODE_SAVE')return {ok:true,...await coding.save(conn,sender.tab.id,message.snapshot,message.files)};
            if(message.type==='CODE_POLL')return {ok:true,...await coding.poll(conn,sender.tab.id,message.job)};
            throw new Error('Unsupported coding request.');
        })().then(sendResponse).catch(error=>sendResponse({ok:false,error:friendlyError(error)}));
        return true;
    }
    if (senderPage.pathname === '/app/launcher.html' && message.type === 'OPEN_PALETTE') {
        (async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return launchPalette(chrome, tab);
        })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
        return true;
    }
    if (senderPage.pathname !== '/app/palette.html' || !sender.tab?.id) return false;
    const handle = async () => {
        // Derive the org from the current tab, never an origin supplied in a message.
        const tab = await chrome.tabs.get(sender.tab.id);
        const context = salesforceContext(tab.url);
        if(message.type==='OPEN_CODING'){
            const conn=await connection(tab);
            const editor=await chrome.tabs.create({url:'about:blank',openerTabId:tab.id});
            await chrome.storage.session.set({[`coding-tab:${editor.id}`]:{sourceTab:tab.id,orgKey:conn.libraryKey}});
            await chrome.tabs.update(editor.id,{url:chrome.runtime.getURL('app/coding.html')});
            return {ok:true};
        }
        if(message.type==='RECORD_CONTEXT')return {ok:true,context:recordContext(tab.url)};
        if(['RECORD_GET','RECORD_SAVE','DEBUG_SETTINGS_GET','DEBUG_SETTINGS_SAVE','DEBUG_ENABLE'].includes(message.type)){
            const conn=await connection(tab);
            if(message.type==='RECORD_GET')return {ok:true,...await admin.read(conn,tab)};
            if(message.type==='RECORD_SAVE')return {ok:true,...await admin.save(conn,tab,message.snapshot,message.changes)};
            if(message.type==='DEBUG_SETTINGS_GET')return {ok:true,settings:await admin.settings(conn)};
            if(message.type==='DEBUG_SETTINGS_SAVE')return {ok:true,settings:await admin.settings(conn,message.settings)};
            const result=await admin.enableDebug(conn);
            try{await chrome.tabs.create({url:context.pageOrigin+'/lightning/setup/ApexDebugLogs/home',openerTabId:tab.id});}
            catch{return {ok:true,...result,warning:'Logging is enabled. The Debug Logs tab could not be opened; open Debug Logs from Setup.'};}
            return {ok:true,...result};
        }
        if (message.type === 'GET_VIEW') return {ok:true, mode:displayMode((await chrome.storage.local.get('displayMode')).displayMode)};
        if (message.type === 'SET_VIEW') {
            if (displayMode(message.mode) !== message.mode) throw new Error('Choose Popup, Sidebar or Full page.');
            await chrome.storage.local.set({displayMode:message.mode});
            return {ok:true,mode:message.mode};
        }
        if (typeof message.type === 'string' && message.type.startsWith('QUERY_')) {
            const conn=await connection(tab);
            if(message.type==='QUERY_OBJECTS') return {ok:true,objects:await queries.objects(conn),orgOrigin:conn.pageOrigin,orgLabel:conn.orgLabel};
            if(message.type==='QUERY_DESCRIBE') return {ok:true,schema:await queries.describe(conn,message.objectName)};
            if(message.type==='QUERY_LIBRARY_GET')return {ok:true,...await queryLibrary.read(conn.libraryKey)};
            if(message.type==='QUERY_LIBRARY_SAVE')return {ok:true,...await queryLibrary.save(conn.libraryKey,message)};
            if(message.type==='QUERY_LIBRARY_REMOVE')return {ok:true,...await queryLibrary.remove(conn.libraryKey,message.id)};
            if(message.type==='QUERY_HISTORY_CLEAR')return {ok:true,...await queryLibrary.clearHistory(conn.libraryKey)};
            if(message.type==='QUERY_RUN') {
                const result=await queries.run(conn,tab.id,message.objectName,message.query);
                try {await queryLibrary.record(conn.libraryKey,message.objectName,message.query);} catch {result.historyWarning='Query completed, but history could not be saved locally.';}
                return {ok:true,...result};
            }
            if(message.type==='QUERY_MORE') return {ok:true,...await queries.more(conn,tab.id,message.queryId)};
            if(message.type==='QUERY_PREPARE_DELETE') return {ok:true,...queries.prepareDelete(conn,tab.id,message.queryId,message.ids)};
            if(message.type==='QUERY_DELETE') return {ok:true,...await queries.remove(conn,tab.id,message.ticket,message.confirmation)};
        }
        if(message.type==='GET_OBJECT_AUDIT'){
            const conn=await connection(tab),key=`${conn.cacheKey}:object-audit:v1`,cached=(await chrome.storage.session.get(key))[key];
            if(!message.force&&cached&&Date.now()-cached.loadedAt<CACHE_TTL)return {ok:true,...cached};
            const listing=await listMetadataCategory(descriptorFor('object'),(operation,queries)=>soapRequest(conn,operation,queries));
            const result={entries:listing.entries.map(({apiName,createdDate,createdBy,lastModifiedDate,lastModifiedBy})=>({apiName,createdDate,createdBy,lastModifiedDate,lastModifiedBy})),loadedAt:Date.now()};
            if(!listing.warnings.length)try{await chrome.storage.session.set({[key]:result});}catch{}
            return {ok:true,...result};
        }
        if (message.type === 'GET_INDEX') return { ok: true, ...(await loadIndex(tab, message.force === true)) };
        if (message.type === 'GET_CATALOG') return { ok: true, ...(await getCatalog(tab, message.force === true)) };
        if (message.type === 'GET_CATEGORY') return { ok: true, ...(await loadCategory(tab, message.category, message.force === true)) };
        if (message.type === 'OPEN_ENTRY') {
            if (!descriptorFor(message.entry?.type)) throw new Error('This category is not enabled in Power Search.');
            const path = destinationFor(message.entry || {});
            const url = context.pageOrigin + path;
            await chrome.tabs.create({ url, openerTabId: tab.id });
            try {
                const conn = await connection(tab);
                const key = `recents:${conn.cacheKey}`;
                const prior = (await chrome.storage.session.get(key))[key] || [];
                const entryKey = `${message.entry.type}:${message.entry.id}`;
                await chrome.storage.session.set({ [key]: [entryKey, ...prior.filter((item) => item !== entryKey)].slice(0, 10) });
                const targetType = message.entry.type === 'recentcomponent' ? message.entry.targetType : message.entry.type;
                if (!RECENT_TYPES.includes(targetType) && descriptorFor(targetType)) {
                    const recentKey = `components:${conn.cacheKey}`;
                    const previous = (await chrome.storage.session.get(recentKey))[recentKey] || [];
                    const entry = { ...Object.fromEntries(['createdDate','createdBy','lastModifiedDate','lastModifiedBy'].map(key=>[key,typeof message.entry[key]==='string'?message.entry[key].slice(0,200):null])),id: String(message.entry.id), targetType, namespace: typeof message.entry.namespace === 'string' ? message.entry.namespace.slice(0, 100) : null, apiName: String(message.entry.apiName || '').slice(0, 500), label: String(message.entry.label || message.entry.apiName || '').slice(0, 500) };
                    await chrome.storage.session.set({ [recentKey]: [entry, ...localEntries(previous).filter(item => item.id !== entry.id || item.targetType !== targetType)].slice(0, 50) });
                }
            } catch { /* Navigation does not require storage or a still-live API session. */ }
            return { ok: true };
        }
        throw new Error('Unsupported request.');
    };
    handle().then(sendResponse).catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
});

async function toggle(tab) {
    try {
        await launchPalette(chrome, tab);
        await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
        await chrome.action.setTitle({ tabId: tab.id, title: 'Open Power Search' });
    } catch {
        if (tab?.id) {
            await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
            await chrome.action.setTitle({ tabId: tab.id, title: 'Open a Salesforce Lightning/Setup page, then reload it after installing Power Search.' });
        }
    }
}
chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-search') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await toggle(tab);
});
