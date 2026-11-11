const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../plan-builder.js'),R=require('../plan-recommendations.js'),N=require('../server/node-recommendations.cjs'),S=require('../server/plan-server.cjs'),{Readable}=require('node:stream');
function project(){return {id:'funeral',name:'示例产业园咨询计划',description:'为三个待选地块开展产业服务需求调查、规划策划和投融资咨询',scope:'需求研究、规划定位与投融资咨询，不负责施工',people:[{id:'secret-person',name:'不发送的员工'}],materials:[{name:'不发送的附件'}],tree:[{id:'m',type:'module',name:'总体研究',children:[{id:'c',type:'category',name:'园区服务需求研究',children:[{id:'t',type:'task',work:'核实项目现状',output:'《现状清单》',selected:true}]}]}]};}
const config={base:'https://api.moonshot.cn/v1',key:'fixture-secret',model:'fixture',json:true,reasoning:'low'};
const source={title:'园区公共服务规划',url:'https://www.gov.cn/example',snippet:'应调查服务需求，研究服务设施布局及用地条件。',chunks:[{text:'摸清园区服务对象需求及设施服务能力。'}],site_name:'政府网'};
const reply=data=>({ok:true,text:async()=>JSON.stringify(data)});
const completion=value=>reply({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
function provider(type,options={}){let calls=[];const f=async(url,opts)=>{
 const body=JSON.parse(opts.body);calls.push({url:String(url),body});
 if(body.messages&&JSON.parse(body.messages[1].content).stage==='search-query')return completion({query:'园区服务需求 调查方法 设施规划'});
 if(String(url).endsWith('/tools/search_pro'))return options.search||reply({search_results:[source]});
 return options.model||completion({candidates:options.candidates||[0,1].map(i=>({...type==='task'?{work:'核实第'+i+'类园区服务需求',output:'《第'+i+'类需求成果》'}:{name:'新增专业方向'+i},reason:'结合项目服务边界，由检索片段的需求调查方法推导',sourceIds:[1]})),explanation:'建议需结合委托范围确认'});
 };f.calls=calls;return f;}
for(const [type,parent]of [['module',''],['category','m'],['task','c']])test(type+'真实检索链路先规划检索词再搜再生成，候选带服务器核对来源且不发员工附件',async()=>{
 const p=project(),snapshot=JSON.stringify(p),f=provider(type),input=R.request(p,type,parent),result=await N.recommend(input,config,f);
 assert.equal(result.candidates.length,2);assert(result.searched);assert.equal(f.calls.length,3);assert.match(f.calls[1].url,/tools\/search_pro$/);assert.equal(f.calls[1].body.limit,6);assert.deepEqual(f.calls[1].body.sites,['gov.cn']);
 const payload=JSON.parse(f.calls[2].body.messages[1].content);assert.equal(payload.type,type);assert.equal(payload.parents.length,type==='module'?0:type==='category'?1:2);assert(!JSON.stringify(payload).includes('不发送'));assert(!JSON.stringify(payload).includes('secret-person'));
 assert(result.candidates.every(c=>c.sources[0].url===source.url&&c.sources[0].excerpt.includes('设施服务能力')));assert.equal(JSON.stringify(p),snapshot);
});
test('已存在及历史展示项排除，少于两个如实说明，不凑数量',async()=>{
 const p=project(),f=provider('task',{candidates:[{work:'核实 项目现状。',output:'现状清单',reason:'需求',sourceIds:[1]},{work:'历史展示任务',output:'报告',reason:'需求',sourceIds:[1]}]});
 const r=await N.recommend(R.request(p,'task','c',[{work:'历史展示任务'}],1),config,f);assert.equal(r.candidates.length,0);assert.match(r.explanation,/过滤2项/);
});
test('没有有效来源不生成候选；未知来源编号和危险链接不能冒充依据',async()=>{
 for(const search of [reply({search_results:[]}),reply({search_results:[{...source,url:'javascript:alert(1)'}]})]){const f=provider('task',{search}),r=await N.recommend(R.request(project(),'task','c'),config,f);assert.equal(r.candidates.length,0);assert.equal(f.calls.filter(c=>c.body.messages).length,1);assert.equal(f.calls.filter(c=>c.body.text_query).length,2);}
 const f=provider('task',{candidates:[{work:'专业活动',output:'成果',reason:'依据',sourceIds:[999]}]});await assert.rejects(N.recommend(R.request(project(),'task','c'),config,f),/未检索到/);
});
test('父级层级、超量历史、缺配置及不安全接口在调用前拒绝',async()=>{
 let calls=0;const f=()=>{calls++;throw Error('不应调用');};assert.throws(()=>R.request(project(),'task','m'),/父级/);assert.throws(()=>R.request(project(),'module','c'),/父级/);
 await assert.rejects(N.recommend({...R.request(project(),'task','c'),seen:Array(301).fill({})},config,f),/历史/);
 await assert.rejects(N.recommend(R.request(project(),'task','c'),{},f),/配置/);
 await assert.rejects(N.recommend(R.request(project(),'task','c'),{...config,searchBase:'ftp://localhost/v1',searchKey:'fixture'},f),/HTTPS/);assert.equal(calls,0);
});
test('截断、无效JSON、空成果、搜索失败不返回半份候选',async()=>{
 const input=R.request(project(),'task','c');
 for(const options of [{search:{ok:false,status:503}},{model:reply({choices:[{finish_reason:'length'}]})},{model:reply({choices:[{message:{content:'broken'}}]})},{candidates:[{work:'任务',output:'',reason:'依据',sourceIds:[1]}]}])await assert.rejects(N.recommend(input,config,provider('task',options)));
});
test('选择、编辑、添加1或2项原子提交并保留来源；过期或重复添加不改树',()=>{
 const p=project(),stamp=R.fingerprint(p,'task','c'),candidate={work:'服务对象访谈',output:'《访谈纪要》',reason:'需求',sources:[{...source,excerpt:source.snippet}]};
 const before=JSON.stringify(p);assert.throws(()=>R.add(p,'task','c',[candidate,{...candidate,output:'其他'}],stamp),/已存在/);assert.equal(JSON.stringify(p),before);
 const nodes=R.add(p,'task','c',[candidate],stamp);assert.equal(nodes.length,1);assert(nodes[0].selected);assert.equal(nodes[0].recommendation.sources[0].url,source.url);
 assert.throws(()=>R.add(p,'task','c',[{...candidate,work:'其他访谈'}],stamp),/已变化/);
 const edited={...candidate,work:'项目专项需求核实',output:'《专项需求清单》'};R.add(p,'task','c',[edited],R.fingerprint(p,'task','c'));assert(B.find(p.tree,nodes[0].id));
});
test('网关推荐路由拒绝跨来源和非POST，UTF8分块请求中文不损坏',async()=>{
 async function request(method,headers,body){const req=Readable.from(body||[]);Object.assign(req,{url:'/api/plan-ai/recommend',method,headers});let code,data;await S.handler(req,{writeHead:n=>code=n,end:value=>{data=JSON.parse(value);}});return {code,data};}
 assert.equal((await request('GET',{})).code,405);assert.equal((await request('POST',{host:'127.0.0.1:8877',origin:'https://other.invalid'})).code,403);
 const original=N.recommend;try{N.recommend=async input=>{assert.equal(input.project.name,project().name);return {searched:true,candidates:[]};};const bytes=Buffer.from(JSON.stringify(R.request(project(),'task','c'))),chunks=[...bytes].map(b=>Buffer.from([b]));const r=await request('POST',{host:'127.0.0.1:8877',origin:'http://127.0.0.1:8877'},chunks);assert.equal(r.code,200);assert(r.data.recommendation.searched);}finally{N.recommend=original;}
});
test('两个候选只添加到指定父级，其他分支与已有任务身份保持',()=>{
 const p=project(),old=B.clone(p.tree[0].children[0].children[0]),stamp=R.fingerprint(p,'task','c');
 const added=R.add(p,'task','c',[{work:'核实服务覆盖范围',output:'《覆盖范围清单》'},{work:'访谈设施使用对象',output:'《使用对象访谈纪要》'}],stamp);
 assert.equal(added.length,2);assert.equal(p.tree[0].children[0].children.length,3);assert.deepEqual(p.tree[0].children[0].children[0],old);assert(added.every(n=>n.selected));
});
test('模型混淆层级时只做一次定向纠错，重复错误不返回候选',async()=>{
 for(const alwaysBad of [false,true]){
  let attempts=0;const good=provider('category');
  const fetcher=async(url,opts)=>{const body=JSON.parse(opts.body),payload=body.messages?JSON.parse(body.messages[1].content):null;
   if(payload&&payload.stage!=='search-query'){
    attempts++;assert.match(body.messages[0].content,/当前唯一目标层级.*二级工作方向/);
    if(attempts===1||alwaysBad)return completion({candidates:[{work:'错误的三级活动',output:'错误成果',reason:'依据',sourceIds:[1]}],explanation:'不应接受此层级'});
    assert.match(payload.validationFeedback,/name/);assert.match(payload.repairInstruction,/二级|module\/category/);
   }return good(url,opts);
  };
  const job=N.recommend(R.request(project(),'category','m'),config,fetcher);
  if(alwaysBad)await assert.rejects(job,/纠错后仍不完整/);else assert.equal((await job).candidates.length,2);
  assert.equal(attempts,2);
 }
});
