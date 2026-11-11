const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../plan-engine.js'),S=require('../plan-scheduling.js');
function task(id='short',extra={}){return E.newTask({id,module:'B',category:'项目研究',work:'地块现场踏勘',output:'《踏勘报告》',owner:'甲',participantIds:['a'],start:'2026-11',end:'2027-01',allocations:{'2026-11':{a:2},'2026-12':{a:2},'2027-01':{a:2}},...extra});}
function fixture(tasks=[task()]){return {id:'schedule-case',name:'旧稿排期测试',schemaVersion:2,start:'2026-11',end:'2027-02',startDate:'2026-11-01',endDate:'2027-02-28',asOf:'2026-11',modules:['B'],people:[{id:'a',name:'甲',role:'调研',group:'实施',capacity:10},{id:'b',name:'乙',role:'策划',group:'实施',capacity:10},{id:'c',name:'丙',role:'财务',group:'后台',capacity:10}],tasks,taskCache:{},options:[]};}
const total=t=>E.sum([...Object.values(t.unassigned),...Object.values(t.allocations).flatMap(Object.values)]);
test('短踏勘旧跨度压到单月，在副本应用且原稿、任务身份和人天不变',()=>{
 const p=fixture();S.markSystem(p.tasks[0]);const before=JSON.stringify(p),proposal=S.propose(p);assert.equal(JSON.stringify(p),before);assert.equal(proposal.changes.length,1);
 const next=S.applyCopy(p,proposal);assert.notEqual(next.id,p.id);assert.equal(next.basedOn,p.id);assert.equal(next.tasks[0].id,'short');assert.equal(next.tasks[0].start,'2026-11');assert.equal(next.tasks[0].end,'2026-11');assert.equal(total(next.tasks[0]),6);assert.equal(JSON.stringify(p),before);assert.deepEqual(next.taskCache.short,next.tasks[0]);assert.equal(next.tasks[0].monthlyPlan['2026-11'].output,'《踏勘报告》');
});
test('短任务优先找可整体容纳月份，找不到也不拆成3个月且明确超负荷',()=>{
 const locked=task('busy',{locked:true,start:'2026-11',end:'2026-11',allocations:{'2026-11':{a:8}}}),p=fixture([locked,task()]);S.markSystem(p.tasks[1]);
 const change=S.propose(p).changes[0];assert.equal(change.after.start,'2026-12');assert.equal(change.after.end,'2026-12');assert.equal(total(change.after),6);
 const q=fixture();q.people[0].capacity=2;S.markSystem(q.tasks[0]);const result=S.propose(q);assert.equal(result.changes[0].after.start,result.changes[0].after.end);assert.equal(total(result.changes[0].after),6);assert(result.changes[0].warnings.some(w=>/容量不足|超负荷/.test(w)));
});
test('真正跨月逐月有活动成果投入，逐人总量与待分配守恒',()=>{
 const p=fixture([task('long',{work:'投融资专题研究',allocations:{'2026-11':{a:25,b:5}},unassigned:{'2026-11':2}})]);S.markSystem(p.tasks[0]);
 const after=S.propose(p).changes[0].after;assert(after.start<after.end);assert.equal(total(after),32);assert.equal(E.sum(Object.values(after.allocations).map(a=>a.a||0)),25);assert.equal(E.sum(Object.values(after.allocations).map(a=>a.b||0)),5);assert.equal(E.sum(Object.values(after.unassigned)),2);
 for(const [m,row]of Object.entries(after.monthlyPlan)){assert(row.activity);assert(row.output);assert.equal(row.days,E.effort(after,m));assert(row.days>0||/等待/.test(row.activity));}assert(new Set(Object.values(after.monthlyPlan).map(r=>r.output)).size>1);
});
test('三人各0.25按明确3月持续，不把余数堆回首月',()=>{
 const p=fixture([task('tiny',{work:'分期方案核实',durationMonths:3,participantIds:['a','b','c'],allocations:{'2026-11':{a:.25,b:.25,c:.25}}})]);S.markSystem(p.tasks[0]);
 const after=S.propose(p).changes[0].after;assert.equal(after.start,'2026-11');assert.equal(after.end,'2027-01');assert.equal(total(after),.75);assert.deepEqual(Object.values(after.monthlyPlan).map(r=>r.days),[.25,.25,.25]);
});
test('截止月份限制安排；依赖按前置完成后的下一月，容量不足不静默延期',()=>{
 const first=task('first'),second=task('second',{work:'方案汇总',dependsOn:['first'],deadline:'2026-12-20',allocations:{'2026-11':{a:4}}}),p=fixture([first,second]);p.tasks.forEach(t=>S.markSystem(t));
 const proposal=S.propose(p),a=proposal.changes.find(c=>c.taskId==='first').after,b=proposal.changes.find(c=>c.taskId==='second').after;assert.equal(a.end,'2026-11');assert.equal(b.start,'2026-12');assert.equal(b.end,'2026-12');assert(b.scheduleMeta.warnings.some(w=>/具体日内/.test(w)));
 const q=fixture([task('deadline',{work:'专题研究',deadline:'2026-11',allocations:{'2026-11':{a:30}}})]);q.people[0].capacity=5;S.markSystem(q.tasks[0]);const result=S.propose(q).changes[0];assert.equal(result.after.end,'2026-11');assert.equal(total(result.after),30);assert(result.warnings.some(w=>/期限内|超负荷/.test(w)));
});
test('未知来源默认保护，可显式允许重排；未知0、人工、锁定及完成始终保护',()=>{
 const p=fixture();assert.equal(S.propose(p).changes.length,0);assert.match(S.propose(p).protected[0].reason,/来源未知/);assert.equal(S.propose(p,{includeUnknown:true}).changes.length,1);
 const protectedTasks=[task('zero',{allocations:{'2026-11':{a:0}},unassigned:{'2026-12':0}}),task('manual',{editSources:{effort:'manual'}}),task('locked',{locked:true}),task('done',{status:'已完成'}),task('changed')];S.markSystem(protectedTasks[4]);protectedTasks[4].allocations['2026-11'].a=3;
 const q=fixture(protectedTasks),proposal=S.propose(q,{includeUnknown:true});assert.equal(proposal.changes.length,0);assert.equal(proposal.protected.length,5);
});
test('旧短任务完全未估算时只修日期和活动，保留null而不造0或新需求',()=>{
 const p=fixture([task('blank',{allocations:{},unassigned:{}})]);assert.equal(S.propose(p).changes.length,0);const proposal=S.propose(p,{includeUnknown:true}),after=proposal.changes[0].after;
 assert.equal(after.start,after.end);assert.deepEqual(after.allocations,{});assert.deepEqual(after.unassigned,{});assert.equal(E.effort(after,after.start),null);assert.equal(after.monthlyPlan[after.start].days,null);assert(proposal.changes[0].warnings.some(w=>/待估算/.test(w)));E.validate(S.applyCopy(p,proposal));
});
test('约束更新允许系统重排；新约束或容量变化会拒绝过期提案',()=>{
 const p=fixture();S.markSystem(p.tasks[0]);p.tasks[0].deadline='2026-12';p.tasks[0].durationMonths=2;const proposal=S.propose(p);assert.equal(proposal.changes.length,1);assert.equal(proposal.changes[0].after.end,'2026-12');
 const before=JSON.stringify(p);p.people[0].capacity=5;assert.throws(()=>S.applyCopy(p,proposal),/已变化/);p.people[0].capacity=10;assert.equal(JSON.stringify(p),before);p.tasks[0].work='新任务内容';assert.throws(()=>S.applyCopy(p,proposal),/已变化/);
});
test('部分选择造成依赖冲突时拒绝，缩短期间不能遗失保护投入',()=>{
 const first=task('first'),second=task('second',{dependsOn:['first'],start:'2026-11',end:'2026-11',allocations:{'2026-11':{a:1}}}),p=fixture([first,second]);p.tasks.forEach(t=>S.markSystem(t));const proposal=S.propose(p);
 assert.throws(()=>S.applyCopy(p,proposal,['first']),/前置任务冲突/);assert.doesNotThrow(()=>S.applyCopy(p,proposal));
 const q=fixture([task('move'),task('protected',{locked:true,start:'2027-01',end:'2027-01',allocations:{'2027-01':{a:1}}})]);S.markSystem(q.tasks[0]);const short=S.propose(q,{end:'2026-12'}),before=JSON.stringify(q);assert.throws(()=>S.applyCopy(q,short),/仍有投入/);assert.equal(JSON.stringify(q),before);
});
test('部分选择重新计算真实负荷，不复用全选时释放的容量',()=>{
 const p=fixture([task('first',{allocations:{'2026-11':{a:8}}}),task('second',{allocations:{'2026-11':{a:8}}})]);p.tasks.forEach(t=>S.markSystem(t));const proposal=S.propose(p);const next=S.applyCopy(p,proposal,['first']);assert(next.scheduleReview.warnings.some(w=>/安排16人天/.test(w)));assert.equal(next.tasks[1].allocations['2026-11'].a,8);
});
test('initial initialize仅应用指定系统任务，estimate接收排期警告与缓存同步',()=>{
 const p=fixture([task('system',{estimate:{method:'规则初估',warnings:[]}}),task('unknown')]);p.people[0].capacity=1;S.markSystem(p.tasks[0]);const untouched=JSON.stringify(p.tasks[1]);S.initialize(p,['system']);assert.equal(p.tasks[0].start,p.tasks[0].end);assert(p.tasks[0].estimate.warnings.length);assert.equal(JSON.stringify(p.tasks[1]),untouched);assert.deepEqual(p.taskCache.system,p.tasks[0]);
});
