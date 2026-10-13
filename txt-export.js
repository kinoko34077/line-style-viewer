(function(root){
'use strict';
const clean=x=>String(x??'').replace(/[\r\n\t]/g,' ').trim();
const pad=x=>String(x).padStart(2,'0');
function lineDate(value,year){
  const text=String(value||'').trim();
  let m=/^(\d{4})\/(\d{1,2})\/(\d{1,2})(\([^)]+\))?$/.exec(text);
  if(!m)m=/^(\d{4})年(\d{1,2})月(\d{1,2})日(\([^)]+\))?$/.exec(text);
  if(!m){const s=/^(\d{1,2})\/(\d{1,2})(\([^)]+\))?$/.exec(text);if(s)m=[s[0],String(year),s[1],s[2],s[3]];}
  if(!m)return null;
  const y=+m[1],mo=+m[2],d=+m[3],day=new Date(y,mo-1,d);
  if(y<1||day.getFullYear()!==y||day.getMonth()!==mo-1||day.getDate()!==d)return null;
  return y+'/'+pad(mo)+'/'+pad(d)+(m[4]||'');
}
function bodyText(v){
  const s=String(v??'').replace(/\r\n|\r/g,'\n');
  return /[\n"]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function createLineTxt(doc,now=new Date()){
  if(!doc||!Array.isArray(doc.items))throw Error('編集データが不正です');
  const self=clean(doc.self)||'自分',title=clean(doc.title)||'トーク';
  const peer=(doc.participants||[]).map(p=>clean(p?.name)).find(n=>n&&n!==self)||'相手';
  const out=['[LINE] '+title+'とのトーク履歴','保存日時：'+[now.getFullYear(),pad(now.getMonth()+1),pad(now.getDate())].join('/')+' '+pad(now.getHours())+':'+pad(now.getMinutes()),'# user: '+self,''];
  for(const item of doc.items){
    if(!item)continue;
    if(item.type==='date'){
      const date=lineDate(item.content,now.getFullYear());
      if(date)out.push(date);
      else out.push('# system-json: '+JSON.stringify({time:'',content:String(item.content||'')}));
      continue;
    }
    const time=String(item.time??''),content=item.content==='[スタンプ]'?'[スタンプ]':item.media?.data?(item.media.mime?.startsWith('image/')?'[写真]':item.media.mime?.startsWith('video/')?'[動画]':'[ファイル]'):String(item.content??'');
    if(item.type==='system'||item.side==='system'){
      out.push('# system-json: '+JSON.stringify({time,content}));continue;
    }
    const speaker=item.side==='me'?self:(clean(item.speaker)&&clean(item.speaker)!==self?clean(item.speaker):peer);
    if(!/^\d{1,2}:\d{2}$/.test(time)){
      out.push('# entry-json: '+JSON.stringify({time,content,speaker,kind:item.type||'text'}));continue;
    }
    out.push(time+'\t'+speaker+'\t'+bodyText(content));
  }
  return out.join('\n')+'\n';
}
const api={createLineTxt,lineDate,bodyText};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(root)root.LineTxtExport=api;
})(typeof window!=='undefined'?window:null);
