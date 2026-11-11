/* 验证 AI 初算、人工修改和 Excel 导出之间的数据联动。 */
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../plan-engine.js'),B=require('../plan-builder.js'),AI=require('../plan-ai-effort.js'),D=require('../plan-editing.js'),X=require('../plan-export.js'),Zip=require('../vendor/jszip.min.js');
const S=require('../plan-scheduling.js');

function fixture(){
  const p=B.createProject(),r=B.registry();
  Object.assign(p,{name:'AI初算联动样本',description:'三个地块的资料核实与研究',taskScale:'small',start:'2026-11',end:'2027-01',startDate:'2026-11-01',endDate:'2027-01-31',asOf:'2026-11',effortCapacityDefault:false});
  p.people=B.peopleForProject(r,r.employees.slice(0,3).map(x=>x.id));p.people.forEach((x,i)=>{x.capacity=8;x.role=i===0?'现场调研':i===1?'研究分析':'成果复核';});p.selectedEmployeeIds=p.people.map(x=>x.employeeId);
  p.tree.forEach(m=>B.toggle(p.tree,m.id,false));const m=B.addNode(p,null,{name:'专项研究'}),c=B.addNode(p,m.id,{name:'地块分析'});
  for(let i=1;i<=3;i++)B.addNode(p,c.id,{work:`地块${i}专题核实`,output:`《地块${i}研究成果》`});B.generate(p);
  return p;
}
function response(p,ids=p.tasks.map(t=>t.id)){
  return {version:1,method:'model',model:'offline-protocol-fixture',generatedAt:'2026-11-10T00:00:00Z',tasks:p.tasks.filter(t=>ids.includes(t.id)).map(t=>({taskId:t.id,low:4,high:7,components:[{id:'research',activity:t.work+'独立分析',output:t.output,days:5,roles:['研究'],personIds:[],basis:'联动测试固定值：独立分析4人天、核对1人天，不代表实际业务定额',parameterKeys:[]}],basis:'离线协议样本，仅验证计算与传递',assumptions:['各地块资料口径相同，待业务确认'],uncertainty:'不是统计置信区间；资料成熟度尚需确认',informationNeeded:['核对资料成熟度']})),sharedActivities:ids.length>1?[{id:'shared-preparation',activity:'三个地块共用资料整理',output:'《共用资料索引》',days:ids.length,low:ids.length,high:ids.length,basis:'本次共同活动只记一次总成本，再按地块均分；测试值',allocations:ids.map(taskId=>({taskId,days:1}))}]:[]};
}
const months=p=>E.months(p.start,p.end),total=p=>E.sum(p.tasks.map(t=>E.total(t,months(p))||0));
function initialized(){const p=fixture();AI.apply(p,AI.propose(p,response(p),{mode:'empty'}));return p;}
test('已有AI工作包不被旧规则重排覆盖，保留原月度活动和估算依据',()=>{
  const p=initialized(),before=JSON.stringify(p),proposal=S.propose(p);assert.equal(proposal.changes.length,0);assert.equal(proposal.protected.length,p.tasks.length);assert(proposal.protected.every(x=>x.reason.includes('AI工作包')));assert.equal(JSON.stringify(p),before);
});

test('AI专属工作15加共用3只计18；月历、明细、负荷和汇总读取同一分配',()=>{
  const p=initialized();assert.equal(total(p),18);assert.equal(E.sum(E.summaries(p).map(r=>r.days)),18);assert.equal(E.sum(E.loads(p).map(r=>r.days)),18);
  assert.equal(p.effortReview.sharedActivities.length,1);assert.equal(p.effortReview.sharedActivities[0].days,3);
  for(const t of p.tasks){assert.equal(t.estimate.total,6);assert.equal(t.estimate.exclusiveTotal,5);assert.equal(t.estimate.sharedTotal,1);assert.equal(t.start,t.end);assert.equal(E.total(t,months(p)),6);assert.equal(t.monthlyPlan[t.start].days,6);assert.equal(E.sum(Object.values(t.allocations[t.start]||{})),6);}
  const sheets=X.buildSpec(p,['月度任务明细','月度人力汇总','人员月度负荷','说明及人员']),detail=sheets.find(s=>s.name==='月度任务明细');
  assert.equal(E.sum(detail.rows.map(r=>r.at(-1))),18);assert.equal(E.sum(sheets[0].rows.map(r=>r.at(-1))),18);assert.match(sheets[0].note,/AI分项初算/);
  const notes=sheets.find(s=>s.name==='说明及人员').rows;assert.match(notes.find(r=>r[0]==='排期依据')[1],/AI分项已初算3项/);assert.equal(notes.filter(r=>r[0]==='共用工作分摊').length,3);assert(notes.some(r=>r[0]==='AI估算依据'));
});

