/* XLSX公式依赖：明细为输入 → 个人负荷 → 小组汇总；只引用实际导出的Sheet。 */
(function(root){
  'use strict';
  const E=root.WorkPlanEngine||(typeof require==='function'&&require('./plan-engine.js'));
  function column(n){let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
  const ref=(sheet,col,end)=>`'${sheet.name}'!$${column(col)}$5:$${column(col)}$${Math.max(5,end)}`;
  const sum=cells=>cells.length?`SUM(${cells.join(',')})`:'0';
  function attach(p,sheets){
    const main=sheets[0],detail=sheets.find(s=>s.name==='月度任务明细'),load=sheets.find(s=>s.name==='人员月度负荷'),summary=sheets.find(s=>s.name==='月度人力汇总'),notes=sheets.find(s=>s.name==='说明及人员'),groups=[...new Set(p.people.map(x=>x.group))],months=E.months(p.start,p.end);
    const set=(s,r,j,f)=>{(s.formulas||={})[column(j+1)+(r+5)]=f;};
    const standardOwner=load||summary;
    for(const s of [load,summary].filter(Boolean)){s.parameters={A3:'月标准工日',B3:p.standardDays??20};if(s!==standardOwner)s.parameterFormulas={B3:`'${standardOwner.name}'!B3`};}
    const std=s=>s===standardOwner?'$B$3':`'${standardOwner.name}'!$B$3`;
    if(p.tasks.some(t=>t.estimate?.method==='model')){main.note+=' 人天包含AI分项初算；标准需求、人工采用值及假设分别保留，仍须核对。';if(load)load.note+=' 容量使用已填值或明确选用的标准工日假设；未知或零容量保留待分配，未核对其他项目占用。';}
    else if(p.preStartMode){main.note+=' 人天为规则初估，容量仅按本项目默认参数测算，需人工核对。';if(load)load.note+=' 未单独填写的个人容量按标准工日默认测算，未核对其他项目占用。';}
    if(detail){
      const peopleEnd=12+p.people.length,assignedIndex=detail.header.length-3,pendingIndex=detail.header.length-2,totalIndex=detail.header.length-1;
      detail.rows.forEach((row,i)=>{
        const r=i+5,inputs=p.people.map((_,j)=>column(13+j)+r),pending=column(pendingIndex+1)+r,known=`COUNT(${[...inputs,pending].join(',')})=0`;
        const formula=f=>`IF(${known},"",${f})`;
        groups.forEach((g,gi)=>{
          const cells=p.people.flatMap((person,j)=>person.group===g?[column(13+j)+r]:[]);
          set(detail,i,peopleEnd+gi*2,formula(cells.length?sum(cells.map(c=>`COUNTIF(${c},">0")`)):'0'));
          set(detail,i,peopleEnd+gi*2+1,formula(sum(cells)));
        });
        set(detail,i,assignedIndex-1,formula(inputs.length?sum(inputs.map(c=>`COUNTIF(${c},">0")`)):'0'));
        set(detail,i,assignedIndex,formula(sum(inputs)));
        set(detail,i,totalIndex,formula(`${column(assignedIndex+1)}${r}+${pending}`));
      });
      // 每个任务每月在明细中仅有一行，直接引用该行合计，保留未估算的空白。
      const records=new Map(detail.rows.map((row,i)=>[row[1]+'|'+row[0],i+5]));
      main.rows.forEach((row,i)=>months.forEach((m,j)=>{const r=records.get((i+1)+'|'+m);if(r){const cell=`'${detail.name}'!${column(totalIndex+1)}${r}`;set(main,i,11+j,`IF(ISNUMBER(${cell}),${cell},"")`);}}));
    }
    if(load){
      load.rows.forEach((row,i)=>{
        const r=i+5,person=p.people.findIndex(person=>person.name===row[2]);
        if(detail){const days=ref(detail,13+person,detail.rows.length+4),month=ref(detail,1,detail.rows.length+4);set(load,i,3,`SUMIFS(${days},${month},A${r})`);set(load,i,5,`COUNTIFS(${month},A${r},${days},">0")`);}
        set(load,i,4,`D${r}/${std(load)}`);
        set(load,i,7,`IF(ISNUMBER(G${r}),IF(G${r}>0,D${r}/G${r},""),"")`);
        set(load,i,8,`IF(ISNUMBER(G${r}),IF(G${r}=0,IF(D${r}>0,"无可用时间，存在投入","无可用时间"),IF(D${r}>G${r},"超负荷","按已分配投入计算")),"可用人天待确认")`);
      });
      load.note+=' 月标准工日见B3；容量可修改。'+(detail?'投入引用已选月度任务明细，修改明细后自动重算。':'未选明细：投入为本表可编辑汇总，参与任务数是导出时的安排，不反向重分月历。');
    }
    if(summary){
      groups.forEach((g,gi)=>{summary.parameters[column(3+gi*2)+'3']=g+'编制';summary.parameters[column(4+gi*2)+'3']=p.people.filter(x=>x.group===g).length;});
      const base=1+groups.length*3,pend=summary.header.indexOf('待分配人天');
      summary.rows.forEach((row,i)=>{
        const r=i+5,dayCells=[],needCells=[],countCells=[],gaps=[],heads=[];
        groups.forEach((g,gi)=>{
          const start=1+gi*3,counts=column(start+1)+r,needs=column(start+2)+r,days=column(start+3)+r,head='$'+column(4+gi*2)+'$3';dayCells.push(days);needCells.push(needs);countCells.push(counts);gaps.push(`MAX(0,${needs}-${head})`);heads.push(head);
          if(load){
            const a=ref(load,1,load.rows.length+4),b=ref(load,2,load.rows.length+4),d=ref(load,4,load.rows.length+4),group=g.replace(/"/g,'""');
            set(summary,i,start,`COUNTIFS(${a},A${r},${b},"${group}",${d},">0")`);set(summary,i,start+2,`SUMIFS(${d},${a},A${r},${b},"${group}")`);
          }else if(detail){
            const a=ref(detail,1,detail.rows.length+4),members=p.people.flatMap((person,j)=>person.group===g?[ref(detail,j+13,detail.rows.length+4)]:[]);
            set(summary,i,start,sum(members.map(d=>`IF(SUMIFS(${d},${a},A${r})>0,1,0)`)));set(summary,i,start+2,sum(members.map(d=>`SUMIFS(${d},${a},A${r})`)));
          }
          set(summary,i,start+1,`ROUNDUP(${days}/${std(summary)},0)`);
        });
        set(summary,i,base,sum(countCells));set(summary,i,base+1,sum(needCells));
        set(summary,i,base+2,`${sum(dayCells)}+${column(pend+1)}${r}`);
        set(summary,i,base+3,sum(heads));set(summary,i,base+4,sum(gaps));
        if(detail){set(summary,i,pend,`SUMIFS(${ref(detail,detail.header.length-1,detail.rows.length+4)},${ref(detail,1,detail.rows.length+4)},A${r})`);set(summary,i,base+5,`COUNTIF(${ref(detail,1,detail.rows.length+4)},A${r})`);}
        const gap=column(base+5)+r,pending=column(pend+1)+r;
        if(load){const a=ref(load,1,load.rows.length+4),status=ref(load,9,load.rows.length+4);set(summary,i,summary.header.length-1,`IF(COUNTIFS(${a},A${r},${status},"超负荷")+COUNTIFS(${a},A${r},${status},"无可用时间，存在投入")>0,"存在人员超负荷",IF(${pending}>0,"有待分配人天",IF(${gap}>0,"标准编制偏紧","按本项目测算")))`);}
        else set(summary,i,summary.header.length-1,`IF(${pending}>0,"有待分配人天",IF(${gap}>0,"标准编制偏紧","个人负荷请在网页或负荷表核对"))`);
      });
      summary.note+=' B3为标准工日，第3行各组编制可改。'+(!load&&!detail?'未选明细与负荷：本表人数、人天可独立修改，不反向重分任务。':'由已选的上游数据自动汇总。');
    }
    if(notes&&standardOwner){const i=notes.rows.findIndex(r=>r[0]==='月标准工日');if(i>=0)set(notes,i,1,`'${standardOwner.name}'!B3`);}
    return sheets;
  }
  const api={attach};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorkPlanFormulas=api;
})(typeof window!=='undefined'?window:globalThis);
