import { localEntries } from './visibility.js';
export const API_VERSION = 'v65.0';
export const CACHE_TTL = 15 * 60 * 1000;

export function salesforceContext(rawUrl) {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Open Power Search on a Salesforce Lightning or Setup page.');
    const match = url.hostname.match(/^([a-z0-9-]+(?:\.(?:sandbox|develop))?)\.(lightning\.force\.com|my\.salesforce(?:-setup)?\.com)$/);
    if (!match) throw new Error('Open Power Search on a Salesforce Lightning or Setup page.');
    return { pageOrigin: url.origin, apiOrigin: `https://${match[1]}.my.salesforce.com`, orgLabel: match[1].replace('.sandbox', ' · sandbox').replace('.develop', ' · developer org') };
}

export function safeApiUrl(apiOrigin, path) {
    const context = salesforceContext(apiOrigin);
    if (context.apiOrigin !== apiOrigin) throw new Error('Invalid API origin.');
    const url = new URL(path, apiOrigin);
    if (url.origin !== apiOrigin || url.username || url.password || !/^\/services\/data\/v\d+\.\d+\/(?:query(?:\/|$)|sobjects\/$)/.test(url.pathname)) {
        throw new Error('Salesforce returned an unsupported pagination URL.');
    }
    return url.href;
}

export function normalizeRecord(record, type) {
    if (type === 'object') {
        const parts = record.name.split('__');
        return { id: record.name, type, label: record.label || record.name, apiName: record.name, namespace: parts.length > 2 ? parts[0] : null };
    }
    return {
        id: record.Id, type, label: record.Name,
        apiName: record.NamespacePrefix ? `${record.NamespacePrefix}__${record.Name}` : record.Name,
        createdDate:record.CreatedDate||null, createdBy:record.CreatedBy?.Name||record.CreatedById||null,
        lastModifiedDate:record.LastModifiedDate||null, lastModifiedBy:record.LastModifiedBy?.Name||record.LastModifiedById||null,
        namespace: record.NamespacePrefix || null
    };
}

export async function readCategory(type, request) {
    if (type === 'object') {
        const data = await request(`/services/data/${API_VERSION}/sobjects/`);
        if (!Array.isArray(data.sobjects)) throw new Error('Unexpected object catalog response.');
        return localEntries(data.sobjects.filter((record) => !record.deprecatedAndHidden).map((record) => normalizeRecord(record, type)));
    }
    if (type === 'recentrecord') {
        const query = 'SELECT Id, Name, Type, LastViewedDate FROM RecentlyViewed WHERE LastViewedDate != null ORDER BY LastViewedDate DESC LIMIT 100';
        const data = await request(`/services/data/${API_VERSION}/query?q=${encodeURIComponent(query)}`);
        if (!Array.isArray(data.records)) throw new Error('Unexpected recent records response.');
        const entries=localEntries(data.records.map((record, recentRank) => ({ id: record.Id, type, label: record.Name || record.Id,
            apiName: `${record.Type} · ${record.Name || record.Id}`, recordType: record.Type, recentRank })));
        const groups=new Map();for(const entry of entries){if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(entry.recordType)||! /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(entry.id))continue;if(!groups.has(entry.recordType))groups.set(entry.recordType,[]);groups.get(entry.recordType).push(entry);}
        const remaining=[...groups];
        const worker=async()=>{while(remaining.length){const [object,items]=remaining.shift();try{
            const q=`SELECT Id, CreatedDate, CreatedBy.Name, LastModifiedDate, LastModifiedBy.Name FROM ${object} WHERE Id IN (${items.map(item=>`'${item.id}'`).join(',')})`;
            const audit=await request(`/services/data/${API_VERSION}/query?q=${encodeURIComponent(q)}`);
            for(const item of items){const record=audit.records?.find(row=>row.Id===item.id);if(record)Object.assign(item,{createdDate:record.CreatedDate||null,createdBy:record.CreatedBy?.Name||null,lastModifiedDate:record.LastModifiedDate||null,lastModifiedBy:record.LastModifiedBy?.Name||null});}
        }catch{/* Audit access can differ from RecentlyViewed access. Keep the result navigable. */}}};
        await Promise.all([worker(),worker(),worker()]);return entries;
    }
    const objectName = { apex: 'ApexClass', trigger: 'ApexTrigger', queue: 'Group', group: 'Group', role: 'UserRole', user: 'User' }[type];
    if (!objectName) throw new Error('Unsupported metadata category.');
    let fields = ['apex', 'trigger'].includes(type) ? 'Id, Name, NamespacePrefix' : type === 'user' ? 'Id, Name, Username, IsActive' : 'Id, Name, DeveloperName';
    if(['apex','trigger','user'].includes(type))fields+=', CreatedDate, CreatedBy.Name, LastModifiedDate, LastModifiedBy.Name';
    const where = type === 'queue' ? " WHERE Type = 'Queue'" : type === 'group' ? " WHERE Type = 'Regular'" : '';
    let next = `/services/data/${API_VERSION}/query?q=${encodeURIComponent(`SELECT ${fields} FROM ${objectName}${where} ORDER BY Id`)}`;
    const entries = [], visited = new Set();
    while (next) {
        if (visited.has(next) || visited.size >= 50) throw new Error('Metadata pagination limit reached. This category could not be indexed completely.');
        visited.add(next);
        const page = await request(next);
        if (!Array.isArray(page.records)) throw new Error('Unexpected metadata response.');
        entries.push(...page.records.map((record) => ({ ...normalizeRecord(record, type), ...(type === 'user' ? {isActive: record.IsActive} : {}), apiName: record.Username || record.DeveloperName || (record.NamespacePrefix ? `${record.NamespacePrefix}__${record.Name}` : record.Name) })));
        if (!page.done && !page.nextRecordsUrl) throw new Error('Metadata pagination is incomplete.');
        next = page.done ? null : page.nextRecordsUrl;
    }
    return localEntries(entries);
}

export function apiError(status, data) {
    const code = Array.isArray(data) ? data[0]?.errorCode : '';
    if (status === 401 || code === 'INVALID_SESSION_ID') return 'Salesforce rejected this session for API access. Sign in again; your org may require a separate OAuth connection.';
    if (status === 403 || code === 'API_DISABLED_FOR_ORG' || code === 'INSUFFICIENT_ACCESS') return 'Your Salesforce user or org does not allow this API request. Check API Enabled and metadata access with your administrator.';
    if (status === 429 || code === 'REQUEST_LIMIT_EXCEEDED') return 'The Salesforce API request limit was reached. Try again later.';
    return `Salesforce could not load this metadata (HTTP ${status}${code ? `, ${String(code).replace(/[^A-Z_]/g, '')}` : ''}).`;
}

