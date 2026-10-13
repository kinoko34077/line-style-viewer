(function(root){
'use strict';
function createLineTxt(doc){
  const clean=x=>String(x||'').replace(/[\r\n\t]/g,' ').trim();
  const self=clean(doc.self)||'自分';
  const out=['[LINE] '+(clean(doc.title)||'トーク')+'とのトーク履歴','# user: '+self,''];
  for(const item of doc.items){
    if(item.type==='date'){out.push(String(item.content));continue;}
    const time=String(item.time||'');
    const content=String(item.content||'');
    const speaker=item.side==='me'?self:clean(item.speaker)||'相手';
    out.push(time+'\t'+speaker+'\t'+content);
  }
  return out.join('\n')+'\n';
}
const api={createLineTxt};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(root)root.LineTxtExport=api;
})(typeof window!=='undefined'?window:null);
