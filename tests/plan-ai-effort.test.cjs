const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../plan-engine.js'),S=require('../plan-scheduling.js'),A=require('../plan-ai-effort.js');
const task=(id='t',extra={})=>E.newTask({id,module:'B',category:'研究',work:'现场踏勘及专题研究',output:'《专题报告》',start:'2026-11',end:'2027-01',needsInitialStaffing:true,...extra});
function plan(tasks=[task()]){return {id:'ai-case',schemaVersion:2,name:'AI需求测试',description:'三个地块的项目前期研究',scope:'研究和投融资咨询',start:'2026-11',end:'2027-01',asOf:'2026-11',modules:['B'],people:[{id:'a',name:'甲姓名',role:'调研',group:'实施',capacity:10},{id:'b',name:'乙姓名',role:'策划',group:'实施',capacity:10},{id:'c',name:'丙姓名',role:'财务',group:'后台',capacity:10}],tasks,taskCache:{},options:[],effortParameters:[{key:'objectCount',label:'地块数',value:3,source:'user'}]};}
function row(id,n=6){return {taskId:id,low:n-1,high:n+2,components:[{id:'prepare',activity:id+'准备与现场核对',output:'现场资料记录',days:n,roles:['调研'],personIds:['a'],basis:'按3个对象、每个核对及整理约2人天的初算假设；不是历史定额',parameterKeys:['objectCount']}],basis:'对象数量乘单对象调查整理投入，待资料核验',assumptions:['三个对象均需核对；交通等待不计投入'],uncertainty:'中：资料完整度尚未核实',informationNeeded:['基础资料完整度']};}
const response=rows=>({version:1,method:'model',model:'offline-model',generatedAt:'2026-11-10T00:00:00Z',tasks:rows,sharedActivities:[]});
const total=t=>E.sum(Object.values(t.allocations).flatMap(Object.values).concat(Object.values(t.unassigned)));

