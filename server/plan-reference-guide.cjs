/* 从演示任务建立可复用的方向与任务成果对照。 */
const B=require('../plan-builder.js');
const rows=B.flatten(B.catalog()).filter(r=>r.task.sourceSeq);
const compact=r=>({id:r.task.sourceSeq,w:r.task.work,o:r.task.output});
const modules=[];
for(const r of rows){
 let m=modules.find(m=>m.code===r.module.sourceCode);if(!m){m={code:r.module.sourceCode,name:r.module.name,directions:[]};modules.push(m);}
 let d=m.directions.find(d=>d.name===r.category.name);if(!d){d={name:r.category.name,tasks:[]};m.directions.push(d);}d.tasks.push(compact(r));
}
function outline(scale){return {sampleTaskCount:rows.length,directionCount:modules.reduce((s,m)=>s+m.directions.length,0),modules:modules.map(m=>({code:m.code,name:m.name,directions:m.directions.map(d=>({name:d.name,count:d.tasks.length,examples:scale==='small'?d.tasks.slice(0,1):d.tasks}))}))};}
function forBatch(directions){
 const codes=new Set(directions.map(d=>d.moduleCode)),chosen=rows.filter(r=>codes.has(r.module.sourceCode));
 // 新行业大类也可参考方法相近的样本，不要求存在同编号。
 if(!chosen.length){const text=directions.map(d=>d.category+' '+d.purpose).join('');const score=r=>[...new Set((r.category.name+' '+r.task.work).match(/[\u4e00-\u9fff]{2}/g)||[])].filter(w=>text.includes(w)).length;chosen.push(...[...rows].sort((a,b)=>score(b)-score(a)).slice(0,16));}
 return chosen.map(r=>({...compact(r),m:r.module.sourceCode,c:r.category.name}));
}
module.exports={outline,forBatch,total:rows.length,directions:modules.reduce((s,m)=>s+m.directions.length,0)};
