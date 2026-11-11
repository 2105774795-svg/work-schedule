/* 本地材料接收与确定性提取。未接入模型、OCR的格式明确标记，绝不冒充已理解。 */
(function(root){
  'use strict';
  const E=root.WorkPlanEngine||(typeof require==='function'&&require('./plan-engine.js'));
  const media=/\.(mp3|mp4|wav|flac|aac|ogg|oga|opus|m4a|wma|aiff|amr|mid|midi|avi|mov|mkv|webm|wmv|flv|m4v|mpeg|mpg|3gp|ts|m2ts)$/i;
  const text=/\.(txt|md|csv|tsv|json|xml|html?|log|yaml|yml|ini|rtf)$/i;
  const fields=[['scope','服务范围','本次负责|不负责|服务范围|咨询范围|工作范围'],['deliverables','交付成果','交付成果|交付要求|成果要求|成果清单'],['milestones','关键节点','关键节点|交付日期|截止日期|截止时间|里程碑'],['progressNotes','已有进展','已有进展|已完成事项|当前进展|进展情况'],['availabilityNotes','人员可用时间','人员可投入时间|人员可用时间|可投入时间'],['conditions','配合条件','前置条件|外部配合|客户配合|配合条件']];
  const MAX_FILE=20*1024*1024,MAX_EXPANDED=50*1024*1024,MAX_FILES=1000;
  async function readBytes(file){if(file.arrayBuffer)return new Uint8Array(await file.arrayBuffer());return new Promise((resolve,reject)=>{const r=new root.FileReader();r.onload=()=>resolve(new Uint8Array(r.result));r.onerror=()=>reject(Error('文件读取失败'));r.readAsArrayBuffer(file);});}
  function decode(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('gb18030').decode(bytes);}}
  function isMedia(file,bytes){
    if(media.test(file.name)||/^(audio|video)\//i.test(file.type||''))return true;
    const prefix=String.fromCharCode(...bytes.slice(0,16));
    return /^(ID3|fLaC|OggS)/.test(prefix)||prefix.slice(4,8)==='ftyp'||(prefix.startsWith('RIFF')&&/WAVE|AVI /.test(prefix));
  }
  function xml(value){const doc=new root.DOMParser().parseFromString(value,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('文档XML损坏');return doc;}
  const nodes=(doc,name)=>[...doc.getElementsByTagNameNS('*',name)];
  async function parseOffice(bytes,name,Zip){
    const zip=await Zip.loadAsync(bytes),entries=Object.values(zip.files);if(entries.length>5000)throw Error('压缩文件条目超过限制');
    let consumed=0;const read=async entry=>{const size=entry._data?.uncompressedSize;if(size>MAX_EXPANDED)throw Error('解压后的文件过大');const str=await entry.async('string');consumed+=str.length*2;if(consumed>MAX_EXPANDED)throw Error('解压后的文本超过限制');return str;};
    if(zip.file('word/document.xml')){const doc=xml(await read(zip.file('word/document.xml')));return nodes(doc,'p').map((p,i)=>({location:'文档段落 '+(i+1),text:nodes(p,'t').map(t=>t.textContent).join('')})).filter(x=>x.text);}
    if(zip.file('xl/workbook.xml')){
      const strings=zip.file('xl/sharedStrings.xml')?nodes(xml(await read(zip.file('xl/sharedStrings.xml'))),'si').map(n=>nodes(n,'t').map(t=>t.textContent).join('')):[];
      const wb=xml(await read(zip.file('xl/workbook.xml'))),rels=xml(await read(zip.file('xl/_rels/workbook.xml.rels'))),links=new Map(nodes(rels,'Relationship').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
      const chunks=[];for(const sheet of nodes(wb,'sheet')){
        const target=links.get(sheet.getAttribute('r:id'));if(!target)continue;
        const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');const entry=zip.file(path);if(!entry)continue;
        for(const row of nodes(xml(await read(entry)),'row')){
          const values=nodes(row,'c').map(c=>{const v=nodes(c,'v')[0]?.textContent||'',type=c.getAttribute('t');return {ref:c.getAttribute('r'),value:type==='s'?strings[Number(v)]||'':type==='inlineStr'?nodes(c,'t').map(n=>n.textContent).join(''):v,formula:!!nodes(c,'f').length};});
          if(values.some(c=>c.value))chunks.push({location:sheet.getAttribute('name')+'!'+(values[0]?.ref||row.getAttribute('r')),text:values.map(c=>c.value).join('：'),cachedFormula:values.some(c=>c.formula)});
        }
      }return chunks;
    }
    const slides=entries.filter(e=>/^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a,b)=>Number(a.name.match(/slide(\d+)/)[1])-Number(b.name.match(/slide(\d+)/)[1]));
    if(slides.length){const chunks=[];for(const entry of slides){const number=entry.name.match(/slide(\d+)/)[1],doc=xml(await read(entry));nodes(doc,'p').forEach((p,i)=>chunks.push({location:`幻灯片 ${number} 段落 ${i+1}`,text:nodes(p,'t').map(n=>n.textContent).join('')}));}return chunks.filter(c=>c.text);}
    return null;
  }
  function extract(chunks,fileId){
    const cards=[];for(const chunk of chunks){if(chunk.cachedFormula)continue;for(const line of chunk.text.split(/\r?\n/)){
      for(const [field,label,pattern]of fields){const match=line.match(new RegExp('(?:^|\\s)('+pattern+')[：:\\s]+(.+)'));if(!match)continue;const value=match[2].trim();if(!value||cards.some(c=>c.field===field&&c.value===value))continue;cards.push({id:E.uid(),fileId,field,label,value:value.slice(0,4000),source:{location:chunk.location,excerpt:line.slice(0,420)},status:'待核对',method:'文档字段提取'});}
    }}return cards.slice(0,100);
  }
  async function inspect(file,relativePath,Zip){
    const item={id:E.uid(),name:file.name,path:relativePath||file.webkitRelativePath||file.name,size:file.size,status:'读取中',createdAt:new Date().toISOString()};
    if(file.size>MAX_FILE)return {...item,status:'超出限制',message:'单文件上限20 MB，请拆分后重新添加',cards:[]};
    try{
      const bytes=await readBytes(file);if(isMedia(file,bytes))return {...item,status:'已跳过音视频',cards:[]};
      if(root.crypto?.subtle)item.hash=[...new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      let chunks;
      if(text.test(file.name)||/^text\//.test(file.type||'')){
        let content=decode(bytes);if(/\.html?$/i.test(file.name))content=new root.DOMParser().parseFromString(content,'text/html').body.textContent;
        chunks=content.split(/\r?\n/).filter(Boolean).slice(0,10000).map((text,i)=>({location:'文本行 '+(i+1),text}));
      }else if(/\.(docx|xlsx|pptx|docm|xlsm|pptm)$/i.test(file.name)&&Zip)chunks=await parseOffice(bytes,file.name,Zip);
      if(!chunks)return {...item,status:'仅保存附件',message:/\.(pdf|png|jpe?g|bmp|tiff?|webp)$/i.test(file.name)?'待接入PDF解析/OCR服务，尚未读取正文':'此格式尚未接入解析器，原文件可保留，未读取正文',cards:[]};
      const cards=extract(chunks,item.id);return {...item,status:'已解析',message:cards.length?`提取 ${cards.length} 条补充信息，请核对`:'已读取正文，未找到明确标注的补充字段；后续可用AI进一步分析',cards};
    }catch(err){return {...item,status:'解析失败',message:'文件可能损坏、加密或超过解析限制：'+err.message,cards:[]};}
  }
  async function filesFromDrop(data){
    const result=[];async function visit(entry,path=''){
      if(result.length>=MAX_FILES)throw Error('一次最多接收1000个文件，请分批拖入');
      if(entry.isFile){const file=await new Promise((yes,no)=>entry.file(yes,no));result.push({file,path:path+file.name});}
      else if(entry.isDirectory){const reader=entry.createReader();for(;;){const entries=await new Promise((yes,no)=>reader.readEntries(yes,no));if(!entries.length)break;for(const child of entries)await visit(child,path+entry.name+'/');}}
    }
    const items=[...(data.items||[])].filter(i=>i.kind==='file');
    if(items.length&&items.some(i=>i.webkitGetAsEntry?.())){for(const item of items){const entry=item.webkitGetAsEntry?.();if(entry)await visit(entry);else{const file=item.getAsFile?.();if(file)result.push({file,path:file.name});}}}
    else for(const file of data.files||[])result.push({file,path:file.webkitRelativePath||file.name});
    if(result.length>MAX_FILES)throw Error('一次最多接收1000个文件，请分批拖入');return result;
  }
  let dbPromise;function db(){if(!root.indexedDB)return Promise.reject(Error('当前环境不支持文件本地保存'));return dbPromise||=(new Promise((resolve,reject)=>{const req=root.indexedDB.open('work-schedule-plan-materials',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(Error('无法打开资料存储'));}));}
  async function store(projectId,item,file){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('files','readwrite');tx.objectStore('files').put(file,projectId+'/'+item.id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(Error('资料保存失败，可能磁盘空间不足'));});}
  async function retrieve(projectId,id){const d=await db();return new Promise((resolve,reject)=>{const req=d.transaction('files').objectStore('files').get(projectId+'/'+id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(Error('无法读取本地附件'));});}
  async function remove(projectId,id){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('files','readwrite');tx.objectStore('files').delete(projectId+'/'+id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(Error('附件删除失败'));});}
  const api={fields,inspect,extract,filesFromDrop,store,retrieve,remove,MAX_FILES};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkPlanMaterials=api;
})(typeof window!=='undefined'?window:globalThis);
