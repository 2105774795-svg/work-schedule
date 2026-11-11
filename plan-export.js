/* 导出为独立 XLSX：设置计划表的字体、边框、底色及状态样式。 */
(function (root) {
  'use strict';
  const E = root.WorkPlanEngine || (typeof require === 'function' && require('./plan-engine.js'));
  const R = root.WorkPlanReference || (typeof require === 'function' && require('./plan-reference.js'));
  const F = root.WorkPlanFormulas || (typeof require === 'function' && require('./plan-formulas.js'));
  const options = ['月度人力汇总','月度任务明细','人员月度负荷','说明及人员'];
  const xml = value => String(value ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
  const xfBlock=R.stylesXml.match(/<cellXfs\b[^>]*count="(\d+)"[^>]*>([\s\S]*?)<\/cellXfs>/);
  const percentStyle=Number(xfBlock[1]);
  // 附属表增加百分比格式；核心月历的原始样式索引保持不变。
  const numericStyle=percentStyle+1;
  const stylesXml=R.stylesXml.replace(xfBlock[0],`<cellXfs count="${percentStyle+2}">${xfBlock[2]}${[10,0].map(num=>`<xf numFmtId="${num}" fontId="0" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`).join('')}</cellXfs>`);
  function col(n) {let s=''; for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
  const baseFields = (p,t,i) => [i+1,E.moduleName(p,t.module),t.category,`${t.start.replace('-','')}-${t.end.replace('-','')}`,t.work,t.output,E.ownerLabel(t,p.people),t.partner,t.status,t.difficulty,t.notes];
  function estimationSource(plan){
    const models=plan.tasks.filter(t=>t.estimate?.method==='model'),rules=plan.tasks.filter(t=>/规则/.test(t.estimate?.method||''));
    if(models.length){const pending=models.filter(t=>t.estimate.status==='pending'||t.estimate.total===null).length;return `AI分项已初算${models.length-pending}项${pending?'，待补资料'+pending+'项':''}${rules.length?'，规则来源'+rules.length+'项':''}，程序按本项目人员与容量安排；AI标准需求与人工采用值分别保留，仍须核对假设。`;}
    if(rules.length)return '岗位匹配与规则初估，非AI计算；人天与容量待负责人核对。';
    return '沿用当前已保存安排；未初算保持空白，0表示确认无投入。';
  }
  function estimateNotes(plan){
    return plan.tasks.filter(t=>t.estimate?.method==='model').flatMap(t=>{
      const e=t.estimate,adopted=e.calibration?.adoptedTotal??E.total(t,E.months(plan.start,plan.end)),show=n=>n===null||n===undefined?'待初算':n+'人天';
      const rows=[['AI需求与当前采用',t.work,`AI标准需求：${show(e.total)}；当前采用：${show(adopted)}${e.range?`；建议范围：${show(e.range.low)}—${show(e.range.high)}`:''}`,e.model||''],['AI估算依据',t.work,typeof e.basis==='string'?e.basis:JSON.stringify(e.basis||'')]];
      for(const a of e.assumptions||[])rows.push(['估算假设',t.work,typeof a==='string'?a:JSON.stringify(a)]);
      if(e.uncertainty)rows.push(['估算不确定性',t.work,e.uncertainty]);
      for(const a of e.informationNeeded||[])rows.push(['估算待补信息',t.work,a]);
      for(const a of e.allocationBasis||[])rows.push(['程序分配依据',t.work,a]);
      for(const a of e.sharedActivities||[])rows.push(['共用工作分摊',t.work,`${a.activity||a.id}：本项${show(a.days)}／共用总量${show(a.totalDays)}`,a.basis||'']);
      if(e.calibration?.history?.length)rows.push(['人工校准',t.work,e.calibration.reason||'原因待补充',`原AI：${show(e.calibration.aiTotal)}；人工采用：${show(e.calibration.adoptedTotal)}`]);
      return rows;
    });
  }
  function buildSpec(plan, selected = plan.options || []) {
    const list=E.validate(plan), groups=[...new Set(plan.people.map(p=>p.group))], load=E.loads(plan);
    if(plan.tasks.some(t=>[...Object.keys(t.allocations),...Object.keys(t.unassigned)].some(m=>!list.includes(m)&&(E.effort(t,m)||0)>0)))throw Error('存在月历期间之外的投入，请先调整月历期间，避免导出遗漏。');
    if(selected.some(s=>!options.includes(s)))throw Error('不支持的附属工作表');
    const header=['序号','模块','分类','时间','工作内容','工作成果',plan.ownLabel || '项目负责人',plan.partnerLabel || '配合人','推进情况','推进难题','备注',...list,'累计人天'];
    const main={name:'原计划月历',title:plan.name+'｜原计划月历（保留原字段）',note:'A—K 为计划基础字段；右侧按月列示计划投入人天。期内空白为待估算，期外空白为不适用，0为确认无投入。已选明细为Excel投入修改入口。',header,rows:plan.tasks.map((t,i)=>[...baseFields(plan,t,i),...list.map(m=>E.effort(t,m)),E.total(t,list)]),statuses:plan.tasks.map(t=>t.status),widths:[7,16,14,19,41,61,21,20,12,38,38,...list.map(()=>12),13],main:true};
    const sheets=[main];
    if(selected.includes('月度人力汇总')){
      const h=['月份',...groups.flatMap(g=>[g+'投入人数',g+'需求人数',g+'人天']),'投入人数','需求人数','合计人天','现有编制','人员缺口','任务项数','主要推进模块','待分配人天','负荷提示'];
      const rows=E.summaries(plan).map(r=>[r.month,...r.groups.flatMap(g=>[g.people,g.needed,g.days]),r.people,r.needed,r.days,r.headcount,r.gap,r.tasks,r.modules,r.unassigned,r.note]);
      sheets.push({name:'月度人力汇总',title:plan.name+'｜月度推进与人力投入计划',note:`需求人数为各组人天÷月标准工日（参数见第3行）分别向上取整再求和。未分配投入不计各组需求；个人实际容量单独校验。`,header:h,rows,widths:h.map((_,i)=>i===h.length-2?36:i===h.length-1?50:16)});
    }
    if(selected.includes('月度任务明细')){
      const h=['执行月份',...header.slice(0,11),...plan.people.map(p=>p.name),...groups.flatMap(g=>[g+'人数',g+'人天']),'合计人数','已分配人天','待分配人天','合计人天'];
      const rows=list.flatMap(m=>plan.tasks.filter(t=>(t.start<=m&&t.end>=m&&t.status!=='已完成')||E.effort(t,m)!==null).map(t=>{
        const a=t.allocations?.[m]||{},known=E.effort(t,m)!==null;
        const fields=baseFields(plan,t,plan.tasks.indexOf(t));fields[10]=[t.monthlyPlan?.[m]?('当月安排：'+t.monthlyPlan[m].activity+'\n阶段成果：'+t.monthlyPlan[m].output):(t.monthNotes?.[m]?'当月安排：'+t.monthNotes[m]:''),t.deadline?'最迟完成月份：'+t.deadline.slice(0,7):'',t.notes].filter(Boolean).join('\n');
        return [m,...fields,...plan.people.map(p=>a[p.id]??(known?0:null)),...groups.flatMap(g=>{const ps=plan.people.filter(p=>p.group===g);return [known?ps.filter(p=>(a[p.id]||0)>0).length:null,known?E.sum(ps.map(p=>a[p.id]||0)):null];}),known?Object.values(a).filter(v=>v>0).length:null,known?E.assigned(t,m):null,t.unassigned?.[m]??(known?0:null),E.effort(t,m)];
      }));
      sheets.push({name:'月度任务明细',title:'按月推进任务明细｜每人投入人天',note:'同一任务按月份展开；执行月份逐行保留，不合并，避免漏计。空白为待估算，待分配人天不计入个人负荷。',header:h,rows,widths:h.map((_,i)=>[5,6,10,11].includes(i)?42:18)});
    }
    if(selected.includes('人员月度负荷')) sheets.push({name:'人员月度负荷',title:'人员月度负荷｜按人汇总',note:'仅统计本项目已分配投入；空白可用人天表示尚未确认。未分配人天及未估算任务不计入个人负荷。',header:['执行月份','小组','成员','投入人天','折算人力(FTE)','参与任务数','月可用人天','负荷率','负荷提示'],rows:load.map(r=>[r.month,r.person.group,r.person.name,r.days,r.days/(plan.standardDays??20),r.tasks,r.capacity,r.capacity? r.days/r.capacity:null,r.capacity===null?'可用人天待确认':r.capacity===0?(r.days>0?'无可用时间，存在投入':'无可用时间'):r.days>r.capacity?'超负荷':'按已分配投入计算']),widths:[15,24,18,16,20,16,18,16,36],percentColumns:[8]});
    if(selected.includes('说明及人员'))sheets.push({name:'说明及人员',title:'计划说明及人员',note:'人员分工及计算口径随计划保存。',header:['小组','成员','工作分工','本项目月可用人天'],rows:[...plan.people.map(p=>[p.group,p.name,p.role,p.capacity]),[],['项目名称',plan.name],['项目内容',plan.description],['服务范围',plan.scope],['交付要求',plan.deliverables],['关键节点',plan.milestones],['已有进展',plan.progressNotes||''],['人员可用时间说明',plan.availabilityNotes||''],['外部配合条件',plan.conditions||''],['预计开始日期',plan.startDate||''],['预计结束日期',plan.endDate||''],['计划期间',plan.start+' 至 '+plan.end],['进度快照月份',plan.asOf],['导出时间',new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})],['月标准工日',plan.standardDays??20],...load.filter(r=>Object.hasOwn(r.person.capacities||{},r.month)).map(r=>['月度容量',r.month+' '+r.person.name,r.capacity??'待确认']),['人数统计','同一人员在同月多任务中只计 1 人'],['人天统计','按 0.25 天录入，历时不等于投入人天；空白与 0 区别保留'],['负荷口径','个人已分配人天÷个人本项目可用人天；未估算或未分配投入另行核对'],['需求人数','按各组人天÷月标准工日分别向上取整，真实可用容量另行核对'],['排期依据',estimationSource(plan)],['工作簿更新','本文件为导出快照。修改网页后请重新导出，已选表按人员明细单向重算；网页和下载文件不会双向同步'],['资料来源',plan.source||'项目计划与通用任务示例'],...estimateNotes(plan)],widths:[27,45,80,24]});
    return F.attach(plan,sheets);
  }
  function sheetXML(spec) {
    const end=col(spec.header.length),body=[];
    const cell=(value,ref,style,formula)=>{
      if(formula)return `<c r="${ref}" s="${style}"${typeof value==='number'?'':' t="str"'}><f>${xml(formula)}</f><v>${xml(value??'')}</v></c>`;
      if(typeof value==='number')return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    };
    body.push(`<row r="1" ht="36" customHeight="1">${spec.header.map((_,i)=>cell(i?'':spec.title,col(i+1)+'1',i?2:1)).join('')}</row>`,`<row r="2" ht="40" customHeight="1">${cell(spec.note,'A2',4)}</row>`,`<row r="4" ht="33" customHeight="1">${spec.header.map((v,i)=>cell(v,col(i+1)+'4',5)).join('')}</row>`);
    if(spec.parameters)body.splice(2,0,`<row r="3" ht="26" customHeight="1">${Object.entries(spec.parameters).map(([ref,v])=>cell(v,ref,typeof v==='number'?numericStyle:8,spec.parameterFormulas?.[ref])).join('')}</row>`);
    spec.rows.forEach((row,i)=>{
      const r=i+5, styles=R.rowStyles[spec.statuses?.[i]]||R.rowStyles['未开始'];
      const height=Math.max(30,...row.slice(0,11).map((v,j)=>Math.ceil(String(v??'').split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil(s.length/Math.max(5,(spec.widths[j]||18)/2))),0))*14+8));
      body.push(`<row r="${r}" ht="${Math.min(409,height)}" customHeight="1">${row.map((v,j)=>{
        let style=spec.main?(j<11?styles[j]:j===spec.header.length-1?styles[24]:styles[11]):typeof v==='number'?numericStyle:8;
        if(spec.percentColumns?.includes(j+1))style=percentStyle;
        const formula=spec.formulas?.[col(j+1)+r]||(spec.main&&j===spec.header.length-1?`IF(COUNT(L${r}:${col(spec.header.length-1)}${r})=0,"",SUM(L${r}:${col(spec.header.length-1)}${r}))`:null);
        return cell(v,col(j+1)+r,style,formula);
      }).join('')}</row>`);
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${end}${spec.rows.length+4}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="${spec.main?11:1}" ySplit="4" topLeftCell="${spec.main?'L':'B'}5" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="26"/><cols>${spec.widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body.join('')}</sheetData>${spec.rows.length?`<autoFilter ref="A4:${end}${spec.rows.length+4}"/>`:''}<mergeCells count="2"><mergeCell ref="A1:${end}1"/><mergeCell ref="A2:${end}2"/></mergeCells><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  }
  async function buffer(plan, selected, Zip) {
    const J=Zip||root.JSZip;if(!J)throw Error('Excel 导出组件未加载，请刷新页面');
    const specs=buildSpec(plan,selected),z=new J();
    z.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${R.themeXml?'<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>':''}${specs.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
    z.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    z.file('xl/styles.xml',stylesXml);if(R.themeXml)z.file('xl/theme/theme1.xml',R.themeXml);
    z.file('xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${specs.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><definedNames>${specs.map((s,i)=>`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${xml(s.name)}'!$4:$4</definedName>`).join('')}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
    z.file('xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${specs.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${R.themeXml?'<Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>':''}</Relationships>`);
    specs.forEach((s,i)=>z.file(`xl/worksheets/sheet${i+1}.xml`,sheetXML(s)));
    return z.generateAsync({type:'uint8array',compression:'DEFLATE'});
  }
  const api={options,buildSpec,buffer,col,xml};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkPlanExport=api;
})(typeof window!=='undefined'?window:globalThis);