test('人工总量加1只增加1，AI需求与原建议不变；刷新结构保留采用值和校准',()=>{
  const p=initialized(),id=p.tasks[0].id,t=p.tasks[0],m=t.start,original=JSON.stringify(t.estimate.aiOriginal),peopleBefore=E.summaries(p).find(r=>r.month===m).people;
  D.total(p,id,m,'7');const changed=p.tasks.find(t=>t.id===id);
  assert.equal(total(p),19);assert.equal(changed.estimate.total,6);assert.equal(changed.estimate.calibration.aiTotal,6);assert.equal(changed.estimate.calibration.adoptedTotal,7);assert.equal(JSON.stringify(changed.estimate.aiOriginal),original);assert.match(changed.estimate.calibration.reason,/原因待补充/);assert.equal(changed.estimate.calibration.history.length,1);
  assert.equal(changed.monthlyPlan[m].days,7);assert.equal(changed.monthlyPlan[m].unassigned,1);assert.equal(E.summaries(p).find(r=>r.month===m).people,peopleBefore);
  assert.equal(E.sum(E.summaries(p).map(r=>r.days)),19);assert.equal(E.sum(E.loads(p).map(r=>r.days)),18);
  const copy=B.migrate(JSON.parse(JSON.stringify(p)),B.registry());assert.equal(copy.tasks.find(t=>t.id===id).estimate.calibration.adoptedTotal,7);assert.equal(total(copy),19);
  const specs=X.buildSpec(copy,['月度任务明细']);assert.equal(E.sum(specs[0].rows.map(r=>r.at(-1))),19);assert.equal(E.sum(specs[1].rows.map(r=>r.at(-1))),19);
  assert(AI.eligible(copy,{mode:'system'}).protected.some(x=>x.taskId===id));
});

test('转移成员投入总量不变也保留校准；失败分配不写入记录',()=>{
  const p=initialized(),t=p.tasks[0],m=t.start,from=Object.keys(t.allocations[m])[0],to=p.people.find(x=>x.id!==from).id,n=t.allocations[m][from],other=t.allocations[m][to]||0;
  D.distribute(p,m,[{taskId:t.id,personId:from,value:'0'},{taskId:t.id,personId:to,value:String(other+n)}]);
  const changed=p.tasks.find(x=>x.id===t.id);assert.equal(total(p),18);assert.equal(changed.estimate.calibration.adoptedTotal,6);assert.equal(changed.estimate.calibration.history.length,1);assert.equal(changed.estimate.calibration.history[0].allocations[m][to],other+n);
  const before=JSON.stringify(p);assert.throws(()=>D.distribute(p,m,[{taskId:t.id,personId:'not-selected',value:'1'}]),/本次项目/);assert.equal(JSON.stringify(p),before);
});

test('未知与零容量保留AI需求为待分配，导出不造0%或规则来源',async()=>{
  const p=fixture();p.people.forEach((person,i)=>{person.capacity=i===0?0:null;});AI.apply(p,AI.propose(p,response(p),{mode:'empty'}));
  assert.equal(total(p),18);assert.equal(E.sum(E.loads(p).map(r=>r.days)),0);assert.equal(E.sum(E.summaries(p).map(r=>r.unassigned)),18);
  const specs=X.buildSpec(p,['人员月度负荷','月度任务明细','说明及人员']),load=specs.find(s=>s.name==='人员月度负荷');assert(load.rows.every(r=>r[7]===null));assert(load.rows.some(r=>r[6]===null));assert(load.rows.some(r=>r[6]===0));assert.match(load.note,/未知或零容量/);assert.doesNotMatch(specs[0].note,/人天为规则初估/);
  const zip=await Zip.loadAsync(await X.buffer(p,['月度任务明细','说明及人员'],Zip)),xml=await zip.file('xl/worksheets/sheet3.xml').async('string');assert.match(xml,/AI标准需求/);assert.match(xml,/共用工作分摊/);
});

test('共享组内人工修改后整组保留，不能只重算其他份额重复计费',()=>{
  const p=initialized();D.total(p,p.tasks[0].id,p.tasks[0].start,'7');
  const before=JSON.stringify(p),selection=AI.eligible(p,{mode:'system'});assert.equal(selection.taskIds.length,0);assert.equal(selection.protected.length,3);assert.equal(JSON.stringify(p),before);
  assert.throws(()=>AI.request(p,[p.tasks[1].id]),/共用|共享|完整/);
});

test('人工0、锁定与完成保留；独立系统任务重算仅在副本应用',()=>{
  const p=fixture(),first=response(p);first.sharedActivities=[];AI.apply(p,AI.propose(p,first,{mode:'empty'}));D.total(p,p.tasks[0].id,p.tasks[0].start,'7');
  const before=JSON.stringify(p),ids=AI.eligible(p,{mode:'system'}).taskIds,next=response(p,ids);next.sharedActivities=[];const proposal=AI.propose(p,next,{taskIds:ids,mode:'system'}),copy=AI.applyCopy(p,proposal);
  assert.equal(JSON.stringify(p),before);assert.notEqual(copy.id,p.id);assert.equal(copy.basedOn,p.id);assert.deepEqual(copy.tasks[0],p.tasks[0]);
  const q=fixture();D.total(q,q.tasks[0].id,q.tasks[0].start,'0');q.tasks[1].locked=true;q.tasks[2].status='已完成';const protectedItems=AI.eligible(q,{mode:'system'});assert.equal(protectedItems.taskIds.length,0);assert.equal(protectedItems.protected.length,3);
});
