(function (root) {
  'use strict';
  const framework = root.WorkPlanFramework || (typeof require === 'function' && require('./plan-framework.js'));
  const statuses = ['未开始', '进行中', '已完成', '暂停'];
  const moduleDefinitions=plan=>Array.isArray(plan?.tree)?plan.tree:framework;
  const moduleName=(plan,id)=>moduleDefinitions(plan).find(g=>g.id===id)?.name||'未分类';
  const uid = () => root.crypto?.randomUUID?.() || 'plan-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const monthNumber = value => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || '')) throw Error('月份请使用 YYYY-MM 格式');
    return Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
  };
  const monthLabel = value => `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, '0')}`;
  function months(start, end) {
    const first = monthNumber(start), last = monthNumber(end);
    if (last < first || last - first > 59) throw Error('计划结束月份不能早于开始月份，且最多支持 60 个月');
    return Array.from({length: last - first + 1}, (_, i) => monthLabel(first + i));
  }
  const days = value => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100000 || Math.abs(n * 4 - Math.round(n * 4)) > 1e-8) throw Error('人天须为非负数，按 0.25 天填写');
    return n;
  };
  const sum = values => Math.round(values.reduce((a, b) => a + Number(b || 0), 0) * 100) / 100;
  function assigned(task, month) {return sum(Object.values(task.allocations?.[month] || {}));}
  function effort(task, month) {
    const a = task.allocations?.[month], u = task.unassigned?.[month];
    return a || u !== undefined ? sum([assigned(task, month), u || 0]) : null;
  }
  function total(task, list) {const values = list.map(m => effort(task, m)).filter(v => v !== null); return values.length ? sum(values) : null;}
  function setTotal(task, month, value) {
    task.unassigned ||= {};
    if (value === '') {if (assigned(task, month)) throw Error('此月已有人员投入，请在任务详情中修改'); delete task.unassigned[month]; delete task.allocations?.[month]; return;}
    const n = days(value), a = assigned(task, month);
    if (n < a) throw Error(`已分配 ${a} 人天，总量不能低于已分配投入；请打开任务详情调整`);
    task.unassigned[month] = Math.round((n - a) * 100) / 100;
  }
  function parsePeople(text) {
    const seen = new Set();
    return text.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      const [name = '', group = '', role = '', capacity = ''] = line.split(/[|｜]/).map(s => s.trim());
      if (!name || seen.has(name)) throw Error('人员姓名不能为空或重复：' + name);
      seen.add(name);
      return {id: uid(), name, group: group || '项目组', role, capacity: capacity === '' ? null : days(capacity)};
    });
  }
  function newTask(values = {}) {
    return {id: uid(), module: 'X', category: '补充工作', work: '', output: '', owner: '', partner: '', status: '未开始', difficulty: '', notes: '', start: '', end: '', dependsOn: [], allocations: {}, unassigned: {}, ...values};
  }
  // participantIds是共同负责人的唯一身份；owner仅保留首位姓名以兼容旧数据。
  function participantIds(task, people) {
    if (Array.isArray(task.participantIds)) return [...task.participantIds];
    const names = String(task.owner || '').split(/[、，,]/).map(s => s.trim());
    return people.filter(p => names.includes(p.name)).map(p => p.id);
  }
  function setParticipants(task, ids, people) {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !people.some(p => p.id === id))) throw Error('负责人只能选择本项目人员，且不能重复');
    task.participantIds = [...ids];
    task.owner = people.find(p => p.id === ids[0])?.name || '';
  }
  const ownerLabel = (task, people) => participantIds(task, people).map(id => people.find(p => p.id === id)?.name).filter(Boolean).join('、');
  function generate(plan) {
    const list = months(plan.start, plan.end), tasks = [];
    const subprojects = (plan.subprojects || '').split(/[\n；;]/).map(s => s.trim()).filter(Boolean);
    for (const g of framework.filter(g => plan.modules.includes(g.id))) {
      const start = list[Math.min(list.length - 1, Math.floor((list.length - 1) * g.from))];
      const end = list[Math.min(list.length - 1, Math.ceil((list.length - 1) * g.to))];
      const member = plan.people.map(p => ({p, score: g.skills.filter(s => s && (p.role + p.group).includes(s)).length})).sort((a, b) => b.score - a.score)[0];
      for (const cat of g.categories) for (const seed of cat.tasks) {
        const children = subprojects.length && ['C01', 'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'I03', 'I04', 'I05', 'I06', 'I07'].includes(cat.id) ? subprojects : [''];
        for (const child of children) tasks.push(newTask({module: g.id, category: cat.name, work: (child ? child + '：' : '') + seed.work, output: (child ? child + '：' : '') + seed.output, owner: member?.score ? member.p.name : '', start, end, notes: '模板建议，排期及分工待项目负责人确认'}));
      }
    }
    return tasks;
  }
  function referencePlan(ref) {
    const role = {'项目负责人':'项目统筹与融资协调','研究成员':'市场调研与运营研究','保障成员':'融资政策与材料保障'};
    const p = {id: uid(), name:'示例产业园咨询计划', description:'演示项目的工作计划，用于体验任务选择、月度安排和人员投入。', scope:'总体研究、规划定位、融资及运营相关咨询服务', deliverables:'形成研究报告、工作方案和任务清单', milestones:'按示例月份分阶段交付。', subprojects:'', start:'2026-10', end:'2027-10', asOf:'2026-10', ownLabel:'项目负责人', partnerLabel:'客户配合人', modules:framework.filter(g => g.id !== 'X' && g.id !== 'Z' && g.id !== 'A').map(g => g.id), people:Object.entries(role).map(([name, role], i) => ({id:uid(),name,role,group:['项目实施小组','AI及调研小组','后台保障小组'][i],capacity:20})), tasks:[], options:[], createdAt:new Date().toISOString(), source:ref.source||'公开演示任务'};
    p.tasks = ref.tasks.map(t => {
      const aliases = {'市场调研':'市场研究','方向明确':'方向明确（项目汇报）','投产测算':'投资测算','放款材料准备':'放款材料提交（四证一书）','融资资金落地':'首笔融资放款','政策性资金争取':'政策资金争取','洽商方案设计':'洽谈方案设计','一轮运营洽商':'一轮运营洽商（意愿）','二轮运营洽商':'二轮运营洽商（技术）','三轮运营洽商':'三轮运营洽商（案例）','四轮运营洽商':'四轮运营洽商（商务）'};
      let g = framework.find(g => g.name === t.module);
      if (['决策程序履行','融资材料编制','融资过会支持'].includes(t.category)) g = framework.find(g => g.id === 'G');
      if (g.id === 'F' && /^[一二三四五]轮金融征集$/.test(t.category)) {
        const cat = g.categories.find(c => c.name.startsWith(t.category));
        aliases[t.category] = cat.name;
      }
      const match = t.period.match(/(\d{4})(\d{2})-(\d{4})(\d{2})/);
      return newTask({module:g.id, category:aliases[t.category] || t.category, work:t.work, output:t.output, owner:t.owner, partner:t.partner, status:t.status, difficulty:t.difficulty, notes:t.notes, start:match?`${match[1]}-${match[2]}`:p.start,end:match?`${match[3]}-${match[4]}`:p.end,originalSeq:Number(t.seq), originalModule:t.module});
    });
    return p;
  }
  function validate(plan) {
    if (!plan || typeof plan.id !== 'string' || !plan.name?.trim()) throw Error('请填写项目名称');
    const list = months(plan.start, plan.end); monthNumber(plan.asOf);
    if(plan.standardDays!==undefined&&(!Number.isFinite(plan.standardDays)||plan.standardDays<=0||plan.standardDays>31))throw Error('月标准工日须大于0且不超过31');
    if (!Array.isArray(plan.tasks) || !Array.isArray(plan.people) || !Array.isArray(plan.modules)) throw Error('计划数据格式不正确');
    if (plan.tasks.length > 1500 || plan.people.length > 100) throw Error('单份计划最多支持 1500 项任务、100 位人员');
    if(plan.options!==undefined&&!Array.isArray(plan.options))throw Error('工作表选项格式不正确');
    const validId=id=>typeof id==='string'&&id.length>0&&id.length<150&&!['__proto__','constructor','prototype'].includes(id);
    const people = new Set(), names = new Set(), ids = new Set();
    plan.people.forEach(p => {
      if (!validId(p.id) || people.has(p.id) || typeof p.name!=='string' || !p.name.trim() || names.has(p.name) || typeof p.group!=='string' || typeof p.role!=='string') throw Error('人员姓名、分组、分工或标识不正确');
      people.add(p.id); names.add(p.name);
      if (p.capacity !== null) days(p.capacity);
      if(p.capacities!==undefined){if(!p.capacities||typeof p.capacities!=='object'||Array.isArray(p.capacities))throw Error('月度可用人天格式不正确');for(const [m,v] of Object.entries(p.capacities)){monthNumber(m);if(v!==null)days(v);}}
    });
    plan.tasks.forEach(t => {
      if (!validId(t.id) || ids.has(t.id) || typeof t.work!=='string' || !t.work.trim() || !moduleDefinitions(plan).some(g => g.id === t.module) || !statuses.includes(t.status)) throw Error('任务名称、模块、状态或任务标识不正确');
      if(plan.schemaVersion===2&&t.owner&&!plan.people.some(p=>p.name===t.owner))throw Error('任务负责人必须属于本次项目参与人员');
      if(t.participantIds!==undefined){
        if(!Array.isArray(t.participantIds)||new Set(t.participantIds).size!==t.participantIds.length||t.participantIds.some(id=>!people.has(id)))throw Error('负责人只能选择本项目人员，且不能重复');
        if(t.owner!==(plan.people.find(p=>p.id===t.participantIds[0])?.name||''))throw Error('负责人姓名与成员标识不一致');
      }
      if(['category','output','owner','partner','difficulty','notes'].some(k=>typeof t[k]!=='string'))throw Error('任务文本字段格式不正确');
      if(t.dependsOn!==undefined&&!Array.isArray(t.dependsOn))throw Error('前置任务格式不正确');
      for(const map of [t.allocations,t.unassigned])if(!map||typeof map!=='object'||Array.isArray(map))throw Error('任务投入格式不正确');
      ids.add(t.id);
      if (monthNumber(t.start) > monthNumber(t.end)) throw Error('任务结束时间不能早于开始时间：' + t.work);
      for (const [m, allocation] of Object.entries(t.allocations || {})) {
        monthNumber(m);
        if(!allocation||typeof allocation!=='object'||Array.isArray(allocation))throw Error('人员投入格式不正确');
        for (const [id, value] of Object.entries(allocation)) {if (!people.has(id)) throw Error('任务引用了不存在的人员'); days(value);}
      }
      for (const [m, value] of Object.entries(t.unassigned || {})) {monthNumber(m); days(value);}
      if(t.monthNotes!==undefined){if(!t.monthNotes||typeof t.monthNotes!=='object'||Array.isArray(t.monthNotes))throw Error('当月安排格式不正确');for(const [m,note]of Object.entries(t.monthNotes)){monthNumber(m);if(typeof note!=='string'||note.length>3000)throw Error('当月安排须为不超过3000字的文字');}}
      if(t.durationMonths!==undefined&&(!Number.isInteger(t.durationMonths)||t.durationMonths<1||t.durationMonths>60))throw Error('持续月数须为1至60的整数');
      if(t.deadline){
        if(typeof t.deadline!=='string'||!/^\d{4}-\d{2}(?:-\d{2})?$/.test(t.deadline))throw Error('最迟完成时间格式不正确');monthNumber(t.deadline.slice(0,7));
        if(t.deadline.length===10&&(Number.isNaN(Date.parse(t.deadline))||new Date(t.deadline).toISOString().slice(0,10)!==t.deadline))throw Error('最迟完成日期无效');
      }
      if(t.monthlyPlan!==undefined){
        if(!t.monthlyPlan||typeof t.monthlyPlan!=='object'||Array.isArray(t.monthlyPlan))throw Error('月度活动与成果格式不正确');
        for(const [m,row]of Object.entries(t.monthlyPlan)){monthNumber(m);if(!row||typeof row!=='object'||Array.isArray(row))throw Error('月度安排须为对象');
          for(const key of ['activity','output'])if(typeof row[key]!=='string'||row[key].length>3000)throw Error('月度活动与成果须为不超过3000字的文字');
          if(row.days!==undefined&&row.days!==null)days(row.days);
        }
      }
    });
    const visiting = new Set(), done = new Set(), byId = new Map(plan.tasks.map(t => [t.id,t]));
    function visit(t) {
      if (visiting.has(t.id)) throw Error('前置任务存在循环依赖');
      if (done.has(t.id)) return;
      visiting.add(t.id);
      for (const id of t.dependsOn || []) {if (!byId.has(id)) throw Error('前置任务已不存在'); visit(byId.get(id));}
      visiting.delete(t.id);done.add(t.id);
    }
    plan.tasks.forEach(visit);
    return list;
  }
  function diagnostics(plan) {
    const list = validate(plan), issues = [];
    for (const t of plan.tasks) {
      if(t.omittedDependencies?.length)issues.push({task:t.id,text:'前置工作未纳入本次计划，请核对条件：'+t.omittedDependencies.join('、')});
      if (!t.owner) issues.push({task:t.id, text:'未明确负责人：' + t.work});
      if(t.deadline&&t.end>t.deadline.slice(0,7))issues.push({task:t.id,text:'排期超过最迟完成月份 '+t.deadline.slice(0,7)+'：'+t.work});
      for(const warning of t.scheduleMeta?.warnings||[])issues.push({task:t.id,text:warning+'：'+t.work});
      if(t.start!==t.end)for(const m of months(t.start,t.end))if((effort(t,m)||0)>0&&(!t.monthlyPlan?.[m]?.activity||!t.monthlyPlan?.[m]?.output))issues.push({task:t.id,text:m+' 跨月活动或阶段成果待明确：'+t.work});
      if (t.status !== '已完成' && total(t,list) === null) issues.push({task:t.id,text:'人天待估算：' + t.work});
      if (t.status !== '已完成' && t.end < plan.asOf) issues.push({task:t.id,text:'已过原计划时间，需确认新排期：' + t.work});
      for (const m of new Set([...Object.keys(t.allocations || {}),...Object.keys(t.unassigned || {})])) {
        if ((effort(t,m) || 0) > 0 && (m < t.start || m > t.end || !list.includes(m))) issues.push({task:t.id,text:`${m} 投入超出任务或月历范围：${t.work}`});
        if ((effort(t,m) || 0) > 0 && t.status === '已完成' && m > plan.asOf) issues.push({task:t.id,text:'已完成任务仍有未来投入：' + t.work});
      }
      for (const id of t.dependsOn || []) {const prev=plan.tasks.find(x=>x.id===id); if(prev && prev.end > t.start) issues.push({task:t.id,text:'前置任务排期冲突：' + t.work});}
    }
    for (const row of loads(plan)) if (row.capacity !== null && row.days > row.capacity) issues.push({text:`${row.month} ${row.person.name} 安排 ${row.days} 人天，可用 ${row.capacity} 人天`});
    return issues;
  }
  function loads(plan) {
    return months(plan.start,plan.end).flatMap(month => plan.people.map(person => ({
      month,person,days:sum(plan.tasks.map(t => t.allocations?.[month]?.[person.id] || 0)),
      tasks:plan.tasks.filter(t => (t.allocations?.[month]?.[person.id] || 0) > 0).length,
      capacity:Object.hasOwn(person.capacities||{},month)?person.capacities[month]:(person.capacity??((plan.effortCapacityDefault===true||plan.preStartMode)?(plan.standardDays??20):null)),
      assumed:!Object.hasOwn(person.capacities||{},month)&&person.capacity===null&&(plan.effortCapacityDefault===true||!!plan.preStartMode)
    })));
  }
  function summaries(plan){
    const load=loads(plan),standard=plan.standardDays??20,groups=[...new Set(plan.people.map(p=>p.group))];
    return months(plan.start,plan.end).map(month=>{
      const byGroup=groups.map(group=>{
        const rows=load.filter(r=>r.month===month&&r.person.group===group),days=sum(rows.map(r=>r.days)),needed=Math.ceil(days/standard);
        return {group,people:rows.filter(r=>r.days>0).length,days,needed,headcount:rows.length,gap:Math.max(0,needed-rows.length),capacity:rows.some(r=>r.capacity===null)?null:sum(rows.map(r=>r.capacity))};
      });
      const active=plan.tasks.filter(t=>(t.start<=month&&t.end>=month&&t.status!=='已完成')||effort(t,month)!==null),unknown=active.filter(t=>effort(t,month)===null).length;
      const unassigned=sum(plan.tasks.map(t=>t.unassigned?.[month]||0)),overloaded=load.some(r=>r.month===month&&r.capacity!==null&&r.days>r.capacity),unknownCapacity=load.some(r=>r.month===month&&r.capacity===null);
      return {month,groups:byGroup,people:load.filter(r=>r.month===month&&r.days>0).length,needed:sum(byGroup.map(r=>r.needed)),days:sum(plan.tasks.map(t=>effort(t,month)||0)),headcount:plan.people.length,gap:sum(byGroup.map(r=>r.gap)),tasks:active.length,modules:[...new Set(active.map(t=>moduleName(plan,t.module)))].join('、'),unassigned,unknown,
        note:[overloaded?'存在人员超负荷':'',unknownCapacity?'个人可用人天待确认':'',load.some(r=>r.month===month&&r.assumed)?'部分容量按标准工日默认测算':'',unassigned?`含 ${unassigned} 待分配人天`:'',unknown?`${unknown} 项人天待估算`:''].filter(Boolean).join('；')||'按已填投入汇总'};
    });
  }
  const api={framework,moduleDefinitions,moduleName,statuses,uid,monthNumber,monthLabel,months,days,sum,effort,assigned,total,setTotal,parsePeople,newTask,participantIds,setParticipants,ownerLabel,generate,referencePlan,validate,diagnostics,loads,summaries};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.WorkPlanEngine=api;
})(typeof window !== 'undefined' ? window : globalThis);
