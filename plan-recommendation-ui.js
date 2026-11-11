/* 新增表单内的独立推荐面板；检索、换批、编辑均不改树，显式添加才提交。 */
(function(root){
  'use strict';
  const R=root.WorkPlanRecommendations,A=root.WorkPlanAdaptation,B=root.WorkPlanBuilder;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function mount(form,{current,edit,save,onAdded}){
    const host=form.querySelector('[data-node-recommendations]');if(!host)return;
    const type=form.dataset.type,parentId=form.dataset.parent||'',projectId=current().id,key=type+'|'+parentId;
    const context=A.fingerprint(current());let busy=false,notice='',failure=false,candidates=[],drafts=[],stamp='',controller,sequence=0,round=0;
    const dialog=form.closest('dialog');
    const active=()=>form.isConnected&&dialog.open&&current().id===projectId;
    const history=()=>current().nodeRecommendationHistory?.context===context?current().nodeRecommendationHistory.entries?.[key]:null;
    round=history()?.round||0;
    function card(item){
      return `<article class="wp-recommend-card" data-recommend-card="${item.id}"><label class="wp-recommend-select"><input type="checkbox" data-recommend-pick ${item.selected?'checked':''}>选择此建议${item.edited?' · 已编辑':''}</label>${type==='task'?`<label>具体工作<textarea data-recommend-field="work" maxlength="1000">${esc(item.work)}</textarea></label><label>对应成果<textarea data-recommend-field="output" maxlength="2000">${esc(item.output)}</textarea></label>`:`<label>${type==='module'?'业务大类':'工作方向'}名称<input data-recommend-field="name" maxlength="160" value="${esc(item.name)}"></label>`}<p>${esc(item.reason)}</p><details><summary>查看 ${item.sources.length} 个检索来源${item.edited?'（为原建议依据）':''}</summary>${item.sources.map(s=>`<div class="wp-recommend-source"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a><small>${esc(s.site||'')} ${esc(s.date||'')}</small><blockquote>${esc(s.excerpt)}</blockquote></div>`).join('')}</details></article>`;
    }
    function render(){
      host.innerHTML=`<section class="wp-node-recommendations"><header><strong>联网AI推荐 <small>可选辅助</small></strong><button type="button" data-recommend-action="fetch" ${busy?'disabled':''}>${busy?'正在检索与推荐…':round?'换一批':'联网推荐两个'}</button></header><p class="wp-recommend-help">结合项目信息、当前父级和已有内容推荐。只有点击“添加所选”才写入任务树；手动填写仍可直接保存。</p><p class="${failure?'wp-recommend-error':''}" data-recommend-status role="${failure?'alert':'status'}">${esc(notice)}</p>${drafts.length?`<details open class="wp-recommend-drafts"><summary>已编辑暂存 · ${drafts.length}项（换批保留）</summary><div class="wp-recommend-cards">${drafts.map(card).join('')}</div></details>`:''}<div class="wp-recommend-cards">${candidates.map(card).join('')}</div>${candidates.length||drafts.length?`<footer><span>来源用于支持建议，不代表本项目事实已核实。</span><button type="button" data-recommend-action="add" ${busy?'disabled':''}>添加所选（1—2项）</button></footer>`:''}</section>`;
    }
    async function fetchBatch(){
      if(busy)return;
      if(!/^https?:$/.test(location.protocol)||typeof root.fetch!=='function'){failure=true;notice='请从本地工作计划应用使用联网推荐；手动填写不受影响。';render();return;}
      const p=current();
      try{
        if(A.fingerprint(p)!==context)throw Error('项目资料已变化，请重新打开新增入口');
        const seen=[...(history()?.seen||[]),...drafts,...candidates];
        const request=R.request(p,type,parentId,seen,round);const requestedStamp=R.fingerprint(p,type,parentId);
        busy=true;failure=false;notice='正在检索网页并结合项目生成建议，请稍候…';render();
        controller=new AbortController();const timer=setTimeout(()=>controller.abort(),125000);
        let response,data;
        try{response=await root.fetch(new URL('./api/plan-ai/recommend',location.href),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal});try{data=await response.json();}catch{throw Error('推荐后端未就绪，请更新本地工作计划服务后再试');}}finally{clearTimeout(timer);}
        if(!active())return;
        if(!response.ok)throw Error(data.error||'检索或推荐失败，手填内容已保留');
        if(R.fingerprint(current(),type,parentId)!==requestedStamp)throw Error('等待期间项目或任务树已变化，本次旧候选未采用，请重新打开入口');
        const result=data.recommendation;
        if(result?.searched!==true||!Array.isArray(result.candidates)||result.candidates.length>2)throw Error('服务未返回有效的联网候选，不冒充检索完成');
        for(const item of result.candidates){R.validateCandidate(item,type);if(!item.reason?.trim()||!Array.isArray(item.sources)||!item.sources.length||item.sources.some(s=>!s.title||!s.excerpt||!R.safeUrl(s.url)))throw Error('候选缺少可核查的检索来源，未采用');}
        const filtered=[];
        for(const item of result.candidates){if(!R.duplicate(item,[...R.existing(current(),type,parentId),...seen,...filtered],type))filtered.push(item);}
        stamp=requestedStamp;drafts.push(...candidates.filter(c=>c.edited).map(c=>({...c,selected:false})));candidates=filtered.map(c=>({...c,id:'recommend-'+(++sequence),selected:true,edited:false}));
        round++;
        // 只保存展示历史，任务树、月历及投入不变；关闭后重开也能排除已展示项。
        const historyStore=p.nodeRecommendationHistory?.context===context?p.nodeRecommendationHistory:{context,entries:{}};
        historyStore.entries[key]={round,seen:[...(history()?.seen||[]),...result.candidates].slice(-300).map(c=>({name:c.name,work:c.work,output:c.output}))};p.nodeRecommendationHistory=historyStore;save();
        failure=false;notice=[`已完成联网检索，本批可用 ${candidates.length} 项。`,result.explanation||'',filtered.length<result.candidates.length?'已排除与已有或历史展示内容重复的建议。':''].filter(Boolean).join(' ');
      }catch(err){if(active()){failure=true;notice=err.name==='AbortError'?'检索或推荐超时，原树与手填内容已保留，可重试。':err.message;}}
      finally{busy=false;if(active())render();}
    }
    host.addEventListener('input',e=>{
      const card=e.target.closest('[data-recommend-card]');if(!card)return;
      const item=[...drafts,...candidates].find(c=>c.id===card.dataset.recommendCard);
      if(e.target.dataset.recommendField){item[e.target.dataset.recommendField]=e.target.value;item.edited=true;}
    });
    host.addEventListener('change',e=>{
      if(!e.target.hasAttribute('data-recommend-pick'))return;
      const item=[...drafts,...candidates].find(c=>c.id===e.target.closest('[data-recommend-card]').dataset.recommendCard);item.selected=e.target.checked;
    });
    host.addEventListener('click',e=>{
      const b=e.target.closest('[data-recommend-action]');if(!b)return;e.preventDefault();e.stopPropagation();
      if(b.dataset.recommendAction==='fetch'){fetchBatch();return;}
      if(busy)return;
      try{
        if(!active())return;
        const selected=[...drafts,...candidates].filter(c=>c.selected);let added;
        edit(p=>{added=R.add(p,type,parentId,selected,stamp);});
        const ids=new Set(selected.map(c=>c.id));drafts=drafts.filter(c=>!ids.has(c.id));candidates=candidates.filter(c=>!ids.has(c.id));
        stamp=R.fingerprint(current(),type,parentId);notice=`已添加 ${added.length} 项，可继续推荐或关闭此窗口。`;failure=false;
        onAdded(added);render();
      }catch(err){failure=true;notice=err.message;render();}
    });
    dialog.addEventListener('close',()=>controller?.abort(),{once:true});
    render();
  }
  root.WorkPlanRecommendationUI={mount};
})(window);
