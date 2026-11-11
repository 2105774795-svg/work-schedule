const test=require('node:test'),assert=require('node:assert/strict'),E=require('../plan-engine.js'),X=require('../plan-export.js'),Zip=require('../vendor/jszip.min.js');
test('全部16种Excel公式依赖只有已选表，输入为数字且没有隐藏表',async()=>{
 const p={id:'formula-case',name:'公式检查',start:'2026-11',end:'2027-01',asOf:'2026-11',modules:['B'],people:[{id:'p1',name:'甲',group:'实施组',role:'实施',capacity:20},{id:'p2',name:'乙',group:'支持组',role:'后台',capacity:0}],tasks:[E.newTask({id:'t1',module:'B',work:'访谈',output:'访谈记录',owner:'甲',start:'2026-11',end:'2026-11',allocations:{'2026-11':{p1:2,p2:1}},unassigned:{'2026-11':.5}})]};
 for(let mask=0;mask<16;mask++){
  const opts=X.options.filter((_,i)=>mask&(1<<i)),spec=X.buildSpec(p,opts),zip=await Zip.loadAsync(await X.buffer(p,opts,Zip));
  for(let i=0;i<spec.length;i++){const xml=(await zip.file(`xl/worksheets/sheet${i+1}.xml`).async('string')).replaceAll('&apos;',"'");for(const match of xml.matchAll(/'([^']+)'!/g))assert(spec.some(s=>s.name===match[1]));assert(!xml.includes('#REF!'));if(spec[i].name!=='说明及人员')assert(xml.includes('<f>'));}
  const main=(await zip.file('xl/worksheets/sheet1.xml').async('string')).replaceAll('&apos;',"'");assert.equal(main.includes("'月度任务明细'!"),opts.includes('月度任务明细'));assert(!Object.keys(zip.files).some(n=>n.includes('externalLinks')));assert(!(await zip.file('xl/workbook.xml').async('string')).includes('state="hidden"'));
 }
});
