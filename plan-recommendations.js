/* 三个新增入口共用的层级、去重与原子添加规则；不负责排期与人天。 */
(function(root){
  'use strict';
  const B=root.WorkPlanBuilder||(typeof require==='function'&&require('./plan-builder.js'));
  const A=root.WorkPlanAdaptation||(typeof require==='function'&&require('./plan-adaptation.js'));
  const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
  function path(plan,type,parentId){
    if(!['module','category','task'].includes(type))throw Error('推荐层级不正确');
    if(type==='module'){if(parentId)throw Error('业务大类不能指定父级');return [];}
    const parent=B.find(plan.tree,parentId);
    if(!parent||parent.node.type!==(type==='category'?'module':'category'))throw Error('推荐父级已不存在或层级不正确');
    return type==='category'?[{id:parent.node.id,name:parent.node.name}]:[{id:parent.parent.id,name:parent.parent.name},{id:parent.node.id,name:parent.node.name}];
  }
  const label=(item,type)=>type==='task'?item.work:item.name;
  function existing(plan,type,parentId){
    // 同名任务即使放在另一方向，也不重复推荐；方向则限定在同一业务大类。
    return type==='module'?plan.tree:type==='category'?B.find(plan.tree,parentId).node.children:B.flatten(plan.tree).map(r=>r.task);
  }
  function duplicate(value,items,type){return items.some(item=>normalize(label(item,type))===normalize(label(value,type)));}
  function request(plan,type,parentId='',seen=[],round=0){
    B.validateTree(plan.tree);const parents=path(plan,type,parentId);
    if(!plan.name?.trim()||!plan.description?.trim())throw Error('请先填写项目名称和内容');
    const tree=plan.tree.map(m=>({id:m.id,type:'module',name:m.name,children:m.children.map(c=>({id:c.id,type:'category',name:c.name,children:c.children.map(t=>({id:t.id,type:'task',work:t.work,output:t.output,selected:!!t.selected}))}))}));
    return {project:A.context(plan),tree,type,parentId,parents,seen:seen.slice(-300).map(t=>({name:String(t.name||'').slice(0,160),work:String(t.work||'').slice(0,1000),output:String(t.output||'').slice(0,2000)})),round};
  }
  const fingerprint=(plan,type,parentId='')=>JSON.stringify(request(plan,type,parentId));
  function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
  function validateCandidate(item,type){
    for(const [key,max]of (type==='task'?[['work',1000],['output',2000]]:[['name',160]]))if(typeof item?.[key]!=='string'||!item[key].trim()||item[key].length>max)throw Error('候选'+key+'不能为空或超过长度限制');
  }
  function add(plan,type,parentId,candidates,expected){
    if(expected!==fingerprint(plan,type,parentId))throw Error('项目资料或任务树已变化，请重新推荐后添加');
    if(!Array.isArray(candidates)||!candidates.length||candidates.length>2)throw Error('请选择一个或两个候选');
    const draft=B.clone(plan),added=[];
    path(draft,type,parentId);
    for(const candidate of candidates){
      validateCandidate(candidate,type);
      if(duplicate(candidate,existing(draft,type,parentId),type))throw Error('内容已存在，请修改候选或换一批');
      const node=B.addNode(draft,parentId,{name:candidate.name,work:candidate.work,output:candidate.output});
      node.recommendation={method:'联网检索与AI建议',edited:!!candidate.edited,reason:String(candidate.reason||'').slice(0,2000),sources:(candidate.sources||[]).filter(s=>safeUrl(s.url)).map(s=>({title:s.title,url:safeUrl(s.url),excerpt:s.excerpt,accessedAt:s.accessedAt})),addedAt:new Date().toISOString()};
      added.push(node);
    }
    B.validateTree(draft.tree);Object.assign(plan,draft);return added;
  }
  const api={normalize,path,label,existing,duplicate,request,fingerprint,safeUrl,validateCandidate,add};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkPlanRecommendations=api;
})(typeof window!=='undefined'?window:globalThis);
