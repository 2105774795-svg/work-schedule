/* 所有表格编辑共用事务：先在副本校验，成功后整份替换。失败不丢原数据。 */
(function(root){
  'use strict';
  const E=root.WorkPlanEngine||(typeof require==='function'&&require('./plan-engine.js'));
  const B=root.WorkPlanBuilder||(typeof require==='function'&&require('./plan-builder.js'));
  const clone=B.clone;
  function markManual(t,key){(t.editSources||={})[key]='manual';}
  function syncMonthly(t){for(const [m,row]of Object.entries(t.monthlyPlan||{})){row.days=E.effort(t,m);row.allocations=clone(t.allocations?.[m]||{});row.unassigned=t.unassigned?.[m]??null;}}
  function task(plan,id){const t=plan.tasks.find(t=>t.id===id);if(!t)throw Error('任务已不存在，请刷新');return t;}
  function period(plan,t,month,value){
    if(!E.months(plan.start,plan.end).includes(month)||month<t.start||month>t.end)throw Error('投入月份必须在项目与任务期间内');
    if(t.locked)throw Error('此任务已锁定，请先解除锁定');
    if(t.status==='已完成'&&month>plan.asOf&&value>0)throw Error('已完成任务不能安排未来投入');
  }
  function transaction(plan,operation){
    const draft=clone(plan);operation(draft);E.validate(draft);
    // 保留AI标准需求；人工修改只更新采用值和分工快照，不反写成新的模型估值。
    const previous=new Map(plan.tasks.map(t=>[t.id,t]));
    for(const t of draft.tasks){
      const before=previous.get(t.id);
      if(t.estimate?.method==='model'&&before&&['allocations','unassigned'].some(k=>JSON.stringify(before[k])!==JSON.stringify(t[k]))){
        const AI=root.WorkPlanAIEffort||(typeof require==='function'&&require('./plan-ai-effort.js'));
        AI.calibrate(draft,t.id,'人工调整月度投入或人员分工，具体原因待补充');
      }
    }
    draft.taskCache||={};draft.tasks.forEach(t=>draft.taskCache[t.id]=clone(t));
    draft.editRevision=(plan.editRevision||0)+1;draft.updatedAt=new Date().toISOString();
    Object.assign(plan,draft);return plan;
  }
  function update(plan,id,field,value){
    return transaction(plan,p=>{
      const t=task(p,id);if(t.locked&&field!=='locked')throw Error('此任务已锁定，请先解除锁定');
      if(field==='locked'){t.locked=!!value;return;}
      if(!['work','output','owner','start','end','deadline','partner','status','difficulty','notes'].includes(field))throw Error('此列由系统计算，不可直接改写');
      value=String(value).trim();if(field==='work'&&!value)throw Error('工作内容不能为空');
      if(field==='owner'&&value&&!p.people.some(x=>x.name===value))throw Error('负责人必须属于本次参与人员');
      if(field==='owner'){changeParticipants(p,t,value?[p.people.find(x=>x.name===value).id]:[],false);return;}
      const changed=t[field]!==value;t[field]=value;
      if(changed&&['start','end','work','output'].includes(field))markManual(t,'schedule');
      if(changed&&field==='deadline')markManual(t,'constraints');
      if(['start','end'].includes(field)){
        E.months(t.start,t.end);
        if(t.start<p.start||t.end>p.end)throw Error('任务日期必须在项目期间内');
        for(const m of new Set([...Object.keys(t.allocations),...Object.keys(t.unassigned)]))if((E.effort(t,m)||0)>0&&(m<t.start||m>t.end))throw Error('新的期间会遗漏已有投入，请先迁移或清空该月人天');
      }
      const row=B.find(p.tree,id);if(row&&['work','output'].includes(field))row.node[field]=value;
    });
  }
  function total(plan,id,month,value){return transaction(plan,p=>{const t=task(p,id);period(p,t,month,value===''?0:E.days(value));E.setTotal(t,month,value);markManual(t,'effort');syncMonthly(t);});}
  function allocation(plan,id,month,personId,value){return transaction(plan,p=>{
    const t=task(p,id),n=value===''?null:E.days(value);period(p,t,month,n||0);
    if(personId==='unassigned'){if(n===null)delete t.unassigned[month];else t.unassigned[month]=n;markManual(t,'effort');syncMonthly(t);return;}
    if(!p.people.some(x=>x.id===personId))throw Error('只能分配本次项目参与人员');
    t.allocations[month]||={};if(n===null)delete t.allocations[month][personId];else t.allocations[month][personId]=n;
    if(!Object.keys(t.allocations[month]).length)delete t.allocations[month];
    markManual(t,'effort');syncMonthly(t);
  });}
  function capacity(plan,personId,month,value){return transaction(plan,p=>{
    const person=p.people.find(x=>x.id===personId);if(!person)throw Error('人员已不存在');
    if(!E.months(p.start,p.end).includes(month))throw Error('月份超出项目期间');
    (person.capacities||={})[month]=value===''?null:E.days(value);
  });}
  function standard(plan,value){const n=Number(value);return transaction(plan,p=>{if(!Number.isFinite(n)||n<=0||n>31)throw Error('月标准工日须大于0且不超过31');p.standardDays=n;});}
  function monthNote(plan,id,month,value){return transaction(plan,p=>{const t=task(p,id);period(p,t,month,0);(t.monthNotes||={})[month]=String(value).trim().slice(0,3000);if(t.monthlyPlan?.[month])t.monthlyPlan[month].activity=t.monthNotes[month];markManual(t,'monthNotes');});}
  function monthPlanField(plan,id,month,field,value){return transaction(plan,p=>{
    const t=task(p,id);period(p,t,month,0);if(!['activity','output'].includes(field))throw Error('月度安排字段不正确');
    value=String(value).trim();if(value.length>3000)throw Error('月度活动或成果不能超过3000字');
    const row=(t.monthlyPlan||={})[month]||={activity:t.monthNotes?.[month]||'',output:''};row[field]=value;
    (t.monthNotes||={})[month]=row.activity;
    markManual(t,'monthNotes');syncMonthly(t);
  });}
  // 汇总入口必须落到明确的任务和人员分配，不向各任务隐式均摊。
  function distribute(plan,month,entries,target){return transaction(plan,p=>{
    if(!Array.isArray(entries)||!entries.length)throw Error('请至少填写一项任务分配');
    const seen=new Set();for(const entry of entries){
      const key=entry.taskId+'|'+entry.personId;if(seen.has(key))throw Error('任务分配不能重复');seen.add(key);
      const t=task(p,entry.taskId),n=entry.value===''?null:E.days(entry.value);period(p,t,month,n||0);
      if(entry.personId==='unassigned'){if(n===null)delete t.unassigned[month];else t.unassigned[month]=n;}
      else{if(!p.people.some(x=>x.id===entry.personId))throw Error('分配人员不在本次项目');if(n===null){if(t.allocations[month]){delete t.allocations[month][entry.personId];if(!Object.keys(t.allocations[month]).length)delete t.allocations[month];}}else{t.allocations[month]||={};t.allocations[month][entry.personId]=n;}}
      markManual(t,'effort');syncMonthly(t);
    }
    if(target){const members=target.personId?[target.personId]:p.people.filter(x=>x.group===target.group).map(x=>x.id);const result=E.sum(p.tasks.flatMap(t=>members.map(id=>t.allocations?.[month]?.[id]||0)));if(result!==E.days(target.value))throw Error(`明细合计为 ${result} 人天，与目标 ${target.value} 不一致，请核对后保存`);}
  });}
  function changeParticipants(p,t,ids,release){
    const previous=E.participantIds(t,p.people);
    if(t.locked&&JSON.stringify(previous)!==JSON.stringify(ids))throw Error('此任务已锁定，请先解除锁定');
    E.setParticipants(t,ids,p.people);
    const removed=previous.filter(id=>!ids.includes(id));
    if(removed.some(id=>Object.values(t.allocations).some(a=>(a[id]||0)>0))&&!release)throw Error('移除成员有已填投入，请确认将其转为待分配后再修改');
    for(const [m,a]of Object.entries(t.allocations))for(const id of removed)if(Object.hasOwn(a,id)){
      markManual(t,'effort');
      t.unassigned[m]=E.sum([t.unassigned[m]||0,a[id]]);delete a[id];
      if(!Object.keys(a).length)delete t.allocations[m];
    }
    syncMonthly(t);
    t.participantSource='manual';
  }
  function participants(plan,id,ids,release=false){return transaction(plan,p=>{
    const t=task(p,id);if(t.locked)throw Error('此任务已锁定，请先解除锁定');
    changeParticipants(p,t,ids,release);
  });}
  const api={transaction,update,total,allocation,capacity,standard,monthNote,monthPlanField,markManual,syncMonthly,distribute,participants,changeParticipants};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkPlanEditing=api;
})(typeof window!=='undefined'?window:globalThis);
