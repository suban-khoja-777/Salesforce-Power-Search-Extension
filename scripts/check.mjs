import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Manifest V3 is required.');
for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons || {}), ...Object.values(manifest.action.default_icon || {}), ...manifest.content_scripts.flatMap((entry) => entry.js), ...manifest.web_accessible_resources.flatMap((entry) => entry.resources)]) await access(file);
async function check(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (['dist', 'node_modules'].includes(entry.name)) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await check(file);
        else if (/\.(js|mjs)$/.test(file)) {
            const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
            if (result.status !== 0) throw new Error(result.stderr);
            console.log(`Checked ${file}`);
        }
    }
}
await check('.');
console.log('Manifest references and JavaScript syntax checked.');
