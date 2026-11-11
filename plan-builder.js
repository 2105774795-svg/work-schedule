/* 三级任务目录、员工库、勾选及版本迁移；节点身份与展示编号完全分离。 */
(function (root) {
  'use strict';
  const E=root.WorkPlanEngine||(typeof require==='function'&&require('./plan-engine.js'));
  const R=root.WorkPlanReference||(typeof require==='function'&&require('./plan-reference.js'));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const taskScales=Object.freeze({small:{name:'小型',min:50,max:100},medium:{name:'中型',min:100,max:150},large:{name:'大型',min:150,max:200}});
  function taskScale(plan){return typeof plan.taskScale==='string'&&Object.hasOwn(taskScales,plan.taskScale)?taskScales[plan.taskScale]:null;}
  const recommendedCodes=new Set(['B','C','D','E','F','G','H','I','J']);
  const isRecommended=node=>node.id==='module-'+node.sourceCode&&recommendedCodes.has(node.sourceCode);
  function applyRecommendations(plan){plan.tree.filter(isRecommended).forEach(m=>toggle(plan.tree,m.id,true));plan.tree.filter(m=>m.sourceCode&&!isRecommended(m)).forEach(m=>toggle(plan.tree,m.id,false));return plan;}
  const aliases={'市场研究':'市场调研','方向明确（项目汇报）':'方向明确','投资测算':'投产测算','放款材料提交（四证一书）':'放款材料准备','政策资金争取':'政策性资金争取','洽谈方案设计':'洽商方案设计','一轮运营洽商（意愿）':'一轮运营洽商','二轮运营洽商（技术）':'二轮运营洽商','三轮运营洽商（案例）':'三轮运营洽商','四轮运营洽商（商务）':'四轮运营洽商'};
  function catalog() {
    const tree=E.framework.map(g=>({id:'module-'+g.id,type:'module',sourceCode:g.id,name:g.name,skills:g.skills,from:g.from,to:g.to,children:[]}));
    for(const raw of R.tasks){
      let module=tree.find(g=>g.name===raw.module);
      if(['决策程序履行','融资材料编制','融资过会支持'].includes(raw.category))module=tree.find(g=>g.sourceCode==='G');
      let category=module.children.find(c=>c.name===raw.category);
      if(!category){category={id:'direction-'+raw.seq,type:'category',name:raw.category,children:[]};module.children.push(category);}
      category.children.push({id:'original-task-'+raw.seq,type:'task',work:raw.work,output:raw.output,selected:false,sourceSeq:Number(raw.seq),original:clone(raw)});
    }
    // 优先使用示例任务，并补全示例未覆盖的通用方向。
    E.framework.forEach(g=>{
      const module=tree.find(m=>m.sourceCode===g.id);
      g.categories.forEach(c=>{
        const name=aliases[c.name]||c.name;
        if(module.children.some(x=>x.name===name||x.name.startsWith(c.name.split('（')[0])))return;
        module.children.push({id:'suggested-'+c.id,type:'category',name:c.name,children:c.tasks.map((t,i)=>({id:'suggested-'+c.id+'-'+i,type:'task',work:t.work,output:t.output,selected:false,sourceSeq:null}))});
      });
    });
    return tree;
  }
  function registry() {
    const groups=[{id:'implementation',name:'项目实施小组'},{id:'ai',name:'AI及调研小组'},{id:'support',name:'后台保障小组'}];
    const names=[['项目负责人','规划成员','投资测算成员'],['研究成员','数据分析成员'],['保障成员','财务成员']];
    const employees=[];
    names.forEach((list,i)=>list.forEach(name=>{
      let p=employees.find(p=>p.name===name);
      if(!p){p={id:'staff-'+employees.length,name,groupIds:[],role:i===0?'项目实施':i===1?'AI应用开发、调研支持':'后台保障',capacity:null};employees.push(p);}
      p.groupIds.push(groups[i].id);
    }));
    return {version:1,groups,employees};
  }
  function validateRegistry(value){
    if(!value||!Array.isArray(value.groups)||!Array.isArray(value.employees)||value.groups.length>200||value.employees.length>1000)throw Error('员工库格式不正确或数量过多');
    const groups=new Set(),employees=new Set();
    value.groups.forEach(g=>{if(!g||typeof g.id!=='string'||!g.id||groups.has(g.id)||typeof g.name!=='string'||!g.name.trim())throw Error('小组名称或标识不正确');groups.add(g.id);});
    value.employees.forEach(p=>{if(!p||typeof p.id!=='string'||!p.id||employees.has(p.id)||typeof p.name!=='string'||!p.name.trim()||typeof p.role!=='string'||!Array.isArray(p.groupIds)||p.groupIds.some(id=>!groups.has(id)))throw Error('员工姓名、分组或定位格式不正确');employees.add(p.id);if(p.capacity!==null)E.days(p.capacity);});
    return value;
  }
  function mergeRegistry(store,incoming){
    validateRegistry(incoming);const mapping=new Map(),groupMap=new Map();
    incoming.groups.forEach(group=>{let match=store.groups.find(g=>g.name===group.name);if(!match){match={id:E.uid(),name:group.name};store.groups.push(match);}groupMap.set(group.id,match.id);});
    incoming.employees.forEach(employee=>{let match=store.employees.find(p=>p.name===employee.name&&!p.archived);if(!match){match={...clone(employee),id:E.uid(),groupIds:employee.groupIds.map(id=>groupMap.get(id))};store.employees.push(match);}mapping.set(employee.id,match.id);});return mapping;
  }
  function createProject() {
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    return applyRecommendations({schemaVersion:2,id:E.uid(),name:'',description:'',taskScale:'',startDate:today,endDate:'',start:today.slice(0,7),end:today.slice(0,7),asOf:today.slice(0,7),ownLabel:'',partnerLabel:'',partnerName:'',scope:'',deliverables:'',milestones:'',progressNotes:'',availabilityNotes:'',conditions:'',people:[],selectedEmployeeIds:[],modules:[],tree:catalog(),tasks:[],taskCache:{},options:[],standardDays:20,effortCapacityDefault:true,renumbered:false,createdAt:new Date().toISOString()});
  }
  function flatten(tree) {
    return tree.flatMap(module=>module.children.flatMap(category=>category.children.map(task=>({module,category,task}))));
  }
  function find(tree,id) {
    for(const module of tree){
      if(module.id===id)return {node:module,parent:null,siblings:tree};
      for(const category of module.children){
        if(category.id===id)return {node:category,parent:module,siblings:module.children};
        const task=category.children.find(t=>t.id===id);if(task)return {node:task,parent:category,siblings:category.children};
      }
    }
    return null;
  }
  const leaves=node=>node.type==='task'?[node]:node.children.flatMap(leaves);
  function state(node){const all=leaves(node),count=all.filter(n=>n.selected).length;return {count,total:all.length,checked:all.length>0&&count===all.length,mixed:count>0&&count<all.length};}
  function toggle(tree,id,checked){const item=find(tree,id);if(!item)throw Error('选择的工作已不存在');leaves(item.node).forEach(t=>t.selected=!!checked);}
  function code(index){let result='';for(let n=index+1;n;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;}
  function moduleCode(plan,module){return plan.renumbered?code(plan.tree.indexOf(module)):module.sourceCode||code(plan.tree.indexOf(module));}
  function reorder(plan,id,targetId,after=false){
    if(id===targetId)return;
    const from=plan.tree.findIndex(m=>m.id===id);if(from<0||!plan.tree.some(m=>m.id===targetId))throw Error('无法移动此模块');
    const [module]=plan.tree.splice(from,1),to=plan.tree.findIndex(m=>m.id===targetId)+(after?1:0);plan.tree.splice(to,0,module);plan.renumbered=true;
  }
  function addNode(plan,parentId,values){
    if(!parentId){const node={id:E.uid(),type:'module',name:values.name.trim(),skills:[],from:0,to:1,children:[]};if(!node.name)throw Error('请填写业务大类名称');plan.tree.push(node);plan.renumbered=true;return node;}
    const parent=find(plan.tree,parentId)?.node;if(!parent||parent.type==='task')throw Error('请先选择业务大类或工作方向');
    if(parent.type==='module'){if(!values.name.trim())throw Error('请填写工作方向');const node={id:E.uid(),type:'category',name:values.name.trim(),children:[]};parent.children.push(node);return node;}
    if(!values.work?.trim())throw Error('请填写具体工作内容');
    const node={id:E.uid(),type:'task',work:values.work.trim(),output:(values.output||'').trim(),selected:true,sourceSeq:null};parent.children.push(node);return node;
  }
  function removeNode(plan,id){
    const item=find(plan.tree,id);if(!item)throw Error('此内容已不存在');
    const ids=new Set(leaves(item.node).map(t=>t.id));
    plan.tasks.forEach(t=>{if(ids.has(t.id))plan.taskCache[t.id]=clone(t);});
    item.siblings.splice(item.siblings.indexOf(item.node),1);plan.tasks=plan.tasks.filter(t=>!ids.has(t.id));
    [...plan.tasks,...Object.values(plan.taskCache)].forEach(t=>{if(t.dependsOn)t.dependsOn=t.dependsOn.filter(id=>!ids.has(id));});
    if(item.node.type==='module')plan.renumbered=true;
  }
  function moveSibling(plan,id,offset){
    const item=find(plan.tree,id);if(!item)return;
    const i=item.siblings.indexOf(item.node),j=i+offset;if(j<0||j>=item.siblings.length)return;
    item.siblings.splice(i,1);item.siblings.splice(j,0,item.node);if(item.node.type==='module')plan.renumbered=true;
  }
  function selected(plan){return flatten(plan.tree).filter(row=>row.task.selected);}
  function peopleForProject(store,ids,previous=[]){
    return ids.map(id=>{
      const employee=store.employees.find(p=>p.id===id);if(!employee)throw Error('项目人员已不在员工库，请重新选择');
      const before=previous.find(p=>p.employeeId===id||p.name===employee.name);
      // 多组归属用于推荐，负荷汇总只采用一个主归属，避免重复人天。
      const groupNames=employee.groupIds.map(id=>store.groups.find(g=>g.id===id)?.name).filter(Boolean);
      return {...before,id:before?.id||employee.id,employeeId:employee.id,name:employee.name,group:groupNames[0]||'未分组',groupNames,role:employee.role,capacity:employee.capacity??null};
    });
  }
  function reconcilePeople(plan,people){
    const valid=new Set(people.map(p=>p.id));let released=0;
    const entries=new Map(Object.entries(plan.taskCache||{}));plan.tasks.forEach(t=>entries.set(t.id,t));
    for(const t of entries.values()){
      const members=E.participantIds(t,plan.people).filter(id=>valid.has(id));
      for(const [month,a]of Object.entries(t.allocations||{}))for(const id of Object.keys(a))if(!valid.has(id)){t.unassigned[month]=E.sum([t.unassigned[month]||0,a[id]]);released+=a[id];delete a[id];}
      E.setParticipants(t,members,people);
    }
    plan.tasks.forEach(t=>{if(plan.taskCache[t.id])plan.taskCache[t.id]=clone(t);});
    plan.people=people;return released;
  }
  function validateBasics(plan){
    if(!taskScale(plan))throw Error('请选择计划任务规模：小型、中型或大型');
    if(!plan.name.trim()||!plan.description.trim())throw Error('请填写项目名称和项目内容');
    for(const key of ['startDate','endDate']){
      const v=plan[key];if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw Error('请填写有效的预计开始和结束日期');
    }
    if(plan.endDate<plan.startDate)throw Error('预计结束时间不能早于开始时间');
    E.months(plan.startDate.slice(0,7),plan.endDate.slice(0,7));
    if(!plan.people.length)throw Error('请至少选择一位本次项目参与人员');
  }
  function suggest(plan,module,task){
    const text=task.work+' '+task.output,keys=[...(module.skills||[])];
    for(const [pattern,words]of [[/调研|访谈|客群|市场/,['调研','市场']],[/AI|系统开发|可视化/,['AI','开发']],[/融资|政策|资金|放款/,['融资','政策','财务','后台']],[/踏勘|谋划|规划|实施|设计/,['实施','策划','设计']]])if(pattern.test(text))keys.push(...words);
    return plan.people.map((p,index)=>({p,index,score:keys.reduce((n,k)=>n+((p.role+' '+(p.groupNames||[p.group]).join(' ')).includes(k)?1:0),0)})).sort((a,b)=>b.score-a.score||a.index-b.index)[0]?.p.name||'';
  }
  function generate(plan){
    validateBasics(plan);validateTree(plan.tree);
    const rows=selected(plan);if(!rows.length)throw Error('请至少勾选一项具体工作');
    const list=E.months(plan.start,plan.end),previous={...(plan.taskCache||{})};plan.tasks.forEach(t=>previous[t.id]=clone(t));
    const peopleNames=new Set(plan.people.map(p=>p.name));
    const tasks=rows.map(({module,category,task})=>{
      const before=previous[task.id],start=list[0],end=list[0];
      const next=E.newTask({...before,id:task.id,module:module.id,category:category.name,work:task.work,output:task.output,owner:before&&typeof before.owner==='string'&&(before.owner===''||peopleNames.has(before.owner))?before.owner:suggest(plan,module,task),partner:before?.partner??plan.partnerName??'',start:before?.start||start,end:before?.end||end,needsInitialStaffing:before?.start?before.needsInitialStaffing:!plan.source,originalSeq:task.sourceSeq||before?.originalSeq,sourceWork:task.original?.work||'',sourceCategory:task.original?.category||'',notes:before?.notes??'建议排期与分工，请结合实际情况确认'});
      E.setParticipants(next,E.participantIds(next,plan.people),plan.people);return next;
    });
    const included=new Set(tasks.map(t=>t.id));
    tasks.forEach(t=>{
      const omitted=(t.dependsOn||[]).filter(id=>!included.has(id));
      if(omitted.length){t.omittedDependencies=omitted.map(id=>previous[id]?.work||id);t.dependsOn=t.dependsOn.filter(id=>included.has(id));}
    });
    const next={...plan,tasks,taskCache:previous,modules:[...new Set(rows.map(r=>r.module.id))]};E.validate(next);Object.assign(plan,next);return tasks;
  }
  function validateTree(tree){
    if(!Array.isArray(tree)||tree.length>200)throw Error('业务大类数据不正确或超过200个');
    const ids=new Set();let count=0;
    function visit(node,type){
      if(!node||node.type!==type||typeof node.id!=='string'||!node.id||node.id.length>149||ids.has(node.id)||['__proto__','constructor','prototype'].includes(node.id))throw Error('任务树节点类型或唯一标识不正确');
      ids.add(node.id);
      if(type==='module'){
        if(node.sourceCode!==undefined&&!/^[A-Z]{1,3}$/.test(node.sourceCode))throw Error('业务大类来源编号不正确');
        if(node.skills!==undefined&&(!Array.isArray(node.skills)||node.skills.some(s=>typeof s!=='string')))throw Error('业务大类工作定位不正确');
        for(const key of ['from','to'])if(node[key]!==undefined&&(!Number.isFinite(node[key])||node[key]<0||node[key]>1))throw Error('建议排期参数不正确');
      }
      if(type==='task'){if(typeof node.work!=='string'||!node.work.trim()||typeof node.output!=='string'||typeof node.selected!=='boolean')throw Error('具体任务、勾选或成果格式不正确');if(++count>3000)throw Error('单个项目目录最多支持3000项任务');}
      else{if(typeof node.name!=='string'||!node.name.trim()||!Array.isArray(node.children))throw Error('业务大类或工作方向格式不正确');node.children.forEach(child=>visit(child,type==='module'?'category':'task'));}
    }
    tree.forEach(n=>visit(n,'module'));
  }
  function coverage(tree=catalog()){
    const rows=flatten(tree),mappings=R.tasks.map(raw=>{
      const matches=rows.filter(r=>r.task.sourceSeq===Number(raw.seq));
      return {sourceSeq:Number(raw.seq),originalModule:raw.module,originalCategory:raw.category,originalWork:raw.work,originalOutput:raw.output,matches:matches.length,path:matches.map(r=>[r.module.name,r.category.name,r.task.work]),exact:matches.length===1&&matches[0].task.work===raw.work&&matches[0].task.output===raw.output};
    });
    return {source:R.source,total:R.tasks.length,covered:mappings.filter(r=>r.exact).length,missing:mappings.filter(r=>!r.matches).map(r=>r.sourceSeq),duplicates:mappings.filter(r=>r.matches>1).map(r=>r.sourceSeq),modified:mappings.filter(r=>r.matches===1&&!r.exact).map(r=>r.sourceSeq),mappings};
  }
  function migrate(old,store){
    if(old.schemaVersion===2){const copy=clone(old);if(copy.taskScale===undefined){copy.taskScale='medium';copy.taskScaleLegacy=true;}if(copy.taskScale!==''&&!taskScale(copy))throw Error('任务规模格式不正确');for(const t of [...copy.tasks,...Object.values(copy.taskCache||{})])E.setParticipants(t,E.participantIds(t,copy.people),copy.people);validateTree(copy.tree);if(!Array.isArray(copy.selectedEmployeeIds)||!copy.taskCache||typeof copy.taskCache!=='object')throw Error('计划草稿格式不正确');for(const key of ['name','description','startDate','endDate'])if(typeof copy[key]!=='string')throw Error('项目基本信息格式不正确');E.validate({...copy,name:copy.name||'未命名草稿'});return copy;}
    E.validate(old);const p={...createProject(),...clone(old),schemaVersion:2,tree:catalog(),taskCache:{},startDate:old.start+'-01',endDate:new Date(Date.UTC(Number(old.end.slice(0,4)),Number(old.end.slice(5)),0)).toISOString().slice(0,10)};
    p.people.forEach(person=>{
      let employee=store.employees.find(e=>e.name===person.name);
      if(!employee){let group=store.groups.find(g=>g.name===person.group);if(!group){group={id:E.uid(),name:person.group};store.groups.push(group);}employee={id:E.uid(),name:person.name,role:person.role,groupIds:[group.id],capacity:person.capacity};store.employees.push(employee);}
      person.employeeId=employee.id;
    });
    p.effortCapacityDefault=old.effortCapacityDefault===true;p.taskScale=old.taskScale||(old.tasks.length>=150?'large':'medium');p.taskScaleLegacy=!old.taskScale;
    p.selectedEmployeeIds=p.people.map(p=>p.employeeId);
    const used=new Set();
    p.tasks.forEach(t=>{
      let row=flatten(p.tree).find(r=>!used.has(r.task)&&(t.originalSeq?r.task.sourceSeq===t.originalSeq:r.task.work===t.work));
      if(!row){const name=E.framework.find(g=>g.id===t.module)?.name||t.module;let module=p.tree.find(m=>m.name===name);if(!module){module=addNode(p,null,{name});}let category=module.children.find(c=>c.name===t.category);if(!category)category=addNode(p,module.id,{name:t.category||'补充工作'});const task=addNode(p,category.id,{work:t.work,output:t.output});row={module,category,task};}
      used.add(row.task);row.task.id=t.id;row.task.work=t.work;row.task.output=t.output;row.task.selected=true;t.module=row.module.id;t.category=row.category.name;
      const owners=t.owner.split(/[、，,]/).map(s=>s.trim()),matched=p.people.filter(person=>owners.includes(person.name));
      if(t.owner&&!p.people.some(person=>person.name===t.owner))t.legacyOwner=t.owner;
      E.setParticipants(t,t.participantIds??matched.map(person=>person.id),p.people);
    });
    p.modules=[...new Set(p.tasks.map(t=>t.module))];return p;
  }
  const api={clone,taskScales,taskScale,catalog,registry,validateRegistry,mergeRegistry,createProject,applyRecommendations,isRecommended,flatten,find,leaves,state,toggle,code,moduleCode,reorder,addNode,removeNode,moveSibling,selected,peopleForProject,reconcilePeople,validateBasics,validateTree,suggest,generate,coverage,migrate};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkPlanBuilder=api;
})(typeof window!=='undefined'?window:globalThis);
