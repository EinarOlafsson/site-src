import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from '/mnt/wd4tb/scratch/n687v3/verify/node_modules/playwright-core/index.mjs';
const site='/mnt/wd4tb/spacr-worktrees/codex-home-b-site-20261014';
const dir='/mnt/wd4tb/scratch/home-b-n698-site-20261015/dist-localized';
const after=fs.readFileSync(site+'/src/assets/js/fx.js','utf8');
const before=execFileSync('git',['show','f2115f8202b4421bc70922712076bb0b7c416949:src/assets/js/fx.js'],{cwd:site,encoding:'utf8'});
const sha=x=>createHash('sha256').update(x).digest('hex');
const results=[];
const server=http.createServer((req,res)=>{
 const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.resolve(dir,'.'+route+(route.endsWith('/')?'index.html':''));
 if(!file.startsWith(dir+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
 res.writeHead(200,{'Content-Type':mime});fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
try{
 for(const spec of [{name:'baseline-software',source:before,theme:'dark',mode:null,webgl:true},{name:'candidate-software-dark',source:after,theme:'dark',mode:null,webgl:false},{name:'candidate-software-light',source:after,theme:'light',mode:null,webgl:false},{name:'candidate-explicit-override',source:after,theme:'dark',mode:'always',webgl:true}]){
  const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:375,height:812}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',route=>{if(!route.request().url().startsWith(base+'/'))return route.abort();return route.continue();});
  await page.route('**/assets/js/fx.js?*',route=>route.fulfill({contentType:'text/javascript',body:spec.source}));
  await page.addInitScript(({theme,mode})=>{
   localStorage.setItem('theme',theme);if(mode)localStorage.setItem('fx-motion',mode);
   window.contextRequests=[];
   const original=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(kind,options){
    const result=original.call(this,kind,options);
    if(kind.includes('webgl')){
     let renderer=null;if(result){const ext=result.getExtension('WEBGL_debug_renderer_info');if(ext)renderer=result.getParameter(ext.UNMASKED_RENDERER_WEBGL);}
     window.contextRequests.push({kind,options,result:!!result,renderer});
    }
    return result;
   };
  },spec);
  await page.goto(base+'/',{waitUntil:'load'});
  await page.waitForFunction(()=>window.contextRequests.length>0);
  if(spec.webgl)await page.waitForFunction(()=>document.documentElement.classList.contains('has-webgl'));
  else await page.waitForFunction(()=>!document.getElementById('fx'));
  const state=await page.evaluate(()=>({requests:window.contextRequests,hasWebgl:document.documentElement.classList.contains('has-webgl'),fallbackDisplay:getComputedStyle(document.querySelector('.fx-css')).display,fallbackImage:getComputedStyle(document.querySelector('.fx-css')).backgroundImage,heading:document.querySelector('h1').innerText,overflow:document.documentElement.scrollWidth>innerWidth,theme:document.documentElement.dataset.theme,reduced:document.documentElement.classList.contains('no-motion')}));
  assert.equal(state.hasWebgl,spec.webgl);assert.equal(state.theme,spec.theme);assert.equal(state.reduced,true);assert.equal(state.overflow,false);assert.match(state.heading,/Software, models and hardware/);assert.deepEqual(errors,[]);
  if(spec.webgl)assert.match(state.requests.find(x=>x.result).renderer,/SwiftShader/i);
  else {assert.equal(state.fallbackDisplay,'block');assert.match(state.fallbackImage,/radial-gradient/);assert(state.requests.every(x=>x.options.failIfMajorPerformanceCaveat===true));}
  results.push({name:spec.name,status:'PASS',...state});await context.close();
 }
 console.log(JSON.stringify({status:'PASS',browser:browser.version(),before_sha256:sha(before),after_sha256:sha(after),results,limits:['CPU SwiftShader functional proof only; no hardware GPU, timing, Lighthouse or physical frame-rate claim.','Existing built fixture with actual full fx.js swapped; no protected page decrypt/build/publication.']},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
