/* 旧计划在副本重排：预览不写原稿，只有明确选择后另存。 */
(function(root){
  'use strict';
  const S=root.WorkPlanScheduling,E=root.WorkPlanEngine;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function open({current,showDialog,onApply}){
    const original=current();if(!original.tasks.length)throw Error('请先选择任务并生成月历');let proposal=null;
    showDialog(`<header class="dialog-header"><div><h2 id="dialog-title">调整月度安排 · 保留原版</h2><p>先预览差异，再将选中的变更另存为副本。</p></div><button type="button" data-close aria-label="关闭窗口">×</button></header><form id="plan-schedule-review"><div class="simple-form"><div class="form-grid"><label class="form-field">目标开始月份<input type="month" name="scheduleStart" value="${esc(original.start)}" required></label><label class="form-field">目标结束月份<input type="month" name="scheduleEnd" value="${esc(original.end)}" required></label></div><label class="wp-inline-check"><input type="checkbox" name="includeUnknown">我确认需要重排来源未知的旧安排（仍保护手填0、人工修改、锁定和已完成项）</label><p class="form-help">保持既有人天和各人总投入，不调用AI重新估算。不确定是否人工填写的旧稿默认保留；容量不足、依赖或期限冲突会提示。</p><button type="submit" class="button secondary">生成重排预览</button><p data-schedule-error role="alert" class="wp-cell-error"></p><div data-schedule-result></div></div><div class="dialog-footer"><span>原项目始终保留，可从“我的计划”切回。</span><button type="button" class="button" data-apply-schedule disabled>另存重排副本并打开</button></div></form>`);
    const form=document.getElementById('plan-schedule-review'),result=form.querySelector('[data-schedule-result]'),error=form.querySelector('[data-schedule-error]'),apply=form.querySelector('[data-apply-schedule]');
    function months(task){return Object.entries(task.monthlyPlan||{}).map(([m,row])=>`<li><b>${esc(m)}</b> ${esc(row.activity)}<br>阶段成果：${esc(row.output)}<br>${E.effort(task,m)??'待估算'} 人天</li>`).join('');}
    form.addEventListener('submit',e=>{e.preventDefault();e.stopPropagation();try{
      if(current().id!==original.id)throw Error('当前项目已切换，请关闭后重新打开');
      proposal=S.propose(current(),{start:form.elements.scheduleStart.value,end:form.elements.scheduleEnd.value,includeUnknown:form.elements.includeUnknown.checked});
      error.textContent='';result.innerHTML=`<div class="wp-schedule-summary"><strong>${proposal.changes.length}项可调整 · ${proposal.protected.length}项保留</strong><p>勾选要应用的变更，最终会按所选内容重新核对冲突。</p>${(proposal.warnings||[]).map(s=>`<p class="wp-cell-error">${esc(s)}</p>`).join('')}</div>${proposal.changes.map(change=>`<article class="wp-schedule-change"><label><input type="checkbox" data-schedule-task="${esc(change.taskId)}" checked><strong>${esc(change.after.work)}</strong></label><p>${esc(change.before.start)} 至 ${esc(change.before.end)} → <b>${esc(change.after.start)} 至 ${esc(change.after.end)}</b> · 总人天 ${E.total(change.before,E.months(change.before.start,change.before.end))??'待估算'} → ${E.total(change.after,E.months(change.after.start,change.after.end))??'待估算'}</p><p>${esc(change.reason)}</p>${change.warnings.map(w=>`<p class="wp-cell-error">${esc(w)}</p>`).join('')}<details><summary>逐月活动与阶段成果</summary><ul>${months(change.after)}</ul></details></article>`).join('')}${proposal.protected.length?`<details class="wp-schedule-protected"><summary>查看 ${proposal.protected.length} 项保留原因</summary><ul>${proposal.protected.map(row=>`<li>${esc(original.tasks.find(t=>t.id===row.taskId)?.work||row.taskId)}：${esc(row.reason)}</li>`).join('')}</ul></details>`:''}`;
      apply.disabled=!proposal.changes.length;
    }catch(err){proposal=null;apply.disabled=true;error.textContent=err.message;}});
    form.addEventListener('input',e=>{if(e.target.name){proposal=null;apply.disabled=true;result.innerHTML='';}});
    apply.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();try{
      if(!proposal)throw Error('请先生成重排预览');if(current().id!==original.id)throw Error('当前项目已切换');
      const ids=[...form.querySelectorAll('[data-schedule-task]:checked')].map(el=>el.dataset.scheduleTask);
      if(!ids.length)throw Error('请至少选择一项要调整的任务');
      onApply(S.applyCopy(current(),proposal,ids));
    }catch(err){error.textContent=err.message;}});
  }
  root.WorkPlanSchedulingUI={open};
})(window);
