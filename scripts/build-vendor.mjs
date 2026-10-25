import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('vendor', { recursive: true });
await build({ stdin: { contents: "export { XMLParser, XMLValidator } from 'fast-xml-parser';", resolveDir: process.cwd(), sourcefile: 'xml-parser-entry.js' }, bundle: true, format: 'esm', platform: 'browser', outfile: 'vendor/xml-parser.js', minify: true, legalComments: 'eof' });
await writeFile('vendor/XML-PARSER-LICENSE.txt', await readFile('node_modules/fast-xml-parser/LICENSE', 'utf8'));
console.log('Bundled local XML parser; no remote code is loaded.');
await build({stdin:{contents:"export {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',outfile:'vendor/zip.js',minify:true});
await writeFile('vendor/FFLATE-LICENSE.txt',await readFile('node_modules/fflate/LICENSE','utf8'));
await build({entryPoints:['app/editor-engine.js'],bundle:true,format:'esm',platform:'browser',outfile:'vendor/editor.js',minify:true,loader:{'.ttf':'file'},assetNames:'[name]-[hash]',legalComments:'eof'});
for(const [name,entry] of Object.entries({editor:'editor/editor.worker',typescript:'language/typescript/ts.worker',html:'language/html/html.worker',css:'language/css/css.worker',json:'language/json/json.worker'})){
    await build({entryPoints:[`node_modules/monaco-editor/esm/vs/${entry}.js`],bundle:true,format:'esm',platform:'browser',outfile:`vendor/${name}.worker.js`,minify:true});
}
await writeFile('vendor/MONACO-LICENSE.txt',await readFile('node_modules/monaco-editor/LICENSE','utf8'));
await writeFile('vendor/MONACO-THIRD-PARTY-NOTICES.txt',await readFile('node_modules/monaco-editor/ThirdPartyNotices.txt','utf8'));
console.log('Bundled Monaco, workers and ZIP utilities locally.');
