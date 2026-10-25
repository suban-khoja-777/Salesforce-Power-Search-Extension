// Namespace metadata is authoritative; API-name fallback also handles older cached history.
export function isManaged(entry = {}) {
    if (String(entry.namespace || entry.NamespacePrefix || '').trim()) return true;
    if (/^installed/i.test(String(entry.manageableState || ''))) return true;
    const type = entry.targetType || entry.type;
    const name = String(type === 'recentrecord' ? entry.recordType || '' : entry.apiName || '');
    if (type === 'object' || type === 'recentrecord') return /^[A-Za-z][A-Za-z0-9_]*__[A-Za-z][A-Za-z0-9_]*__(?:c|mdt|e|b|x|kav|ka)$/.test(name);
    if (!['apex','trigger','lwc','aura','vfpage','vfcomponent','flow','permissionset','permissiongroup','app','valueset'].includes(type)) return false;
    return /^[A-Za-z][A-Za-z0-9_]*__[A-Za-z][A-Za-z0-9_]*$/.test(name);
}
export function localEntries(entries = []) { return entries.filter(entry => !isManaged(entry)); }
export function localResult(result) { return { ...result, entries: localEntries(result.entries) }; }
