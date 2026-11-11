/* 开项前初稿：规则估算、岗位匹配、逐月分配。不是实际工时或精确资源调度。 */
(function(root){
  'use strict';
  const E=root.WorkPlanEngine||(typeof require==='function'&&require('./plan-engine.js'));
  const B=root.WorkPlanBuilder||(typeof require==='function'&&require('./plan-builder.js'));
  const S=root.WorkPlanScheduling||(typeof require==='function'&&require('./plan-scheduling.js'));
  const quarter=n=>Math.round(n*4)/4;
  const rules=[
    [/访谈/,'访谈与记录整理',3.75,['调研','市场','实施']],
    [/踏勘/,'现场核实与记录整理',3,['调研','实施','设计']],
    [/调研|研究|征集/,'资料收集、调研及整理',5,['调研','研究','市场']],
    [/测算|财务|偿债/,'测算与数据核对',5,['财务','测算','后台']],
    [/协议|合同/,'文本编制与协调核对',4,['后台','合同','商务','实施']],
    [/方案|编制|规划|策划/,'方案编制及复核',6,['策划','实施','规划','设计']],
    [/分析|论证/,'分析与结论核实',4,['研究','调研','策划']],
    [/汇报|会议|进场|签订/,'协调准备与记录',2,['统筹','协调','实施']],
    [/跟进|提交|申报|联系/,'协调与材料跟进',1.5,['后台','协调','实施']],
  ];
  function estimate(t){
    const rule=rules.find(r=>r[0].test(t.work))||[null,'编制与核对',3.25,['实施']];
    const outputs=Math.max(1,(t.output.match(/《/g)||[]).length);
    return {days:quarter(rule[2]+Math.min(2,outputs-1)*.5),skills:rule[3],basis:`规则初估：${rule[1]}，基准${rule[2]}人天${outputs>1?'；多项成果增加核对投入':''}；待负责人按规模与资料情况修改`};
  }
  function capacity(p,person,m){
    if(Object.hasOwn(person.capacities||{},m))return person.capacities[m];
    if(person.capacity!==null)return person.capacity;
    return p.preStartMode?(p.standardDays??20):null;
  }
  function initialize(plan,ids){
    const p=B.clone(plan),wanted=new Set(ids),months=E.months(p.start,p.end),initialized=[];
    p.preStartMode=true;
    // 本模块只保留原规则总量及岗位建议；逐月安排统一交给M4排期器。
    const ordered=p.tasks;
    for(const t of ordered){
      if(!wanted.has(t.id)||t.locked||t.status==='已完成')continue;
      if(Object.keys(t.allocations).length||Object.keys(t.unassigned).length){t.needsInitialStaffing=false;continue;}
      const e=estimate(t),available=p.people.map(person=>({person,score:e.skills.reduce((s,word)=>s+((person.role+' '+(person.groupNames||[person.group]).join(' ')).includes(word)?1:0),0)})).sort((a,b)=>b.score-a.score);
      if(!available.length)continue;
      const active=available.filter(x=>months.some(m=>(capacity(p,x.person,m)||0)>0)),pool=active.length?active:available;
      const nominated=pool.find(x=>x.person.name===t.owner),best=pool[0];
      // 相同匹配度时尊重用户已选的负责人；否则选更符合任务的成员。
      const lead=nominated&&nominated.score>=best.score?nominated:best;
      const helper=pool.find(x=>x.person.id!==lead.person.id&&x.score>0);
      const nominatedIds=E.participantIds(t,p.people),manual=t.participantSource==='manual';
      const participants=manual?available.filter(x=>nominatedIds.includes(x.person.id)).sort((a,b)=>nominatedIds.indexOf(a.person.id)-nominatedIds.indexOf(b.person.id)):[lead,...(e.days>2&&helper?[helper]:[])];
      const allocations={},unassigned={},warnings=[],month=months[0];
      E.setParticipants(t,participants.map(x=>x.person.id),p.people);
      if(!participants.length){unassigned[month]=e.days;warnings.push('未指定负责人，需求保留为待分配');}
      let distributed=0;
      for(let i=0;i<participants.length;i++){
        const person=participants[i].person;
        const n=i===participants.length-1?quarter(e.days-distributed):Math.min(quarter(e.days-distributed),manual?Math.floor(e.days/participants.length*4)/4:quarter(e.days*.75));
        distributed=E.sum([distributed,n]);
        if(n===0)continue;
        if(months.some(m=>(capacity(p,person,m)||0)>0)){
          (allocations[month]||={})[person.id]=n;
        }else{
          unassigned[month]=E.sum([unassigned[month]||0,n]);
          warnings.push('人员容量为0或未知，需求保留为待分配');
        }
      }
      t.allocations=allocations;t.unassigned=unassigned;t.start=month;t.end=month;
      t.monthNotes={};
      t.estimate={method:'规则初估',total:e.days,basis:e.basis,warnings:[...new Set(warnings)]};
      t.needsInitialStaffing=false;
      t.notes=[t.notes,e.basis,...new Set(warnings)].filter(Boolean).join('；');
      S.markSystem(t);initialized.push(t.id);
    }
    if(initialized.length)S.initialize(p,initialized);
    p.staffing={at:new Date().toISOString(),method:'岗位匹配与规则初估',note:'标准工日默认20；仅按本项目测算，未核对其他项目占用。'};
    E.validate(p);p.tasks.forEach(t=>p.taskCache[t.id]=B.clone(t));Object.assign(plan,p);return plan;
  }
  const api={estimate,capacity,initialize};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkPlanStaffing=api;
})(typeof window!=='undefined'?window:globalThis);
