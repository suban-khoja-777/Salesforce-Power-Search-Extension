import * as monaco from 'monaco-editor';
self.MonacoEnvironment={getWorker(_id,label){const name={javascript:'typescript',typescript:'typescript',html:'html',handlebars:'html',razor:'html',css:'css',scss:'css',less:'css',json:'json'}[label]||'editor';return new Worker(new URL(`./${name}.worker.js`,import.meta.url),{type:'module'});}};
monaco.languages.register({id:'apex',extensions:['.cls','.trigger']});
monaco.languages.setMonarchTokensProvider('apex',{
    keywords:['public','private','protected','global','class','interface','extends','implements','virtual','abstract','override','static','final','with','without','sharing','inherited','void','new','return','if','else','for','while','try','catch','finally','throw','this','super','null','true','false','insert','update','delete','upsert','undelete','merge','select','from','where','limit','order','by','trigger','on','before','after','testmethod','transient','get','set','instanceof','break','continue'],
    typeKeywords:['String','Integer','Long','Double','Decimal','Boolean','Date','Datetime','Time','Id','Object','List','Set','Map','SObject','Database','System','Test','Exception','Trigger','Schema'],
    tokenizer:{root:[[/\/\*/, 'comment','@comment'],[/\/\/.*$/,'comment'],[/@[\w]+/,'annotation'],[/'([^'\\]|\\.)*'/,'string'],[/\b\d+(\.\d+)?\b/,'number'],[/[a-zA-Z_$][\w$]*/,{cases:{'@keywords':'keyword','@typeKeywords':'type','@default':'identifier'}}],[/[{}()[\]]/,'@brackets'],[/[=><!~?:&|+\-*\/^%]+/,'operator']],comment:[[/[^/*]+/,'comment'],[/\*\//,'comment','@pop'],[/[/*]/,'comment']]}
});
monaco.languages.setLanguageConfiguration('apex',{comments:{lineComment:'//',blockComment:['/*','*/']},brackets:[['{','}'],['[',']'],['(',')']],autoClosingPairs:[{open:'{',close:'}'},{open:'[',close:']'},{open:'(',close:')'},{open:"'",close:"'",notIn:['string','comment']}],indentationRules:{increaseIndentPattern:/\{[^}]*$/,decreaseIndentPattern:/^\s*\}/}});
const apexSnippets={
    'System.debug':'System.debug(${1:value});',
    'for each':'for (${1:Account} ${2:record} : ${3:records}) {\n\t$0\n}',
    'SOQL query':'[SELECT Id FROM ${1:Account} WHERE ${2:Name} = :${3:name}]',
    'test method':'@IsTest\nstatic void ${1:testName}() {\n\tTest.startTest();\n\t$0\n\tTest.stopTest();\n}',
    'try catch':'try {\n\t$0\n} catch (Exception e) {\n\tSystem.debug(e.getMessage());\n}'
};
let componentNames=[];
export function setComponentNames(names){componentNames=names;}
monaco.languages.registerCompletionItemProvider('apex',{provideCompletionItems(model,position){const word=model.getWordUntilPosition(position),range={startLineNumber:position.lineNumber,endLineNumber:position.lineNumber,startColumn:word.startColumn,endColumn:word.endColumn};return {suggestions:[...Object.entries(apexSnippets).map(([label,insertText])=>({label,insertText,range,kind:monaco.languages.CompletionItemKind.Snippet,insertTextRules:monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet})),...['String','Integer','Boolean','List','Set','Map','System','Database','Test','Schema','public','private','static','return',...componentNames].map(label=>({label,insertText:label,range,kind:monaco.languages.CompletionItemKind.Class}))]};}});
monaco.typescript.javascriptDefaults.setCompilerOptions({allowNonTsExtensions:true,experimentalDecorators:true,target:monaco.typescript.ScriptTarget.ESNext,noLib:false,checkJs:false});
monaco.typescript.javascriptDefaults.addExtraLib("declare module 'lwc' { export class LightningElement { template: HTMLElement; dispatchEvent(event: Event): boolean; } export function api(...args:any[]):any; export function track(...args:any[]):any; export function wire(...args:any[]):any; }",'file:///lwc.d.ts');
export {monaco};

