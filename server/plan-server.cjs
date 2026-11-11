/* Node 20+，无第三方服务端依赖。仅显式执行本文件时监听本机；导入测试不会启动。 */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const O=require('./open-task-generation.cjs');
const N=require('./node-recommendations.cjs');
const I=require('./ai-effort-estimation.cjs');
// 仅记录不含项目文字的本机运行进度，随机标识由当前页面生成。
const effortProgress=new Map(),PROGRESS_MS=10*60*1000;
function pruneProgress(){const now=Date.now();for(const [id,row]of effortProgress)if(now-row.at>PROGRESS_MS)effortProgress.delete(id);while(effortProgress.size>100)effortProgress.delete(effortProgress.keys().next().value);}
function validRequestId(id){return typeof id==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(id);}
const ROOT=path.resolve(__dirname,'..');
function loadEnv(filename=path.join(__dirname,'.env')){if(!fs.existsSync(filename))return;for(const line of fs.readFileSync(filename,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_0-9]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^(["'])(.*)\1$/,'$2');}}
function config(env=process.env){const model=env.PLAN_AI_MODEL||'';return {base:env.PLAN_AI_BASE_URL||'',key:env.PLAN_AI_API_KEY||'',model,json:env.PLAN_AI_JSON_MODE!=='0',tokens:Number(env.PLAN_AI_MAX_TOKENS||16000),reasoning:env.PLAN_AI_REASONING_EFFORT||(/^kimi-k3/.test(model)?'low':undefined),taskBatchSize:Number(env.PLAN_AI_TASK_BATCH_SIZE||48),effortBatchSize:Number(env.PLAN_AI_EFFORT_BATCH_SIZE||16),searchBase:env.PLAN_SEARCH_BASE_URL||'',searchKey:env.PLAN_SEARCH_API_KEY||''};}
function configured(c){return !!(c.base&&c.key&&c.model);}
async function adapt(project,c=config(),fetcher=fetch,options={}){return O.generate(project,c,fetcher,options);}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function handler(req,res){
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/api/plan-ai/status'){send(res,200,{configured:configured(config()),webSearch:N.configured(config()),recommendation:'web-v1',taskGeneration:'open-v1',taskGenerationWebSearch:false,effortEstimation:'effort-v1',effortProgress:true});return;}
  if(pathname==='/api/plan-ai/estimate-progress'){
    if(req.method!=='GET'){send(res,405,{error:'请使用GET'});return;}
    if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host||req.headers['sec-fetch-site']==='cross-site'){send(res,403,{error:'请从本机工作台查看初算进度'});return;}
    const id=new URL(req.url,'http://localhost').searchParams.get('id');if(!validRequestId(id)){send(res,400,{error:'进度标识无效'});return;}pruneProgress();
    const row=effortProgress.get(id);if(!row){send(res,404,{error:'进度已过期或尚未开始'});return;}const {at,...progress}=row;send(res,200,progress);return;
  }
  if(pathname==='/api/plan-ai/adapt'||pathname==='/api/plan-ai/recommend'||pathname==='/api/plan-ai/estimate'){
    if(req.method!=='POST'){send(res,405,{error:'请使用POST'});return;}
    if(req.headers.origin!=='http://'+req.headers.host){send(res,403,{error:'请从本机工作台页面访问适配接口'});return;}
    let size=0,requestId='',progressRow=null;const chunks=[];try{for await(const chunk of req){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>512*1024)throw Error('项目资料超过512 KB');chunks.push(bytes);}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(pathname==='/api/plan-ai/estimate'){
        if(data.requestId!==undefined&&!validRequestId(data.requestId))throw Error('进度标识无效');const proposedId=data.requestId||'';if(proposedId&&effortProgress.get(proposedId)?.state==='running')throw Error('进度标识正在使用，请刷新后重试');requestId=proposedId;const c=config(),total=Array.isArray(data.input?.tasks)?data.input.tasks.length:0;
        if(requestId){pruneProgress();progressRow={at:Date.now(),state:'running',stage:'starting',completed:0,total};effortProgress.set(requestId,progressRow);c.onProgress=event=>{progressRow.at=Date.now();progressRow.stage=String(event.stage||'running').slice(0,40);for(const key of ['completed','total','batch','batches'])if(Number.isInteger(event[key])&&event[key]>=0)progressRow[key]=event[key];};}
        const estimate=await I.estimate(data.input,c,fetch,{force:data.force===true});if(progressRow)Object.assign(progressRow,{at:Date.now(),state:'complete',stage:'complete',completed:total,total});send(res,200,{estimate});
      }
      else if(pathname==='/api/plan-ai/recommend'){const recommendation=await N.recommend(data,config());send(res,200,{recommendation});}
      else{const candidate=await adapt(data.project,config(),fetch,{force:data.force===true});send(res,200,{candidate});}
    }catch(err){if(progressRow)Object.assign(progressRow,{at:Date.now(),state:'failed',stage:'failed'});const c=config();let message=String(err.message);for(const key of [c.key,c.searchKey])if(key)message=message.split(key).join('[已隐藏]');send(res,400,{error:['TimeoutError','AbortError'].includes(err.name)?'检索或模型请求超时，请重试':message.slice(0,300)});}return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){send(res,405,{error:'不支持的方法'});return;}
  const relative=pathname==='/'?'index.html':pathname.replace(/^\//,'');
  // 只响应应用静态文件请求。
  const allowed=/^[\w-]+\.(html|js|css)$/.test(relative)||/^vendor\/[\w.-]+\.(js|css)$/.test(relative);
  if(!allowed){send(res,404,{error:'未找到'});return;}const full=path.join(ROOT,relative);
  if(!fs.existsSync(full)||!fs.statSync(full).isFile()){send(res,404,{error:'未找到'});return;}
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
  res.writeHead(200,{'Content-Type':mime[path.extname(full)],'X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')res.end();else fs.createReadStream(full).pipe(res);
}
if(require.main===module){loadEnv();const port=Number(process.env.PLAN_PORT||8877);http.createServer((req,res)=>handler(req,res).catch(()=>send(res,500,{error:'服务处理失败'}))).listen(port,'127.0.0.1',()=>console.log('本机工作台：http://127.0.0.1:'+port));}
module.exports={adapt,config,configured,loadEnv,handler};
