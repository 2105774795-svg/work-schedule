/* AI只给需求与分工建议；本模块以0.25人天整数校验、按全计划容量安排并保护人工数据。 */
(function(root){
  'use strict';
  const E=root.WorkPlanEngine||(typeof require==='function'&&require('./plan-engine.js'));
  const B=root.WorkPlanBuilder||(typeof require==='function'&&require('./plan-builder.js'));
  const S=root.WorkPlanScheduling||(typeof require==='function'&&require('./plan-scheduling.js'));
  const clone=B.clone,unique=a=>[...new Set(a)],units=n=>Math.round(n*4),days=n=>n/4;
  const validId=v=>typeof v==='string'&&v.length>0&&v.length<150&&!['__proto__','constructor','prototype'].includes(v);
  const text=(v,label,required=true,max=3000)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Error(label+'须为'+(required?'非空':'')+'文字');return v.trim();};
  function amount(v,label){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100000||Math.abs(v*4-Math.round(v*4))>1e-8)throw Error(label+'须为非负数且按0.25人天填写');return v;}
  function strings(v,label,required=false){if(v===undefined&&!required)return [];if(!Array.isArray(v)||v.length>100)throw Error(label+'须为文字列表');return unique(v.map(x=>text(x,label,true,1000)));}
  function parameters(values=[]){
    if(!Array.isArray(values)||values.length>30)throw Error('估算参数格式不正确');const seen=new Set();
    return values.map(p=>{if(!p||!validId(p.key)||seen.has(p.key))throw Error('估算参数标识无效或重复');seen.add(p.key);if(!['string','number'].includes(typeof p.value)||String(p.value).length>1000||typeof p.value==='number'&&!Number.isFinite(p.value))throw Error('估算参数值无效');if(p.source&&!['user','manual','ai'].includes(p.source))throw Error('估算参数来源无效');return {key:p.key,label:text(p.label||p.key,'参数名称',true,100),value:p.value,source:p.source||'ai'};});
  }
  const hasInput=t=>Object.keys(t.allocations||{}).length>0||Object.keys(t.unassigned||{}).length>0;
  function sharedGroups(plan){
    const groups=new Map(),taskIds=new Set(plan.tasks.map(t=>t.id));
    for(const t of plan.tasks)for(const s of t.estimate?.sharedActivities||[]){if(!groups.has(s.id))groups.set(s.id,new Set());groups.get(s.id).add(t.id);for(const a of s.allocations||[])if(taskIds.has(a.taskId))groups.get(s.id).add(a.taskId);}
    return [...groups.values()];
  }
  function closure(plan,ids){const set=new Set(ids);let changed=true;while(changed){changed=false;for(const g of sharedGroups(plan))if([...g].some(id=>set.has(id)))for(const id of g)if(!set.has(id)){set.add(id);changed=true;}}return [...set];}
  function protection(t,mode){
    if(t.locked)return '任务已锁定';if(t.status==='已完成')return '任务已完成，保留历史投入';
    if(['schedule','effort','monthNotes','monthlyPlan'].some(k=>t.editSources?.[k]==='manual')||t.scheduleMeta?.source==='manual')return '已有人工修改或人工确认，保留原数据';
    if(!hasInput(t)){
      if(t.scheduleMeta?.source==='system'&&t.scheduleMeta.baseline)return S.protection(t)||'';
      return t.needsInitialStaffing===true?'':'旧稿来源未知，保留日期和月度内容，请先确认来源';
    }
    if(mode==='empty')return '已有投入，只补未估算项';
    return S.protection(t)||'';
  }
  function eligible(plan,options={}){
    const mode=options.mode||'empty';if(!['empty','system'].includes(mode))throw Error('初算模式无效');
    const wanted=options.taskIds?new Set(closure(plan,options.taskIds)):null,taskIds=[],protectedItems=[];
    for(const t of plan.tasks){if(wanted&&!wanted.has(t.id))continue;const reason=protection(t,mode);if(reason)protectedItems.push({taskId:t.id,work:t.work,reason});else taskIds.push(t.id);}
    const blocked=new Set();for(const item of protectedItems)for(const id of closure(plan,[item.taskId]))blocked.add(id);
    for(const id of taskIds.filter(id=>blocked.has(id))){const t=plan.tasks.find(t=>t.id===id);protectedItems.push({taskId:id,work:t.work,reason:'同一共用活动的其他任务有人工或未知数据保护，整组保留，不能只重算部分份额'});}
    return {taskIds:taskIds.filter(id=>!blocked.has(id)),protected:protectedItems};
  }
  // 精确原文修订签名供本机应用；它不发送给模型，也不受散列碰撞影响。
  function fingerprint(plan){return JSON.stringify({id:plan.id,name:plan.name,description:plan.description,scope:plan.scope,deliverables:plan.deliverables,conditions:plan.conditions,milestones:plan.milestones,start:plan.start,end:plan.end,startDate:plan.startDate,endDate:plan.endDate,asOf:plan.asOf,standardDays:plan.standardDays,effortCapacityDefault:plan.effortCapacityDefault,effortParameters:plan.effortParameters,editRevision:plan.editRevision,people:plan.people,tasks:plan.tasks,tree:plan.tree});}
  function capacity(plan,person,month){if(Object.hasOwn(person.capacities||{},month))return person.capacities[month];if(person.capacity!==null&&person.capacity!==undefined)return person.capacity;return plan.effortCapacityDefault===true?(plan.standardDays??20):null;}
  function request(plan,taskIds,options={}){
    E.validate(plan);const ids=taskIds===undefined?eligible(plan).taskIds:taskIds;
    if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!plan.tasks.some(t=>t.id===id)))throw Error('请选择有效的待初算任务');
    const wanted=new Set(ids),months=E.months(plan.start,plan.end),retained=new Map();
    if(closure(plan,ids).some(id=>!wanted.has(id)))throw Error('本次任务与已有共用活动关联，请将整组任务一起初算');
    for(const t of plan.tasks.filter(t=>!wanted.has(t.id)))for(const s of t.estimate?.sharedActivities||[])if(!retained.has(s.id))retained.set(s.id,{id:s.id,activity:s.activity,output:s.output,days:s.totalDays??s.days,basis:s.basis,taskIds:(s.allocations||[]).map(a=>a.taskId)});
    return {version:1,project:{name:plan.name,description:plan.description||'',scope:plan.scope||'',deliverables:plan.deliverables||'',conditions:plan.conditions||'',milestones:plan.milestones||'',start:plan.start,end:plan.end,dependencies:plan.tasks.filter(t=>!wanted.has(t.id)&&plan.tasks.some(x=>wanted.has(x.id)&&(x.dependsOn||[]).includes(t.id))).map(t=>({id:t.id,work:t.work,end:t.end,status:t.status})),existingSharedActivities:[...retained.values()]},people:plan.people.map(p=>({id:p.id,role:p.role||'',group:p.group||'',capacity:p.capacity??(plan.effortCapacityDefault===true?(plan.standardDays??20):null),capacitySource:p.capacity===null||p.capacity===undefined?(plan.effortCapacityDefault===true?'用户选择按标准工日假设':'待确认'):'用户资料',capacities:Object.fromEntries(Object.entries(p.capacities||{}).filter(([m])=>months.includes(m)))})),tasks:plan.tasks.filter(t=>wanted.has(t.id)).map(t=>({id:t.id,work:t.work,output:t.output,module:E.moduleName(plan,t.module),category:t.category||'',deadline:t.deadline||'',durationMonths:t.durationMonths??null,dependsOn:clone(t.dependsOn||[]),...(t.participantSource==='manual'?{participantIds:E.participantIds(t,plan.people)}:{})})),parameters:parameters(options.parameters??plan.effortParameters??[])};
  }
  const norm=s=>s.replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
  function validateResponse(input,response,options={}){
    if(!input||input.version!==1||!Array.isArray(input.tasks)||!Array.isArray(input.people))throw Error('初算输入协议无效');
    if(!response||response.version!==1||response.method!=='model'||!Array.isArray(response.tasks)||!Array.isArray(response.sharedActivities))throw Error('AI初算响应协议无效，未应用结果');
    const byId=new Map(input.tasks.map(t=>[t.id,t])),people=new Set(input.people.map(p=>p.id)),keys=new Set((input.parameters||[]).map(p=>p.key)),seen=new Set();
    if(response.tasks.length!==input.tasks.length)throw Error('AI初算任务覆盖不完整，未应用半份结果');
    const tasks=response.tasks.map(t=>{
      if(!t||!byId.has(t.taskId)||seen.has(t.taskId))throw Error('AI初算含陌生或重复任务');seen.add(t.taskId);const source=byId.get(t.taskId),componentIds=new Set();
      const basis=text(t.basis,'估算依据'),assumptions=strings(t.assumptions,'估算假设'),uncertainty=text(t.uncertainty,'不确定性说明',true,1000),informationNeeded=strings(t.informationNeeded,'待补信息');
      if(t.status==='pending'){
        if(t.low!==null||t.high!==null||!Array.isArray(t.components)||t.components.length||!informationNeeded.length)throw Error('待估算项须留空需求并说明缺少的信息');
        return {taskId:t.taskId,status:'pending',low:null,high:null,components:[],basis,assumptions,uncertainty,informationNeeded};
      }
      if(!Array.isArray(t.components)||t.components.length>80)throw Error('AI分项工作包无效');
      const components=t.components.map(c=>{
        if(!c||!validId(c.id)||componentIds.has(c.id))throw Error('AI工作包标识无效或重复');componentIds.add(c.id);
        const personIds=strings(c.personIds,'建议人员标识');if(personIds.some(id=>!people.has(id)||(source.participantIds&&!source.participantIds.includes(id))))throw Error('AI建议了项目外或人工指定集合外的人员');
        const parameterKeys=strings(c.parameterKeys,'参数引用');if(parameterKeys.some(k=>!keys.has(k)))throw Error('AI工作包引用了不存在的参数');
        return {id:c.id,activity:text(c.activity,'工作包活动'),output:text(c.output,'工作包成果'),days:amount(c.days,'工作包人天'),roles:strings(c.roles,'所需岗位'),personIds,basis:text(c.basis,'分项估算依据'),parameterKeys};
      });
      const low=amount(t.low,'专属需求下限'),high=amount(t.high,'专属需求上限'),total=units(E.sum(components.map(c=>c.days)));
      if(low>high||total<units(low)||total>units(high))throw Error('AI分项合计不在专属估算范围内');
      return {taskId:t.taskId,status:'estimated',low,high,components,basis,assumptions,uncertainty,informationNeeded};
    });
    const sharedIds=new Set(),sharedNames=new Set(),sharedActivities=response.sharedActivities.map(s=>{
      if(!s||!validId(s.id)||sharedIds.has(s.id))throw Error('共用活动标识无效或重复');sharedIds.add(s.id);
      const activity=text(s.activity,'共用活动'),output=text(s.output,'共用成果'),name=norm(activity+'|'+output);if(sharedNames.has(name))throw Error('共用活动重复，不能重复计费');sharedNames.add(name);
      const n=amount(s.days,'共用活动人天'),low=amount(s.low??n,'共用需求下限'),high=amount(s.high??n,'共用需求上限');if(n<=0||low>n||high<n)throw Error('共用活动范围无效');
      if(!Array.isArray(s.allocations)||s.allocations.length<(options.batch?1:2))throw Error('共用活动须明确分摊到至少两项任务');const ids=new Set();
      const allocations=s.allocations.map(a=>{if(!a||!byId.has(a.taskId)||ids.has(a.taskId)||tasks.find(t=>t.taskId===a.taskId).status==='pending')throw Error('共用活动分摊任务无效或重复');ids.add(a.taskId);const d=amount(a.days,'共用活动分摊');if(d<=0)throw Error('共用活动份额须大于0');return {taskId:a.taskId,days:d};});
      if(allocations.reduce((sum,a)=>sum+units(a.days),0)!==units(n))throw Error('共用活动分摊合计不等于共用总量');
      for(const a of allocations)if(tasks.find(t=>t.taskId===a.taskId).components.some(c=>norm(c.activity)===norm(activity)||norm(c.activity+'|'+c.output)===name))throw Error('共用活动又计入专属工作包，须先去重');
      return {id:s.id,activity,output,days:n,low,high,basis:text(s.basis,'共用活动依据'),allocations};
    });
    const retained=input.project?.existingSharedActivities||[];for(const s of retained){if(sharedActivities.some(x=>x.id===s.id||norm(x.activity)===norm(s.activity))||tasks.some(t=>t.components.some(c=>norm(c.activity)===norm(s.activity))))throw Error('已计入原计划的共用活动被再次计费或标识复用，请复用已有投入并区分独立活动标识');}
    for(const t of tasks)if(t.status!=='pending'&&units(E.sum(t.components.map(c=>c.days)))+sharedActivities.flatMap(s=>s.allocations.filter(a=>a.taskId===t.taskId)).reduce((s,a)=>s+units(a.days),0)<=0)throw Error('模型不能用0冒充已完成估算，请说明缺少信息并标待估算');
    return {version:1,method:'model',model:text(response.model||'模型接口','模型名称',true,200),generatedAt:typeof response.generatedAt==='string'?response.generatedAt:new Date().toISOString(),tasks,sharedActivities};
  }
  function ordered(tasks){const result=[],done=new Set(),visiting=new Set(),byId=new Map(tasks.map(t=>[t.id,t]));function visit(t){if(done.has(t.id))return;if(visiting.has(t.id))throw Error('前置任务存在循环依赖');visiting.add(t.id);for(const id of t.dependsOn||[]){if(!byId.has(id))throw Error('前置任务不存在');visit(byId.get(id));}visiting.delete(t.id);done.add(t.id);result.push(t);}tasks.forEach(visit);return result;}
  function totals(t){return {assigned:E.sum(Object.values(t.allocations||{}).flatMap(Object.values)),unassigned:E.sum(Object.values(t.unassigned||{}))};}
  function demandInfo(result,taskId){
    const t=result.tasks.find(t=>t.taskId===taskId),shared=result.sharedActivities.flatMap(s=>s.allocations.filter(a=>a.taskId===taskId).map(a=>({...clone(s),totalDays:s.days,days:a.days,low:days(Math.floor(units(s.low)*units(a.days)/units(s.days))),high:days(Math.ceil(units(s.high)*units(a.days)/units(s.days)))})));
    if(t.status==='pending')return {...t,total:null,shared,exclusiveTotal:null,sharedTotal:null};
    const exclusiveTotal=E.sum(t.components.map(c=>c.days)),sharedTotal=E.sum(shared.map(s=>s.days));return {...t,shared,exclusiveTotal,sharedTotal,total:E.sum([exclusiveTotal,sharedTotal]),range:{low:E.sum([t.low,...shared.map(s=>s.low)]),high:E.sum([t.high,...shared.map(s=>s.high)])}};
  }
  function suggestedMonth(plan,t,months){
    if(!t.needsInitialStaffing&&t.start)return {month:t.start,basis:'保留已有系统初稿的建议开始月'};
    const selected=new Set(plan.tasks.map(task=>task.module)),modules=E.moduleDefinitions(plan).filter(module=>selected.has(module.id)),index=modules.findIndex(module=>module.id===t.module),module=modules[index];
    if(Number.isFinite(module?.from)&&module.from>=0&&module.from<=1)return {month:months[Math.floor((months.length-1)*module.from)],basis:'按当前模块已有阶段位置提出单月建议'};
    return {month:months[Math.floor((months.length-1)*Math.max(0,index)/Math.max(1,modules.length-1))],basis:'按本次实际已选模块顺序提出单月建议'};
  }
  function arrange(plan,t,demand,load,byId){
    const warnings=[],adjustments=[],months=E.months(plan.start,plan.end),people=new Map(plan.people.map(p=>[p.id,p])),manual=t.participantSource==='manual',allowed=manual?E.participantIds(t,plan.people):plan.people.map(p=>p.id);
    let earliest=plan.start,latest=t.deadline&&t.deadline.slice(0,7)<plan.end?t.deadline.slice(0,7):plan.end;
    let pendingPredecessor=false;for(const id of t.dependsOn||[]){const previous=byId.get(id);if(previous.estimate?.status==='pending')pendingPredecessor=true;const next=E.monthLabel(E.monthNumber(previous.end)+1);if(next>earliest)earliest=next;}
    let possible=months.filter(m=>m>=earliest&&m<=latest),blocked='';const span=t.durationMonths||1;
    if(pendingPredecessor)blocked='前置任务仍待估算，不能把后续工作标为已安排；需求保留待安排';
    else if(!possible.length)blocked='前置任务完成后的月份晚于截止时间；需求保留待安排，请调整期限或依赖';
    else if(span>possible.length)blocked='持续月数超过可用期间；需求保留待安排，请调整期限或持续月数';
    const suggestion=suggestedMonth(plan,t,months);let preferred=suggestion.month;
    adjustments.push('程序阶段单月建议，未推断依赖：'+suggestion.month+'（'+suggestion.basis+'）；原结束月不作为持续月数依据');
    if(!blocked){
      if(preferred<possible[0]){warnings.push('程序阶段建议'+preferred+'早于项目或前置条件允许月份，已按明确约束后移到'+possible[0]);preferred=possible[0];}
      if(preferred>possible.at(-1)){warnings.push('程序阶段建议'+preferred+'晚于截止或项目结束月份，已按明确约束前移到'+possible.at(-1)+'，未把软建议当作硬依赖');preferred=possible.at(-1);}
      let offset=possible.indexOf(preferred);if(offset<0)offset=0;
      if(span>1&&possible.length-offset<span){const next=possible[possible.length-span];warnings.push('为满足明确持续月数及截止约束，阶段建议从'+preferred+'前移到'+next+'；需求未减少');offset=possible.length-span;preferred=next;}
      possible=possible.slice(offset);
    }
    const key=(id,m)=>id+'|'+m,room=(id,m)=>{const c=capacity(plan,people.get(id),m);return c===null?0:Math.max(0,units(c)-(load.get(key(id,m))||0));};
    const components=[...demand.shared.map(s=>({id:'shared-'+s.id,activity:s.activity,output:s.output,days:s.days,roles:[],personIds:[],basis:s.basis,sharedId:s.id})),...demand.components],allocations={},unassigned={},monthlyPlan={},memberIds=new Set(manual?allowed:[]);
    const ensure=m=>monthlyPlan[m]||=( {activity:'',output:'',days:0,allocations:{},unassigned:0,basis:'',workPackages:[]} );
    function add(m,id,n,c){if(n<=0)return;const row=ensure(m);if(id){(allocations[m]||={})[id]=days(units(allocations[m]?.[id]||0)+n);load.set(key(id,m),(load.get(key(id,m))||0)+n);memberIds.add(id);}else unassigned[m]=days(units(unassigned[m]||0)+n);let pkg=row.workPackages.find(p=>p.id===c.id);if(!pkg){pkg={id:c.id,activity:c.activity,output:c.output,days:0,basis:c.basis,...(c.sharedId?{sharedId:c.sharedId}:{}),allocations:{},unassigned:0};row.workPackages.push(pkg);}pkg.days=days(units(pkg.days)+n);if(id)pkg.allocations[id]=days(units(pkg.allocations[id]||0)+n);else pkg.unassigned=days(units(pkg.unassigned)+n);}
    if(plan.effortCapacityDefault===true&&plan.people.some(p=>p.capacity===null||p.capacity===undefined))warnings.push('未填容量按用户选择的标准工日假设测算，未核对其他项目占用');
    if(plan.people.some(p=>months.some(m=>capacity(plan,p,m)===null)))warnings.push('部分人员容量待确认，未知容量未安排投入');
    if(!allowed.length)warnings.push('没有可分配的已选成员，全部需求保留待分配');
    // <=8人天且无明确持续要求的短活动整体落在一个月；不为适应容量拆成多月。
    if(!blocked&&demand.total<=8&&span===1){const scores=possible.map((m,i)=>({m,i,room:allowed.reduce((s,id)=>s+room(id,m),0)}));possible=[scores.find(x=>x.room>=units(demand.total))?.m||scores.sort((a,b)=>b.room-a.room||a.i-b.i)[0].m];}
    else if(!blocked&&span>1){possible=possible.slice(0,span);}
    if(blocked){warnings.push(blocked);possible=[months.includes(latest)?latest:months.at(-1)];}
    let completed=0,cursor=0;
    for(const c of components){
      const roleScore=id=>{const p=people.get(id),hay=(p.role+' '+p.group).toLowerCase();return (c.roles||[]).reduce((s,r)=>s+(hay.includes(r.toLowerCase())?1:0),0);};
      if(c.roles?.length&&!allowed.some(id=>roleScore(id)>0))warnings.push('“'+c.activity+'”所需岗位与人员定位无直接匹配，按已选成员及容量提出安排，岗位适配待确认');
      let remaining=units(c.days);while(remaining>0){
        let month;
        if(blocked)month=possible[0];else if(span>1)month=possible[Math.min(possible.length-1,Math.floor(completed/Math.max(1,units(demand.total))*possible.length))];else month=possible[Math.min(cursor,possible.length-1)];
        const candidates=blocked?[]:allowed.filter(id=>room(id,month)>0).map(id=>({id,score:roleScore(id)*100+(c.personIds?.includes(id)?20:0)+(memberIds.has(id)?2:0),room:room(id,month)})).sort((a,b)=>b.score-a.score||b.room-a.room||a.id.localeCompare(b.id));
        if(candidates.length){const best=candidates[0];let n=Math.min(remaining,best.room);if(span>1){const limit=Math.ceil(units(demand.total)*(possible.indexOf(month)+1)/possible.length)-completed;n=Math.min(n,Math.max(1,limit));}add(month,best.id,n,c);remaining-=n;completed+=n;}
        else if(!blocked&&span===1&&possible.length>1&&cursor<possible.length-1){cursor++;}
        else{let n=remaining;if(span>1&&!blocked){const limit=Math.ceil(units(demand.total)*(possible.indexOf(month)+1)/possible.length)-completed;n=Math.min(n,Math.max(1,limit));}add(month,null,n,c);remaining-=n;completed+=n;}
      }
      const details=[];for(const [m,row]of Object.entries(monthlyPlan)){const pkg=row.workPackages.find(x=>x.id===c.id);if(!pkg)continue;for(const [id,n]of Object.entries(pkg.allocations)){const reason=[manual?'人工指定成员范围':'本项目已选成员',c.personIds?.includes(id)?'AI建议成员':'',roleScore(id)>0?'岗位与工作包匹配':'岗位适配待确认','全计划剩余容量允许'].filter(Boolean).join('、');details.push(m+' '+people.get(id).name+' '+n+'人天（'+reason+'）');}if(pkg.unassigned>0)details.push(m+' '+pkg.unassigned+'人天待分配');}
      adjustments.push(c.activity+'：需求'+c.days+'人天；'+details.join('；'));
    }
    const active=Object.keys(monthlyPlan).sort(),start=active[0],end=active.at(-1),monthNotes={};
    if(!blocked&&start>preferred)warnings.push('建议开始月'+preferred+'的全计划可用容量不足，已后移到'+start+'；未静默提前或改变需求');
    adjustments.push(...warnings.filter(w=>/程序阶段建议|阶段建议从|建议开始月/.test(w)));
    for(const m of E.months(start,end)){
      const row=ensure(m),ps=row.workPackages;row.activity=ps.length?(blocked?'待安排：':'')+unique(ps.map(c=>c.activity)).join('；'):'等待前序工作或人员容量，本月无新增投入';row.output=ps.length?unique(ps.map(c=>c.output)).join('；'):'本月无新增阶段成果';row.basis=ps.length?unique(ps.map(c=>c.basis)).join('；'):'程序保留的阶段间隔';
      row.days=E.sum([...(Object.values(allocations[m]||{})),unassigned[m]||0]);row.allocations=clone(allocations[m]||{});row.unassigned=unassigned[m]||0;if(!ps.length)unassigned[m]=0;monthNotes[m]=row.activity+'；阶段成果：'+row.output;
    }
    const after={...clone(t),start,end,allocations,unassigned,monthlyPlan,monthNotes,needsInitialStaffing:false};E.setParticipants(after,[...memberIds],plan.people);
    const resource=totals(after);if(resource.unassigned>0)warnings.push('期限内可用容量不足或分工条件未满足，保留'+resource.unassigned+'人天待分配；可增加本项目容量、调整成员或延长期限后重算，未削减需求');
    if(t.deadline?.length>7)warnings.push('按截止月份安排；具体日内时间仍需人工确认');
    return {after,warnings:unique(warnings),adjustments,resource:{...resource,blockedReason:blocked}};
  }
  function propose(plan,response,options={}){
    E.validate(plan);if(options.baseRevision!==undefined&&options.baseRevision!==fingerprint(plan))throw Error('计划、人工修改或人员容量已变化，请重新初算');
    const mode=options.mode||'empty',selection=eligible(plan,{mode,taskIds:options.taskIds}),input=request(plan,selection.taskIds,{parameters:options.parameters}),result=validateResponse(input,response),draft=clone(plan),wanted=new Set(selection.taskIds),load=new Map(),warnings=[],changes=[],byId=new Map(draft.tasks.map(t=>[t.id,t]));
    if(result.tasks.some(row=>row.status==='pending'&&hasInput(byId.get(row.taskId))))throw Error('模型缺少重新估算已有初稿的依据，原人天及共用分摊全部保留，请补资料后重试');
    for(const t of draft.tasks)if(!wanted.has(t.id))for(const [m,a]of Object.entries(t.allocations||{}))for(const [id,n]of Object.entries(a))load.set(id+'|'+m,(load.get(id+'|'+m)||0)+units(n));
    for(const t of ordered(draft.tasks))if(wanted.has(t.id)){
      const before=clone(t),d=demandInfo(result,t.id);let after,ws=[],resource={assigned:0,unassigned:0},adjustments=[];
      if(d.status==='pending'){
        after={...clone(t),allocations:{},unassigned:{},monthlyPlan:{},monthNotes:{},needsInitialStaffing:true};ws=['资料不足，保留待估算：'+d.informationNeeded.join('；')];
      }else{const arranged=arrange(draft,t,d,load,byId);after=arranged.after;ws=arranged.warnings;resource=arranged.resource;adjustments=arranged.adjustments;}
      after.estimate={method:'model',status:d.status,model:result.model,generatedAt:result.generatedAt,total:d.total,range:d.range||{low:null,high:null},standardDemand:{total:d.total,low:d.range?.low??null,high:d.range?.high??null},exclusiveTotal:d.exclusiveTotal,sharedTotal:d.sharedTotal,basis:d.basis,components:clone(d.components),sharedActivities:clone(d.shared),assumptions:clone(d.assumptions),uncertainty:d.uncertainty,informationNeeded:clone(d.informationNeeded),parameters:clone(input.parameters),resourcePlan:{...resource,adjustments},allocationBasis:adjustments,aiOriginal:clone(result.tasks.find(x=>x.taskId===t.id)),calibration:{aiTotal:d.total,adoptedTotal:d.status==='pending'?null:E.sum([resource.assigned,resource.unassigned]),reason:'AI初算采用值，尚无人工校准',history:clone(t.estimate?.calibration?.history||[])},warnings:ws};
      S.markSystem(after,ws);Object.assign(t,after);warnings.push(...ws.map(w=>t.work+'：'+w));changes.push({taskId:t.id,work:t.work,before,after:clone(after),warnings:ws});
    }
    return {version:1,baseRevision:fingerprint(plan),request:input,estimate:result,parameters:input.parameters,changes,protected:selection.protected,warnings:unique(warnings),createdAt:new Date().toISOString()};
  }
  function updated(plan,proposal){
    if(!proposal||proposal.version!==1||proposal.baseRevision!==fingerprint(plan))throw Error('计划、人工修改或人员容量已变化，请重新初算');
    if(!Array.isArray(proposal.changes)||!proposal.changes.length)throw Error('没有可以应用的初算结果');
    const copy=clone(plan),ids=new Set(proposal.changes.map(c=>c.taskId));if(ids.size!==proposal.changes.length)throw Error('初算变更任务重复');
    for(const c of proposal.changes){const t=copy.tasks.find(t=>t.id===c.taskId);if(!t||protection(t,'system'))throw Error('初算目标已受保护，未覆盖人工数据');Object.assign(t,clone(c.after));if(t.estimate.status!=='pending'){const n=totals(t);if(units(n.assigned+n.unassigned)!==units(t.estimate.total))throw Error('任务需求与分配不守恒，未应用');}}
    // 任一共用活动必须整份应用，不能只选一部分任务制造份额遗失。
    for(const s of proposal.estimate.sharedActivities)if(s.allocations.some(a=>!ids.has(a.taskId)))throw Error('共用活动必须连同全部分摊任务一起应用');
    copy.taskCache||={};copy.tasks.forEach(t=>copy.taskCache[t.id]=clone(t));copy.preStartMode=false;copy.effortParameters=clone(proposal.parameters);copy.staffing={at:new Date().toISOString(),method:'model',model:proposal.estimate.model,status:proposal.changes.some(c=>c.after.estimate.status==='pending')?'partial':'estimated',note:'AI需求与程序全局容量分配；未知或0容量不安排，待分配保留需求'};
    copy.effortReview={version:1,at:new Date().toISOString(),taskIds:[...ids],sharedActivities:clone(proposal.estimate.sharedActivities),warnings:clone(proposal.warnings)};copy.editRevision=(copy.editRevision||0)+1;copy.updatedAt=new Date().toISOString();E.validate(copy);return copy;
  }
  function apply(plan,proposal){const copy=updated(plan,proposal);Object.assign(plan,copy);return plan;}
  function applyCopy(plan,proposal){const copy=updated(plan,proposal);copy.id=E.uid();copy.basedOn=plan.id;copy.name=plan.name+'（AI初算修订版）';copy.createdAt=new Date().toISOString();return copy;}
  function calibrate(plan,taskId,reason){
    const t=plan.tasks.find(t=>t.id===taskId);if(!t)throw Error('校准任务不存在');if(t.estimate?.method!=='model')return plan;
    const adopted=hasInput(t)?E.sum(Object.values(t.allocations||{}).flatMap(Object.values).concat(Object.values(t.unassigned||{}))):null,e=t.estimate,why=String(reason||'人工调整，原因待补充').trim().slice(0,1000),entry={at:new Date().toISOString(),aiTotal:e.total,adoptedTotal:adopted,reason:why,allocations:clone(t.allocations||{}),unassigned:clone(t.unassigned||{})};
    e.calibration={aiTotal:e.total,adoptedTotal:adopted,reason:why,history:[...(e.calibration?.history||[]),entry].slice(-50)};e.resourcePlan={...(e.resourcePlan||{}),...totals(t),manual:true};(t.editSources||={}).effort='manual';(plan.taskCache||={})[t.id]=clone(t);return plan;
  }
  function affected(plan,previous,next){
    const a=parameters(previous||[]),b=parameters(next||[]),keys=unique([...a.map(p=>p.key),...b.map(p=>p.key)]).filter(key=>JSON.stringify(a.find(p=>p.key===key))!==JSON.stringify(b.find(p=>p.key===key)));if(!keys.length)return [];
    return closure(plan,plan.tasks.filter(t=>{const e=t.estimate;if(!e||e.status==='pending')return true;const refs=unique((e.components||[]).flatMap(c=>c.parameterKeys||[]));return !refs.length||keys.some(k=>refs.includes(k));}).map(t=>t.id));
  }
  const api={request,fingerprint,eligible,validateResponse,propose,apply,applyCopy,calibrate,affected,capacity};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkPlanAIEffort=api;
})(typeof window!=='undefined'?window:globalThis);
