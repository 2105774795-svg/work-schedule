const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../plan-engine.js'),B=require('../plan-builder.js'),D=require('../plan-editing.js'),F=require('../plan-staffing.js'),X=require('../plan-export.js');
function fixture(){
 const p=B.createProject(),r=B.registry();Object.assign(p,{name:'多人验收项目',description:'研究与策划',taskScale:'medium',start:'2026-11',end:'2027-01',startDate:'2026-11-01',endDate:'2027-01-31'});
 p.people=B.peopleForProject(r,r.employees.slice(0,4).map(x=>x.id));p.selectedEmployeeIds=p.people.map(x=>x.employeeId);
 p.tree.forEach(m=>B.toggle(p.tree,m.id,false));const m=p.tree[1],c=m.children[0];B.toggle(p.tree,c.children[0].id,true);B.generate(p);return p;
}
test('2、3、4位负责人用稳定ID保存，添加不改变6人天，导出显示全部姓名',async()=>{
 const p=fixture(),t=p.tasks[0],ids=p.people.map(x=>x.id);t.unassigned[p.start]=6;
 for(const count of [2,3,4]){D.participants(p,t.id,ids.slice(0,count));assert.equal(E.effort(p.tasks[0],p.start),6);assert.deepEqual(p.tasks[0].participantIds,ids.slice(0,count));}
 const copy=B.migrate(JSON.parse(JSON.stringify(p)),B.registry());assert.deepEqual(copy.tasks[0].participantIds,ids);
 const spec=X.buildSpec(copy,['月度任务明细']);assert.equal(spec[0].rows[0][6],p.people.map(x=>x.name).join('、'));assert.equal(spec[1].rows[0][7],spec[0].rows[0][6]);
 const Zip=require('../vendor/jszip.min.js');for(let mask=0;mask<16;mask++){const options=X.options.filter((_,i)=>mask&(1<<i)),zip=await Zip.loadAsync(await X.buffer(copy,options,Zip));const main=await zip.file('xl/worksheets/sheet1.xml').async('string');assert(main.includes(p.people.map(x=>x.name).join('、')));const wb=await zip.file('xl/workbook.xml').async('string');assert.equal((wb.match(/<sheet /g)||[]).length,1+options.length);if(options.includes('月度任务明细')){const n=X.buildSpec(copy,options).findIndex(s=>s.name==='月度任务明细')+1;assert((await zip.file('xl/worksheets/sheet'+n+'.xml').async('string')).includes(p.people.map(x=>x.name).join('、')));}}
});
test('3+2+1只计6人天和3人，修改成员列表不复制个人投入',()=>{
 const p=fixture(),id=p.tasks[0].id,ids=p.people.map(x=>x.id);D.participants(p,id,ids.slice(0,3));
 for(const [i,n]of [3,2,1].entries())D.allocation(p,id,p.start,ids[i],n);
 assert.equal(E.summaries(p)[0].days,6);assert.equal(E.summaries(p)[0].people,3);
 D.participants(p,id,ids);assert.equal(E.summaries(p)[0].days,6);assert.equal(E.summaries(p)[0].people,3);assert.equal(E.loads(p).find(r=>r.person.id===ids[3]).days,0);
});
test('重复人员、外项目人员和锁定修改原子拒绝',()=>{
 const p=fixture(),id=p.tasks[0].id,a=p.people[0].id,before=JSON.stringify(p);
 for(const ids of [[a,a],['外项目人员']])assert.throws(()=>D.participants(p,id,ids),/本项目|重复/);
 assert.equal(JSON.stringify(p),before);p.tasks[0].locked=true;assert.throws(()=>D.participants(p,id,[]),/锁定/);
});
test('替换或移除有投入人员须显式确认，转待分配后总量、0与缓存保留',()=>{
 const p=fixture(),id=p.tasks[0].id,[a,b,c]=p.people.map(x=>x.id);D.participants(p,id,[a,b]);D.allocation(p,id,p.start,a,3);D.allocation(p,id,p.start,b,0);
 const before=JSON.stringify(p);assert.throws(()=>D.participants(p,id,[c]),/确认/);assert.equal(JSON.stringify(p),before);
 D.participants(p,id,[c],true);assert.equal(E.effort(p.tasks[0],p.start),3);assert.equal(p.tasks[0].unassigned[p.start],3);assert.deepEqual(p.tasks[0].allocations,{});assert.deepEqual(p.taskCache[id],p.tasks[0]);
 D.participants(p,id,[],true);assert.equal(p.tasks[0].owner,'');assert.equal(E.effort(p.tasks[0],p.start),3);
});
test('旧单人及旧版多人姓名迁移不改原对象，取消勾选再恢复仍保留成员',()=>{
 const p=fixture(),t=p.tasks[0];t.owner=p.people[0].name;delete t.participantIds;const snapshot=JSON.stringify(p),copy=B.migrate(p,B.registry());assert.equal(JSON.stringify(p),snapshot);assert.deepEqual(copy.tasks[0].participantIds,[p.people[0].id]);
 D.participants(copy,t.id,copy.people.slice(0,3).map(x=>x.id));const ids=[...copy.tasks[0].participantIds];B.toggle(copy.tree,t.id,false);const other=B.flatten(copy.tree).find(r=>r.task.id!==t.id).task;B.toggle(copy.tree,other.id,true);B.generate(copy);B.toggle(copy.tree,t.id,true);B.generate(copy);assert.deepEqual(copy.tasks.find(x=>x.id===t.id).participantIds,ids);
 const legacy=E.referencePlan(require('../plan-reference.js'));legacy.tasks[0].owner=legacy.people.slice(0,2).map(x=>x.name).join('、');const upgraded=B.migrate(legacy,B.registry());assert.deepEqual(upgraded.tasks[0].participantIds,legacy.people.slice(0,2).map(x=>x.id));assert.equal(upgraded.tasks[0].legacyOwner,legacy.tasks[0].owner);
});
test('员工改名保持身份，移出项目后成员列表与投入同步且总量守恒',()=>{
 const p=fixture(),id=p.tasks[0].id,[a,b]=p.people.map(x=>x.id);D.participants(p,id,[a,b]);D.allocation(p,id,p.start,a,3);D.allocation(p,id,p.start,b,2);
 const renamed=structuredClone(p.people);renamed[0].name='新姓名';B.reconcilePeople(p,renamed);assert.equal(E.ownerLabel(p.tasks[0],p.people),'新姓名、'+p.people[1].name);
 assert.equal(B.reconcilePeople(p,p.people.filter(x=>x.id!==a)),3);assert.deepEqual(p.tasks[0].participantIds,[b]);assert.equal(E.effort(p.tasks[0],p.start),5);assert.equal(p.tasks[0].unassigned[p.start],3);E.validate(p);
});
test('初稿尊重手选成员，4人分工仍等于规则总量，不强加额外成员',()=>{
 const p=fixture(),id=p.tasks[0].id,ids=p.people.map(x=>x.id);D.participants(p,id,ids);F.initialize(p,[id]);assert.deepEqual(p.tasks[0].participantIds,ids);assert.equal(E.total(p.tasks[0],E.months(p.start,p.end)),p.tasks[0].estimate.total);
 const q=fixture();D.participants(q,q.tasks[0].id,[]);F.initialize(q,[q.tasks[0].id]);assert.equal(E.assigned(q.tasks[0],q.start),0);assert.equal(E.total(q.tasks[0],E.months(q.start,q.end)),q.tasks[0].estimate.total);assert.deepEqual(q.tasks[0].participantIds,[]);
});
