const test=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const I=require('../server/ai-effort-estimation.cjs'),S=require('../server/plan-server.cjs');
const config={base:'https://fixture.invalid/v1',key:'TEST_ONLY',model:'fixture-effort',json:true,tokens:16000,reasoning:'low'};
function input(count=2){return {version:1,project:{name:'示例产业园研究',description:'围绕三个地块开展需求、规划及融资研究',scope:'研究策划，非工程施工',start:'2026-11',end:'2027-01'},people:[{id:'p1',name:'不外发姓名',role:'调研实施',group:'项目实施',capacity:20,capacities:{},capacitySource:'人工确认'}],tasks:Array.from({length:count},(_,i)=>({id:'t'+i,work:'核实独立对象'+i+'需求',output:'对象'+i+'需求清单',module:'总体研究',category:'需求研究',dependsOn:[],participantIds:['p1']})),parameters:[{key:'plots',label:'地块数',value:3,source:'user'}],employeeDirectory:['不外发完整员工库'],materials:['不外发附件']};}
function task(id,patch={}){return {taskId:id,status:'estimated',low:3,high:6,components:[{id:'c1',activity:'核实独立对象需求',output:'需求核实记录',days:4,roles:['调研'],personIds:['p1'],basis:'用户资料3个地块；AI假设每个对象核实及整理1人天，成果复核1人天，合计4人天，待确认',parameterKeys:['plots']}],basis:'专属需求核实与复核，不含统一资料归集',assumptions:['AI假设：对象资料需重新核实，待确认'],uncertainty:'资料成熟度及核实次数未知，范围为合理估计而非统计置信度',informationNeeded:['已有资料成熟度'],...patch};}
const completion=value=>({ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})});
function provider(options={}){
  const calls=[];const f=async(url,opts)=>{const body=JSON.parse(opts.body),payload=JSON.parse(body.messages[1].content);calls.push({url:String(url),body,payload});
    if(options.handle){const custom=await options.handle(payload,body,calls.length);if(custom)return custom;}
    if(!payload.tasks)return completion({sharedActivities:options.sharedActivities||[]});
    return completion({tasks:payload.tasks.map(t=>options.task?options.task(t.id,payload):task(t.id))});
  };f.calls=calls;return f;
}
test('AI初算使用独立模型链路，需求保留依据、假设与范围，不外发姓名员工库附件',async()=>{
  const raw=input(),before=JSON.stringify(raw),fetcher=provider(),estimate=await I.estimate(raw,config,fetcher);
  assert.equal(estimate.method,'model');assert.equal(estimate.model,config.model);assert.equal(estimate.tasks.length,2);assert.equal(estimate.performance.modelCalls,2);assert.equal(estimate.performance.cacheHit,false);
  assert(estimate.tasks.every(t=>t.components[0].days===4&&t.low===3&&t.high===6&&t.basis&&t.assumptions.length));
  const sent=JSON.stringify(fetcher.calls.map(c=>c.payload));assert(!sent.includes('不外发'));assert(sent.includes('plots'));assert.equal(JSON.stringify(raw),before);
  assert(fetcher.calls.every(c=>c.url.endsWith('/chat/completions')));assert.match(fetcher.calls[0].body.messages[0].content,/不是工时定额/);assert.match(fetcher.calls[1].body.messages[0].content,/不能削减/);
});
test('全局共用活动只调用一次并明确排除专属重复，分摊守恒后统一返回',async()=>{
  const shared=[{id:'s1',activity:'统一资料归集',output:'共用资料包',days:1,low:.5,high:2,basis:'同一次归集服务两个需求核实任务，AI假设1人天',allocations:[{taskId:'t0',days:.5},{taskId:'t1',days:.5}]}];
  const fetcher=provider({sharedActivities:shared}),estimate=await I.estimate(input(),{...config,effortBatchSize:1},fetcher);
  assert.equal(fetcher.calls.filter(c=>!c.payload.tasks).length,1);assert.equal(estimate.sharedActivities.length,1);assert.equal(estimate.sharedActivities[0].days,1);
  assert.equal(estimate.sharedActivities[0].allocations.reduce((n,a)=>n+a.days,0),1);assert.equal(estimate.tasks.reduce((n,t)=>n+t.components.reduce((s,c)=>s+c.days,0),0)+estimate.sharedActivities[0].days,9);
  for(const call of fetcher.calls.filter(c=>c.payload.tasks)){assert.deepEqual(call.payload.globalSharedActivities,shared);assert.match(call.body.messages[0].content,/不在专属components重复/);}
});
test('分批估算最多3并发，所有批次完整合并后返回，无分批独立容量分配',async()=>{
  let active=0,max=0;const fetcher=provider({handle:async payload=>{if(payload.tasks){active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,5));active--;}return null;}});
  const estimate=await I.estimate(input(7),{...config,effortBatchSize:1},fetcher);assert.equal(estimate.tasks.length,7);assert.equal(estimate.performance.batches,7);assert.equal(fetcher.calls.length,8);assert.equal(max,3);assert(estimate.tasks.every(t=>!t.allocations));
});
test('相同请求合并、缓存复制，改参数及强制重算才新调用，缓存明确标记',async()=>{
  const fetcher=provider({handle:async()=>{await new Promise(resolve=>setTimeout(resolve,2));return null;}}),raw=input();
  const [one,two]=await Promise.all([I.estimate(raw,config,fetcher),I.estimate(raw,config,fetcher)]);assert.equal(fetcher.calls.length,2);assert.equal(two.performance.inflightShared,true);assert.equal(two.performance.modelCalls,0);
  one.tasks[0].basis='自行修改';assert.notEqual(two.tasks[0].basis,'自行修改');const hit=await I.estimate(raw,config,fetcher);assert.equal(hit.performance.cacheHit,true);assert.equal(hit.performance.modelCalls,0);assert.equal(fetcher.calls.length,2);
  raw.parameters[0].value=4;await I.estimate(raw,config,fetcher);assert.equal(fetcher.calls.length,4);await I.estimate(raw,config,fetcher,{force:true});assert.equal(fetcher.calls.length,6);
});
test('遗漏、重复任务或陌生人员仅一次定向纠错；持续错误不返回半份',async()=>{
  for(const flaw of ['missing','duplicate','person']){
    let batches=0;const fetcher=provider({handle:async payload=>{if(!payload.tasks)return null;batches++;let rows=payload.tasks.map(t=>task(t.id));if(flaw==='missing')rows.pop();if(flaw==='duplicate')rows.push(rows[0]);if(flaw==='person')rows[0].components[0].personIds=['outside'];return completion({tasks:rows});}});
    await assert.rejects(I.estimate(input(),config,fetcher),/纠错后仍未通过/);assert.equal(batches,2);assert(fetcher.calls.at(-1).payload.validationFeedback);assert(fetcher.calls.at(-1).payload.repairInstruction);
  }
});
test('修复一个格式错误后完整返回，0.1人天及缺依据不可静默四舍五入',async()=>{
  let batches=0;const fetcher=provider({handle:async payload=>{if(!payload.tasks||++batches>1)return null;const rows=payload.tasks.map(t=>task(t.id));rows[0].components[0].days=.1;return completion({tasks:rows});}});
  const estimate=await I.estimate(input(),config,fetcher);assert.equal(estimate.tasks.length,2);assert.equal(batches,2);
  for(const patch of [{basis:''},{components:[{...task('t0').components[0],basis:''}]}])await assert.rejects(I.estimate(input(1),config,provider({task:id=>task(id,patch)})),/纠错后仍未通过/);
});
test('截断和HTTP失败不重试整批，后续只复用已验证阶段、不缓存失败阶段',async()=>{
  let broken=true;const fetcher=provider({handle:async payload=>{if(payload.tasks&&broken)return {ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'length'}]})};return null;}});
  await assert.rejects(I.estimate(input(),config,fetcher),/截断/);assert.equal(fetcher.calls.length,2);broken=false;const estimate=await I.estimate(input(),config,fetcher);assert.equal(estimate.tasks.length,2);assert.equal(fetcher.calls.length,3);assert.equal(estimate.performance.reusedStages,1);assert.equal(estimate.performance.modelCalls,1);
  const failed=provider({handle:async()=>({ok:false,status:503})});await assert.rejects(I.estimate(input(),config,failed),/HTTP 503/);assert.equal(failed.calls.length,1);
});
test('完整148项预算随并发波次增长且最多15分钟，单请求另有超时信号',()=>{
  assert.equal(I.budgetMs(148,16),900000);assert.equal(I.budgetMs(10,16),360000);assert.equal(I.budgetMs(400,1),900000);
});
test('失败后仅重试缺失批次，成功6批及共同阶段复用，模型调用数据实返回',async()=>{
  let broken=true;const fetcher=provider({handle:async payload=>{if(payload.batch===2&&broken){await new Promise(resolve=>setTimeout(resolve,15));return {ok:false,status:503};}return null;}}),c={...config,effortBatchSize:1};
  let first;try{await I.estimate(input(7),c,fetcher);}catch(err){first=err;}assert(first);assert.equal(first.performance.modelCalls,8);assert.equal(fetcher.calls.length,8);
  broken=false;const estimate=await I.estimate(input(7),c,fetcher);assert.equal(fetcher.calls.length,9);assert.equal(estimate.performance.modelCalls,1);assert.equal(estimate.performance.reusedStages,7);assert.equal(estimate.performance.reusedTasks,6);assert.equal(estimate.tasks.length,7);
});
test('强制重算绕过成功及阶段缓存，阶段缓存过期后重新调用，不伪称新模型计算',async()=>{
  let clock=1000000;const fetcher=provider(),c={...config,now:()=>clock},raw=input();await I.estimate(raw,c,fetcher);assert.equal(fetcher.calls.length,2);
  clock+=10*60*1000+1;const staged=await I.estimate(raw,c,fetcher);assert.equal(staged.performance.cacheHit,false);assert.equal(staged.performance.modelCalls,0);assert.equal(staged.performance.reusedStages,2);assert.equal(fetcher.calls.length,2);
  await I.estimate(raw,c,fetcher,{force:true});assert.equal(fetcher.calls.length,4);clock+=60*60*1000+1;const expired=await I.estimate(raw,c,fetcher);assert.equal(expired.performance.reusedStages,0);assert.equal(expired.performance.modelCalls,2);assert.equal(fetcher.calls.length,6);
});
test('外部断点cache可跨fetch实例恢复，缓存记录不含凭证，force依旧新调用',async()=>{
  const entries=new Map(),stageCache={get:key=>entries.get(key),set:(key,value)=>entries.set(key,value),delete:key=>entries.delete(key)},c={...config,stageCache,stageCacheNamespace:'test-persistent-cache'};
  let broken=true;const one=provider({handle:async payload=>payload.tasks&&broken?{ok:false,status:503}:null});await assert.rejects(I.estimate(input(),c,one));assert.equal(entries.size,1);assert(!JSON.stringify([...entries.values()]).includes(config.key));
  broken=false;const two=provider(),estimate=await I.estimate(input(),c,two);assert.equal(two.calls.length,1);assert.equal(estimate.performance.reusedStages,1);const three=provider();await I.estimate(input(),c,three,{force:true});assert.equal(three.calls.length,2);
});
test('批次携完整本批原文、精简全局目录和有关共同详情，保留全局防重边界',async()=>{
  const raw=input(3);raw.tasks.forEach(t=>{t.work+='长任务说明'.repeat(80);t.output+='长成果说明'.repeat(80);});
  const shared=[{id:'s',activity:'共同基础资料归集',output:'共享资料包',days:1,low:.5,high:2,basis:'同一资料服务前两个任务',allocations:[{taskId:'t0',days:.5},{taskId:'t1',days:.5}]}],fetcher=provider({sharedActivities:shared});
  await I.estimate(raw,{...config,effortBatchSize:1},fetcher);const batch=fetcher.calls.find(c=>c.payload.batch===3).payload;assert.equal(batch.tasks[0].work,raw.tasks[2].work);assert.equal(batch.taskSummary.flatMap(g=>g.items).length,3);assert(batch.taskSummary.every(g=>g.items.every(([work,output])=>work.length<=101&&output.length<=101)));assert.equal(batch.globalSharedActivities.length,0);assert.equal(batch.sharedBoundaries.length,1);assert.equal(batch.sharedBoundaries[0].activity,shared[0].activity);
});
test('共用任务未知、重复活动及分摊不守恒在任务估算前拒绝',async()=>{
  const s={id:'s1',activity:'共同准备',output:'共用资料',days:1,low:.5,high:2,basis:'同一次共同准备仅计一次',allocations:[{taskId:'t0',days:.5},{taskId:'t1',days:.5}]};
  for(const rows of [[{...s,allocations:[{taskId:'unknown',days:1}]}],[{...s,days:2}],[s,{...s,id:'s2'}]]){
    const fetcher=provider({sharedActivities:rows});await assert.rejects(I.estimate(input(),config,fetcher),/纠错后仍未通过/);assert.equal(fetcher.calls.length,2);assert(fetcher.calls.every(c=>!c.payload.tasks));
  }
});
test('补算保留原计划共用摘要，已收费活动不能再次生成或计入专属包',async()=>{
  const raw=input();raw.project.existingSharedActivities=[{id:'old-shared',activity:'统一资料归集',output:'共用资料包',days:1,basis:'历史共同活动已计一次',taskIds:['historical-task'],privateNote:'不外发私密附加说明'}];
  const normalized=I.normalizeInput(raw);assert.equal(normalized.project.existingSharedActivities.length,1);assert(!JSON.stringify(normalized).includes('不外发'));
  const shared=[{id:'new-shared',activity:'统一资料归集',output:'共用资料包',days:1,low:.5,high:2,basis:'本次错误重复',allocations:[{taskId:'t0',days:.5},{taskId:'t1',days:.5}]}];
  const fetcher=provider({sharedActivities:shared});await assert.rejects(I.estimate(raw,config,fetcher),/已计入原计划/);assert.equal(fetcher.calls.length,2);assert(fetcher.calls.every(c=>!c.payload.tasks));
  await assert.rejects(I.estimate(raw,config,provider({task:id=>{const t=task(id);t.components[0].activity='统一资料归集';return t;}})),/计费|已计入|保留/);
});
test('实质不能估算保留pending及原因，不伪造0或全份AI计算完成',async()=>{
  const fetcher=provider({task:id=>task(id,{status:'pending',low:null,high:null,components:[],basis:'缺少服务范围与成果深度，暂无法判断',uncertainty:'必要对象边界未知',informationNeeded:['确认服务对象及交付深度']})});
  const estimate=await I.estimate(input(1),config,fetcher);assert.equal(estimate.tasks[0].status,'pending');assert.equal(estimate.tasks[0].low,null);assert.deepEqual(estimate.tasks[0].components,[]);
});
test('输入白名单拒绝非季度数、重复ID、未知手选人员和不安全接口，原输入不变',async()=>{
  let calls=0;const fetcher=async()=>{calls++;throw Error('不应请求');};
  const variants=[];const a=input();a.people[0].capacity=.1;variants.push(a);const b=input();b.tasks[1].id='t0';variants.push(b);const d=input();d.tasks[0].participantIds=['outside'];variants.push(d);const e=input();e.parameters[0].source='伪称用户';variants.push(e);
  for(const raw of variants)await assert.rejects(I.estimate(raw,config,fetcher));await assert.rejects(I.estimate(input(),{...config,base:'ftp://localhost'},fetcher),/HTTPS/);await assert.rejects(I.estimate(input(),{},fetcher),/配置/);assert.equal(calls,0);
});
test('网关新增初算状态与路由，拒绝跨源及非POST，UTF8分块完整，返回统一estimate',async()=>{
  async function request(method,headers,chunks=[],url='/api/plan-ai/estimate'){const req=Readable.from(chunks);Object.assign(req,{url,method,headers});let status,data;await S.handler(req,{writeHead:n=>status=n,end:value=>data=JSON.parse(value)});return {status,data};}
  assert.equal((await request('GET',{})).status,405);assert.equal((await request('POST',{host:'127.0.0.1:8877',origin:'https://other.invalid'})).status,403);
  const original=I.estimate;try{I.estimate=async value=>{assert.equal(value.project.name,input().project.name);return {method:'model',tasks:[]};};const bytes=Buffer.from(JSON.stringify({input:input()})),chunks=[...bytes].map(b=>Buffer.from([b]));const result=await request('POST',{host:'127.0.0.1:8877',origin:'http://127.0.0.1:8877'},chunks);assert.equal(result.status,200);assert.equal(result.data.estimate.method,'model');}finally{I.estimate=original;}
  const status=await request('GET',{},[],'/api/plan-ai/status');assert.equal(status.data.effortEstimation,'effort-v1');
});
test('进度轮询只给真实完成数量和阶段，跨源及短ID拒绝，重复运行ID不污染原请求',async()=>{
  async function request(method,url,body,headers={host:'127.0.0.1:8877',origin:'http://127.0.0.1:8877'}){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url,method,headers});let status,data;await S.handler(req,{writeHead:n=>status=n,end:value=>data=JSON.parse(value)});return {status,data};}
  const id='offline-progress-'+Date.now(),original=I.estimate;let finish;
  try{I.estimate=async(raw,c)=>{c.onProgress({stage:'batch-done',completed:1,total:2,batch:1,batches:2,private:'不能出现在进度'});await new Promise(resolve=>finish=resolve);return {method:'model',tasks:[]};};
    const pending=request('POST','/api/plan-ai/estimate',{input:input(),requestId:id});while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
    const polling=await request('GET','/api/plan-ai/estimate-progress?id='+id);assert.equal(polling.data.completed,1);assert.equal(polling.data.state,'running');assert(!JSON.stringify(polling.data).includes('private'));assert(!JSON.stringify(polling.data).includes('产业园'));
    const duplicate=await request('POST','/api/plan-ai/estimate',{input:input(),requestId:id});assert.equal(duplicate.status,400);assert.equal((await request('GET','/api/plan-ai/estimate-progress?id='+id)).data.state,'running');
    assert.equal((await request('GET','/api/plan-ai/estimate-progress?id='+id,null,{host:'127.0.0.1:8877',origin:'https://other.invalid'})).status,403);assert.equal((await request('GET','/api/plan-ai/estimate-progress?id=short')).status,400);
    finish();assert.equal((await pending).status,200);const complete=await request('GET','/api/plan-ai/estimate-progress?id='+id);assert.equal(complete.data.state,'complete');assert.equal(complete.data.completed,2);
  }finally{finish?.();I.estimate=original;}
});
