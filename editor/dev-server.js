/* Local Studio backend. Run: node editor/dev-server.js (localhost:8793). */
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.woff2':'font/woff2'};
function safe(relative){if(!relative || relative.includes('\0') || relative.split(/[\\/]/).some(p=>p==='..'||p.startsWith('.')))throw Error('Invalid path');const full=path.resolve(ROOT,relative);if(!full.startsWith(ROOT+path.sep))throw Error('Invalid path');let ancestor=full;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);if(!fs.realpathSync(ancestor).startsWith(ROOT+path.sep)&&fs.realpathSync(ancestor)!==ROOT)throw Error('Invalid path');return full;}
function manifest(){const ids=dir=>fs.readdirSync(path.join(ROOT,'content',dir)).filter(n=>n.endsWith('.json')).map(n=>n.slice(0,-5));return {works:ids('works'),categories:ids('categories')};}
const allowedFile=/^(content\/(works|categories|pages|settings)\/[a-z0-9-]+\.json|assets\/work\/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp|gif))$/;
function snapshot(){
  const hashes={},records={};
  for(const dir of ['content/works','content/categories','content/pages','content/settings','assets/work']){
    for(const name of fs.readdirSync(safe(dir)).sort()){
      const relative=dir+'/'+name;if(!allowedFile.test(relative))continue;
      const full=safe(relative);if(!fs.statSync(full).isFile())continue;
      const bytes=fs.readFileSync(full);hashes[relative]=crypto.createHash('sha256').update(bytes).digest('hex');
      if(relative.startsWith('content/'))records[relative]=JSON.parse(bytes.toString('utf8'));
    }
  }
  return {sha:crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),hashes,records};
}
async function readBody(req){let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>100*1024*1024)throw Error('Publish exceeds 100 MB');chunks.push(chunk);}return Buffer.concat(chunks);}
let nextWriteDelay=0;
async function delayNextWrite(){const ms=nextWriteDelay;nextWriteDelay=0;if(ms)await new Promise(resolve=>setTimeout(resolve,ms));}
const server=http.createServer(async(req,res)=>{
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
    const url=new URL(req.url,'http://localhost:8793');let pathname=decodeURIComponent(url.pathname).replace(/^\/ed-eastham(?=\/|$)/,'');
    if(pathname.startsWith('/__dev/')){
      if(req.headers.origin && !['http://localhost:8793','http://127.0.0.1:8793'].includes(req.headers.origin))return json(403,{message:'Local origin required'});
      if(pathname==='/__dev/slow' && req.method==='GET'){
        const ms=Number(url.searchParams.get('ms'));
        if(!Number.isInteger(ms) || ms<0 || ms>60000)return json(400,{message:'Expected ms between 0 and 60000'});
        nextWriteDelay=ms;return json(200,{ms});
      }
      if(pathname==='/__dev/snapshot' && req.method==='GET')return json(200,snapshot());
      if(pathname==='/__dev/publish' && req.method==='POST'){
        const payload=JSON.parse((await readBody(req)).toString('utf8'));
        if(!Array.isArray(payload.files))return json(400,{message:'Expected files'});
        // Validate everything before touching disk. Same path/deletion rules as /file.
        const writes=payload.files.map(f=>{
          if(!allowedFile.test(f.path))throw Error('File not allowed');
          const full=safe(f.path);
          if(f.content===null){if(!/^content\/(works|categories)\//.test(f.path))throw Error('Only work/category records can be removed');return {full,body:null};}
          if(typeof f.content!=='string')throw Error('Expected file content');
          const isJSON=f.path.startsWith('content/');
          if(!isJSON && f.encoding!=='base64')throw Error('Expected base64 picture');
          const body=Buffer.from(f.content,isJSON?'utf8':'base64');
          if(body.length>25*1024*1024)throw Error('File exceeds 25 MB');
          if(isJSON){const value=JSON.parse(body.toString());if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected a JSON object');}
          return {full,body};
        });
        await delayNextWrite();
        // No await between comparison and writes: competing dev-server PUTs cannot interleave.
        if(snapshot().sha!==payload.sha)return json(409,{message:'Files changed; reload latest before publishing'});
        const previous=writes.map(w=>({...w,previous:fs.existsSync(w.full)?fs.readFileSync(w.full):null}));
        try{for(const w of writes){if(w.body===null){if(fs.existsSync(w.full))fs.unlinkSync(w.full);}else{fs.mkdirSync(path.dirname(w.full),{recursive:true});fs.writeFileSync(w.full,w.body);}}}
        catch(e){for(const w of previous){if(w.previous===null){if(fs.existsSync(w.full))fs.unlinkSync(w.full);}else fs.writeFileSync(w.full,w.previous);}throw e;}
        return json(200,snapshot());
      }
      if(pathname==='/__dev/list'&&req.method==='GET'){const dir=url.searchParams.get('dir');if(!['assets/work','content/works','content/categories'].includes(dir))return json(403,{message:'Directory not allowed'});return json(200,fs.readdirSync(safe(dir)).filter(n=>fs.statSync(safe(dir+'/'+n)).isFile()));}
      if(pathname==='/__dev/file'&&['PUT','DELETE'].includes(req.method)){
        const relative=url.searchParams.get('path')||'';
        if(!allowedFile.test(relative))return json(403,{message:'File not allowed'});
        const full=safe(relative);
        if(req.method==='DELETE'){await delayNextWrite();if(!/^content\/(works|categories)\//.test(relative))return json(403,{message:'Only work/category records can be removed'});if(fs.existsSync(full))fs.unlinkSync(full);return json(200,{ok:true});}
        let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>25*1024*1024)return json(413,{message:'Picture exceeds 25 MB'});chunks.push(chunk);}const body=Buffer.concat(chunks);
        if(relative.endsWith('.json')){const value=JSON.parse(body.toString());if(!value||typeof value!=='object'||Array.isArray(value))return json(400,{message:'Expected a JSON object'});}
        await delayNextWrite();
        fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,body);return json(200,{ok:true});
      }return json(404,{message:'Unknown endpoint'});
    }
    if(!['GET','HEAD'].includes(req.method))return json(405,{message:'Method not allowed'});
    // Dynamic manifest avoids modifying content merely by starting the development server.
    if(pathname==='/content/index.json')return json(200,manifest());
    let relative=pathname.replace(/^\//,'')||'index.html';let full=safe(relative);
    if(fs.existsSync(full)&&fs.statSync(full).isDirectory())full=safe(relative.replace(/\/$/,'')+'/index.html');
    if(!fs.existsSync(full) && !path.extname(relative))full=path.join(ROOT,'index.html');
    if(!fs.existsSync(full))return json(404,{message:'Not found'});
    res.writeHead(200,{'Content-Type':mime[path.extname(full)]||'application/octet-stream','Cache-Control':'no-store'});if(req.method==='HEAD')return res.end();fs.createReadStream(full).pipe(res);
  }catch(e){json(400,{message:e.message});}
});
server.listen(8793,'127.0.0.1',()=>console.log('Studio: http://localhost:8793/ed-eastham/edit/?local=1'));
