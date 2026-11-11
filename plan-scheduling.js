/* 逐月排期与旧稿修订：只重排已有需求，不估算新人天，不调用模型。 */
(function(root){
  'use strict';
  const E=root.WorkPlanEngine||(typeof require==='function'&&require('./plan-engine.js'));
  const B=root.WorkPlanBuilder||(typeof require==='function'&&require('./plan-builder.js'));
  const clone=B.clone;
  const unique=items=>[...new Set(items)];
  const units=n=>Math.round(Number(n||0)*4);
  const fromUnits=n=>n/4;
  const scheduleFields=['start','end','allocations','unassigned','monthNotes','monthlyPlan'];
  function snapshot(t){
    return {start:t.start||'',end:t.end||'',allocations:clone(t.allocations||{}),unassigned:clone(t.unassigned||{}),monthNotes:clone(t.monthNotes||{}),monthlyPlan:clone(t.monthlyPlan||{}),deadline:t.deadline||'',dependsOn:clone(t.dependsOn||[]),work:t.work||'',output:t.output||'',participantIds:clone(t.participantIds||null),durationMonths:t.durationMonths??null};
  }
  function markSystem(t,warnings=[]){
    t.scheduleMeta={version:1,source:'system',baseline:snapshot(t),warnings:unique(warnings),updatedAt:new Date().toISOString()};return t;
  }
  const revision=p=>JSON.stringify({id:p.id,start:p.start,end:p.end,startDate:p.startDate,endDate:p.endDate,asOf:p.asOf,standardDays:p.standardDays,preStartMode:p.preStartMode,people:p.people,tasks:p.tasks});
  function hasZero(t){return Object.values(t.unassigned||{}).some(n=>n===0)||Object.values(t.allocations||{}).some(a=>Object.values(a).some(n=>n===0));}
  function protection(t,options={}){
    if(t.locked)return '任务已锁定';
    if(t.status==='已完成')return '任务已完成，保留历史安排';
    if(['schedule','effort','monthNotes','monthlyPlan'].some(k=>t.editSources?.[k]==='manual'))return '已有人工修改，保留原安排';
    const meta=t.scheduleMeta;
    if(meta?.source==='manual')return '已标记人工确认';
    if(meta?.source==='system'&&meta.baseline){
      if(scheduleFields.some(k=>JSON.stringify(meta.baseline[k]??{})!==JSON.stringify(snapshot(t)[k]??{})))return '系统初稿之后已有修改，需人工核对';
    }else{
      if(hasZero(t))return '旧稿含显式0，不能把确认无投入当成未估算';
      if(!options.includeUnknown)return '旧稿来源未知，默认保留；可勾选允许重排来源未知项';
    }
    const demand=E.sum([...Object.values(t.unassigned||{}),...Object.values(t.allocations||{}).flatMap(a=>Object.values(a))]);
    if(demand===0&&hasZero(t))return '已确认0投入，保留原安排';
    return '';
  }
  function deadline(t,fallback){
    if(!t.deadline)return fallback;
    const text=String(t.deadline),month=text.slice(0,7);E.monthNumber(month);
    if(text!==month&&(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(Date.parse(text))||new Date(text).toISOString().slice(0,10)!==text))throw Error('任务截止时间须为有效月份或日期：'+t.work);
    return month<fallback?month:fallback;
  }
  function capacity(p,person,month){
    if(Object.hasOwn(person.capacities||{},month))return person.capacities[month];
    return person.capacity??(p.preStartMode?(p.standardDays??20):null);
  }
  function demand(t){
    const people={};for(const a of Object.values(t.allocations||{}))for(const [id,n]of Object.entries(a))people[id]=(people[id]||0)+units(n);
    return {people,unassigned:Object.values(t.unassigned||{}).reduce((s,n)=>s+units(n),0)};
  }
  function ordered(tasks){
    const byId=new Map(tasks.map(t=>[t.id,t])),done=new Set(),visiting=new Set(),result=[];
    function visit(t){if(done.has(t.id))return;if(visiting.has(t.id))throw Error('前置任务存在循环依赖');visiting.add(t.id);for(const id of t.dependsOn||[]){const previous=byId.get(id);if(!previous)throw Error('前置任务已不存在');visit(previous);}visiting.delete(t.id);done.add(t.id);result.push(t);}
    tasks.forEach(visit);return result;
  }
  function monthContent(t,index,count,days){
    if(days===0)return {activity:'等待前置条件或人员可用时间，本月不安排工作投入',output:'本月无新增阶段成果',basis:'空档月明确为等待，未虚填人天'};
    if(count===1)return {activity:t.work,output:t.output||'该项工作记录及核对结论',basis:'短任务或可在单月完成的工作集中安排'};
    const research=/调研|研究|分析|访谈/.test(t.work);
    if(index===0)return {activity:research?'核实'+t.work+'的基础资料、调查对象与分析口径':'明确'+t.work+'的边界、约束条件与分项安排',output:research?'《'+t.work+'基础资料与口径核对表》':'《'+t.work+'条件与分项安排清单》',basis:'分月规则建议：先确认本项工作输入及边界'};
    if(index===count-1)return {activity:'汇总并复核'+t.work+'的工作结论，完成成果交付',output:t.output||'该项最终成果与复核记录',basis:'分月规则建议：本项最终成果汇总与复核'};
    return {activity:research?'开展'+t.work+'的分项调查、比较和专题分析（第'+(index+1)+'阶段）':'推进'+t.work+'的分项编制与衔接核对（第'+(index+1)+'阶段）',output:'《'+t.work+'第'+(index+1)+'阶段工作记录与分析结论》',basis:'分月规则建议：阶段成果需由负责人结合实际进一步细化'};
  }
  function place(plan,t,period,load,byId){
    const warnings=[],all=E.months(period.start,period.end),d=demand(t),total=Object.values(d.people).reduce((a,b)=>a+b,0)+d.unassigned;
    let first=period.start,last=deadline(t,period.end);
    for(const id of t.dependsOn||[]){const previous=byId.get(id);if(previous){const next=E.monthLabel(E.monthNumber(previous.end)+1);if(next>first)first=next;}}
    if(first>last)return {blocked:'前置任务完成后的可安排月份晚于截止时间，请调整依赖或期限'};
    const months=all.filter(m=>m>=first&&m<=last);if(!months.length)return {blocked:'任务截止时间早于目标计划期间'};
    const people=new Map(plan.people.map(p=>[p.id,p])),key=(id,m)=>id+'|'+m;
    const room=(id,m)=>{const person=people.get(id),cap=capacity(plan,person,m);return cap===null?0:Math.max(0,units(cap)-(load.get(key(id,m))||0));};
    const allocations={},unassigned={};
    function add(id,m,n){if(n<=0)return;if(id==='unassigned'){unassigned[m]=fromUnits(units(unassigned[m])+n);return;}(allocations[m]||={})[id]=fromUnits(units(allocations[m]?.[id])+n);load.set(key(id,m),(load.get(key(id,m))||0)+n);}
    const persistent=/持续|每月|逐月|全过程/.test(t.work),continuous=persistent||/分期|跟踪/.test(t.work),oldSpan=Math.max(1,E.monthNumber(t.end)-E.monthNumber(t.start)+1);
    const requested=t.durationMonths===undefined?(persistent?months.length:continuous?Math.max(2,Math.min(oldSpan,months.length)):1):Number(t.durationMonths);
    if(!Number.isInteger(requested)||requested<1||requested>60)throw Error('任务持续月份须为1至60的整数：'+t.work);
    if(continuous&&t.durationMonths===undefined)warnings.push(persistent?'持续性工作暂按目标期间逐月安排，具体频次与需求待核对':'跟踪或分期工作暂按至少两个月安排，具体持续月份待核对');
    if(total===0){
      const span=Math.min(requested,months.length),selected=months.slice(0,span),monthlyPlan={},monthNotes={};
      if(span<requested)warnings.push('目标期间不足以覆盖所填持续月份；未把待估算人天补成0');
      selected.forEach((m,i)=>{const content=monthContent(t,i,span,null);monthlyPlan[m]={...content,days:null,allocations:{},unassigned:null};monthNotes[m]=content.activity+'；阶段成果：'+content.output;});
      warnings.push('人天仍待估算，仅修正逐月工作和日期，未生成0或新增投入');
      const after={...clone(t),start:selected[0],end:selected.at(-1),allocations:{},unassigned:{},monthlyPlan,monthNotes};markSystem(after,warnings);return {after,warnings:unique(warnings)};
    }
    // 一次短活动不会因为某人当月容量小就被拆成几个月；先找能整体容纳的月份。
    const short=total<=8*4&&!continuous&&requested===1;
    if(short){
      const fits=m=>Object.entries(d.people).every(([id,n])=>room(id,m)>=n);
      const chosen=months.find(fits)||months.map((m,i)=>({m,i,available:Object.entries(d.people).reduce((s,[id,n])=>s+Math.min(n,room(id,m)),0)})).sort((a,b)=>b.available-a.available||a.i-b.i)[0].m;
      for(const [id,n]of Object.entries(d.people))add(id,chosen,n);add('unassigned',chosen,d.unassigned);
      if(!fitsBeforeLoad(chosen))warnings.push('短任务保留单月，总需求未删减；该月人员容量不足或未知，请调整人员或期限');
      function fitsBeforeLoad(m){return Object.entries(d.people).every(([id])=>{const cap=capacity(plan,people.get(id),m);return cap!==null&&(load.get(key(id,m))||0)<=units(cap);});}
    }else if(requested>1){
      const span=Math.min(requested,months.length,total);
      if(span<requested)warnings.push('可用月份或需求不足以覆盖原持续月份，已保留全部需求，请核对任务拆分与期限');
      const buckets=[...Object.entries(d.people),['unassigned',d.unassigned]].filter(([,n])=>n>0);
      let remainderOffset=0;
      const patterns=buckets.map(([id,n])=>{const values=Array(span).fill(Math.floor(n/span));for(let i=0;i<n%span;i++)values[(remainderOffset+i)%span]++;remainderOffset=(remainderOffset+n)%span;return {id,values};});
      const windows=Array.from({length:Math.max(1,months.length-span+1)},(_,offset)=>({offset,score:patterns.reduce((sum,{id,values})=>sum+(id==='unassigned'?0:values.reduce((s,value,i)=>s+Math.min(value,room(id,months[offset+i])),0)),0)}));
      const offset=windows.sort((a,b)=>b.score-a.score||a.offset-b.offset)[0].offset;
      for(const {id,values}of patterns)values.forEach((value,i)=>add(id,months[offset+i],value));
    }else{
      // 有较大工作量时按真实月容量推进；总量、逐人份额保持不变。
      for(const [id,n]of Object.entries(d.people)){
        let remaining=n;for(const m of months){const value=Math.min(remaining,room(id,m));add(id,m,value);remaining-=value;if(!remaining)break;}
        if(remaining){add(id,months.at(-1),remaining);warnings.push('期限内人员容量不足，剩余需求保留在截止月并提示超负荷，未静默延期');}
      }
      if(d.unassigned){
        const active=months.filter(m=>allocations[m]);
        if(active.length){const n=Math.floor(d.unassigned/active.length);active.forEach((m,i)=>add('unassigned',m,n+(i<d.unassigned%active.length?1:0)));}
        else add('unassigned',months[0],d.unassigned);
      }
    }
    if(d.unassigned)warnings.push('含待分配需求；未把待分配人天伪装为个人投入');
    for(const [id]of Object.entries(d.people))for(const m of months)if(allocations[m]?.[id]>0){const cap=capacity(plan,people.get(id),m);if(cap===null)warnings.push(m+' '+people.get(id).name+'可用量未知，保留投入待核对');else if((load.get(key(id,m))||0)>units(cap))warnings.push(m+' '+people.get(id).name+'存在超负荷（含其他任务）');}
    const active=months.filter(m=>allocations[m]||unassigned[m]!==undefined);
    if(!active.length)return {blocked:'没有可安排的正投入，保留原任务'};
    const start=active[0],end=active.at(-1),monthlyPlan={},monthNotes={},spanMonths=E.months(start,end);
    spanMonths.forEach((m,i)=>{
      if(!allocations[m]&&unassigned[m]===undefined)unassigned[m]=0;
      const amount=E.sum([...Object.values(allocations[m]||{}),unassigned[m]||0]),content=monthContent(t,i,spanMonths.length,amount);
      monthlyPlan[m]={...content,days:amount,allocations:clone(allocations[m]||{}),unassigned:unassigned[m]??0};monthNotes[m]=content.activity+'；阶段成果：'+content.output;
    });
    const after={...clone(t),start,end,allocations,unassigned,monthlyPlan,monthNotes};
    if(t.deadline&&String(t.deadline).length>7)warnings.push('截止日期按月份约束排期；具体日内安排仍需人工确认');
    markSystem(after,warnings);if(after.estimate)after.estimate.warnings=unique([...(after.estimate.warnings||[]),...warnings]);
    return {after,warnings:unique(warnings)};
  }
  function conflicts(plan,period){
    const warnings=[];
    for(const t of plan.tasks){
      if(t.start<period.start||t.end>period.end)warnings.push(t.work+'的保留期间超出目标计划期间');
      if(t.deadline&&t.end>deadline(t,period.end))warnings.push(t.work+'晚于截止月份，请调整期限或工作安排');
      for(const id of t.dependsOn||[]){const previous=plan.tasks.find(x=>x.id===id);if(previous&&previous.end>=t.start)warnings.push(t.work+'与前置任务'+previous.work+'存在月度依赖冲突');}
    }
    for(const row of E.loads({...plan,start:period.start,end:period.end}))if(row.capacity!==null&&row.days>row.capacity)warnings.push(row.month+' '+row.person.name+'安排'+row.days+'人天，可用'+row.capacity+'人天');
    return unique(warnings);
  }
  function propose(plan,options={}){
    E.validate(plan);
    const targetPeriod={start:options.start||plan.start,end:options.end||plan.end};E.months(targetPeriod.start,targetPeriod.end);
    const draft=clone(plan),wanted=options.taskIds?new Set(options.taskIds):null,eligible=new Set(),protectedItems=[],warnings=[];
    for(const t of draft.tasks){
      if(wanted&&!wanted.has(t.id))continue;
      const reason=t.estimate?.method==='model'?'已有AI工作包，保留分项活动与投入；请使用AI初算副本调整资源安排':protection(t,options);if(reason)protectedItems.push({taskId:t.id,work:t.work,reason});else eligible.add(t.id);
    }
    const load=new Map(),key=(id,m)=>id+'|'+m;
    for(const t of draft.tasks)if(!eligible.has(t.id))for(const [m,a]of Object.entries(t.allocations||{}))for(const [id,n]of Object.entries(a))load.set(key(id,m),(load.get(key(id,m))||0)+units(n));
    const byId=new Map(draft.tasks.map(t=>[t.id,t])),changes=[];
    for(const t of ordered(draft.tasks))if(eligible.has(t.id)){
      const result=place(draft,t,targetPeriod,load,byId);
      if(result.blocked){protectedItems.push({taskId:t.id,work:t.work,reason:result.blocked});for(const [m,a]of Object.entries(t.allocations||{}))for(const [id,n]of Object.entries(a))load.set(key(id,m),(load.get(key(id,m))||0)+units(n));continue;}
      const before=clone(t);Object.assign(t,result.after);warnings.push(...result.warnings.map(w=>t.work+'：'+w));
      if(JSON.stringify(snapshot(before))!==JSON.stringify(snapshot(t)))changes.push({taskId:t.id,work:t.work,before,after:clone(t),reason:before.scheduleMeta?.source==='system'?'根据已有系统需求逐月重排，再汇总任务起止':'用户允许对来源未知的旧安排提出副本重排建议',warnings:result.warnings});
    }
    warnings.push(...conflicts(draft,targetPeriod));
    return {version:1,baseRevision:revision(plan),targetPeriod,changes,protected:protectedItems,warnings:unique(warnings),createdAt:new Date().toISOString()};
  }
  function updated(plan,proposal,selectedIds){
    if(!proposal||proposal.version!==1||proposal.baseRevision!==revision(plan))throw Error('计划、人员容量或任务已变化，请重新计算排期建议');
    const ids=selectedIds===undefined?proposal.changes.map(c=>c.taskId):selectedIds;
    if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!proposal.changes.some(c=>c.taskId===id)))throw Error('请至少选择一项有效排期变更');
    const copy=clone(plan),selected=new Set(ids);
    copy.tasks=copy.tasks.map(t=>selected.has(t.id)?clone(proposal.changes.find(c=>c.taskId===t.id).after):t);
    const period=proposal.targetPeriod;E.months(period.start,period.end);
    for(const t of copy.tasks)for(const m of new Set([...Object.keys(t.allocations),...Object.keys(t.unassigned)]))if((E.effort(t,m)||0)>0&&(m<period.start||m>period.end))throw Error('保留任务“'+t.work+'”在'+m+'仍有投入，请扩大目标期间或先处理该任务；未创建副本');
    for(const t of copy.tasks)for(const id of t.dependsOn||[]){const previous=copy.tasks.find(p=>p.id===id);if(previous&&(selected.has(t.id)||selected.has(previous.id))&&previous.end>=t.start)throw Error('所选变更与未更新的前置任务冲突，请同时选择相关任务或重新计算');}
    copy.start=period.start;copy.end=period.end;
    const first=period.start+'-01',last=new Date(Date.UTC(Number(period.end.slice(0,4)),Number(period.end.slice(5)),0)).toISOString().slice(0,10);
    copy.startDate=copy.startDate?.slice(0,7)===period.start?copy.startDate:first;copy.endDate=copy.endDate?.slice(0,7)===period.end?copy.endDate:last;
    copy.taskCache||={};copy.tasks.forEach(t=>copy.taskCache[t.id]=clone(t));
    copy.scheduleReview={version:1,appliedIds:[...selected],at:new Date().toISOString(),warnings:conflicts(copy,period),note:'规则月度重排，仅调整已有需求与人员份额；不是AI人天初算'};
    copy.updatedAt=new Date().toISOString();E.validate(copy);return copy;
  }
  function applyCopy(plan,proposal,selectedIds){
    const copy=updated(plan,proposal,selectedIds);copy.id=E.uid();copy.basedOn=plan.id;copy.name=plan.name+'（月度重排修订版）';copy.createdAt=new Date().toISOString();return copy;
  }
  function applyChanges(plan,proposal,selectedIds){const copy=updated(plan,proposal,selectedIds);Object.assign(plan,copy);return plan;}
  function initialize(plan,ids){
    const proposal=propose(plan,{taskIds:ids});if(proposal.changes.length)applyChanges(plan,proposal);return plan;
  }
  const api={snapshot,markSystem,revision,protection,propose,applyCopy,applyChanges,initialize};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkPlanScheduling=api;
})(typeof window!=='undefined'?window:globalThis);
