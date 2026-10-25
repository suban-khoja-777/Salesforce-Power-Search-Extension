import { isManaged } from './visibility.js';
import { COMMON_TYPES, RECENT_TYPES, descriptorFor } from './catalog.js';
export const CATEGORIES = [{key:'all',label:'All'}, ...COMMON_TYPES];

const LABELS = { apex: 'Apex class', trigger: 'Apex trigger', object: 'Object' };
const ICONS = { apex: 'utility:apex', trigger: 'utility:automate', object: 'utility:database' };
const ALIASES = { apex: 'apex', class: 'apex', trigger: 'trigger', object: 'object' };
const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function prepareEntry(entry) {
    return {
        ...entry,
        key: `${entry.type}:${entry.id}`,
        typeLabel: descriptorFor(entry.type === 'recentcomponent' ? entry.targetType : entry.type)?.singular || entry.metadataType || LABELS[entry.type] || entry.type,
        icon: ICONS[entry.type === 'recentcomponent' ? entry.targetType : entry.type] || 'utility:search',
        iconClass: `result-icon ${entry.targetType || entry.type}`,
        normalizedLabel: normalize(entry.label),
        normalizedApiName: normalize(entry.apiName),
        initials: normalize(`${entry.label} ${entry.apiName}`.match(/[A-Z][a-z0-9]*|[a-z0-9]+/g)?.map((word) => word[0]).join(''))
    };
}

export function parseQuery(raw, category = 'all', catalog = CATEGORIES) {
    const match = String(raw || '').trim().match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    const prefix = match?.[1].toLowerCase();
    const mapped = match && (ALIASES[prefix] || catalog.find((type) => type.key.toLowerCase() === prefix || type.metadataType?.toLowerCase() === prefix)?.key);
    return { category: mapped || category, query: normalize(mapped ? match[2] : raw) };
}

function matchScore(value, query) {
    if (value === query) return 1000;
    if (value.startsWith(query)) return 800 - Math.min(value.length - query.length, 100);
    const position = value.indexOf(query);
    if (position >= 0) return 600 - Math.min(position, 100);
    // Ordered subsequence matching supports abbreviations without an expensive edit-distance matrix.
    let index = -1;
    let gaps = 0;
    for (const character of query) {
        const next = value.indexOf(character, index + 1);
        if (next < 0) return 0;
        gaps += next - index - 1;
        index = next;
    }
    return 250 - Math.min(gaps, 150);
}

export function searchEntries(entries, raw, options = {}) {
    const { category, query } = parseQuery(raw, options.category, options.catalog);
    const recentKeys = options.recentKeys || [];
    const merged = new Map(entries.filter(entry => entry.type !== 'recentcomponent').map(entry => [entry.key, entry]));
    for (const history of entries.filter(entry => entry.type === 'recentcomponent' && !isManaged(entry) && descriptorFor(entry.targetType) && !RECENT_TYPES.includes(entry.targetType))) {
        const item = prepareEntry({...history, type:history.targetType});
        merged.set(item.key, {...(merged.get(item.key) || item), recentRank:history.recentRank ?? 0});
    }
    return [...merged.values()]
        .filter((entry) => (category === 'all' || entry.type === category) && !isManaged(entry))
        .map((entry) => {
            const score = query
                ? Math.max(matchScore(entry.normalizedLabel, query), matchScore(entry.normalizedApiName, query),
                    entry.initials.startsWith(query) ? 450 : 0)
                : 1;
            const recentIndex = recentKeys.indexOf(entry.key);
            return { ...entry, score, recentOrder: entry.recentRank ?? (recentIndex < 0 ? 100 : recentIndex) };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.recentOrder - b.recentOrder || a.label.localeCompare(b.label) || a.key.localeCompare(b.key))
        .slice(0, options.limit || 30);
}

export function destinationFor(entry) {
    if (isManaged(entry)) throw new Error('Managed package components are excluded from Power Search.');
    if (!descriptorFor(entry.type)) throw new Error('This metadata category is not enabled.');
    if (entry.type === 'recentcomponent') {
        if (!descriptorFor(entry.targetType) || RECENT_TYPES.includes(entry.targetType)) throw new Error('Invalid recent component.');
        return destinationFor({ ...entry, type: entry.targetType });
    }
    if (entry.type === 'recentrecord') {
        if (!/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(entry.id || '') || !/^[A-Za-z][A-Za-z0-9_]*$/.test(entry.recordType || '')) throw new Error('Invalid recent record.');
        return `/lightning/r/${encodeURIComponent(entry.recordType)}/${entry.id}/view`;
    }
    if (entry.type === 'user') {
        if (!/^005[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(entry.id || '')) throw new Error('Invalid user identifier.');
        return `/lightning/setup/ManageUsers/page?address=${encodeURIComponent('/' + entry.id)}`;
    }
    if (entry.type === 'object' && /^[A-Za-z][A-Za-z0-9_]*$/.test(entry.apiName)) {
        return `/lightning/setup/ObjectManager/${encodeURIComponent(entry.apiName)}/Details/view`;
    }
    if ((entry.type === 'apex' || entry.type === 'trigger') && /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(entry.id)) {
        const section = entry.type === 'apex' ? 'ApexClasses' : 'ApexTriggers';
        return `/lightning/setup/${section}/page?address=${encodeURIComponent('/' + entry.id)}`;
    }
    if (['apex', 'trigger', 'object'].includes(entry.type)) throw new Error('This metadata item has no supported destination.');
    const validId = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(entry.id);
    if (entry.type === 'flow' && validId && entry.id.startsWith('301')) return `/builder_platform_interaction/flowBuilder.app?flowId=${entry.id}`;
    // Item routes, not category home pages. See navigation audit in METADATA-COVERAGE.md.
    const routes = {
        lwc:['LightningComponentBundles','0Rb'], aura:['LightningComponentBundles','0Ab'],
        vfpage:['ApexPages','066'], vfcomponent:['ApexComponent','099'],
        profile:['EnhancedProfiles','00e'], permissionset:['PermSets','0PS'],
        permissiongroup:['PermSetGroups','0PG'], role:['Roles','00E'],
        queue:['Queues','00G'], group:['PublicGroups','00G']
    };
    const route=routes[entry.type];
    if(validId && route && entry.id.startsWith(route[1])) {
        const address=entry.type==='queue'?`/p/own/Queue/d?id=${entry.id}`:
            entry.type==='group'?`/setup/own/groupdetail.jsp?id=${entry.id}`:`/${entry.id}`;
        return `/lightning/setup/${route[0]}/page?address=${encodeURIComponent(address)}`;
    }
    throw new Error('This metadata item has no supported destination.');
}

export function hasDestination(entry) { try { destinationFor(entry); return true; } catch { return false; } }