test('6人天按三人3+2+1安排，总需求与分项、月度、逐人守恒，不因成员数变18',()=>{
 const p=plan(),r=row('t');r.components=[['p',1,'调研','a'],['f',2,'调研','a'],['s',2,'策划','b'],['r',1,'财务','c']].map(([id,days,role,person])=>({id,days,activity:id+'分项活动',output:id+'分项成果',roles:[role],personIds:[person],basis:id+'投入估算依据',parameterKeys:['objectCount']}));
 const original=JSON.stringify(p),proposal=A.propose(p,response([r]));assert.equal(JSON.stringify(p),original);A.apply(p,proposal);const t=p.tasks[0];assert.equal(total(t),6);assert.equal(t.estimate.total,6);assert.equal(t.start,t.end);assert.deepEqual(t.allocations[t.start],{a:3,b:2,c:1});assert.deepEqual(t.participantIds,['a','b','c']);assert.equal(E.sum(t.monthlyPlan[t.start].workPackages.map(c=>c.days)),6);assert.deepEqual(p.taskCache.t,t);
});
test('多个任务统一使用同一份剩余容量，不按任务或批次重复给满容量',()=>{
 const p=plan([task('one'),task('two')]);p.people=p.people.slice(0,1);p.people[0].capacity=5;p.end='2026-11';const proposal=A.propose(p,response([row('one'),row('two')]));A.apply(p,proposal);assert.equal(E.loads(p)[0].days,5);assert.equal(E.sum(p.tasks.map(total)),12);assert.equal(E.sum(p.tasks.flatMap(t=>Object.values(t.unassigned))),7);assert(proposal.warnings.some(x=>/全计划|容量不足/.test(x)));
});
test('未知容量及显式0不分配，用户明确选标准工日才按假设安排且标来源',()=>{
 const p=plan();p.people.forEach(x=>x.capacity=null);p.preStartMode=true;A.apply(p,A.propose(p,response([row('t')])));assert.equal(total(p.tasks[0]),6);assert.equal(E.sum(Object.values(p.tasks[0].allocations).flatMap(Object.values)),0);assert.equal(p.tasks[0].unassigned[p.tasks[0].start],6);assert.equal(p.preStartMode,false);
 const q=plan();q.people.forEach(x=>x.capacity=null);q.people[0].capacities={'2026-11':0};q.effortCapacityDefault=true;const input=A.request(q,['t']);assert.equal(input.people[0].capacity,20);assert.match(input.people[0].capacitySource,/假设/);A.apply(q,A.propose(q,response([row('t')])));assert.equal(q.tasks[0].allocations[q.tasks[0].start]?.a||0,0);assert.equal(total(q.tasks[0]),6);assert(q.tasks[0].estimate.warnings.some(x=>/假设/.test(x)));
});
test('人工日期、人天0、月活动、锁定、完成、未知旧稿全部保护，新空白可初算',()=>{
 const p=plan([task('fresh'),task('date',{editSources:{schedule:'manual'}}),task('zero',{allocations:{'2026-11':{a:0}}}),task('notes',{editSources:{monthNotes:'manual'}}),task('lock',{locked:true}),task('done',{status:'已完成'}),task('legacy',{needsInitialStaffing:false,monthlyPlan:{'2026-11':{activity:'旧活动',output:'旧成果',days:null}}})]);
 const result=A.eligible(p,{mode:'system'});assert.deepEqual(result.taskIds,['fresh']);assert.equal(result.protected.length,6);const before=JSON.stringify(p.tasks.slice(1));A.apply(p,A.propose(p,response([row('fresh')]),{mode:'system'}));assert.equal(JSON.stringify(p.tasks.slice(1)),before);
});
test('无投入的旧系统稿仍按基线保护已修改的月活动',()=>{
 const untouched=S.markSystem(task('untouched',{needsInitialStaffing:false,monthlyPlan:{'2026-11':{activity:'系统预排',output:'核对表',days:null}}}));
 const edited=S.markSystem(task('edited',{needsInitialStaffing:false,monthlyPlan:{'2026-11':{activity:'系统预排',output:'核对表',days:null}}}));
 edited.monthlyPlan['2026-11'].activity='历史旧稿补充的人工安排';
 const unknown=task('unknown',{needsInitialStaffing:false,scheduleMeta:{source:'system'}}),p=plan([untouched,edited,unknown]);
 for(const mode of ['empty','system']){
  const result=A.eligible(p,{mode});assert.deepEqual(result.taskIds,['untouched']);
  assert.match(result.protected.find(t=>t.taskId==='edited').reason,/系统初稿之后已有修改/);
  assert.match(result.protected.find(t=>t.taskId==='unknown').reason,/旧稿来源未知/);
 }
 const snapshot=JSON.stringify([edited,unknown]);A.apply(p,A.propose(p,response([row('untouched')]),{mode:'system'}));assert.equal(JSON.stringify(p.tasks.slice(1)),snapshot);
});
test('旧建议开始月只定位单月，容量为0时有据后移',()=>{
 const p=plan([S.markSystem(task('t',{start:'2026-12',needsInitialStaffing:false}))]);
 A.apply(p,A.propose(p,response([row('t')]),{mode:'system'}));
 assert.equal(p.tasks[0].start,'2026-12');assert.equal(p.tasks[0].end,'2026-12');
 assert(p.tasks[0].estimate.allocationBasis.some(line=>line.includes('保留已有系统初稿的建议开始月')));
 const q=plan();q.people.forEach(person=>{person.capacities={'2026-11':0};});
 A.apply(q,A.propose(q,response([row('t')])));assert.equal(q.tasks[0].start,'2026-12');assert.equal(q.tasks[0].end,'2026-12');
 assert(q.tasks[0].estimate.warnings.some(w=>w.includes('已后移到2026-12')));
});
test('明确前置任务仍待估算时，后续需求全部待分配',()=>{
 const p=plan([task('prev',{end:'2026-11'}),task('next',{dependsOn:['prev']})]);
 const pending={taskId:'prev',status:'pending',low:null,high:null,components:[],basis:'对象范围未知',assumptions:[],uncertainty:'高',informationNeeded:['确认对象边界']};
 A.apply(p,A.propose(p,response([pending,row('next')])));
 const next=p.tasks[1];assert.equal(next.estimate.resourcePlan.assigned,0);assert.equal(next.estimate.resourcePlan.unassigned,6);
 assert.match(next.estimate.resourcePlan.blockedReason,/前置任务仍待估算/);
});
test('大任务按原AI工作包保留各阶段活动成果和投入，跨月不被规则文字或均分覆盖',()=>{
 const p=plan();p.people=p.people.slice(0,1);p.people[0].capacity=8;const r=row('t',20);r.components=[['prepare',3,'资料核实','基础数据表'],['research',12,'专题研究与分析','专题分析初稿'],['review',5,'成果复核','定稿报告']].map(([id,days,activity,output])=>({id,days,activity,output,roles:['调研'],personIds:['a'],basis:'该阶段专属估算依据',parameterKeys:['objectCount']}));
 A.apply(p,A.propose(p,response([r])));const t=p.tasks[0];assert.equal(total(t),20);assert.deepEqual(Object.values(t.monthlyPlan).map(x=>x.days),[8,8,4]);assert.match(t.monthlyPlan['2026-11'].activity,/资料核实/);assert.match(t.monthlyPlan['2027-01'].activity,/成果复核/);assert(!Object.values(t.monthlyPlan).some(x=>/分月规则建议/.test(x.basis)));const byPackage={};Object.values(t.monthlyPlan).flatMap(x=>x.workPackages).forEach(x=>byPackage[x.id]=(byPackage[x.id]||0)+x.days);assert.deepEqual(byPackage,{prepare:3,research:12,review:5});
});
test('截止不足保留需求待分配，不超0容量、不延后；依赖不可行不伪装已安排',()=>{
 const p=plan();p.people=p.people.slice(0,1);p.people[0].capacity=2;p.tasks[0].deadline='2026-11';A.apply(p,A.propose(p,response([row('t')])));assert.equal(p.tasks[0].end,'2026-11');assert.equal(total(p.tasks[0]),6);assert.equal(p.tasks[0].unassigned['2026-11'],4);assert.equal(p.tasks[0].allocations['2026-11'].a,2);
 const prev=task('prev',{locked:true,needsInitialStaffing:false,start:'2026-12',end:'2026-12'}),q=plan([prev,task('next',{dependsOn:['prev'],deadline:'2026-12'})]);A.apply(q,A.propose(q,response([row('next')])));const next=q.tasks[1];assert.equal(E.sum(Object.values(next.allocations).flatMap(Object.values)),0);assert.equal(total(next),6);assert.match(next.estimate.resourcePlan.blockedReason,/前置/);assert.match(next.monthlyPlan[next.start].activity,/待安排/);
});
test('手选成员为硬约束，模型越界拒绝；合法建议只在该集合安排',()=>{
 const p=plan([task('t',{participantSource:'manual',participantIds:['b'],owner:'乙姓名'})]),bad=response([row('t')]);assert.throws(()=>A.propose(p,bad),/集合外/);bad.tasks[0].components[0].personIds=['b'];A.apply(p,A.propose(p,bad));assert.deepEqual(p.tasks[0].participantIds,['b']);assert.equal(p.tasks[0].allocations[p.tasks[0].start].b,6);
});
test('共用活动只计一次，分摊必须守恒，重算参数按关联任务闭包且整组保护',()=>{
 const p=plan([task('one'),task('two')]),r=response([row('one',5),row('two',5)]);r.sharedActivities=[{id:'common',activity:'统一出发准备',output:'共用路线清单',days:2,low:1,high:3,basis:'同次外业准备只计一次',allocations:[{taskId:'one',days:1},{taskId:'two',days:1}]}];
 A.apply(p,A.propose(p,r));assert.equal(E.sum(p.tasks.map(total)),12);assert.equal(E.sum(p.tasks.map(t=>t.estimate.sharedTotal)),2);assert.deepEqual(new Set(A.affected(p,p.effortParameters,[{...p.effortParameters[0],value:4}])),new Set(['one','two']));assert.deepEqual(new Set(A.eligible(p,{mode:'system',taskIds:['one']}).taskIds),new Set(['one','two']));p.tasks[1].editSources={effort:'manual'};assert.deepEqual(A.eligible(p,{mode:'system',taskIds:['one']}).taskIds,[]);assert.throws(()=>A.request(p,['one']),/整组/);
 const q=plan([task('one'),task('two')]);r.sharedActivities[0].allocations[0].days=.75;assert.throws(()=>A.propose(q,r),/分摊合计/);
});
test('增量新任务不能重复收取已经预算的共用活动',()=>{
 const p=plan([task('one'),task('two')]),r=response([row('one',5),row('two',5)]);r.sharedActivities=[{id:'common',activity:'统一出发准备',output:'共用路线清单',days:2,low:2,high:2,basis:'一次准备',allocations:[{taskId:'one',days:1},{taskId:'two',days:1}]}];A.apply(p,A.propose(p,r));p.tasks.push(task('new'));
 const input=A.request(p,['new']);assert.equal(input.project.existingSharedActivities[0].days,2);const duplicate=row('new');duplicate.components[0].activity='统一出发准备';assert.throws(()=>A.propose(p,response([duplicate]),{taskIds:['new']}),/再次计费/);
});
test('未知必须pending并给缺失信息，不能造0；重新初算系统稿资料不足不清空原数据',()=>{
 const pending={taskId:'t',status:'pending',low:null,high:null,components:[],basis:'缺少任务边界与对象信息',assumptions:[],uncertainty:'高：无法判断',informationNeeded:['确认调查对象']},p=plan();A.apply(p,A.propose(p,response([pending])));assert.equal(E.total(p.tasks[0],E.months(p.start,p.end)),null);assert.equal(p.staffing.status,'partial');assert.equal(p.tasks[0].estimate.total,null);
 const q=plan();A.apply(q,A.propose(q,response([row('t')])));const before=JSON.stringify(q);assert.throws(()=>A.propose(q,response([pending]),{mode:'system'}),/原人天/);assert.equal(JSON.stringify(q),before);
});
test('输入和应用阶段均拒绝过期响应；格式失败和副本应用不改变原稿',()=>{
 const p=plan(),signature=A.fingerprint(p);p.people[0].capacity=9;assert.throws(()=>A.propose(p,response([row('t')]),{baseRevision:signature}),/已变化/);const proposal=A.propose(p,response([row('t')])),before=JSON.stringify(p),copy=A.applyCopy(p,proposal);assert.equal(JSON.stringify(p),before);assert.notEqual(copy.id,p.id);assert.equal(copy.basedOn,p.id);p.tasks[0].locked=true;const locked=JSON.stringify(p);assert.throws(()=>A.apply(p,proposal),/已变化/);assert.equal(JSON.stringify(p),locked);
 const q=plan(),bad=response([row('t')]);bad.tasks[0].components[0].days=.1;assert.throws(()=>A.propose(q,bad),/0.25/);assert.equal(total(q.tasks[0]),0);
});
test('白名单请求不发送姓名、员工全库、附件与旧估算；校准留标准需求与人工采用及原因',()=>{
 const p=plan();p.attachments=[{secret:'附件原文'}];p.registry={employees:[{name:'非本次员工'}]};const str=JSON.stringify(A.request(p,['t']));assert(!str.includes('甲姓名'));assert(!str.includes('附件原文'));assert(!str.includes('非本次员工'));
 A.apply(p,A.propose(p,response([row('t')])));p.tasks[0].unassigned[p.tasks[0].start]=1;A.calibrate(p,'t','对象资料比假设复杂，需要补核');assert.equal(p.tasks[0].estimate.total,6);assert.equal(p.tasks[0].estimate.calibration.adoptedTotal,7);assert.equal(p.tasks[0].estimate.calibration.reason,'对象资料比假设复杂，需要补核');assert.equal(p.tasks[0].estimate.calibration.history.length,1);
});
