const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../plan-engine.js'),B=require('../plan-builder.js'),F=require('../plan-staffing.js'),D=require('../plan-editing.js');
function fixture(){
 const p=B.createProject(),r=B.registry();Object.assign(p,{taskScale:'medium',name:'排期集成项目',description:'现场调研与咨询',start:'2026-11',end:'2027-01',startDate:'2026-11-01',endDate:'2027-01-31'});
 p.people=B.peopleForProject(r,[r.employees[0].id,r.employees[1].id]);p.selectedEmployeeIds=p.people.map(x=>x.employeeId);
 p.tree.forEach(m=>B.toggle(p.tree,m.id,false));const m=B.addNode(p,null,{name:'研究'}),c=B.addNode(p,m.id,{name:'核实'});B.addNode(p,c.id,{work:'地块现场踏勘',output:'《踏勘核实报告》'});B.addNode(p,c.id,{work:'项目相关主体访谈',output:'《访谈纪要》'});B.generate(p);return p;
}
test('新初估移交M4排期：短任务容量不足仍单月，保留逐人总量与超载提示',()=>{
 const p=fixture();p.people.forEach(x=>x.capacity=1);p.tasks.forEach(t=>{E.setParticipants(t,p.people.map(x=>x.id),p.people);t.participantSource='manual';});
 F.initialize(p,p.tasks.map(t=>t.id));
 for(const t of p.tasks){
  assert.equal(t.start,t.end);assert.equal(Object.keys(t.monthlyPlan).length,1);assert.equal(E.total(t,E.months(p.start,p.end)),t.estimate.total);
  assert.equal(t.scheduleMeta.source,'system');const row=t.monthlyPlan[t.start];assert(row.activity);assert(row.output);assert.equal(row.days,E.effort(t,t.start));
 }
 const short=p.tasks[0];for(const person of p.people)assert.equal(E.sum(Object.values(short.allocations).map(a=>a[person.id]||0)),1.5);
 assert(E.loads(p).some(r=>r.capacity!==null&&r.days>r.capacity));
 assert(p.tasks.some(t=>t.estimate.warnings.length||t.scheduleMeta.warnings?.length));
});
test('首次生成不改已有手填0、投入与锁定任务，仅新鲜任务得到系统月计划',()=>{
 const p=fixture(),first=p.tasks[0],second=p.tasks[1];first.unassigned[p.start]=0;const before={start:first.start,end:first.end,allocations:structuredClone(first.allocations),unassigned:structuredClone(first.unassigned)};
 F.initialize(p,[first.id,second.id]);assert.deepEqual({start:p.tasks[0].start,end:p.tasks[0].end,allocations:p.tasks[0].allocations,unassigned:p.tasks[0].unassigned},before);
 assert(p.tasks[1].monthlyPlan);assert.equal(p.tasks[0].monthlyPlan,undefined);
 const snapshot=JSON.stringify(p.tasks);F.initialize(p,p.tasks.map(t=>t.id));assert.equal(JSON.stringify(p.tasks),snapshot);
 const q=fixture();q.tasks[0].locked=true;q.tasks[1].status='已完成';const old=JSON.stringify(q.tasks);F.initialize(q,q.tasks.map(t=>t.id));assert.equal(JSON.stringify(q.tasks),old);
});
test('人员容量全为0或未知仍保留完整需求为待分配，保持规则来源而不冒充AI',()=>{
 const p=fixture();p.people.forEach(x=>{x.capacity=0;x.capacities={'2026-11':null,'2026-12':null,'2027-01':null};});F.initialize(p,p.tasks.map(t=>t.id));
 for(const t of p.tasks){assert.equal(E.assigned(t,t.start),0);assert.equal(E.total(t,E.months(p.start,p.end)),t.estimate.total);assert.equal(t.estimate.method,'规则初估');assert(t.monthlyPlan[t.start].unassigned>0);}
});
test('M4初稿后的逐人手动投入不被再次规则初排覆盖',()=>{
 const p=fixture();F.initialize(p,p.tasks.map(t=>t.id));const t=p.tasks[0],id=p.people[0].id;D.allocation(p,t.id,t.start,id,'0');
 const snapshot=JSON.stringify(p.tasks);F.initialize(p,p.tasks.map(t=>t.id));assert.equal(JSON.stringify(p.tasks),snapshot);
});
