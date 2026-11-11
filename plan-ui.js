(function () {
  'use strict';
  const E=WorkPlanEngine,B=WorkPlanBuilder,X=WorkPlanExport,KEY='work-schedule-plans-v2',STAFF_KEY='work-schedule-plan-staff-v1';
  const D=WorkPlanEditing,P=WorkPlanPreviews,A=WorkPlanAdaptation,AI=WorkPlanAIEffort,AIUI=WorkPlanAIEffortUI;
  const adaptationJobs=new Set(),adaptationNotices=new Map();
  const editHistory=new Map();let feedback='修改将在离开单元格后校验并自动保存';
  let monthFilter='all',detailView=null;
  let store=B.registry(),plans=[],selected='',step='basic',activeModule='module-B',expanded=new Set(['direction-1']),search='',employeeSearch='',filter='all',query='',statusFilter='all',error='',undo=null,dragged='';
  try{const data=JSON.parse(localStorage.getItem(STAFF_KEY)||'null');if(data){store=B.validateRegistry(data);}}catch{error='员工库读取失败，已加载预设名单，可导入备份恢复。';}
  try{const data=JSON.parse(localStorage.getItem(KEY)||'null');if(data){if(data.version!==2||!Array.isArray(data.plans))throw Error();plans=data.plans.map(p=>B.migrate(p,store));selected=plans.some(p=>p.id===data.activeId)?data.activeId:plans[0]?.id||'';}else{const legacy=JSON.parse(localStorage.getItem('work-schedule-plans-v1')||'[]');if(Array.isArray(legacy)){plans=legacy.map(p=>B.migrate(p,store));selected=plans[0]?.id||'';}}}catch{try{const raw=localStorage.getItem(KEY);if(raw&&!localStorage.getItem(KEY+'-recovery'))localStorage.setItem(KEY+'-recovery',raw);}catch{}error='旧计划读取失败，原数据已保留，可导入备份或新建。';}
  if(!plans.length){const p=B.createProject();plans.push(p);selected=p.id;}
  const current=()=>plans.find(p=>p.id===selected);
  const btn=(text,action,secondary=true)=>`<button type="button" class="button ${secondary?'secondary':''}" data-plan-action="${action}">${text}</button>`;
  const textField=(label,name,value='',type='text',required=false)=>`<label class="form-field">${label}${required?' <em class="wp-required">*</em>':''}<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${name==='ownLabel'?'默认：项目负责人':name==='partnerLabel'?'默认：客户配合人':''}" ${required?'required':''} maxlength="300"></label>`;
  const area=(label,name,value='',placeholder='',required=false)=>`<label class="form-field">${label}${required?' <em class="wp-required">*</em>':''}<textarea name="${name}" maxlength="20000" placeholder="${esc(placeholder)}" ${required?'required':''}>${esc(value)}</textarea></label>`;
  function save(message){try{localStorage.setItem(STAFF_KEY,JSON.stringify(store));localStorage.setItem(KEY,JSON.stringify({version:2,activeId:selected,plans}));feedback='已保存到本浏览器 · '+new Date().toLocaleTimeString('zh-CN');if(message)toast(message);return true;}catch{feedback='本地保存失败，修改仍在页面中，请重试保存或备份';toast(feedback);return false;}}
  function edit(operation,p=current()){
    const before=B.clone(p);operation(p);
    const keys=Object.keys(p).filter(k=>JSON.stringify(p[k])!==JSON.stringify(before[k]));
    const history=editHistory.get(p.id)||[];history.push({before,after:B.clone(p),keys});if(history.length>10)history.shift();editHistory.set(p.id,history);save();
  }
  function pendingEditor(){return document.querySelector('.wp-invalid,.wp-inline-dirty');}
  function checkPending(){
    const bad=pendingEditor();if(bad){bad.focus();throw Error('请先确认或取消正在编辑的单元格，尚未保存的内容不会用于导出');}
    
    if(!save())throw Error('保存失败，请先重试保存或备份后再导出');
  }
  function editStatus(){return `<div class="wp-edit-status"><span role="status">${esc(feedback)}</span>${btn('重试保存','retry-save')}${btn('撤销上次编辑','undo-edit')}</div>`;}
  function redraw(){const scrolls=[...document.querySelectorAll('.plan-calendar-scroll,.wp-tree-body,.wp-module-list')].map(el=>[el.className,el.scrollLeft,el.scrollTop]);render();document.querySelectorAll('[data-node-check]').forEach(el=>el.indeterminate=el.dataset.mixed==='true');scrolls.forEach(([name,x,y])=>{const el=document.getElementsByClassName(name)[0];if(el){el.scrollLeft=x;el.scrollTop=y;}});if(detailView&&detailView.projectId!==current().id)detailView=null;if(detailView){const section=[...document.querySelectorAll('[data-preview-name]')].find(el=>el.dataset.previewName===detailView.name);if(section)section.querySelector('.wp-distribution-host').innerHTML=P.distribution(current(),detailView.month,detailView.person,detailView.group);}}
  function check(node){const s=B.state(node);return `<input type="checkbox" data-node-check="${esc(node.id)}" data-mixed="${s.mixed}" ${s.checked?'checked':''} ${s.mixed?'aria-checked="mixed"':''} ${!s.total?'disabled':''} aria-label="选择${esc(node.name||node.work)}">`;}
  function header(p){
    const titles={basic:['先认识一下这个项目','填好项目，选好伙伴，下一步再选择具体工作。'],tree:['这次项目，要做哪些工作？','先选大类，再展开方向和具体任务。只把勾选的工作放进月历。'],review:['确认安排，形成原计划月历','建议排期与分工可继续修改，并可导出 Excel 月历。'],export:['选择需要附带的工作表','原计划月历固定导出，其他四张表按需勾选。']};
    return `<div class="wp-heading"><div><h1>${titles[step][0]}</h1><p>${titles[step][1]}</p></div><details class="wp-plan-menu"><summary>我的计划 ${icon('folder')}</summary><div><label>切换计划<select id="plan-select">${plans.map(x=>`<option value="${esc(x.id)}" ${x.id===p.id?'selected':''}>${esc(x.name)||'未命名草稿'}</option>`).join('')}</select></label>${btn('新建计划','new')}${btn('载入演示计划','reference')}${btn('复制为修订版','version')}${p.tasks.length?btn('调整月度安排／更新旧计划','reschedule'):''}${btn('备份 JSON','backup')}${btn('导入备份','import')}</div></details></div>${error?`<p class="plan-alert">${esc(error)}</p>`:''}<nav class="wp-steps" aria-label="计划编制步骤">${[['basic','1','基础信息'],['tree','2','选择工作内容'],['review','3','确认原计划月历']].map(([id,n,name],i)=>`<button data-step="${id}" class="${step===id||(id==='review'&&step==='export')?'active':''}"><b>${n}</b>${name}</button>${i<2?'<span></span>':''}`).join('')}</nav>${step!=='basic'?`<div class="wp-project-strip">${icon('folder')}<strong>${esc(p.name)}</strong><span>${esc(p.start)} 至 ${esc(p.end)}</span><span>本次参与 ${p.people.length} 人</span></div>`:''}`;
  }
  function employeePicker(p){
    return `<section><div class="wp-section-title"><h2>选择本次参与人员 <em>*</em></h2><p>从员工库中勾选；名单、小组及工作定位都可以调整。</p></div><div class="wp-employee-toolbar"><label>${icon('search')}<input id="wp-employee-search" type="search" value="${esc(employeeSearch)}" placeholder="搜索员工姓名" aria-label="搜索员工姓名"></label><button type="button" class="button secondary" data-employee-new>新增员工</button><button type="button" class="button secondary" data-group-manage>管理小组</button></div><div class="wp-employee-groups">${[...store.groups,{id:'ungrouped',name:'未分组'}].map(group=>{
      const people=store.employees.filter(x=>!x.archived&&(group.id==='ungrouped'?!x.groupIds.length:x.groupIds.includes(group.id))&&(!employeeSearch||x.name.includes(employeeSearch)));if(!people.length&&group.id==='ungrouped')return '';
      return `<section class="wp-employee-group"><header><strong>${esc(group.name)}</strong><span>（${people.length}人）</span>${group.id!=='ungrouped'?`<button type="button" data-group-edit="${esc(group.id)}" aria-label="编辑${esc(group.name)}">${icon('pen')}</button>`:''}</header><div class="wp-employee-chips">${people.map(person=>`<div class="wp-employee-chip ${p.selectedEmployeeIds.includes(person.id)?'selected':''}"><label><input type="checkbox" data-employee-check="${esc(person.id)}" ${p.selectedEmployeeIds.includes(person.id)?'checked':''}><span>${esc(person.name)}</span></label><button type="button" data-employee-edit="${esc(person.id)}" aria-label="编辑员工${esc(person.name)}">${icon('pen')}</button></div>`).join('')||'<p class="wp-muted">没有匹配的员工，可新增或调整分组。</p>'}</div></section>`;
    }).join('')}</div></section>`;
  }
  const materialBusy=new Set();
  function materialPanel(p){
    const files=p.materials||[],cards=p.materialCards||[];
    return `<section class="wp-materials"><h2>拖入项目资料，自动补充信息 <small>选填，可跳过</small></h2><div class="wp-material-drop" data-material-drop tabindex="0" role="group" aria-label="项目资料拖拽区"><strong>把文件或整个文件夹拖到这里</strong><p>支持多文件与子文件夹，音视频自动跳过 · 单文件20 MB，每批100 MB</p><label class="button secondary">选择文件<input type="file" data-material-input multiple hidden></label> <label class="button secondary">选择文件夹<input type="file" data-material-input webkitdirectory multiple hidden></label><small>当前本地解析 Word/Excel/演示文稿的现代格式和文本；PDF、图片及专业格式保留附件，等待后续解析服务。</small></div><p role="status" class="wp-material-status">${materialBusy.has(p.id)?'正在逐个接收并解析，完成后自动更新…':`已接收 ${files.length} 个文件，${cards.filter(c=>c.status==='待核对').length} 条信息待核对`}</p><div class="wp-material-list">${files.map(f=>`<div><span><strong>${esc(f.path)}</strong><small>${esc(f.status)} · ${(f.size/1024).toFixed(1)} KB · ${esc(f.message||'')} ${f.rawSaved?'（原件已保存在本浏览器）':''}</small></span><div>${f.rawSaved?`<button type="button" data-material-download="${esc(f.id)}">下载原件</button>${f.status==='解析失败'?`<button type="button" data-material-retry="${esc(f.id)}">重试解析</button>`:''}`:''}<button type="button" data-material-remove="${esc(f.id)}">移除</button></div></div>`).join('')}</div><div class="wp-material-cards">${cards.filter(c=>c.status!=='已忽略').map(c=>`<article><header><strong>${esc(c.label)}</strong><span>${esc(c.status)}</span></header><p>${esc(c.value)}</p><small>${esc(files.find(f=>f.id===c.fileId)?.path||'原件已移除')} · ${esc(c.source.location)} · ${esc(c.method)}</small><details><summary>查看来源片段</summary><p>${esc(c.source.excerpt)}</p></details>${c.status==='待核对'?`<button type="button" data-card-adopt="${esc(c.id)}">${p[c.field]?'采用并追加，不覆盖原文':'采用这条信息'}</button> <button type="button" data-card-ignore="${esc(c.id)}">忽略</button>`:''}</article>`).join('')}</div></section>`;
  }
  async function receiveMaterials(entries,projectId){
    const p=plans.find(p=>p.id===projectId);if(!p)return;
    if(materialBusy.has(projectId)){toast('该项目当前正在接收资料，请完成后再追加');return;}
    if(entries.length>WorkPlanMaterials.MAX_FILES||entries.reduce((n,e)=>n+e.file.size,0)>100*1024*1024){toast('每批最多1000个文件、100 MB，请分批添加');return;}
    materialBusy.add(projectId);p.materials||=[];p.materialCards||=[];
    try{for(const entry of entries){
      const result=await WorkPlanMaterials.inspect(entry.file,entry.path,window.JSZip),cards=result.cards;delete result.cards;
      if(result.hash&&p.materials.some(f=>f.hash===result.hash)){toast('已跳过内容相同的文件：'+entry.path);continue;}
      if(!['已跳过音视频','超出限制'].includes(result.status))try{await WorkPlanMaterials.store(projectId,result,entry.file);result.rawSaved=true;}catch(err){result.rawSaved=false;result.message=(result.message||'')+'；原文件未持久保存：'+err.message;}
      p.materials.push(result);p.materialCards.push(...cards);
      if(current().id===projectId){readBasics();save();if(step==='basic')redraw();}else save();
    }}finally{materialBusy.delete(projectId);if(current().id===projectId&&step==='basic'){readBasics();save();redraw();}}
  }
  function scalePicker(p){return `<fieldset class="wp-task-scale"><legend>计划任务规模 <em class="wp-required">*</em></legend><p>控制初稿的任务数量和拆分细度，生成后仍可自由增删。</p><div>${Object.entries(B.taskScales).map(([key,s])=>`<label><input type="radio" name="taskScale" value="${key}" ${p.taskScale===key?'checked':''} required><span><strong>${s.name}</strong><small>${s.min}—${s.max}项任务</small></span></label>`).join('')}</div>${p.taskScaleLegacy?'<small>旧草稿暂按此档位显示，原任务未改变；可重新选择后生成新方案。</small>':''}</fieldset>`;}
  function taskCountPanel(s){return `<div class="wp-task-count wp-count-inline" aria-label="任务规模与数量"><strong>${s.scale?`${s.scale.name} · ${s.scale.min}—${s.scale.max}项`:'选择任务规模'}</strong><span class="wp-count-values"><span>候选 <b>${s.total}</b></span><span>已选 <b>${s.selected}</b></span><span>未选 <b>${s.unselected}</b></span></span>${!s.inRange&&s.total?`<small>${esc(s.rangeText)}，可自由增删</small>`:''}</div>`;}
  function basic(p){return `<form id="plan-setup-form" novalidate><div class="wp-basic-columns"><div class="wp-basic-main"><section><div class="wp-section-title"><h2>项目基本信息</h2></div>${textField('项目名称','name',p.name,'text',true)}${area('项目是做什么的','description',p.description,'例如：为产业园配套设施开展需求调研、建设策划与融资咨询。',true)}<div class="form-grid">${textField('预计开始时间','startDate',p.startDate,'date',true)}${textField('预计结束时间','endDate',p.endDate,'date',true)}</div>${scalePicker(p)}<label class="wp-inline-check"><input type="checkbox" name="effortCapacityDefault" ${p.effortCapacityDefault===true?'checked':''}>未填写容量的成员，本次暂按每月 ${p.standardDays??20} 人天测算（可在负荷表调整）</label></section>${employeePicker(p)}</div><aside class="wp-selected-staff"><h2>本次参与 <b>${p.people.length}</b> 人</h2><div>${p.people.map(person=>`<div class="wp-selected-person"><strong>${esc(person.name)}</strong><span title="${esc(person.role)}">${esc(person.role||person.group)}</span><button type="button" data-employee-remove="${esc(person.employeeId)}" aria-label="移除本次参与人员${esc(person.name)}">${icon('close')}</button></div>`).join('')||'<p class="wp-empty">从左侧勾选这次一起参与项目的同事。</p>'}</div><p>下一步只从这 ${p.people.length} 人中推荐任务负责人，之后可以修改。</p><small>员工定位是推荐依据，允许跨组参与。</small></aside></div><section class="wp-optional-contact"><div class="wp-section-title"><h2>对接信息 <small>（选填）</small></h2></div><div class="wp-three-columns">${textField('我方负责人列表头','ownLabel',p.ownLabel)}${textField('对方配合人列表头','partnerLabel',p.partnerLabel)}${textField('对方配合人姓名','partnerName',p.partnerName)}</div></section>${materialPanel(p)}<details class="wp-optional"><summary><strong>手动核对或补充信息</strong>（选填，可以跳过）<span>服务范围、交付成果、关键节点和人员可用时间</span></summary><div class="form-grid">${area('本次负责与不负责的工作','scope',p.scope)}${area('需要交付的成果','deliverables',p.deliverables)}${area('关键节点与具体交付日期','milestones',p.milestones)}${area('已有进展与已完成事项','progressNotes',p.progressNotes)}${area('人员可投入时间','availabilityNotes',p.availabilityNotes)}${area('客户配合与前置条件','conditions',p.conditions)}</div><p>这些信息作为编制依据保留；具体排期与进展可在月历中逐项确认。</p></details><footer class="wp-footer"><span>已选 <b>${p.people.length}</b> 位参与人员</span><div>${btn('保存草稿','save-draft')}<button type="submit" class="button">下一步：选择工作内容 ${icon('arrow')}</button></div></footer></form>`;}
  function needsFrameworkUpdate(p){return !referenceView(p)&&!!p.adaptation&&(A.stale(p)||(p.adaptation.mode==='model'&&p.adaptation.generation!=='open-v1'&&p.adaptation.retainedForScale!==p.taskScale));}
  function frameworkWaiting(p){return needsFrameworkUpdate(p)||adaptationJobs.has(p.id);}
  function frameworkUpdateText(p){const size=B.taskScale(p),old=B.taskScales[A.generatedScale(p)];return `${size?.name||'当前'}目标${size?`${size.min}—${size.max}`:''}项；当前显示的${B.selected(p).length}项属于${old?old.name:'原有'}方案，尚未按新设置更新。`;}
  function adaptationBanner(p){
    const busy=adaptationJobs.has(p.id),meta=p.adaptation,s=A.statistics(p),stale=needsFrameworkUpdate(p);
    const exceedsScale=s.scale&&s.selected>s.scale.max;
    const message=busy?`正在生成${s.scale?.name||''}任务树，请稍候…`:stale?'当前任务待更新，请重试生成':adaptationNotices.get(p.id)||(!s.total?'尚未生成任务，可重试或手动新增。':'已生成，可直接勾选和修改');
    const budget=meta?.selectionBudget;
    const budgetMessage=!busy&&!stale&&budget&&(budget.deferred>0||budget.protectedOverLimit)
      ?`保留 ${budget.keptSelected} 项原勾选，自动勾选 ${budget.autoSelected} 项，${budget.deferred} 项留作备选。${budget.protectedOverLimit?'原勾选已超出档位，继续保留。':''}`:'';
    return `<section class="wp-adaptation wp-generation-bar" aria-live="polite">
      ${taskCountPanel(s)}
      <span class="wp-generation-message" role="status">${esc(message)}${budgetMessage?`<br>${esc(budgetMessage)}`:''}</span>
      <button type="button" class="text-link" data-plan-action="adapt-tree" ${busy?'disabled':''}>${busy?'生成中…':'重新生成'}</button>
      ${exceedsScale?`<button type="button" class="text-link" data-plan-action="adapt-fresh" ${busy?'disabled':''} title="在独立副本重新生成任务，已有安排保留在原计划">按${esc(s.scale.name)}另建副本</button>`:''}
      <details class="wp-generation-details"><summary>编制依据与待核对事项</summary>
        ${stale?`<p role="alert">${esc(frameworkUpdateText(p))} 系统会自动更新任务树，原有手动修改继续保留。</p>`:''}
        ${meta?.summary?`<p>${esc(meta.summary)}</p>`:''}
        <p>演示任务只提供拆分参考；整树生成未联网；新增入口可单独使用联网AI推荐。</p>
        ${meta?.referenceProfile?`<p>参考演示任务库的${esc(meta.referenceProfile.directions)}个方向，读取${esc(meta.referenceProfile.outlineExamples)}项任务与成果对照。</p>`:''}
        ${meta?.countExplanation?`<p>${esc(meta.countExplanation.split('；分批说明：')[0])}</p>`:''}
        ${(meta?.assumptions||[]).map(x=>`<p>${esc(x)}</p>`).join('')}
        ${s.duplicates.exact.length||s.duplicates.suspected.length?`<p>重复检查：${s.duplicates.exact.length}项重复、${s.duplicates.suspected.length}项近似待核对。</p>`:''}
        ${stale&&!busy?btn(`保留当前${s.selected}项，手动调整继续`,'retain-framework'):''}
        ${p.tasks.length&&!exceedsScale&&!busy?btn('新建适配副本（原计划保留）','adapt-fresh'):''}
      </details>
    </section>`;
  }
  function prepareTree(){
    commitBasic();const p=current();
    if(!referenceView(p)&&!p.adaptation&&!p.tasks.length){A.apply(p,A.local(p));const first=p.tree.find(m=>m.sourceCode==='B')?.children[0];if(first)expanded.add(first.id);}
    step='tree';save();redraw();
    if(!referenceView(p)&&(p.adaptation?.mode!=='model'||p.adaptation?.generation!=='open-v1'||needsFrameworkUpdate(p)))requestAdaptation(p);
  }
  function referenceView(p){return !!p.source&&p.name==='示例产业园咨询计划';}
  async function requestAdaptation(p,force=false){
    if(adaptationJobs.has(p.id))return;
    if(!/^https?:$/.test(location.protocol)||typeof window.fetch!=='function'){adaptationNotices.set(p.id,'尚未调用大模型，项目任务尚未生成。请从本机服务打开后重试，也可手动新增任务。');if(current().id===p.id)redraw();return;}
    const stamp=A.revision(p),requestedContext=A.fingerprint(p);adaptationJobs.add(p.id);adaptationNotices.set(p.id,'正在生成任务树，请稍候…');if(current().id===p.id)redraw();
    try{
      const status=await fetch(new URL('./api/plan-ai/status',location.href),{signal:AbortSignal.timeout(5000)});if(!status.ok)throw Error('本页面尚未连接适配后端，请参考 README 的启动说明');const config=await status.json();if(!config.configured)throw Error('尚未配置模型服务，项目任务尚未生成；不会退回固定数量模板');
      if(config.taskGeneration!=='open-v1')throw Error('当前本地服务仍为旧版，需更新服务后才能按任务规模生成；现有计划未改变');
      const response=await fetch(new URL('./api/plan-ai/adapt',location.href),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:A.context(p),force}),signal:AbortSignal.timeout(250000)});const data=await response.json();if(!response.ok)throw Error(data.error||'项目适配失败');B.validateTree(data.candidate.tree);if(data.candidate.generation!=='open-v1')throw Error('服务返回旧版任务方案，未采用；请更新本地服务');
      if(A.revision(p)!==stamp)throw Error('生成期间项目或任务已有修改，旧结果未应用；请重新适配');
      edit(project=>A.apply(project,data.candidate),p);
      if(current().id===p.id){const first=p.tree.find(m=>B.state(m).count);if(first){activeModule=first.id;const direction=first.children.find(c=>B.state(c).count);if(direction)expanded.add(direction.id);}}
      adaptationNotices.set(p.id,data.candidate.performance?.cacheHit?'已恢复相同项目信息的任务树，可直接修改':'任务树已更新，可直接勾选和修改');
    }catch(err){adaptationNotices.set(p.id,err.name==='TimeoutError'?'适配请求超时，原计划未改变，请重试':err.message);}
    finally{adaptationJobs.delete(p.id);if(current().id===p.id&&step==='tree'){redraw();if(A.fingerprint(p)!==requestedContext&&needsFrameworkUpdate(p))requestAdaptation(p);}}
  }
  function taskTree(p){
    const module=p.tree.find(m=>m.id===activeModule)||p.tree[0];if(module)activeModule=module.id;
    const selectedRows=B.selected(p),active=p.tree.filter(m=>B.state(m).count),term=search.trim().toLowerCase(),matches=t=>(t.work+' '+t.output+' '+(t.original?.category||'')).toLowerCase().includes(term);
    return `${adaptationBanner(p)}<fieldset class="wp-generation-content" ${adaptationJobs.has(p.id)?'disabled aria-busy="true"':''}><div class="wp-tree-layout"><aside class="wp-modules"><h2>业务大类 <small>（可多选）</small></h2><p>只选需要的模块，拖动可排序。</p><div class="wp-module-list">${p.tree.map((m,i)=>`<div class="wp-module-row ${m.id===activeModule?'active':''}" draggable="true" data-module-id="${esc(m.id)}"><span class="wp-grip" title="拖动排序">${icon('menu')}</span>${check(m)}<button class="wp-module-open" data-module-open="${esc(m.id)}"><b>${B.moduleCode(p,m)}</b>${esc(m.name)}${B.isRecommended(m)?'<span class="wp-recommended">（推荐）</span>':''}</button><div class="wp-module-controls"><button data-node-move="${esc(m.id)}" data-offset="-1" ${!i?'disabled':''} aria-label="上移${esc(m.name)}">上</button><button data-node-move="${esc(m.id)}" data-offset="1" ${i===p.tree.length-1?'disabled':''} aria-label="下移${esc(m.name)}">下</button></div></div>`).join('')}</div>${btn('恢复推荐选择','restore-recommended')}<button class="button secondary wp-add-module" data-node-new="module">新增业务大类</button><small class="wp-number-note">插入或重排后连续编号，任务选择与分工保持不变。</small></aside><section class="wp-tree-main">${module?`<div class="wp-tree-title"><h2>${B.moduleCode(p,module)} ${esc(module.name)}</h2><div>${btn('编辑大类','edit-active-module')}${btn('新增方向','add-direction')}</div></div><p class="wp-muted">勾选方向可全选其下任务，也可以只选其中几项。</p><div class="wp-tree-toolbar"><label>${icon('search')}<input id="wp-tree-search" type="search" value="${esc(search)}" placeholder="搜索工作或成果" aria-label="搜索工作或成果"></label><button data-expand-all>展开全部</button><button data-collapse-all>收起全部</button></div><div class="wp-tree-column-head"><span>选择具体工作</span><span>对应工作成果</span></div><div class="wp-tree-body">${module.children.filter(c=>!term||c.name.toLowerCase().includes(term)||c.children.some(matches)).map(c=>{
      const s=B.state(c),open=!!term||expanded.has(c.id);return `<section class="wp-direction"><header><button data-category-open="${esc(c.id)}" aria-expanded="${open}" aria-label="展开或收起${esc(c.name)}">${icon('chevron')}</button>${check(c)}<button class="wp-direction-name" data-category-open="${esc(c.id)}">${esc(c.name)}</button><span>${s.count}/${s.total} 项</span><div class="wp-node-actions"><button data-node-new="task" data-parent="${esc(c.id)}" aria-label="在${esc(c.name)}下新增任务">新增任务</button><button data-node-edit="${esc(c.id)}" aria-label="编辑方向${esc(c.name)}">${icon('pen')}</button><button data-node-move="${esc(c.id)}" data-offset="-1" aria-label="上移方向${esc(c.name)}">上移</button><button data-node-move="${esc(c.id)}" data-offset="1" aria-label="下移方向${esc(c.name)}">下移</button></div></header>${open?`<div class="wp-leaf-list">${c.children.filter(t=>!term||c.name.toLowerCase().includes(term)||matches(t)).map(t=>`<div class="wp-leaf-row ${t.selected?'selected':''}"><div>${check(t)}<button class="wp-leaf-work" data-node-edit="${esc(t.id)}">${esc(t.work)}</button></div><button class="wp-leaf-output" data-node-edit="${esc(t.id)}">${esc(t.output)||'填写工作成果'}</button><div class="wp-leaf-tools"><button data-node-edit="${esc(t.id)}" aria-label="编辑任务${esc(t.work)}">${icon('pen')}</button><button data-node-move="${esc(t.id)}" data-offset="-1" aria-label="上移任务${esc(t.work)}">上移</button><button data-node-move="${esc(t.id)}" data-offset="1" aria-label="下移任务${esc(t.work)}">下移</button></div></div>`).join('')||'<p class="wp-empty">还没有具体任务。</p>'}<button class="wp-add-leaf" data-node-new="task" data-parent="${esc(c.id)}">新增具体任务及成果</button></div>`:''}</section>`;
    }).join('')||'<div class="wp-empty">没有匹配的方向，可清除搜索或新增方向。</div>'}</div><div class="wp-tree-bottom"><span>任务名称与成果均可编辑。</span><button class="button secondary" data-node-new="category" data-parent="${esc(module.id)}">新增工作方向</button></div>`:'<div class="wp-empty">请先新增业务大类。</div>'}</section><aside class="wp-selection-summary"><section><h2>已选 <b>${active.length}</b> 个大类 · <b>${selectedRows.length}</b> 项任务</h2>${active.map(m=>`<button class="wp-summary-module" data-module-open="${esc(m.id)}"><span>${esc(m.name)}</span><b>${B.state(m).count} 项</b></button>`).join('')||'<p class="wp-empty">从左侧选择需要的工作。</p>'}</section><section><h2>负责人建议</h2><p>仅从本次选中的 ${p.people.length} 位人员中推荐，可修改。</p><div class="wp-owner-list">${selectedRows.slice(0,8).map(({module,task})=>{const assignment=p.tasks.find(t=>t.id===task.id)||p.taskCache[task.id]||{id:task.id,work:task.work,owner:B.suggest(p,module,task)};return `<div><span title="${esc(task.work)}">${esc(task.work)}</span>${P.members(p,{...assignment,id:task.id,work:task.work},'tree')}</div>`;}).join('')}</div>${selectedRows.length>8?'<small>其余任务在下一步统一确认。</small>':''}</section><details open><summary>本次 ${p.people.length} 位参与人员</summary><div class="wp-person-tags">${p.people.map(x=>`<span>${esc(x.name)}</span>`).join('')}</div></details><p class="wp-muted">分工与排期将在下一步统一确认。下一步自动估算人天，按月分配到本次人员，之后可直接修改。</p></aside></div></fieldset>${undo?.projectId===p.id?`<div class="wp-undo">已删除本项目中的内容。${btn('撤销删除','undo')}</div>`:''}<footer class="wp-footer"><span>${frameworkWaiting(p)?`正在更新任务树，当前${selectedRows.length}项暂不用于生成月历`:`已选 <b>${selectedRows.length}</b> 项任务，将生成 <b>${selectedRows.length}</b> 行工作安排`}<small>${frameworkWaiting(p)?'生成完成后自动展示，无需再次确认。':'已选任务可继续排期和导出 Excel'}</small></span><div>${btn('上一步','back-basic')}<button class="button" data-plan-action="generate" ${frameworkWaiting(p)?'disabled':''}>生成原计划月历 ${icon('arrow')}</button></div></footer>`;
  }
  function calendar(p) {
    const allMonths=E.months(p.start,p.end),months=monthFilter==='all'?allMonths:allMonths.filter(m=>m===monthFilter),issues=E.diagnostics(p);
    const visible=p.tasks.filter(t=>(monthFilter==='all'||E.effort(t,monthFilter)!==null||(t.start<=monthFilter&&t.end>=monthFilter))&&(filter==='all'||t.module===filter)&&(statusFilter==='all'||t.status===statusFilter)&&(!query||(t.work+t.output+E.ownerLabel(t,p.people)+t.category).includes(query)));
    const total=E.sum(p.tasks.map(t=>E.total(t,allMonths)||0)),unassigned=E.sum(p.tasks.flatMap(t=>allMonths.map(m=>t.unassigned?.[m]||0)));
    const pending=p.tasks.filter(t=>t.status!=='已完成'&&E.total(t,allMonths)===null).length;
    return `<div class="plan-overview"><div><small>任务总数</small><b>${p.tasks.length}<em>项</em></b></div><div><small>月历期间</small><b>${allMonths.length}<em>个月</em></b></div><div><small>已填计划投入</small><b>${total}<em>人天</em></b></div><div><small>人天待估算</small><b>${pending}<em>项</em></b></div><div><small>投入待分配</small><b>${unassigned}<em>人天</em></b></div></div><section class="panel plan-calendar"><div class="plan-section-head"><div><h2>${esc(p.name)} <span>原计划月历</span></h2><p>月历包含 11 个任务字段。内容、成果、负责人、时间、人天均可直接修改；点击序号旁详情可细分投入。</p></div><div class="plan-actions">${btn('新增任务','add-task')}${btn('调整月度安排／更新旧计划','reschedule')}${btn('AI补齐未估算','estimate-empty')}${btn('AI初算／更新系统初稿','estimate-system')}${btn('选择导出表','show-export',false)}</div></div><div class="plan-filters"><label>查看月份<select id="plan-month-filter"><option value="all">全部月份</option>${allMonths.map(m=>`<option ${m===monthFilter?'selected':''}>${m}</option>`).join('')}</select></label><label class="sr-only" for="plan-module-filter">筛选流程模块</label><select id="plan-module-filter"><option value="all">全部流程</option>${E.moduleDefinitions(p).map(g=>`<option value="${g.id}" ${g.id===filter?'selected':''}>${g.id} ${esc(g.name)}</option>`).join('')}</select><label class="sr-only" for="plan-status-filter">筛选任务状态</label><select id="plan-status-filter"><option value="all">全部状态</option>${E.statuses.map(s=>`<option ${s===statusFilter?'selected':''}>${s}</option>`).join('')}</select><input id="plan-search" type="search" aria-label="搜索计划任务" value="${esc(query)}" placeholder="搜索任务、成果或负责人"><span>显示 ${visible.length} / ${p.tasks.length} 项</span></div><div class="plan-calendar-scroll" tabindex="0" aria-label="原计划月历，可横向滚动"><table class="plan-grid"><colgroup><col style="width:58px"><col style="width:128px"><col style="width:160px"><col style="width:150px"><col style="width:290px"><col style="width:280px"><col style="width:210px"><col style="width:140px"><col style="width:110px"><col style="width:240px"><col style="width:240px">${months.map(()=>'<col style="width:105px">').join('')}<col style="width:110px"></colgroup><thead><tr>${['序号','模块','分类','时间','工作内容','工作成果',p.ownLabel||'项目负责人',p.partnerLabel||'客户配合人','推进情况','推进难题','备注',...months,'累计人天'].map(v=>`<th scope="col">${esc(v)}</th>`).join('')}</tr></thead><tbody>${visible.map(t=>{
      const index=p.tasks.indexOf(t),g=E.moduleDefinitions(p).find(g=>g.id===t.module),sum=E.total(t,allMonths);
      return `<tr class="${t.status==='已完成'?'plan-completed':''}"><td>${index+1}<button class="plan-task-title" data-plan-task="${esc(t.id)}">详情</button>${t.estimate?.method==='model'?`<button class="plan-task-title" data-effort-task="${esc(t.id)}">估算依据</button>`:''}</td><td><span class="plan-module-tag">${B.moduleCode(p,g)}</span>${esc(g.name)}</td><td>${esc(t.category)}</td><td>${P.dates(t)}</td>${['work','output','owner','partner','status','difficulty','notes'].map(k=>`<td>${P.field(p,t,k)}</td>`).join('')}${months.map(m=>{const n=E.effort(t,m),active=m>=t.start&&m<=t.end;return `<td class="plan-month-cell ${active?'in-period':''}"><input type="number" min="0" step="0.25" value="${n??''}" ${!active?'disabled':''} data-plan-month="${m}" data-plan-row="${esc(t.id)}" aria-label="${esc(t.work)} ${m} 人天" placeholder="${active&&t.status!=='已完成'?'待估算':''}"></td>`;}).join('')}<td class="plan-total">${sum??'—'}</td></tr>`;
    }).join('')||`<tr><td colspan="${12+months.length}" class="plan-table-empty">${p.tasks.length?'没有匹配的任务':'还没有任务，点击“新增任务”开始。'}</td></tr>`}</tbody></table></div><div class="plan-table-footer"><span>浅绿表示执行月份；期内空白待估算，期外空白不适用，0为确认无投入。</span><span>修改在离开输入框后自动保存 · 横向滚动查看月份</span></div></section>${p.source?`<p class="plan-source">${esc(p.source)}</p>`:''}<details class="panel plan-checks"><summary>待核对事项 <b>${issues.length}</b><span>排期、负责人、人天及人员负荷</span></summary>${issues.length?`<ul>${issues.slice(0,100).map(i=>`<li>${i.task?`<button data-plan-task="${esc(i.task)}">${esc(i.text)}</button>`:esc(i.text)}</li>`).join('')}</ul>${issues.length>100?`<p>其余 ${issues.length-100} 项随任务补充后逐步更新。</p>`:''}`:'<p>已填写数据中未发现上述冲突；仍请核对交付节点和实际工作范围。</p>'}</details>`;
  }
  function schedulingNotice(p){return p.scheduleReview?`<details class="panel plan-checks" ${(p.scheduleReview.warnings||[]).length?'open':''}><summary>重排副本说明 · 原版已保留</summary><p>${esc(p.scheduleReview.note||'沿用原人天，仅调整月度安排')}</p>${(p.scheduleReview.warnings||[]).map(w=>`<p class="wp-cell-error">${esc(w)}</p>`).join('')}</details>`:'';}
  function staffingHint(p){
    const s=AIUI.state(p.id),model=p.tasks.filter(t=>t.estimate?.method==='model'&&t.estimate.status!=='pending').length,pending=p.tasks.filter(t=>t.estimate?.status==='pending').length;
    if(s.busy||s.error||model||pending)return `<section class="panel wp-effort-status" aria-live="polite"><strong>${s.busy?'AI初算中…':`${model} 项已有AI估算依据${pending?` · ${pending} 项待补资料`:''}`}</strong><p>${esc(s.message||'标准需求与当前安排分别保存。点击任务旁“估算依据”查看分项、假设与共用活动。')}</p>${s.error?`<p class="wp-cell-error">${esc(s.error)}</p>`:''}<small>${p.effortCapacityDefault===true?`未填容量暂按月标准工日 ${p.standardDays??20} 天测算；可在人员月度负荷中修改。`:'未知容量保留待分配；可在AI初算窗口确认容量假设。'} 仅核对本项目容量。</small></section>`;
    return p.preStartMode?'<p class="plan-alert">当前人天为原规则建议估算，可使用“AI初算／更新系统初稿”升级副本。已有人工数据保留。</p>':'';
  }
  function exportView(p) {
    return `<section class="panel plan-export"><h2>确认当前版本并导出</h2><p>原计划月历必选，附属表按需选择；三张人力表可直接预览编辑。</p>${editStatus()}${staffingHint(p)}${schedulingNotice(p)}${P.choices(p)}${P.render(p)}<div class="plan-form-footer"><span>网页与Excel共用当前已保存数据 · ${p.editRevision||0}次表格修改</span><button class="button" data-plan-action="download">${icon('download')}导出 Excel 工作计划</button></div></section>`;
  }

  function editTask(id) {
    const p=current(),t=p.tasks.find(t=>t.id===id)||E.newTask({module:filter==='all'?'module-X':filter,start:p.start,end:p.end});
    const months=E.months(p.start,p.end),g=E.moduleDefinitions(p).find(g=>g.id===t.module);
    showDialog(`${dialogHeader(id?'编辑计划任务':'新增计划任务','人员投入自动汇总到月历','calendar')}<form id="plan-task-form" data-id="${esc(id||'')}"><div class="simple-form plan-task-form"><div class="form-grid"><label class="form-field">模块<select name="module" id="plan-task-module">${E.moduleDefinitions(p).map(g=>`<option value="${g.id}" ${g.id===t.module?'selected':''}>${g.id} ${esc(g.name)}</option>`).join('')}</select></label><label class="form-field">分类<input name="category" list="plan-categories" value="${esc(t.category)}" required maxlength="160"><datalist id="plan-categories">${g.children.map(c=>`<option value="${esc(c.name)}">`).join('')}</datalist></label></div>${area('工作内容','work',t.work)}${area('工作成果','output',t.output)}<div class="form-grid">${textField('开始月份','start',t.start,'month',true)}${textField('结束月份','end',t.end,'month',true)}${textField('最迟完成月份（选填）','deadline',(t.deadline||'').slice(0,7),'month')}<label class="form-field">持续月数（跨月时选填）<input type="number" name="durationMonths" min="1" max="60" step="1" value="${t.durationMonths??''}" placeholder="短任务留空"></label></div><div class="form-grid"><div class="form-field">${esc(p.ownLabel||'项目负责人')}${P.members(p,t,'dialog')}<small>添加成员不增加人天；移除已有投入会先确认转为待分配。</small></div>${textField(p.partnerLabel||'客户配合人','partner',t.partner)}</div><datalist id="plan-people-list">${p.people.map(x=>`<option value="${esc(x.name)}">`).join('')}</datalist><div class="form-grid"><label class="form-field">推进情况<select name="status">${E.statuses.map(s=>`<option ${s===t.status?'selected':''}>${s}</option>`).join('')}</select></label><label class="form-field">前置任务（多选）<select name="dependencies" multiple size="3">${p.tasks.filter(x=>x.id!==t.id).map(x=>`<option value="${esc(x.id)}" ${(t.dependsOn||[]).includes(x.id)?'selected':''}>${esc(x.work)}</option>`).join('')}</select></label></div><label class="wp-inline-check"><input type="checkbox" name="locked" ${t.locked?'checked':''}>锁定本任务安排（重排时保留，取消勾选可解除）</label>${area('推进难题／需要外部配合的条件','difficulty',t.difficulty)}${area('备注（可记录具体交付日期、修改要求）','notes',t.notes)}<h3>按月安排人天</h3><p class="form-help">人员各自投入 + 待分配投入 = 当月总人天。空白保持未估算；仅填写月历总量的投入列在“待分配”中，分给人员时请相应减少该列。</p><div class="plan-allocation-scroll"><table class="plan-allocation"><thead><tr><th>月份</th>${p.people.map(x=>`<th>${esc(x.name)}</th>`).join('')}<th>待分配</th></tr></thead><tbody>${months.map(m=>`<tr><th>${m}</th>${p.people.map(x=>`<td><input type="number" min="0" step="0.25" aria-label="${m} ${esc(x.name)} 人天" data-allocation-month="${m}" data-allocation-person="${esc(x.id)}" value="${t.allocations?.[m]?.[x.id]??''}"></td>`).join('')}<td><input type="number" min="0" step="0.25" aria-label="${m} 待分配人天" data-unassigned-month="${m}" value="${t.unassigned?.[m]??''}"></td></tr>`).join('')}</tbody></table></div><p class="form-help">当前月历 ${p.start} 至 ${p.end}。已完成任务只能保留截至 ${p.asOf} 的历史投入；未来投入请先清空再保存。</p></div><div class="dialog-footer"><span>${id?'修改后更新整份计划':'新任务加入月历末尾，可设为计划外工作'}</span><div>${id?`<button type="button" class="button secondary plan-danger" data-plan-delete="${esc(id)}">删除任务</button>`:''}<button class="button" type="submit">保存任务与投入</button></div></div></form>`);
    
  }
  function saveTask(f) {
    const p=current(),data=new FormData(f),before=p.tasks.find(t=>t.id===f.dataset.id);
    const t=E.newTask(before?JSON.parse(JSON.stringify(before)):{});
    for(const k of ['module','category','work','output','start','end','deadline','partner','status','difficulty','notes'])t[k]=String(data.get(k)||'').trim();
    t.dependsOn=data.getAll('dependencies');t.locked=data.has('locked');
    const duration=String(data.get('durationMonths')||'').trim();if(duration)t.durationMonths=Number(duration);else delete t.durationMonths;
    // 只覆盖当前月历中的投入；月历外历史记录保留，避免修改任务时丢失历史。
    for(const m of E.months(p.start,p.end)){delete t.allocations[m];delete t.unassigned[m];}
    for(const input of f.querySelectorAll('[data-allocation-month]'))if(input.value!==''){
      const m=input.dataset.allocationMonth; (t.allocations[m]||={})[input.dataset.allocationPerson]=E.days(input.value);
    }
    for(const input of f.querySelectorAll('[data-unassigned-month]'))if(input.value!=='')t.unassigned[input.dataset.unassignedMonth]=E.days(input.value);
    for(const m of new Set([...Object.keys(t.allocations),...Object.keys(t.unassigned)]))if((E.effort(t,m)||0)>0){
      if(m<t.start||m>t.end)throw Error('存在执行期间之外的人天：'+m+'，请调整日期或清空该月投入');
      if(t.status==='已完成'&&m>p.asOf)throw Error('已完成任务不能继续安排未来投入，请清空 '+m+' 的人天');
    }
    const ids=[...f.querySelectorAll('[data-member-select]')].map(el=>el.value).filter(Boolean);
    const removed=E.participantIds(before||{},p.people).filter(id=>!ids.includes(id));
    const released=E.sum(Object.values(t.allocations).flatMap(a=>removed.map(id=>a[id]||0)));
    if(released&&!window.confirm(`移除或替换成员后，其 ${released} 人天将转为待分配，总人天保持不变。是否继续保存？`))return;
    D.changeParticipants(p,t,ids,true);
    if(before?.locked&&t.locked&&JSON.stringify(t)!==JSON.stringify(before))throw Error('此任务已锁定，请先解除锁定');
    if(!before||['start','end','work','output'].some(k=>JSON.stringify(t[k]||'')!==JSON.stringify(before[k]||'')))D.markManual(t,'schedule');
    if(!before||['allocations','unassigned'].some(k=>JSON.stringify(t[k])!==JSON.stringify(before[k])))D.markManual(t,'effort');
    if(['deadline','durationMonths','dependsOn'].some(k=>JSON.stringify(t[k]||'')!==JSON.stringify(before?.[k]||'')))D.markManual(t,'constraints');
    D.syncMonthly(t);
    const tasks=before?p.tasks.map(x=>x.id===t.id?t:x):[...p.tasks,t];E.validate({...p,tasks});
    const row=B.find(p.tree,t.id);if(row){row.node.work=t.work;row.node.output=t.output;const target=p.tree.find(m=>m.id===t.module);let category=target.children.find(c=>c.name===t.category);if(!category)category=B.addNode(p,target.id,{name:t.category});if(row.parent!==category){row.siblings.splice(row.siblings.indexOf(row.node),1);category.children.push(row.node);}}
    p.tasks=tasks;if(t.estimate?.method==='model'&&before&&(['allocations','unassigned','participantIds'].some(k=>JSON.stringify(before[k])!==JSON.stringify(t[k]))))AI.calibrate(p,t.id,'任务详情调整投入或分工，具体原因待补充');p.taskCache[t.id]=B.clone(t);save('任务与投入已保存');dialog.close();redraw();
  }

  function view(){const p=current();return `<div class="plan-workspace wp-workspace">${header(p)}${step==='basic'?basic(p):step==='tree'?taskTree(p):step==='review'?editStatus()+staffingHint(p)+schedulingNotice(p)+calendar(p)+P.choices(p)+P.render(p)+`<div class="wp-review-bottom">${btn('返回调整工作','back-tree')}${btn('导出 Excel 工作计划','download',false)}</div>`:exportView(p)}<input type="file" id="plan-import-file" accept=".json,application/json" hidden></div>`;}
  function readBasics(){const f=document.getElementById('plan-setup-form');if(!f)return;const data=new FormData(f),p=current();for(const key of ['name','description','startDate','endDate','taskScale','ownLabel','partnerLabel','partnerName','scope','deliverables','milestones','progressNotes','availabilityNotes','conditions'])p[key]=String(data.get(key)||'').trim();p.effortCapacityDefault=data.has('effortCapacityDefault');}
  function updateProjectPeople(){const p=current();return B.reconcilePeople(p,B.peopleForProject(store,p.selectedEmployeeIds,p.people));}
  function commitBasic(){const p=current();readBasics();updateProjectPeople();B.validateBasics(p);const start=p.startDate.slice(0,7),end=p.endDate.slice(0,7);if(p.tasks.some(t=>[...Object.keys(t.allocations),...Object.keys(t.unassigned)].some(m=>(E.effort(t,m)||0)>0&&(m<start||m>end))))throw Error('新的项目期间会遗漏已填投入，请先调整投入或保留原日期。');p.start=start;p.end=end;p.asOf=p.asOf||start;save();}
  function open(projectId){if(dialog.open)dialog.close();if(projectId){const exists=plans.find(p=>p.projectId===projectId);if(exists)selected=exists.id;else{const source=state.projects.find(p=>p.id===projectId),p=B.createProject();p.projectId=projectId;p.name=source?.name||'';p.description=source?.notes||'';p.endDate=source?.date||'';plans.unshift(p);selected=p.id;}}step='basic';go('plan');}
  function nodeEditor(type,parentId,id){
    const existing=id?B.find(current().tree,id)?.node:null;type=existing?.type||type;
    const title=type==='module'?'业务大类':type==='category'?'工作方向':'具体任务与成果';
    showDialog(`${dialogHeader((id?'编辑':'新增')+title,'只修改本项目，原始基础选项库保持完整','layers')}<form id="wp-node-form" data-id="${esc(id||'')}" data-type="${type}" data-parent="${esc(parentId||'')}"><div class="simple-form">${type==='task'?area('具体工作内容','work',existing?.work||'','描述一项可执行工作',true)+area('对应工作成果（多个成果可分行填写）','output',existing?.output||'','例如：《市场调研报告》'):textField(type==='module'?'业务大类名称':'工作方向名称','name',existing?.name||'','text',true)}${existing?.original?`<details class="wp-source-reference"><summary>演示任务参考</summary><p>原序号 ${existing.sourceSeq} · ${esc(existing.original.module)} / ${esc(existing.original.category)}</p><p>${esc(existing.original.work)}</p><p>${esc(existing.original.output)}</p></details>`:''}${!id?'<div data-node-recommendations></div>':''}</div><div class="dialog-footer"><span>可手动保存，也可从联网建议中选择添加。</span><div>${id?`<button type="button" class="button secondary plan-danger" data-node-delete="${esc(id)}">删除本项目中的内容</button>`:''}<button type="submit" class="button">保存${title}</button></div></div></form>`,!!id&&type!=='task');
    if(!id)WorkPlanRecommendationUI.mount(document.querySelector('#wp-node-form'),{current,edit,save,onAdded:nodes=>{
      for(const node of nodes){if(node.type==='module')activeModule=node.id;else if(node.type==='category')expanded.add(node.id);else expanded.add(B.find(current().tree,node.id).parent.id);}
      toast(`已添加 ${nodes.length} 项，手动填写的内容已保留`);redraw();
    }});
  }
  function employeeEditor(id){readBasics();const p=current(),person=store.employees.find(x=>x.id===id);showDialog(`${dialogHeader(person?'编辑员工':'新增员工','工作定位用于推荐，允许跨组参与','users')}<form id="wp-employee-form" data-id="${esc(id||'')}"><div class="simple-form">${textField('姓名','name',person?.name||'','text',true)}<fieldset class="wp-group-fieldset"><legend>所属小组（可多选）</legend>${store.groups.map(g=>`<label><input type="checkbox" name="groupIds" value="${esc(g.id)}" ${person?.groupIds.includes(g.id)?'checked':''}>${esc(g.name)}</label>`).join('')}</fieldset>${area('工作定位（选填，可修改）','role',person?.role||'','例如：市场调研、项目策划或AI开发')}${textField('每月可投入人天（选填）','capacity',person?.capacity??'','number')}<label class="wp-inline-check"><input type="checkbox" name="participate" ${!person||p.selectedEmployeeIds.includes(person.id)?'checked':''}>加入本次项目</label><p class="wp-muted">可以通过“管理小组”新增分组。</p></div><div class="dialog-footer"><span>改名保留员工身份与已有投入。</span><div>${person?`<button type="button" class="button secondary plan-danger" data-employee-delete="${esc(person.id)}">移出员工库</button>`:''}<button class="button" type="submit">保存员工</button></div></div></form>`,true);const input=document.querySelector('#wp-employee-form [name=capacity]');input.min='0';input.step='0.25';}
  function groupEditor(id){readBasics();const group=store.groups.find(g=>g.id===id);showDialog(`${dialogHeader(group?'编辑小组':'管理小组','员工允许属于多个小组','users')}<form id="wp-group-form" data-id="${esc(id||'')}"><div class="simple-form">${textField(group?'小组名称':'新小组名称','name',group?.name||'','text',true)}${!id?`<div class="wp-group-management">${store.groups.map(g=>`<div><span>${esc(g.name)}</span><button type="button" class="text-link" data-group-edit="${esc(g.id)}">编辑</button></div>`).join('')}</div>`:''}</div><div class="dialog-footer"><span>移除小组后，其成员保留在员工库。</span><div>${group?`<button type="button" class="button secondary plan-danger" data-group-delete="${esc(group.id)}">移除小组</button>`:''}<button class="button" type="submit">${group?'保存小组':'新增小组'}</button></div></div></form>`,true);}
  function downloadBlob(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/:*?"<>|]/g,'_');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  function makeReview(){
    commitBasic();const p=current();if(frameworkWaiting(p)){step='tree';redraw();if(needsFrameworkUpdate(p)&&!adaptationJobs.has(p.id))requestAdaptation(p);throw Error('任务树正在生成或待更新，请完成后再生成月历。');}const before=B.clone(p),known=new Set([...p.tasks.filter(t=>!t.needsInitialStaffing).map(t=>t.id),...Object.values(p.taskCache||{}).filter(t=>t.start&&!t.needsInitialStaffing).map(t=>t.id)]);
    let fresh=[];try{B.generate(p);fresh=p.tasks.filter(t=>!known.has(t.id)).map(t=>t.id);}catch(err){Object.assign(p,before);throw err;}
    step='review';filter='all';monthFilter='all';query='';detailView=null;save();redraw();
    if(fresh.length&&!p.source)AIUI.start({current,taskIds:fresh,onApply:applyEffort,canApply:()=>!pendingEditor()&&!dialog.open,onStatus:()=>{
      if(!pendingEditor()&&!dialog.open)redraw();
      else{const panel=document.querySelector('.wp-effort-status');if(panel)panel.outerHTML=staffingHint(current());}
    }});
  }
  function applyEffort(next,copy){
    if(copy){if(next.adaptation)next.adaptation.fingerprint=A.fingerprint(next);plans.unshift(next);selected=next.id;}
    else Object.assign(current(),next);
    step='review';filter='all';query='';monthFilter='all';detailView=null;
    save(copy?'已另存AI初算副本，原计划保留':'AI初算已校验并保存');if(dialog.open)dialog.close();redraw();
  }
  document.addEventListener('submit',e=>{
    const f=e.target;if(!['plan-setup-form','plan-task-form','wp-node-form','wp-employee-form','wp-group-form','plan-distribution-form'].includes(f.id))return;e.preventDefault();
    try{
      const p=current(),data=new FormData(f);
      if(f.id==='plan-setup-form'){prepareTree();return;}
      if(f.id==='plan-task-form'){saveTask(f);return;}
      if(f.id==='plan-distribution-form'){
        const entries=[...f.querySelectorAll('[data-distribution-task]:not(:disabled)')].map(el=>({taskId:el.dataset.distributionTask,personId:el.dataset.distributionPerson,value:el.value}));
        const value=String(data.get('target')||'').trim(),target=value===''?null:{personId:f.dataset.person,group:f.dataset.group,value};
        try{edit(p=>D.distribute(p,f.dataset.month,entries,target));redraw();}catch(err){f.querySelector('.wp-distribution-error').textContent=err.message;}return;
      }
      if(f.id==='wp-node-form'){
        const values={name:String(data.get('name')||''),work:String(data.get('work')||''),output:String(data.get('output')||'')};let node;
        if(f.dataset.id){node=B.find(p.tree,f.dataset.id).node;if(node.type==='task'){if(!values.work.trim())throw Error('请填写具体工作内容');node.work=values.work.trim();node.output=values.output.trim();}else{if(!values.name.trim())throw Error('请填写名称');node.name=values.name.trim();}}
        else node=B.addNode(p,f.dataset.parent||null,values);
        if(node.type==='module')activeModule=node.id;else if(node.type==='category')expanded.add(node.id);else expanded.add(B.find(p.tree,node.id).parent.id);
        save('已保存，可以继续选择工作');dialog.close();redraw();return;
      }
      if(f.id==='wp-employee-form'){
        const name=String(data.get('name')||'').trim(),id=f.dataset.id||E.uid();if(!name)throw Error('请填写员工姓名');
        if(store.employees.some(x=>!x.archived&&x.name===name&&x.id!==id))throw Error('已有同名员工，请选择已有员工或使用能区分的姓名');
        const capacity=String(data.get('capacity')||'').trim(),person={id,name,groupIds:data.getAll('groupIds'),role:String(data.get('role')||'').trim(),capacity:capacity===''?null:E.days(capacity)};
        const i=store.employees.findIndex(x=>x.id===id);if(i>=0)store.employees[i]=person;else store.employees.push(person);
        p.selectedEmployeeIds=p.selectedEmployeeIds.filter(x=>x!==id);if(data.has('participate'))p.selectedEmployeeIds.push(id);
        const released=updateProjectPeople();save(released?`员工已保存，原投入 ${released} 人天转为待分配`:'员工已保存');dialog.close();redraw();return;
      }
      if(f.id==='wp-group-form'){
        const name=String(data.get('name')||'').trim();if(!name)throw Error('请填写小组名称');if(store.groups.some(g=>g.name===name&&g.id!==f.dataset.id))throw Error('已有同名小组');
        const group=store.groups.find(g=>g.id===f.dataset.id);if(group)group.name=name;else store.groups.push({id:E.uid(),name});updateProjectPeople();save('小组已保存');dialog.close();redraw();
      }
    }catch(err){toast(err.message);}
  });
  function memberTask(p,editor){
    if(editor.dataset.memberMode==='dialog')return {id:editor.dataset.memberEditor,work:document.querySelector('#plan-task-form [name=work]')?.value||'任务',participantIds:[...editor.querySelectorAll('[data-member-select]')].map(el=>el.value).filter(Boolean)};
    return p.tasks.find(t=>t.id===editor.dataset.memberEditor)||p.taskCache[editor.dataset.memberEditor]||{id:editor.dataset.memberEditor,owner:B.suggest(p,B.find(p.tree,editor.dataset.memberEditor).parent,B.find(p.tree,editor.dataset.memberEditor).node)};
  }
  function saveMembers(editor,ids,source){
    const p=current(),t=memberTask(p,editor),before=E.participantIds(t,p.people);
    const removed=before.filter(id=>!ids.includes(id)),released=E.sum(Object.values(t.allocations||{}).flatMap(a=>removed.map(id=>a[id]||0)));
    if(released&&!window.confirm(`移除或替换成员后，其 ${released} 人天将转为待分配，总人天保持不变。是否继续？`)){
      if(source?.tagName==='SELECT')source.value=source.dataset.memberOriginal||'';return;
    }
    edit(p=>{
      if(p.tasks.some(t=>t.id===editor.dataset.memberEditor))D.participants(p,editor.dataset.memberEditor,ids,true);
      else{const next=E.newTask({...p.taskCache[editor.dataset.memberEditor],id:editor.dataset.memberEditor});D.changeParticipants(p,next,ids,true);p.taskCache[next.id]=next;}
    });redraw();
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    try{
      const p=current();
      if(pendingEditor()&&!['undo-edit','retry-save'].includes(b.dataset.planAction)){pendingEditor().focus();throw Error('请先修正或按Esc取消未保存的单元格');}
      if((b.dataset.step||['download','show-export','generate','back-tree','new','version','estimate-empty','estimate-system'].includes(b.dataset.planAction)))checkPending();
      if(b.dataset.effortTask){
        const t=p.tasks.find(t=>t.id===b.dataset.effortTask);if(!t)throw Error('任务已不存在');
        showDialog(dialogHeader('估算依据 · '+t.work,'标准需求保留AI原值，人工采用值另行记录','calendar')+'<div class="simple-form">'+AIUI.detail(p,t)+`<form id="plan-calibration-reason"><label class="form-field">人工调整原因（用于估算校准）<textarea name="reason" maxlength="1000" required>${esc(t.estimate?.calibration?.reason||'')}</textarea></label><button class="button" type="submit">保存原因</button></form></div>`);
        document.getElementById('plan-calibration-reason').addEventListener('submit',ev=>{ev.preventDefault();ev.stopPropagation();try{const reason=ev.target.elements.reason.value.trim();if(!reason)throw Error('请填写调整原因');edit(d=>{AI.calibrate(d,t.id,reason);});dialog.close();redraw();}catch(err){toast(err.message);}});return;
      }
      const memberEditor=b.closest('[data-member-editor]');
      if(memberEditor&&(b.hasAttribute('data-member-add')||b.hasAttribute('data-member-remove'))){
        const selects=[...memberEditor.querySelectorAll('[data-member-select]')],ids=selects.map(el=>el.value).filter(Boolean);
        if(b.hasAttribute('data-member-add')){
          const t={...memberTask(p,memberEditor),participantIds:ids};
          memberEditor.outerHTML=P.members(p,t,memberEditor.dataset.memberMode,selects.length+1);
        }else{
          const remaining=selects.filter((_,i)=>i!==Number(b.dataset.memberRemove)).map(el=>el.value).filter(Boolean);
          if(memberEditor.dataset.memberMode==='dialog')memberEditor.outerHTML=P.members(p,{id:memberEditor.dataset.memberEditor,participantIds:remaining,work:'任务'},'dialog');
          else saveMembers(memberEditor,remaining,b);
        }return;
      }
      if(b.dataset.cardAdopt||b.dataset.cardIgnore){
        readBasics();const c=(p.materialCards||[]).find(c=>c.id===(b.dataset.cardAdopt||b.dataset.cardIgnore));if(!c)throw Error('此信息已不存在');
        if(b.dataset.cardAdopt){const old=p[c.field]||'';p[c.field]=old.includes(c.value)?old:[old,c.value].filter(Boolean).join('\n');c.status='已采用';c.adoptedAt=new Date().toISOString();}else c.status='已忽略';save('资料信息已更新');redraw();return;
      }
      if(b.dataset.materialDownload||b.dataset.materialRetry){
        const id=b.dataset.materialDownload||b.dataset.materialRetry,file=await WorkPlanMaterials.retrieve(p.id,id);if(!file)throw Error('本浏览器未找到原件，请重新拖入');
        if(b.dataset.materialDownload)downloadBlob(file,file.name,file.type);else{const old=p.materials.find(f=>f.id===id),next=await WorkPlanMaterials.inspect(file,old.path,window.JSZip);next.id=id;next.rawSaved=true;next.cards.forEach(c=>c.fileId=id);p.materialCards=(p.materialCards||[]).filter(c=>c.fileId!==id||c.status==='已采用');p.materialCards.push(...next.cards);delete next.cards;Object.assign(old,next);save();redraw();}return;
      }
      if(b.dataset.materialRemove){
        if(materialBusy.has(p.id))throw Error('请等待资料接收完成再移除');readBasics();const id=b.dataset.materialRemove,f=p.materials.find(f=>f.id===id);if(f?.rawSaved)await WorkPlanMaterials.remove(p.id,id);
        p.materials=p.materials.filter(f=>f.id!==id);p.materialCards=(p.materialCards||[]).filter(c=>{if(c.fileId!==id)return true;if(c.status==='已采用'){c.status='来源已移除，需复核';return true;}return false;});save('原件已移除，已采用的信息保留并标记复核');redraw();return;
      }
      if(b.hasAttribute('data-close-distribution')){detailView=null;b.closest('.wp-distribution-host').innerHTML='';return;}
      if(b.dataset.distributeMonth){
        checkPending();const host=b.closest('.wp-attachment-preview').querySelector('.wp-distribution-host');detailView={projectId:p.id,name:b.closest('.wp-attachment-preview').dataset.previewName,month:b.dataset.distributeMonth,person:b.dataset.distributePerson,group:b.dataset.distributeGroup};host.innerHTML=P.distribution(p,detailView.month,detailView.person,detailView.group);host.querySelector('input')?.focus();return;
      }
      if(b.dataset.step){if(b.dataset.step==='basic'){readBasics();step='basic';save();redraw();}else if(b.dataset.step==='tree'){prepareTree();}else makeReview();return;}
      if(b.hasAttribute('data-employee-new')){employeeEditor();return;}
      if(b.dataset.employeeEdit){employeeEditor(b.dataset.employeeEdit);return;}
      if(b.dataset.employeeRemove){readBasics();p.selectedEmployeeIds=p.selectedEmployeeIds.filter(id=>id!==b.dataset.employeeRemove);const released=updateProjectPeople();save(released?'已移除，其原投入已转为待分配':undefined);redraw();return;}
      if(b.hasAttribute('data-group-manage')){groupEditor();return;}
      if(b.dataset.groupEdit){groupEditor(b.dataset.groupEdit);return;}
      if(b.dataset.employeeDelete||b.dataset.groupDelete){
        if(!b.dataset.confirm){b.dataset.confirm='yes';b.textContent='再次点击确认移除';return;}
        if(b.dataset.employeeDelete){store.employees.find(x=>x.id===b.dataset.employeeDelete).archived=true;p.selectedEmployeeIds=p.selectedEmployeeIds.filter(id=>id!==b.dataset.employeeDelete);}
        else{store.groups=store.groups.filter(g=>g.id!==b.dataset.groupDelete);store.employees.forEach(x=>x.groupIds=x.groupIds.filter(id=>id!==b.dataset.groupDelete));}
        updateProjectPeople();save('已移除，其他项目的历史记录保留');dialog.close();redraw();return;
      }
      if(b.dataset.moduleOpen){activeModule=b.dataset.moduleOpen;search='';redraw();return;}
      if(b.dataset.categoryOpen){expanded.has(b.dataset.categoryOpen)?expanded.delete(b.dataset.categoryOpen):expanded.add(b.dataset.categoryOpen);redraw();return;}
      if(b.hasAttribute('data-expand-all')){p.tree.find(m=>m.id===activeModule)?.children.forEach(c=>expanded.add(c.id));redraw();return;}
      if(b.hasAttribute('data-collapse-all')){expanded.clear();redraw();return;}
      if(b.dataset.nodeNew){nodeEditor(b.dataset.nodeNew,b.dataset.parent||null);return;}
      if(b.dataset.nodeEdit){nodeEditor(null,null,b.dataset.nodeEdit);return;}
      if(b.dataset.nodeMove){B.moveSibling(p,b.dataset.nodeMove,Number(b.dataset.offset));save();redraw();return;}
      if(b.dataset.nodeDelete){
        if(!b.dataset.confirm){b.dataset.confirm='yes';b.textContent='再次点击删除（可撤销）';return;}
        undo={projectId:p.id,tree:B.clone(p.tree),tasks:B.clone(p.tasks),taskCache:B.clone(p.taskCache),renumbered:p.renumbered};B.removeNode(p,b.dataset.nodeDelete);save();dialog.close();redraw();return;
      }
      if(b.dataset.planTask){editTask(b.dataset.planTask);return;}
      if(b.dataset.planDelete){if(!b.dataset.confirm){b.dataset.confirm='yes';b.textContent='再次点击确认删除';return;}if(p.tasks.some(t=>t.dependsOn?.includes(b.dataset.planDelete)))throw Error('其他任务使用了此前置任务，请先解除依赖');undo={projectId:p.id,tree:B.clone(p.tree),tasks:B.clone(p.tasks),taskCache:B.clone(p.taskCache),renumbered:p.renumbered};B.removeNode(p,b.dataset.planDelete);save();dialog.close();redraw();return;}
      const action=b.dataset.planAction;
      if(action==='retain-framework'){if(adaptationJobs.has(p.id))throw Error('请等待生成结束后再选择保留原任务');edit(p=>{p.adaptation.retainedForScale=p.taskScale;p.adaptation.fingerprint=A.fingerprint(p);});adaptationNotices.set(p.id,'已保留当前任务，请按实际需要手动增删；不视为按新规模重新生成');redraw();}
      if(action==='adapt-tree'){commitBasic();if(!p.adaptation&&!p.tasks.length){A.apply(p,A.local(p));save();}redraw();requestAdaptation(p,true);}
      if(action==='adapt-fresh'){
        if(adaptationJobs.has(p.id))throw Error('请等待当前任务树生成结束');
        const copy=B.clone(p);copy.id=E.uid();copy.basedOn=p.id;copy.name=(p.name||'未命名计划')+'（适配副本）';
        copy.tasks=[];copy.taskCache={};copy.modules=[];copy.tree=B.catalog();
        for(const key of ['source','adaptation','staffing','preStartMode','scheduleReview','effortReview'])delete copy[key];
        A.apply(copy,A.local(copy));plans.unshift(copy);selected=copy.id;step='tree';
        save('已创建独立适配副本，原计划保留');redraw();requestAdaptation(copy);return;
      }
      if(action==='retry-save'){save('已重试保存');redraw();}
      if(action==='undo-edit'){const history=editHistory.get(p.id)||[],record=history.at(-1);if(record){if(record.keys.some(k=>JSON.stringify(p[k])!==JSON.stringify(record.after[k])))throw Error('该编辑后已有其他修改，不能直接覆盖，请在当前表格调整');history.pop();record.keys.forEach(k=>{if(record.before[k]===undefined)delete p[k];else p[k]=B.clone(record.before[k]);});save('已撤销上次编辑');redraw();}else toast('当前项目没有可撤销的表格编辑');}
      if(action==='restore-recommended'){
        if(!b.dataset.confirm){b.dataset.confirm='yes';b.textContent='再次点击恢复推荐（可撤销）';return;}
        edit(p=>A.restoreRecommended(p));redraw();
      }
      if(action==='reschedule'){
        checkPending();
        const rows=B.selected(p);if(rows.length!==p.tasks.length||rows.some(r=>!p.tasks.some(t=>t.id===r.task.id&&t.work===r.task.work&&t.output===r.task.output)))throw Error('任务树内容已调整，请先生成月历同步后再重排');
        WorkPlanSchedulingUI.open({current,showDialog,onApply:copy=>{
          if(copy.adaptation)copy.adaptation.fingerprint=A.fingerprint(copy);
          plans.unshift(copy);selected=copy.id;step='review';filter='all';query='';monthFilter='all';detailView=null;
          save('已另存重排副本，原计划保留');dialog.close();redraw();
        }});return;
      }
      if(action==='back-tree'){step='tree';redraw();}
      if(action==='save-draft'){readBasics();save('草稿已保存，可稍后继续');}
      if(action==='new'){readBasics();const fresh=B.createProject();plans.unshift(fresh);selected=fresh.id;step='basic';save();redraw();}
      if(action==='reference'){const example=B.migrate(E.referencePlan(WorkPlanReference),store);plans.unshift(example);selected=example.id;step='tree';activeModule='module-B';save();redraw();}
      if(action==='version'){readBasics();const copy=B.clone(p);copy.id=E.uid();copy.name=(p.name||'未命名计划')+'（修订版）';copy.basedOn=p.id;plans.unshift(copy);selected=copy.id;save('修订版已另存，原计划保留');redraw();}
      if(action==='backup'){readBasics();downloadBlob(JSON.stringify({format:'work-schedule-plan',version:2,plan:p,registry:store},null,2),(p.name||'未命名计划')+'-工作计划备份.json','application/json;charset=utf-8');}
      if(action==='import')document.getElementById('plan-import-file').click();
      if(action==='edit-active-module')nodeEditor(null,null,activeModule);
      if(action==='add-direction')nodeEditor('category',activeModule);
      if(action==='back-basic'){step='basic';redraw();}
      if(action==='estimate-empty'||action==='estimate-system'){AIUI.open({current,showDialog,onApply:applyEffort,onStatus:()=>{},mode:action==='estimate-empty'?'empty':'system'});return;}
      if(action==='generate')makeReview();
      if(action==='show-export'){E.validate(p);step='export';redraw();}
      if(action==='add-task'){step='tree';redraw();toast('在相应工作方向下点击“新增任务”，也可以新增大类和方向');}
      if(action==='undo'&&undo&&undo.projectId===p.id){const {projectId:ignored,...snapshot}=undo;Object.assign(p,snapshot);undo=null;save('已恢复删除内容');redraw();}
      if(action==='download'){
        if(!p.tasks.length)throw Error('请先选择任务并生成月历');b.disabled=true;b.textContent='正在生成 Excel…';
        try{downloadBlob(await X.buffer(p,p.options||[]),(p.name||'项目')+'-原计划月历.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');toast(`已导出 ${1+(p.options||[]).length} 张工作表`);}finally{b.disabled=false;b.innerHTML=icon('download')+'导出 Excel 工作计划';}
      }
    }catch(err){toast(err.message);}
  });
  document.addEventListener('change',async e=>{
    const el=e.target,p=current();
    const bad=pendingEditor();if(bad&&bad!==el){if(el.type==='checkbox')el.checked=!el.checked;else if(el.dataset.editOriginal!==undefined)el.value=el.dataset.editOriginal;toast('请先完成标记中的单元格编辑');bad.focus();return;}
    try{
      if(el.hasAttribute('data-member-select')){
        const editor=el.closest('[data-member-editor]'),selects=[...editor.querySelectorAll('[data-member-select]')],ids=selects.map(x=>x.value).filter(Boolean);
        if(new Set(ids).size!==ids.length){el.value=el.dataset.memberOriginal||'';throw Error('同一任务不能重复选择成员');}
        if(editor.dataset.memberMode==='dialog'){
          for(const select of selects){select.dataset.memberOriginal=select.value;for(const option of select.options)option.disabled=!!option.value&&option.value!==select.value&&ids.includes(option.value);}
        }else saveMembers(editor,ids,el);return;
      }
      if(el.hasAttribute('data-material-input')){readBasics();await receiveMaterials([...el.files].map(file=>({file,path:file.webkitRelativePath||file.name})),p.id);return;}
      if(el.name==='taskScale'){readBasics();delete p.taskScaleLegacy;save();}
      if(el.dataset.employeeCheck){readBasics();p.selectedEmployeeIds=p.selectedEmployeeIds.filter(id=>id!==el.dataset.employeeCheck);if(el.checked)p.selectedEmployeeIds.push(el.dataset.employeeCheck);const released=updateProjectPeople();save(released?'原人员投入已转为待分配':undefined);redraw();}
      if(el.dataset.nodeCheck){B.toggle(p.tree,el.dataset.nodeCheck,el.checked);save();redraw();}
      if(el.id==='plan-select'){readBasics();selected=el.value;step='basic';save();redraw();}
      if(el.id==='plan-month-filter'){monthFilter=el.value;detailView=null;redraw();}
      if(el.id==='plan-module-filter'){filter=el.value;redraw();}
      if(el.id==='plan-status-filter'){statusFilter=el.value;redraw();}
      if(el.id==='plan-task-module')document.getElementById('plan-categories').innerHTML=E.moduleDefinitions(p).find(g=>g.id===el.value).children.map(c=>`<option value="${esc(c.name)}">`).join('');
      if(el.dataset.planMonth){edit(p=>D.total(p,el.dataset.planRow,el.dataset.planMonth,el.value));redraw();}
      if(el.dataset.monthNoteTask){edit(p=>el.dataset.monthPlanField?D.monthPlanField(p,el.dataset.monthNoteTask,el.dataset.monthNoteMonth,el.dataset.monthPlanField,el.value):D.monthNote(p,el.dataset.monthNoteTask,el.dataset.monthNoteMonth,el.value));redraw();}
      if(el.dataset.inlineTask){edit(p=>D.update(p,el.dataset.inlineTask,el.dataset.inlineField,el.value));redraw();}
      if(el.dataset.allocationTask){edit(p=>D.allocation(p,el.dataset.allocationTask,el.dataset.allocationMonth,el.dataset.allocationPerson,el.value));redraw();}
      if(el.dataset.capacityPerson){edit(p=>D.capacity(p,el.dataset.capacityPerson,el.dataset.capacityMonth,el.value));redraw();}
      if(el.hasAttribute('data-plan-standard')){edit(p=>D.standard(p,el.value));redraw();}
      if(el.dataset.planExportOption){p.options=X.options.filter(n=>n===el.dataset.planExportOption?el.checked:(p.options||[]).includes(n));save();redraw();}
      if(el.id==='plan-import-file'&&el.files[0]){
        if(el.files[0].size>10*1024*1024)throw Error('备份文件不能超过10 MB');const data=JSON.parse(await el.files[0].text());if(data.format!=='work-schedule-plan'||![1,2].includes(data.version))throw Error('请选择本应用导出的工作计划备份');
        const restored=B.migrate(data.plan,store);B.validateTree(restored.tree);
        if(data.registry){const mapping=B.mergeRegistry(store,data.registry);restored.people.forEach(person=>{person.employeeId=mapping.get(person.employeeId)||person.employeeId;});}
        restored.selectedEmployeeIds=restored.people.map(person=>{let employee=store.employees.find(e=>e.id===person.employeeId||e.name===person.name);if(!employee){employee={id:E.uid(),name:person.name,role:person.role,capacity:person.capacity,groupIds:[]};store.employees.push(employee);}person.employeeId=employee.id;return employee.id;});
        const importedCurrent=restored.adaptation?.fingerprint===A.fingerprint(restored);
        restored.id=E.uid();restored.name+='（导入）';if(importedCurrent)restored.adaptation.fingerprint=A.fingerprint(restored);restored.options=(restored.options||[]).filter(n=>X.options.includes(n));plans.unshift(restored);selected=restored.id;step='basic';save('备份已作为新计划导入');redraw();
      }
    }catch(err){toast(err.message);if(el.matches('[data-inline-task],[data-allocation-task],[data-capacity-person],[data-plan-month],[data-plan-standard],[data-month-note-task]')){el.classList.add('wp-invalid');el.setAttribute('aria-invalid','true');el.title=err.message;let note=el.parentElement.querySelector('.wp-cell-error');if(!note){note=document.createElement('small');note.className='wp-cell-error';note.setAttribute('role','alert');el.parentElement.append(note);}note.textContent=err.message;}}

  });
  document.addEventListener('focusin',e=>{if(e.target.matches('[data-inline-task],[data-allocation-task],[data-capacity-person],[data-plan-month],[data-plan-standard],[data-month-note-task]'))e.target.dataset.editOriginal=e.target.value;});
  document.addEventListener('keydown',e=>{
    const el=e.target;if(!el.matches('[data-inline-task],[data-allocation-task],[data-capacity-person],[data-plan-month],[data-plan-standard],[data-month-note-task]'))return;
    if(e.key==='Escape'){e.preventDefault();el.value=el.dataset.editOriginal??el.value;el.classList.remove('wp-invalid','wp-inline-dirty');el.removeAttribute('aria-invalid');el.parentElement.querySelector('.wp-cell-error')?.remove();el.blur();}
    if(e.key==='Enter'&&(el.tagName!=='TEXTAREA'||e.ctrlKey)){e.preventDefault();el.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  let inputTimer;
  document.addEventListener('input',e=>{
    if(e.target.matches('[data-inline-task],[data-allocation-task],[data-capacity-person],[data-plan-month],[data-plan-standard],[data-month-note-task]'))e.target.classList.add('wp-inline-dirty');
    if(e.target.closest('#plan-setup-form')){readBasics();clearTimeout(inputTimer);inputTimer=setTimeout(()=>save(),300);}
    const type={'wp-employee-search':'employee','wp-tree-search':'tree','plan-search':'calendar'}[e.target.id];if(!type)return;const value=e.target.value;
    if(type==='employee')employeeSearch=value;else if(type==='tree')search=value;else query=value;
    clearTimeout(inputTimer);inputTimer=setTimeout(()=>{const id=e.target.id;redraw();const input=document.getElementById(id);input?.focus();input?.setSelectionRange(value.length,value.length);},200);
  });
  document.addEventListener('dragover',e=>{if(e.target.closest('[data-material-drop]')){e.preventDefault();e.target.closest('[data-material-drop]').classList.add('wp-material-hover');}});
  document.addEventListener('dragleave',e=>e.target.closest('[data-material-drop]')?.classList.remove('wp-material-hover'));
  document.addEventListener('drop',async e=>{const drop=e.target.closest('[data-material-drop]');if(!drop)return;e.preventDefault();drop.classList.remove('wp-material-hover');readBasics();const id=current().id;try{await receiveMaterials(await WorkPlanMaterials.filesFromDrop(e.dataTransfer),id);}catch(err){toast(err.message);}});
  document.addEventListener('dragstart',e=>{const row=e.target.closest('[data-module-id]');if(!row)return;dragged=row.dataset.moduleId;e.dataTransfer?.setData('text/plain',dragged);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';row.classList.add('dragging');});
  document.addEventListener('dragover',e=>{const row=e.target.closest('[data-module-id]');if(row&&dragged){e.preventDefault();row.classList.add('drop-target');}});
  document.addEventListener('dragleave',e=>e.target.closest('[data-module-id]')?.classList.remove('drop-target'));
  document.addEventListener('drop',e=>{const row=e.target.closest('[data-module-id]');if(!row||!dragged)return;e.preventDefault();try{const box=row.getBoundingClientRect();B.reorder(current(),dragged,row.dataset.moduleId,e.clientY>box.top+box.height/2);save();redraw();}catch(err){toast(err.message);}dragged='';});
  document.addEventListener('dragend',()=>{dragged='';document.querySelectorAll('.dragging,.drop-target').forEach(el=>el.classList.remove('dragging','drop-target'));});
  window.addEventListener('beforeunload',e=>{if(state.view==='plan'){readBasics();save();if(pendingEditor()||materialBusy.has(current().id)){e.preventDefault();e.returnValue='';}}});
  const enhance=()=>document.querySelectorAll('[data-node-check]').forEach(input=>input.indeterminate=input.dataset.mixed==='true');
  window.workbenchPlan={view,open,enhance};
})();
