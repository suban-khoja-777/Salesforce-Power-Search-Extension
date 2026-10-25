// Folder access stays in the top-level editor page. Nothing here runs in a content script.
export function createLocalProject(){
    let directory=null,orgKey=null;const expected=new Map();
    async function fileHandle(path,create=false){
        if(!/^[A-Za-z0-9_.\/-]+$/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Unsafe local file path.');
        const parts=path.split('/');let parent=directory;for(const part of parts.slice(0,-1))parent=await parent.getDirectoryHandle(part,{create});return parent.getFileHandle(parts.at(-1),{create});
    }
    async function read(path){try{return await (await (await fileHandle(path)).getFile()).text();}catch(error){if(error.name==='NotFoundError')return null;throw error;}}
    async function write(path,text){const stream=await (await fileHandle(path,true)).createWritable();try{await stream.write(text);await stream.close();}catch(error){try{await stream.abort();}catch{}throw error;}}
    async function connect(handle,key){const previous=directory;directory=handle;try{const marker=await read('.power-search-project.json');if(marker){let data;try{data=JSON.parse(marker);}catch{throw new Error('Invalid Power Search project marker. Choose a different folder.');}if(data.orgKey!==key)throw new Error('This folder belongs to another Salesforce org. Choose a different folder.');}orgKey=key;expected.clear();return handle.name;}catch(error){directory=previous;throw error;}}
    async function preflight(files){if(!directory)throw new Error('Choose a project folder first.');if(await directory.queryPermission({mode:'readwrite'})!=='granted')throw new Error('Local folder permission expired. Choose the folder again.');for(const [path,text] of Object.entries(files)){const current=await read(path);if(expected.has(path)?current!==expected.get(path):current!==null&&current!==text)throw new Error(`Local file changed or already contains different content: ${path}. Download your edits and merge before syncing.`);}}
    async function save(files){await preflight(files);const written=[];try{for(const [path,text] of Object.entries(files)){await write(path,text);expected.set(path,text);written.push(path);}await write('.power-search-project.json',JSON.stringify({orgKey,format:'metadata-api',version:1},null,2));}catch(error){throw new Error(`Local write stopped after ${written.length} file(s): ${error.message}`);}return written.length;}
    return {connect,preflight,save,get name(){return directory?.name||null;}};
}
