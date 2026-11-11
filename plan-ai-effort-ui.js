/* AI初算只在完整校验后写入；旧稿重算先预览并保留原版。 */
(function(root){
  'use strict';
  const C=root.WorkPlanAIEffort,E=root.WorkPlanEngine,B=root.WorkPlanBuilder;
  const states=new Map(),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const defaults=[['objectCount','研究对象／地块数'],['interviewCount','访谈对象数'],['rounds','沟通／修改轮次'],['materialMaturity','资料成熟度'],['reportDepth','成果深度']];
  function parameters(p){return p.effortParameters?.length?B.clone(p.effortParameters):defaults.map(([key,label])=>({key,label,value:'未明确，请列出估算假设',source:'ai'}));}
  const state=id=>states.get(id)||{};
  function modelSource(performance){
    if(performance?.inflightShared)return '已合并到正在进行的模型请求。';
    if(performance?.cacheHit||performance?.modelCalls===0)return '已复用模型建议，本次调用0次。';
    if(performance?.modelCalls>0&&performance.reusedTasks>0)return `复用 ${performance.reusedTasks} 项模型建议，其余批次调用模型 ${performance.modelCalls} 次。`;
    return performance?.modelCalls>0?'本次模型请求已返回。':'';
  }
  async function obtain(p,ids,params,force=false,onProgress=()=>{}){
    if(!/^https?:$/.test(location.protocol)||typeof root.fetch!=='function')throw Error('请从本地网站打开并连接AI初算后端；没有使用规则替代AI');
    const status=await fetch(new URL('./api/plan-ai/status',location.href),{signal:AbortSignal.timeout(5000)});
    if(!status.ok)throw Error('无法连接AI初算后端');const cfg=await status.json();
    if(!cfg.configured)throw Error('尚未配置模型服务；任务保留待初算');
    if(cfg.effortEstimation!=='effort-v1')throw Error('本地后端尚未加载AI初算接口，请更新服务后重试；原计划已保留');
    const input=C.request(p,ids,{parameters:params}),requestId='effort-'+crypto.randomUUID();let stopped=false,polling=false,timer;
    if(cfg.effortProgress===true)timer=setInterval(async()=>{if(stopped||polling)return;polling=true;try{
      const url=new URL('./api/plan-ai/estimate-progress',location.href);url.searchParams.set('id',requestId);
      const result=await fetch(url,{signal:AbortSignal.timeout(5000)});if(result.ok){const progress=await result.json();if(!stopped&&root.document?.documentElement)onProgress(progress);}
    }catch{}finally{polling=false;}},2500);
    try{
      const response=await fetch(new URL('./api/plan-ai/estimate',location.href),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input,force,requestId}),signal:AbortSignal.timeout(960000)});
      const data=await response.json();if(!response.ok)throw Error(data.error||'AI初算失败');return data.estimate;
    }finally{stopped=true;if(timer)clearInterval(timer);}
  }
  async function start({current,onApply,onStatus=()=>{},canApply=()=>true,taskIds,mode='empty'}){
    const p=B.clone(current()),id=p.id;if(state(id).busy)return;
    const eligible=C.eligible(p,{mode,taskIds});if(!eligible.taskIds.length)return;
    const stamp=C.fingerprint(p),params=parameters(p);
    states.set(id,{busy:true,message:`AI正在估算 ${eligible.taskIds.length} 项工作，完成后统一校验与分配…`});onStatus();
    try{
      const response=await obtain(p,eligible.taskIds,params,false,progress=>{
        states.set(id,{busy:true,message:`${progress.stage==='shared-start'?'正在检查共用活动；':''}已返回 ${progress.completed??0} / ${eligible.taskIds.length} 项建议，全部完成后统一校验与分配。`});onStatus();
      });
      if(current().id!==id||C.fingerprint(current())!==stamp)throw Error('项目、任务或人工数据已变化，本次旧结果未应用，请按当前内容重新初算');
      if(!canApply())throw Error('页面有尚未保存的人工输入或打开的编辑窗口，本次结果未应用；请保留输入并保存后重试');
      const proposal=C.propose(current(),response,{mode,taskIds:eligible.taskIds,parameters:params,baseRevision:stamp});
      const next=B.clone(current());C.apply(next,proposal);onApply(next,false);
      const pending=proposal.changes.filter(c=>c.after.estimate.status==='pending').length;
      states.set(id,{message:`已估算 ${proposal.changes.length-pending} 项，${pending} 项待补资料。${modelSource(response.performance)}请核对依据、容量假设与待分配。`});
    }catch(err){states.set(id,{error:err.message,message:'AI初算未完成，原数据保留。可重试或继续人工填写。'});}
    finally{if(root.document?.documentElement)onStatus();}
  }
  function detail(p,t){
    const e=t.estimate;if(e?.method!=='model')return `<p>${esc(e?.basis||'此项尚无AI初算依据，已有数据保持原来源。')}</p>`;
    const readable=value=>{let out=String(value??'').replace(/globalSharedActivities/g,'共用活动');for(const shared of e.sharedActivities||[])out=out.split(shared.id).join(shared.output||'共用活动');return out;};
    const assigned=E.sum(Object.values(t.allocations||{}).flatMap(a=>Object.values(a))),unassigned=E.sum(Object.values(t.unassigned||{}));
    return `<div class="wp-effort-totals"><span>标准需求 <b>${esc(e.total??'待估算')}</b> 人天</span><span>建议范围 ${esc(e.range?.low??'—')}—${esc(e.range?.high??'—')}</span><span>当前安排 ${E.total(t,E.months(p.start,p.end))??'待估算'} · 已分配 ${assigned} · 待分配 ${unassigned}</span></div><p>${esc(readable(e.basis))}</p><p>不确定性：${esc(e.uncertainty||'待核对')}（非统计概率） · 模型：${esc(e.model)}</p><table class="wp-effort-breakdown"><thead><tr><th>分项工作与成果</th><th>人天</th><th>依据／所需岗位</th></tr></thead><tbody>${(e.components||[]).map(c=>`<tr><td>${esc(readable(c.activity))}<br><small>${esc(c.output)}</small></td><td>${c.days}</td><td>${esc(readable(c.basis))}<br>${esc((c.roles||[]).join('、'))}</td></tr>`).join('')}${(e.sharedActivities||[]).map(s=>`<tr><td>共用分摊：${esc(s.activity)}<br><small>${esc(s.output)}</small></td><td>${s.days}</td><td>共用总量 ${s.totalDays} 人天，仅计一次。${esc(s.basis)}</td></tr>`).join('')}</tbody></table><details><summary>假设、参数与需要补充的信息</summary><ul>${(e.assumptions||[]).map(s=>`<li>${esc(s)}</li>`).join('')}${(e.parameters||[]).map(s=>`<li>${esc(s.label||s.key)}：${esc(s.value)}（${esc(({ai:'AI假设',manual:'人工确认',user:'用户资料'})[s.source]||s.source)}）</li>`).join('')}${(e.informationNeeded||[]).map(s=>`<li>建议补充：${esc(s)}</li>`).join('')}</ul></details><details><summary>人员安排依据与调整说明</summary><p>当前成员：${esc(E.ownerLabel(t,p.people)||'待分配')}</p>${(e.allocationBasis||e.resourcePlan?.adjustments||[]).map(s=>`<p>${esc(s)}</p>`).join('')}${(e.warnings||[]).map(s=>`<p class="wp-cell-error">${esc(s)}</p>`).join('')}</details>${e.calibration?`<p>校准记录：AI原值 ${esc(e.calibration.aiTotal)} → 人工／当前采用 ${esc(e.calibration.adoptedTotal)} 人天；${esc(e.calibration.reason||'尚无人工调整')}</p>`:''}`;
  }
  function open({current,showDialog,onApply,onStatus=()=>{},mode='system'}){
    const original=current(),id=original.id;let proposal=null,basePlan=null;
    if(state(id).busy)throw Error('此项目正在AI初算，请完成后再打开');
    const params=parameters(original);
    showDialog(`<header class="dialog-header"><div><h2 id="dialog-title">AI人天初算与人员分配</h2><p>先核对参数与容量，再看依据和差异。重新初算系统初稿将另存副本。</p></div><button type="button" data-close aria-label="关闭窗口">×</button></header><form id="plan-effort-review"><div class="simple-form"><label class="form-field">初算范围<select name="effortMode"><option value="empty" ${mode==='empty'?'selected':''}>只补未估算任务（原计划）</option><option value="system" ${mode==='system'?'selected':''}>重新初算系统初稿（副本）</option><option value="affected">只重算参数变化影响的系统任务（副本）</option></select></label><details open><summary>核对关键参数</summary><p class="form-help">未知信息可留为AI假设，模型必须写明采用的数量与依据；这里填写后标为人工确认。</p><div class="form-grid">${params.map(s=>`<label class="form-field">${esc(s.label||s.key)}<input data-effort-param="${esc(s.key)}" value="${esc(s.value)}" maxlength="500"><small data-param-source>${esc(({ai:'AI假设',manual:'人工确认',user:'用户资料'})[s.source]||s.source)}</small></label>`).join('')}</div></details><label class="wp-inline-check"><input type="checkbox" name="standardCapacity" ${original.effortCapacityDefault===true?'checked':''}>未填写容量的成员，本次暂按月标准工日 ${original.standardDays??20} 天测算（假设，可在负荷表改）</label><p class="form-help">0容量不会分配；不勾选时未知容量保留待分配。人工日期、投入、月活动、确认0、锁定和已完成项保护。模型不会读取姓名或附件原件。</p><label class="wp-inline-check"><input type="checkbox" name="force">重新请求模型，忽略成功缓存</label><button type="submit" class="button secondary">生成初算预览</button><p data-effort-status role="status"></p><p data-effort-error role="alert" class="wp-cell-error"></p><div data-effort-result></div></div><div class="dialog-footer"><span>标准需求与当前分配分别保存；共用活动整体校验后应用。</span><button type="button" class="button" data-apply-effort disabled>应用初算</button></div></form>`);
    const form=document.getElementById('plan-effort-review'),result=form.querySelector('[data-effort-result]'),error=form.querySelector('[data-effort-error]'),status=form.querySelector('[data-effort-status]'),apply=form.querySelector('[data-apply-effort]');
    function readParams(){return params.map(s=>{const value=[...form.querySelectorAll('[data-effort-param]')].find(el=>el.dataset.effortParam===s.key).value.trim();return value===String(s.value)?{...s}:{...s,value,source:'manual'};});}
    form.addEventListener('input',e=>{if(e.target.matches('[data-effort-param]'))e.target.parentElement.querySelector('[data-param-source]').textContent='人工确认';proposal=null;apply.disabled=true;});
    form.addEventListener('change',()=>{proposal=null;apply.disabled=true;});
    form.addEventListener('submit',async e=>{e.preventDefault();e.stopPropagation();if(state(id).busy)return;
      const button=form.querySelector('[type=submit]');let stamp;
      try{
        if(current().id!==id)throw Error('当前项目已切换，请重新打开');
        const parameterValues=readParams(),selectedMode=form.elements.effortMode.value,scope=selectedMode==='empty'?'empty':'system';
        basePlan=B.clone(current());basePlan.effortCapacityDefault=form.elements.standardCapacity.checked;
        const changed=selectedMode==='affected'?C.affected(basePlan,parameters(current()),parameterValues):undefined;
        const eligible=C.eligible(basePlan,{mode:scope,taskIds:changed});
        if(!eligible.taskIds.length)throw Error(selectedMode==='affected'?'没有受参数变化影响且允许重算的任务；人工项仍保留':'没有符合范围的可估算任务；人工、确认0、锁定、完成与未知旧稿均保留');
        stamp=C.fingerprint(current());const baseStamp=C.fingerprint(basePlan);
        states.set(id,{busy:true});form.querySelectorAll('input,select').forEach(el=>el.disabled=true);button.disabled=true;apply.disabled=true;error.textContent='';result.innerHTML='';status.textContent=`正在估算 ${eligible.taskIds.length} 项，全部返回后统一校验…`;
        const response=await obtain(basePlan,eligible.taskIds,parameterValues,form.elements.force.checked,progress=>{status.textContent=`${progress.stage==='shared-start'?'正在检查共用活动；':''}已返回 ${progress.completed??0} / ${eligible.taskIds.length} 项建议，全部完成后统一校验。`;});
        if(current().id!==id||C.fingerprint(current())!==stamp)throw Error('项目或人工数据已变化，本次旧结果未应用');
        proposal=C.propose(basePlan,response,{mode:scope,taskIds:eligible.taskIds,parameters:parameterValues,baseRevision:baseStamp});
        proposal.uiBaseRevision=stamp;proposal.uiMode=scope;
        status.textContent=`已校验 ${proposal.changes.length} 项，${eligible.protected.length} 项受保护。${modelSource(response.performance)}`;
        result.innerHTML=`${(proposal.warnings||[]).map(s=>`<p class="wp-cell-error">${esc(s)}</p>`).join('')}${proposal.changes.map(c=>`<article class="wp-effort-change"><h3>${esc(c.work)}</h3><p>当前 ${E.total(c.before,E.months(original.start,original.end))??'待估算'} → 建议安排 ${E.total(c.after,E.months(original.start,original.end))??'待估算'} 人天 · ${esc(c.after.start)} 至 ${esc(c.after.end)}</p>${detail(basePlan,c.after)}</article>`).join('')}${eligible.protected.length?`<details><summary>${eligible.protected.length} 项保留原因</summary><ul>${eligible.protected.map(s=>`<li>${esc(s.work||s.taskId)}：${esc(s.reason)}</li>`).join('')}</ul></details>`:''}`;
        apply.textContent=scope==='empty'?'补齐空白并保存':'另存AI初算副本并打开';apply.disabled=!proposal.changes.length;
      }catch(err){proposal=null;apply.disabled=true;error.textContent=err.message;status.textContent='未应用任何新估算，原计划保留。';}
      finally{states.delete(id);form.querySelectorAll('input,select').forEach(el=>el.disabled=false);button.disabled=false;onStatus();}
    });
    apply.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();try{
      if(!proposal)throw Error('请先重新生成初算预览');
      if(current().id!==id||C.fingerprint(current())!==proposal.uiBaseRevision)throw Error('原计划已变化，请重新预览，未覆盖人工数据');
      const copy=proposal.uiMode==='system'?C.applyCopy(basePlan,proposal):C.apply(B.clone(basePlan),proposal);
      onApply(copy,proposal.uiMode==='system');
    }catch(err){error.textContent=err.message;}});
  }
  root.WorkPlanAIEffortUI={start,open,detail,state,parameters};
})(window);
