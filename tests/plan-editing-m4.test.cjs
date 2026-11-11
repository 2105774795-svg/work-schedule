const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../plan-engine.js'),B=require('../plan-builder.js'),D=require('../plan-editing.js'),X=require('../plan-export.js');
function fixture(){const p=B.createProject(),r=B.registry();Object.assign(p,{name:'排期保护测试',description:'调研与策划',taskScale:'small',start:'2026-11',end:'2027-01',asOf:'2026-11',startDate:'2026-11-01',endDate:'2027-01-31'});p.people=B.peopleForProject(r,[r.employees[0].id]);p.selectedEmployeeIds=p.people.map(x=>x.employeeId);p.tree.forEach(m=>B.toggle(p.tree,m.id,false));B.toggle(p.tree,p.tree[1].children[0].children[0].id,true);B.generate(p);const t=p.tasks[0];t.allocations={'2026-11':{[p.people[0].id]:3}};t.monthlyPlan={'2026-11':{activity:'原活动',output:'原阶段成果',days:3}};return p;}
test('人工0留下保护来源，最迟月份作为约束保留；非法期限原子回滚',()=>{
 const p=fixture(),id=p.tasks[0].id;D.total(p,id,'2026-11',3);assert.equal(p.tasks[0].editSources.effort,'manual');D.update(p,id,'deadline','2026-12');assert.equal(p.tasks[0].editSources.constraints,'manual');
 const snapshot=JSON.stringify(p);assert.throws(()=>D.update(p,id,'deadline','2026-02-30'));assert.equal(JSON.stringify(p),snapshot);
 D.allocation(p,id,'2026-11',p.people[0].id,'0');assert.equal(p.tasks[0].allocations['2026-11'][p.people[0].id],0);assert.equal(p.tasks[0].monthlyPlan['2026-11'].days,0);
});
test('活动与阶段成果独立编辑，同步月度明细导出，日期人天保持',()=>{
 const p=fixture(),id=p.tasks[0].id;D.monthPlanField(p,id,'2026-11','activity','核实分项资料');D.monthPlanField(p,id,'2026-11','output','《阶段核对表》');
 const t=p.tasks[0];assert.equal(t.editSources.monthNotes,'manual');assert.equal(t.monthlyPlan['2026-11'].activity,'核实分项资料');assert.equal(E.effort(t,'2026-11'),3);
 const row=X.buildSpec(p,['月度任务明细'])[1].rows[0];assert.match(row[11],/核实分项资料/);assert.match(row[11],/阶段核对表/);assert.deepEqual(p.taskCache[id],t);
});
test('锁定任务不接受月度活动编辑；超过最迟月份有诊断',()=>{
 const p=fixture(),id=p.tasks[0].id;p.tasks[0].locked=true;const snapshot=JSON.stringify(p);assert.throws(()=>D.monthPlanField(p,id,'2026-11','activity','不能覆盖'),/锁定/);assert.equal(JSON.stringify(p),snapshot);
 p.tasks[0].locked=false;D.update(p,id,'deadline','2026-10');assert(E.diagnostics(p).some(x=>x.text.includes('最迟完成')));
});
