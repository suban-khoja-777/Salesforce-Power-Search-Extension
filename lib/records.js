import {isManaged} from './visibility.js';
export const MAX_QUERY_ROWS = 10000;
export const RECORD_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
export function objectName(value) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value || '') || isManaged({type:'object',apiName:value})) throw new Error('Select a local Salesforce object.');
    return value;
}
export function baseQuery(object) { return `SELECT Id FROM ${objectName(object)}`; }
// Tokenize without reading words inside literals/comments; identify the outer FROM independently of subqueries.
export function queryTokens(query) {
    if (typeof query !== 'string' || query.length > 20000) throw new Error('SOQL must be at most 20,000 characters.');
    const tokens = []; let depth=0;
    for (let i=0;i<query.length;) {
        const c=query[i];
        if (/\s/.test(c)) {i++;continue;}
        if (query.startsWith('//',i) || query.startsWith('--',i)) {i=query.indexOf('\n',i);if(i<0)break;continue;}
        if (query.startsWith('/*',i)) {const end=query.indexOf('*/',i+2);if(end<0)throw new Error('Close the SOQL comment.');i=end+2;continue;}
        if (c==="'") {i++;let closed=false;while(i<query.length){if(query[i]==='\\'){i+=2;continue;}if(query[i++]==="'"){closed=true;break;}}if(!closed)throw new Error('Close the SOQL string literal.');continue;}
        if (c===';') throw new Error('Run one SELECT query without a semicolon.');
        if (c==='(') {depth++;i++;continue;} if(c===')'){if(--depth<0)throw new Error('Unbalanced SOQL parentheses.');i++;continue;}
        const match=query.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
        if(match){tokens.push({word:match[0],depth});i+=match[0].length;}else{i++;}
    }
    if(depth)throw new Error('Unbalanced SOQL parentheses.');return tokens;
}
export function validateQuery(query, selectedObject) {
    objectName(selectedObject); const tokens=queryTokens(query);
    if(tokens[0]?.word.toUpperCase()!=='SELECT')throw new Error('Only SELECT queries are supported.');
    const from=tokens.findIndex(t=>t.depth===0 && t.word.toUpperCase()==='FROM');
    if(from<0 || tokens[from+1]?.word.toLowerCase()!==selectedObject.toLowerCase())throw new Error(`The outer FROM must use ${selectedObject}.`);
    if(tokens.some((token,index)=>token.word.toUpperCase()==='FOR' && ['UPDATE','VIEW','REFERENCE'].includes(tokens[index+1]?.word.toUpperCase())))throw new Error('Record-locking and view/reference updates are not supported.');
    for(const token of tokens) if(/^[A-Za-z][A-Za-z0-9_]*__[A-Za-z][A-Za-z0-9_]*__(?:c|r|mdt|e|b|x)$/i.test(token.word))throw new Error('Managed package objects and fields are excluded.');
    return query.trim();
}
export function fieldSuggestions(query,caret,fields) {
    const before=query.slice(0,caret), match=before.match(/(?:^|[\s,(])([A-Za-z_][A-Za-z0-9_]*)?$/);
    if(!match || /\.\w*$/.test(before))return [];
    const prefix=(match[1] || '').toLowerCase();
    // Do not suggest fields in the object-name position or inside an unfinished literal/comment.
    if(/\bFROM\s+\w*$/i.test(before))return [];
    const clean=before.replace(/'(?:\\.|[^'\\])*'/g,''); if((clean.match(/'/g)||[]).length)return [];
    return fields.filter(f=>f.name.toLowerCase().startsWith(prefix)||f.label.toLowerCase().startsWith(prefix)).slice(0,12);
}
export function insertField(query,caret,name) {
    const start=query.slice(0,caret).match(/[A-Za-z0-9_]*$/)[0].length;
    const end=query.slice(caret).match(/^[A-Za-z0-9_]*/)[0].length;
    return {query:query.slice(0,caret-start)+name+query.slice(caret+end),caret:caret-start+name.length};
}
export function valueText(value) {return value==null?'':typeof value==='object'?JSON.stringify(value, (key,item)=>key==='attributes'?undefined:item):String(value);}
export function flattenRecord(record,prefix='',result=Object.create(null),depth=0) {
    for(const [key,value] of Object.entries(record || {})){
        if(['attributes','__proto__','constructor','prototype'].includes(key))continue;
        const name=prefix?`${prefix}.${key}`:key;
        if(value && typeof value==='object' && !Array.isArray(value) && !('records' in value) && depth<8)flattenRecord(value,name,result,depth+1);
        else result[name]=value;
    }return result;
}
export function resultColumns(rows) {const names=[...new Set(rows.flatMap(row=>Object.keys(row)))];return names.filter(name=>!names.some(other=>other.startsWith(name+'.')));}
export function filterRows(rows,search,columns) {const term=search.trim().toLowerCase();return term?rows.filter(row=>columns.some(column=>valueText(row[column]).toLowerCase().includes(term))):rows;}
export function csvText(rows,columns) {
    const cell=(value)=>{let text=valueText(value);if(typeof value==='string' && /^[\s]*[=+\-@\t\r]/.test(value))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
    return '\uFEFF'+[columns.map(cell).join(','),...rows.map(row=>columns.map(column=>cell(row[column])).join(','))].join('\r\n')+'\r\n';
}
export function recordUrl(origin,object,id) {objectName(object);if(!RECORD_ID.test(id || ''))throw new Error('Include Id in your query to open records.');const url=new URL(origin);if(url.protocol!=='https:' || url.username || url.password || url.port || !/\.(?:lightning\.force\.com|my\.salesforce(?:-setup)?\.com)$/.test(url.hostname))throw new Error('Invalid Salesforce record origin.');return `${url.origin}/lightning/r/${encodeURIComponent(object)}/${id}/view`;}
// Find the outer SELECT list without treating nested queries or quoted text as its FROM.
export function addSelectField(query,name) {
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))throw new Error('Invalid field name.');
    let depth=0,from=-1,start=-1;
    for(let i=0;i<query.length;){
        if(query.startsWith('/*',i)){const end=query.indexOf('*/',i+2);if(end<0)break;i=end+2;continue;}
        if(query.startsWith('//',i)||query.startsWith('--',i)){const end=query.indexOf('\n',i);if(end<0)break;i=end+1;continue;}
        if(query[i]==="'"){i++;while(i<query.length){if(query[i]==='\\'){i+=2;continue;}if(query[i++]==="'")break;}continue;}
        if(query[i]==='('){depth++;i++;continue;}if(query[i]===')'){depth--;i++;continue;}
        const token=query.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
        if(token){const word=token[0].toUpperCase();if(depth===0&&word==='SELECT'&&start<0)start=i+token[0].length;if(depth===0&&word==='FROM'){from=i;break;}i+=token[0].length;}else i++;
    }
    if(start<0||from<start)throw new Error('Complete SELECT … FROM before adding a field from the list.');
    const list=query.slice(start,from).trim();
    if(list.split(',').some(field=>field.trim().toLowerCase()===name.toLowerCase()))return query;
    // Do not append after a line comment or incomplete expression.
    if(/\/\*|\/\/|--/.test(list))throw new Error('Add fields directly in the editor when the SELECT list contains comments.');
    return query.slice(0,start)+' '+list.replace(/,\s*$/,'')+(list?', ':'')+name+' '+query.slice(from);
}
// Small completion lexer: retains spans and incomplete literals while ignoring comments.
function completionTokens(source) {
    const tokens=[];let comment=false;
    for(let i=0;i<source.length;){
        if(/\s/.test(source[i])){i++;continue;}
        if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);if(end<0){comment=true;break;}i=end+2;continue;}
        if(source.startsWith('//',i)||source.startsWith('--',i)){const end=source.indexOf('\n',i);if(end<0){comment=true;break;}i=end+1;continue;}
        const start=i;
        if(source[i]==="'"){i++;while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i++]==="'")break;}i=Math.min(i,source.length);tokens.push({start,end:i,text:source.slice(start,i),kind:'literal'});continue;}
        const match=source.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*|^(?:!=|<=|>=|<>|=|<|>)/);
        i+=match?match[0].length:1;tokens.push({start,end:i,text:source.slice(start,i),kind:'token'});
    }
    return {tokens,comment};
}
export function whereValueSuggestions(query,caret,fields) {
    const {tokens,comment}=completionTokens(query.slice(0,caret));if(comment)return [];
    const scopes=[{where:false,subquery:false}];let nested=0;
    for(const token of tokens){const word=token.kind==='literal'?'':token.text.toUpperCase();
        if(word==='(')scopes.push({where:scopes.at(-1).where,subquery:false});
        else if(word===')'){if(scopes.length>1){if(scopes.pop().subquery)nested--;}}
        else if(word==='SELECT'){scopes.at(-1).where=false;if(scopes.length>1&&!scopes.at(-1).subquery){scopes.at(-1).subquery=true;nested++;}}
        else if(word==='WHERE')scopes.at(-1).where=true;
        else if(['ORDER','GROUP','LIMIT','OFFSET','HAVING','WITH'].includes(word))scopes.at(-1).where=false;
    }
    if(!scopes.at(-1).where||nested)return null;
    for(let index=tokens.length-1;index>=0;index--){
        const token=tokens[index],field=fields.find(field=>field.name.toLowerCase()===token.text.toLowerCase());
        if(!field||token.kind==='literal'||!['WHERE','AND','OR','NOT','('].includes(tokens[index-1]?.text.toUpperCase()))continue;
        const tail=tokens.slice(index+1);let current=null,implicit=false;
        if(!tail.length){if(/^\s*(?:[=!<>]|(?:NOT\s+)?IN\b|INCLUDES\b|EXCLUDES\b|LIKE\b)/i.test(query.slice(caret)))return null;implicit=true;}
        else if(['=','!=','<>','<','>','<=','>=','LIKE'].includes(tail[0].text.toUpperCase())){if(tail.length>2)return null;current=tail[1]||null;}
        else {
            let offset=tail[0].text.toUpperCase()==='NOT'?1:0;
            if(!['IN','INCLUDES','EXCLUDES'].includes(tail[offset]?.text.toUpperCase())||tail[offset+1]?.text!=='(')return null;
            const values=tail.slice(offset+2);if(values.some(t=>['SELECT',')'].includes(t.text.toUpperCase())))return null;
            current=values.at(-1)?.text===','?null:values.at(-1)||null;
        }
        if(current && current.kind!=='literal'&&!/^[A-Za-z0-9_]*$/.test(current.text))return null;
        // A completed value followed by whitespace is no longer being edited.
        if(current&&current.end<caret)return null;
        const prefix=current?(current.kind==='literal'?current.text.slice(1).replace(/'$/,'').replace(/\\(.)/g,'$1'):current.text).toLowerCase():'';
        const picklist=['picklist','multipicklist'].includes(field.type);
        const options=picklist?(field.picklistValues||[]).map(item=>({value:item.value,label:item.label||item.value,active:item.active})):(field.type==='boolean'?[{value:'true'},{value:'false'}]:[{value:'null'}]);
        const start=current?current.start:caret,full=current?completionTokens(query).tokens.find(t=>t.start===current.start):null,end=full?.end||caret;
        return options.filter(item=>String(item.value).toLowerCase().includes(prefix)||String(item.label||'').toLowerCase().includes(prefix)).map(item=>{
            const literal=picklist?"'"+String(item.value).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r/g,'\\r').replace(/\n/g,'\\n').replace(/\t/g,'\\t')+"'":item.value;
            const addition=implicit?(field.type==='multipicklist'?` INCLUDES (${literal})`:` = ${literal}`):literal;
            return {kind:'value',name:String(item.value),label:item.label||String(item.value),type:`${field.name}${item.active===false?' · inactive':''}`,start,end,insert:implicit&&/\s$/.test(query.slice(0,caret))?addition.trimStart():addition};
        });
    }
    return null;
}
export function insertWhereValue(query,suggestion) {
    return {query:query.slice(0,suggestion.start)+suggestion.insert+query.slice(suggestion.end),caret:suggestion.start+suggestion.insert.length};
}
