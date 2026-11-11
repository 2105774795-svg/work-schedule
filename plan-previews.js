/* 同一份导出规格生成网页附属表，列与数字不另维护一套。 */
(function(root){
  'use strict';
  const E=root.WorkPlanEngine, X=root.WorkPlanExport;
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function field(plan,t,key){
    const attr=`data-inline-task="${escape(t.id)}" data-inline-field="${key}"`,label=escape(t.work+' '+({work:'工作内容',output:'工作成果',owner:'负责人',partner:'配合人',status:'推进情况',difficulty:'推进难题',notes:'备注'}[key]||key));
    if(key==='owner')return members(plan,t);
    if(key==='status')return `<select ${attr} aria-label="${label}">${E.statuses.map(v=>`<option value="${escape(v)}" ${t[key]===v?'selected':''}>${escape(v)}</option>`).join('')}</select>`;
    return `<textarea ${attr} rows="2" maxlength="20000" aria-label="${label}" ${key==='work'?'required':''}>${escape(t[key])}</textarea>`;
  }
  function dates(t){return `<div class="wp-inline-dates">${['start','end'].map(k=>`<label><small>${k==='start'?'开始月份':'结束月份'}</small><input type="month" value="${escape(t[k])}" data-inline-task="${escape(t.id)}" data-inline-field="${k}" aria-label="${escape(t.work)} ${k==='start'?'开始':'结束'}月份"></label>`).join('')}<label><small>最迟完成月份（选填）</small><input type="month" value="${escape((t.deadline||'').slice(0,7))}" data-inline-task="${escape(t.id)}" data-inline-field="deadline" aria-label="${escape(t.work)} 最迟完成月份"></label><small class="wp-schedule-source">${t.locked?'已锁定':['schedule','effort','monthNotes'].some(k=>t.editSources?.[k]==='manual')?'人工修改，重排保护':t.scheduleMeta?.source==='system'?'系统月度建议':'旧稿来源未知，重排前确认'}</small></div>`;}
  const number=(value,attrs,label)=>`<input type="number" min="0" step="0.25" value="${escape(value)}" ${attrs} aria-label="${escape(label)}">`;
  function choices(plan){return `<div class="wp-preview-choices"><h3>需要哪些附属工作表？</h3><p>勾选即在下方预览和编辑，取消不会删除已保存的修改。原计划月历始终导出。</p>${['月度任务明细','月度人力汇总','人员月度负荷','说明及人员'].map(n=>`<label><input type="checkbox" data-plan-export-option="${n}" ${(plan.options||[]).includes(n)?'checked':''}>${n}${n==='说明及人员'?'<small>仅导出，无需预览</small>':''}</label>`).join('')}<span id="plan-export-count">将导出 ${1+(plan.options||[]).length} 张工作表 · ${plan.tasks.length} 项任务</span></div>`;}
  function render(plan){
    const specs=X.buildSpec(plan,(plan.options||[]).filter(n=>n!=='说明及人员')).slice(1),months=E.months(plan.start,plan.end);
    // buildSpec按月遍历任务，和此处的行到任务映射保持相同顺序。
    const detail=months.flatMap(m=>plan.tasks.filter(t=>(t.start<=m&&t.end>=m&&t.status!=='已完成')||E.effort(t,m)!==null).map(t=>({t,m})));
    const loads=E.loads(plan),groups=[...new Set(plan.people.map(p=>p.group))];
    return specs.map(spec=>`<section class="panel wp-attachment-preview" data-preview-name="${spec.name}"><header><h2>${spec.name}<small>可直接编辑输入项 · 汇总自动计算</small></h2><p>${escape(spec.note)}</p>${spec.name==='月度人力汇总'?`<label class="wp-standard-label">月标准工日 ${number(plan.standardDays??20,'data-plan-standard','月标准工日')} 天/人·月 <small>用于需求人数和FTE；个人可用时间在负荷表调整</small></label>`:''}</header><div class="plan-calendar-scroll"><table class="plan-grid wp-preview-grid"><thead><tr>${spec.header.map(n=>`<th>${escape(n)}</th>`).join('')}</tr></thead><tbody>${spec.rows.map((row,i)=>`<tr>${row.map((v,j)=>{
      let content=escape(v??'—');
      if(spec.name==='月度任务明细'){
        const {t,m}=detail[i],fields={5:'work',6:'output',7:'owner',8:'partner',9:'status',10:'difficulty',11:'notes'};
        if(j===11)content=`<label>当月活动<textarea data-month-note-task="${escape(t.id)}" data-month-note-month="${m}" data-month-plan-field="activity" aria-label="${escape(t.work)} ${m} 当月安排">${escape(t.monthlyPlan?.[m]?.activity??t.monthNotes?.[m]??'')}</textarea></label><label>阶段成果<textarea data-month-note-task="${escape(t.id)}" data-month-note-month="${m}" data-month-plan-field="output" aria-label="${escape(t.work)} ${m} 阶段成果">${escape(t.monthlyPlan?.[m]?.output||'')}</textarea></label><small>${t.monthlyPlan?.[m]?.basis?'逐月安排建议；人天口径沿用原初稿':'旧稿或人工安排，按实际核对'}</small>${field(plan,t,'notes')}`;else if(fields[j])content=field(plan,t,fields[j]);else if(j===4)content=dates(t);
        else if(j>=12&&j<12+plan.people.length)content=number(t.allocations?.[m]?.[plan.people[j-12].id],`data-allocation-task="${escape(t.id)}" data-allocation-month="${m}" data-allocation-person="${escape(plan.people[j-12].id)}"`,`${t.work} ${m} ${plan.people[j-12].name} 人天`);
        else if(j===row.length-2)content=number(t.unassigned?.[m],`data-allocation-task="${escape(t.id)}" data-allocation-month="${m}" data-allocation-person="unassigned"`,`${t.work} ${m} 待分配人天`);
      }else if(spec.name==='人员月度负荷'){
        const r=loads[i];if(j===6)content=number(r.capacity,`data-capacity-person="${escape(r.person.id)}" data-capacity-month="${r.month}"`,`${r.person.name} ${r.month} 可用人天`);
        if(j===3)content=`<button type="button" class="wp-distribute-link" data-distribute-month="${r.month}" data-distribute-person="${escape(r.person.id)}">${v} <small>查看／改明细</small></button>`;
        if(j===8&&r.capacity!==null&&r.days>r.capacity)content=`<strong class="wp-overload">${content}</strong>`;
        if(j===7&&typeof v==='number')content=(v*100).toFixed(1)+'%';
        if(j===4&&typeof v==='number')content=v.toFixed(2);
      }else if(spec.name==='月度人力汇总'&&j>0&&j<=groups.length*3&&j%3===0){
        content=`<button type="button" class="wp-distribute-link" data-distribute-month="${escape(row[0])}" data-distribute-group="${escape(groups[j/3-1])}">${v} <small>查看／改明细</small></button>`;
      }
      return `<td>${content}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div><div class="wp-distribution-host"></div></section>`).join('');
  }
  function distribution(plan,month,personId,group){
    const people=plan.people.filter(p=>personId?p.id===personId:p.group===group),tasks=plan.tasks.filter(t=>t.start<=month&&t.end>=month),total=E.sum(tasks.flatMap(t=>people.map(p=>t.allocations?.[month]?.[p.id]||0)));
    return `<div class="wp-simple-detail"><h3>${escape(personId?people[0]?.name:group)} · ${month} 人员明细</h3><p>直接修改下面的人天，离开单元格即保存；合计自动更新，无需另填目标或审批。</p><div class="plan-calendar-scroll"><table class="plan-grid"><thead><tr><th>任务</th>${people.map(p=>`<th>${escape(p.name)}</th>`).join('')}</tr></thead><tbody>${tasks.map(t=>`<tr><td>${escape(t.work)}${t.locked?'（已锁定）':''}</td>${people.map(p=>`<td>${number(t.allocations?.[month]?.[p.id],`data-allocation-task="${escape(t.id)}" data-allocation-month="${month}" data-allocation-person="${escape(p.id)}" ${t.locked?'disabled':''}`,t.work+' '+p.name+' 人天')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><button type="button" class="button secondary" data-close-distribution>收起明细</button></div>`;
  }
  function members(plan,t,mode='inline',slots=3){
    const ids=E.participantIds(t,plan.people),count=Math.max(3,slots,ids.length);
    return `<div class="wp-members" data-member-editor="${escape(t.id)}" data-member-mode="${mode}">${Array.from({length:count},(_,i)=>`<div class="wp-member-row"><select data-member-select="${i}" data-member-original="${escape(ids[i]||'')}" ${mode==='dialog'&&i===0?'name="owner"':''} aria-label="${escape(t.work)} 第${i+1}位负责人" ${t.locked?'disabled':''}><option value="">${i===0?'待确认':`添加第${i+1}人`}</option>${plan.people.map(p=>`<option value="${escape(p.id)}" ${ids[i]===p.id?'selected':''} ${ids.includes(p.id)&&ids[i]!==p.id?'disabled':''}>${escape(p.name)}</option>`).join('')}</select>${ids[i]?`<button type="button" data-member-remove="${i}" aria-label="移除第${i+1}位负责人" ${t.locked?'disabled':''}>移除</button>`:''}</div>`).join('')}<button type="button" data-member-add ${t.locked||count>=plan.people.length?'disabled':''}>＋继续添加</button></div>`;
  }
  root.WorkPlanPreviews={field,dates,number,choices,render,distribution,members};
})(window);
