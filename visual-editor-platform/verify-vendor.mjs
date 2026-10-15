import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const folder=dirname(fileURLToPath(import.meta.url));
const lock=JSON.parse(await readFile(join(folder,'vendor-lock.json'),'utf8'));
if(lock.schemaVersion!==1||lock.package!=='@kinotch/visual-editor-platform'||!/^([a-f0-9]{40})$/.test(lock.sourceCommit))throw Error('BAD_VENDOR_LOCK');
const names=Object.keys(lock.files);
if(!names.length||names.some(name=>!/^([a-z][a-z0-9-]*\.mjs|package\.json)$/.test(name)))throw Error('BAD_VENDOR_PATH');
for(const name of names){
 const buffer=await readFile(join(folder,name));
 const hash=createHash('sha1').update('blob '+buffer.length+'\0').update(buffer).digest('hex');
 if(hash!==lock.files[name])throw Error('VENDOR_BLOB_MISMATCH: '+name+' expected='+lock.files[name]+' actual='+hash);
}
console.log('Pinned visual-editor package verified offline: '+lock.sourceCommit+' '+names.length+' files');
