/* 原始案例库不变；本项目树独立生成。前后端共用校验和合并规则。 */
(function(root){
  'use strict';
  const B=root.WorkPlanBuilder||(typeof require==='function'&&require('./plan-builder.js'));
  const E=root.WorkPlanEngine||(typeof require==='function'&&require('./plan-engine.js'));
  const clone=B.clone;
  const keys=['name','description','startDate','endDate','taskScale','scope','deliverables','milestones','progressNotes','availabilityNotes','conditions'];
  const context=p=>Object.fromEntries(keys.map(k=>[k,String(p[k]||'').slice(0,20000)]));
  const fingerprint=p=>JSON.stringify(context(p));
  const revision=p=>JSON.stringify([fingerprint(p),p.tree,p.tasks,p.taskCache]);
  const stale=p=>!p.adaptation||p.adaptation.fingerprint!==fingerprint(p);
  function generatedScale(p){
    if(p.adaptation?.generationScale)return p.adaptation.generationScale;
    try{return JSON.parse(p.adaptation?.fingerprint||'null')?.taskScale||null;}catch{return null;}
  }
  function checkText(p,text){
    const c=JSON.stringify(context(p)),related=/农|食品|冷链|水产|物流|仓储|种植|养殖/.test(c),industry=new Set(['食品加工','农产品','冷链物流','产地市场','水产市场']);
    for(const name of ['示例产业园咨询计划','食品加工','农产品','冷链物流','产地市场','水产市场']){
      if(!c.includes(name)&&text.includes(name)&&!(related&&industry.has(name)))throw Error('适配结果仍含原案例或无关行业内容：'+name);
    }
  }
  function emptyTree(){return B.catalog().map(m=>({...m,children:[]}));}
  function add(tree,code,category,t){
    const m=tree.find(m=>m.sourceCode===code);if(!m)throw Error('不支持的业务模块');
    let c=m.children.find(c=>c.name===category);if(!c){c={id:'adapt-direction-'+code+'-'+m.children.length,type:'category',name:category,children:[]};m.children.push(c);}
    const duplicate=c.children.some(x=>x.work.replace(/\s/g,'')===t.work.replace(/\s/g,''));if(duplicate)throw Error('适配结果存在重复任务：'+t.work);
    c.children.push({...t,type:'task',selected:!['A','X','Z'].includes(code)});
  }
  function local(p){
    // 未调用模型时只建立空工作区，不再从简略框架静默产出75/76项。
    return {tree:emptyTree(),mode:'pending',summary:'尚未生成项目任务。请选择任务规模并调用AI生成，也可以手动新增工作。演示任务可用于了解工作拆分方法。',assumptions:[]};
  }
  const normalized=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
  function similar(a,b){const grams=s=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));const x=grams(a),y=grams(b);return x.size&&y.size?2*[...x].filter(g=>y.has(g)).length/(x.size+y.size):0;}
  function duplicates(rows){
    const exact=[],suspected=[];
    for(let i=0;i<rows.length;i++)for(let j=0;j<i;j++){
      const a=rows[i].task,b=rows[j].task,w=normalized(a.work),v=normalized(b.work),o=normalized(a.output),q=normalized(b.output);
      const sameActivity=a.taskObject&&b.taskObject&&normalized(a.taskObject)===normalized(b.taskObject)&&a.activity&&b.activity&&normalized(a.activity)===normalized(b.activity);
      if(o===q&&(w===v||sameActivity)){exact.push({id:a.id,otherId:b.id,work:a.work,otherWork:b.work});break;}
      // 同成果且高度近似才提示，保留对象/地块不同的合法任务供用户判断。
      if(sameActivity||o===q&&similar(w,v)>=.82){suspected.push({id:a.id,otherId:b.id,work:a.work,otherWork:b.work});break;}
    }
    return {exact,suspected};
  }
  function statistics(p,tree=p.tree){
    const rows=B.flatten(tree),selected=rows.filter(r=>r.task.selected),scale=B.taskScale(p),n=selected.length;
    return {total:rows.length,selected:n,unselected:rows.length-n,scale,inRange:!!scale&&n>=scale.min&&n<=scale.max,rangeText:!scale?'请选择任务规模':n<scale.min?`比目标下限少${scale.min-n}项`:n>scale.max?`比目标上限多${n-scale.max}项`:'在初稿目标范围内',duplicates:duplicates(selected)};
  }
  function limitAutomaticSelection(p,tree,heldIds=new Set()){
    const scale=B.taskScale(p);if(!scale)return;
    const directions=new Map();let keptSelected=0,eligible=0;
    for(const {category,task} of B.flatten(tree)){
      if(heldIds.has(task.id)){if(task.selected)keptSelected++;continue;}
      if(!task.selected&&!task.scaleDeferred)continue;
      if(!directions.has(category.id))directions.set(category.id,[]);
      directions.get(category.id).push(task);eligible++;
    }
    const slots=Math.max(0,scale.max-keptSelected),allowed=new Set();
    // 优先覆盖不同方向，方向内沿用模型顺序。超出名额的工作仍可手动勾选。
    for(let index=0;allowed.size<Math.min(slots,eligible);index++){
      for(const tasks of directions.values()){
        if(tasks[index])allowed.add(tasks[index].id);
        if(allowed.size===slots)break;
      }
    }
    for(const tasks of directions.values())for(const task of tasks){
      task.selected=allowed.has(task.id);
      if(task.selected)delete task.scaleDeferred;else task.scaleDeferred=true;
    }
    return {limit:scale.max,keptSelected,autoSelected:allowed.size,deferred:eligible-allowed.size,protectedOverLimit:Math.max(0,keptSelected-scale.max)};
  }
  function fromOpenModel(p,result){
    if(!result||typeof result.summary!=='string'||!result.summary.trim()||!Array.isArray(result.tasks)||!result.tasks.length||result.tasks.length>500)throw Error('开放生成结果缺少有效任务或超出单次500项保护上限');
    if(typeof result.countExplanation!=='string'||!result.countExplanation.trim())throw Error('模型必须说明任务数量与服务范围的关系');
    const tree=emptyTree(),removed=[],referenceWarnings=[],sources=new Map(B.flatten(B.catalog()).filter(r=>r.task.sourceSeq).map(r=>[r.task.sourceSeq,r.task]));
    for(const raw of result.tasks){
      for(const [key,max] of [['moduleCode',3],['moduleName',160],['category',160],['work',1000],['output',2000],['reason',1000]])if(typeof raw[key]!=='string'||!raw[key].trim()||raw[key].length>max)throw Error('模型任务字段不正确：'+key);
      if(!/^[A-Z]{1,3}$/.test(raw.moduleCode))throw Error('新增大类编号不正确');
      checkText(p,raw.work+' '+raw.output+' '+raw.category);
      let m=tree.find(m=>m.sourceCode===raw.moduleCode);if(!m){m={id:'module-'+raw.moduleCode,type:'module',sourceCode:raw.moduleCode,name:raw.moduleName,skills:[],children:[]};tree.push(m);}else m.name=raw.moduleName.trim();
      const t={id:'ai-task-'+E.uid(),type:'task',work:raw.work.trim(),output:raw.output.trim(),adaptReason:raw.reason.trim(),taskObject:typeof raw.taskObject==='string'?raw.taskObject.slice(0,300):'',activity:typeof raw.activity==='string'?raw.activity.slice(0,300):'',selected:raw.selected!==false&&!['A','X','Z'].includes(raw.moduleCode),sourceReferences:[]};
      if(raw.sourceReferences!==undefined){
        const refs=Array.isArray(raw.sourceReferences)?raw.sourceReferences:[],ids=refs.map(id=>typeof id==='string'&&/^\d{1,3}$/.test(id)?Number(id):id),valid=ids.filter(id=>sources.has(id));
        t.sourceReferences=[...new Set(valid)];if(!Array.isArray(raw.sourceReferences)||valid.length!==ids.length)referenceWarnings.push(t.work);
      }
      const rows=B.flatten(tree),duplicate=rows.some(row=>duplicates([row,{task:t}]).exact.length);if(duplicate){removed.push(t.work);continue;}
      let c=m.children.find(c=>normalized(c.name)===normalized(raw.category));if(!c){c={id:'ai-direction-'+E.uid(),type:'category',name:raw.category.trim(),children:[]};m.children.push(c);}c.children.push(t);
    }
    if(!B.flatten(tree).length)throw Error('去重后没有有效任务');B.validateTree(tree);
    const selectionBudget=limitAutomaticSelection(p,tree),stats=statistics(p,tree);
    const assumptions=Array.isArray(result.assumptions)?result.assumptions.filter(s=>typeof s==='string').slice(0,29):[];
    if(referenceWarnings.length)assumptions.push(`${referenceWarnings.length}项任务含无法核对的参考编号，已剔除这些编号，不作为参考依据；请核对任务范围。`);
    return {tree,mode:'model',generation:'open-v1',summary:result.summary.slice(0,2000),countExplanation:result.countExplanation.slice(0,3000),assumptions,audit:[],duplicateRemoved:removed,rangeStatus:stats.rangeText,selectionBudget};
  }
  function fromModel(p,result){
    if(!result||typeof result.summary!=='string'||!Array.isArray(result.decisions)||!Array.isArray(result.additions))throw Error('模型结果结构不完整');
    const originals=B.flatten(B.catalog()).filter(r=>r.task.sourceSeq),ids=new Set(originals.map(r=>r.task.sourceSeq)),seen=new Set(),tree=emptyTree();
    const validate=t=>{for(const [key,max] of [['work',1000],['output',2000],['category',160],['reason',1000]])if(typeof t[key]!=='string'||!t[key].trim()||t[key].length>max)throw Error('模型任务字段不正确：'+key);checkText(p,t.work+' '+t.output+' '+t.category);};
    for(const d of result.decisions){
      if(!ids.has(d.sourceId)||seen.has(d.sourceId))throw Error('原任务映射遗漏或重复');seen.add(d.sourceId);
      if(!['keep','rewrite','exclude'].includes(d.action)||typeof d.reason!=='string'||!d.reason.trim())throw Error('模型任务判断缺少有效原因');
      if(d.action==='exclude')continue;validate(d);
      const raw=originals.find(r=>r.task.sourceSeq===d.sourceId).task;
      add(tree,d.moduleCode,d.category,{id:raw.id,work:d.work,output:d.output,sourceSeq:d.sourceId,original:clone(raw.original),adaptReason:d.reason});
    }
    if(seen.size!==ids.size)throw Error('模型未逐项审阅参考任务，请重试');
    if(result.additions.length>200)throw Error('新增任务过多');
    result.additions.forEach((t,i)=>{validate(t);add(tree,t.moduleCode,t.category,{id:'ai-task-'+E.uid(),work:t.work,output:t.output,adaptReason:t.reason});});
    if(!B.flatten(tree).length)throw Error('模型没有生成任何可执行任务');B.validateTree(tree);
    return {tree,mode:'model',summary:result.summary.slice(0,2000),assumptions:Array.isArray(result.assumptions)?result.assumptions.filter(v=>typeof v==='string').slice(0,30):[],audit:result.decisions.map(d=>({sourceId:d.sourceId,action:d.action,reason:d.reason}))};
  }
  function preview(p,candidate){
    B.validateTree(candidate.tree);const next=clone(candidate.tree),oldRows=B.flatten(p.tree),base=p.adaptation?.baseline||null,protectedIds=[];
    const oldById=new Map(oldRows.map(r=>[r.task.id,r.task]));
    // 新生成的相同任务沿用原ID，避免已有安排与同内容新任务并排重复。
    if(candidate.generation==='open-v1'){
      const used=new Set();for(const row of B.flatten(next)){const old=oldRows.find(r=>!used.has(r.task.id)&&normalized(r.task.work)===normalized(row.task.work)&&normalized(r.task.output)===normalized(row.task.output));if(old){row.task.id=old.task.id;used.add(old.task.id);}}
    }
    const baseline=Object.fromEntries(B.flatten(next).map(r=>[r.task.id,{work:r.task.work,output:r.task.output,category:r.category.name,module:r.module.id,selected:r.task.selected,scaleDeferred:!!r.task.scaleDeferred}]));
    // 用户改写、自建、锁定、有投入或已形成月历的任务，不由模型静默覆盖。
    for(const row of oldRows){
      const {task:t,category:c,module:m}=row,origin=base?.[t.id],custom=!t.original&&!t.localDraft&&!origin;
      const changed=origin&&(t.work!==origin.work||t.output!==origin.output||c.name!==origin.category||m.id!==origin.module);
      const generated=p.tasks.find(x=>x.id===t.id)||p.taskCache?.[t.id];
      if(!custom&&!changed&&!generated)continue;
      // 尚未适配的全新案例叶子不属于用户自建项。
      if(!p.adaptation&&!t.original&&t.id.startsWith('suggested-')&&!generated)continue;
      protectedIds.push(t.id);const existing=B.find(next,t.id);if(existing)existing.siblings.splice(existing.siblings.indexOf(existing.node),1);
      let target=next.find(x=>x.id===m.id);if(!target){target={...clone(m),children:[]};next.push(target);}
      let parent=target.children.find(x=>x.id===c.id||x.name===c.name);if(!parent){parent={...clone(c),children:[]};target.children.push(parent);}parent.children.push(clone(t));
    }
    const heldIds=new Set(protectedIds);
    if(base)for(const {task} of B.flatten(next)){
      const previous=oldById.get(task.id);
      if(!previous)continue;
      const original=base[task.id];
      // 已有安排、人工变化和旧未选项继续保留。仍是原推荐的未排期项可按新档位重新选量。
      if(heldIds.has(task.id)||!previous.selected||typeof original?.selected!=='boolean'||previous.selected!==original.selected){
        task.selected=previous.selected;heldIds.add(task.id);
      }
    }
    for(const m of p.tree){
      const raw=B.catalog().find(x=>x.id===m.id);let target=next.find(x=>x.id===m.id);
      if(!target&&!raw){target={...clone(m),children:[]};next.push(target);}
      if(target&&(!raw||m.name!==raw.name))target.name=m.name;
      if(target)for(const c of m.children.filter(c=>!c.children.length))if(!target.children.some(x=>x.id===c.id))target.children.push(clone(c));
    }
    if(p.renumbered){const order=p.tree.map(m=>m.id);next.sort((a,b)=>(order.indexOf(a.id)<0?1000:order.indexOf(a.id))-(order.indexOf(b.id)<0?1000:order.indexOf(b.id)));}
    const selectionBudget=candidate.generation==='open-v1'?limitAutomaticSelection(p,next,heldIds):undefined;
    if(selectionBudget)for(const {task} of B.flatten(next)){
      if(heldIds.has(task.id)||!baseline[task.id])continue;
      baseline[task.id].selected=task.selected;
      baseline[task.id].scaleDeferred=!!task.scaleDeferred;
    }
    return {tree:next,protectedIds,taskCount:B.flatten(next).length,summary:candidate.summary,baseline,selectionBudget};
  }
  function apply(plan,candidate){
    const p=clone(plan);
    const merged=preview(p,candidate);B.validateTree(merged.tree);
    p.tree=merged.tree;p.adaptation={fingerprint:fingerprint(p),generationScale:candidate.mode==='model'?p.taskScale:null,mode:candidate.mode,generation:candidate.generation,summary:candidate.summary,countExplanation:candidate.countExplanation||'',duplicateRemoved:candidate.duplicateRemoved||[],assumptions:candidate.assumptions||[],audit:candidate.audit||[],referenceProfile:candidate.referenceProfile,performance:candidate.performance,protectedIds:merged.protectedIds,at:new Date().toISOString(),baseline:merged.baseline,selectionBudget:merged.selectionBudget};
    if(p.tasks.length)B.generate(p);Object.assign(plan,p);return merged;
  }
  function restoreRecommended(p){
    const meta=p.adaptation;
    if(meta?.generation!=='open-v1'){B.applyRecommendations(p);return;}
    const baseline=meta.baseline||{};
    if(!Object.values(baseline).some(t=>typeof t.selected==='boolean'))throw Error('这份旧稿没有保存推荐勾选记录，可手动调整或按当前档位另建方案');
    const heldIds=new Set([...(meta.protectedIds||[]),...p.tasks.map(t=>t.id),...Object.keys(p.taskCache||{})]);
    for(const {module,category,task} of B.flatten(p.tree)){
      const original=baseline[task.id];
      if(!original||typeof original.selected!=='boolean'||task.work!==original.work||task.output!==original.output||category.name!==original.category||module.id!==original.module)heldIds.add(task.id);
      if(heldIds.has(task.id))continue;
      task.selected=original.selected;
      if(original.scaleDeferred)task.scaleDeferred=true;else delete task.scaleDeferred;
    }
    meta.selectionBudget=limitAutomaticSelection(p,p.tree,heldIds);
  }
  const api={context,fingerprint,revision,stale,generatedScale,local,fromModel,fromOpenModel,statistics,duplicates,preview,apply,restoreRecommended};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkPlanAdaptation=api;
})(typeof window!=='undefined'?window:globalThis);
