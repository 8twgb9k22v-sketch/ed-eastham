/* Studio. From the site directory:
   node editor/dev-server.js
   python3 editor/test-editor.py
   Open http://localhost:8793/ed-eastham/edit/?local=1 */
'use strict';
const ROOT = location.pathname.replace(/edit\/.*$/, '');
const LOCAL = new URLSearchParams(location.search).get('local') === '1';
const IDENTITY = 'https://ed-eastham.netlify.app/.netlify/identity';
const GATEWAY = 'https://ed-eastham.netlify.app/.netlify/git/github/';
const $ = s => document.querySelector(s), clone = x => JSON.parse(JSON.stringify(x));
const base = f => (f || '').replace(/^.*\//, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const frame = $('#site-frame');
let model, loaded, undoStack = [], redoStack = [], selected = null, panel = null, preview = false, busy = false, token = null;
const uploads = new Map(); // File and object URL live outside the JSON history.
let baseline = null, sessionLoaded = false, loginWait = null, resumeLogin = null, refreshWait = null;
let draftQueue = Promise.resolve(), draftReady = false, draftRevision = 0, published = false;
const draftSite = location.origin + ROOT + (LOCAL ? 'local' : 'gateway');
let sessionId=crypto.randomUUID(), inlineTimer, ownsLock=false, releaseLock, acquiring=false, takingOver=false;
const lockName='studio:'+draftSite, tabId=crypto.randomUUID();
const channel=typeof BroadcastChannel==='function' ? new BroadcastChannel(lockName) : null;
let pendingPanel = null, remotePictures = new Set();
let media = [], thumbs = [], noticeTimer, inline = null, pictureTarget = null;
const sorted = obj => Object.entries(obj).sort((a,b) => (a[1].order || 99) - (b[1].order || 99) || a[0].localeCompare(b[0]));
function assemble(m){
  const site = clone(m.settings.site), home = m.settings.home, look = m.settings.look, pages = clone(m.pages);
  if(pages.about.image) pages.about.image = base(pages.about.image);
  const works = sorted(m.works).map(([id,w]) => ({id,...clone(w)})).filter(w => w.file && w.title && !/\.heic$/i.test(w.file));
  const cats = sorted(m.categories).map(([id,c]) => ({...c,slug:id}));
  const known = new Set(cats.map(c => c.slug));
  const orphans = works.filter(w => !known.has(w.category));
  if(orphans.length){cats.push({slug:'other-works',title:'Other works',intro:''});orphans.forEach(w => w.category = 'other-works');}
  return {...site,home:{featured:(home.featured || []).map(id => {const w = works.find(w => w.id === id || base(w.file) === id || base(w.file) === id + '.jpg');return w ? base(w.file) : null;}).filter(Boolean)},pages,
    settings:{colours:look.colours,typeface:look.typeface,logo:look.logo && {style:look.logo.style,image:base(look.logo.image)},home:{showSelectedWorks:home.showSelectedWorks !== false,showCategories:home.showCategories !== false,showCommission:home.showCommission !== false,selectedCount:home.selectedCount || 6},labels:look.labels,social:look.social || [],footerLine:look.footerLine || ''},
    categories:cats.map(c => ({slug:c.slug,title:c.title,intro:c.intro || '',works:works.filter(w => w.category === c.slug).map(w => ({file:base(w.file),title:w.title,medium:w.medium,size:w.size || '',year:w.year || '',price:w.price || '',sold:!!w.sold}))})),thumbs};
}
function say(message){clearTimeout(noticeTimer);$('#notice').textContent = message;$('#notice').hidden = !message;if(message) noticeTimer = setTimeout(() => $('#notice').hidden = true,6000);}
function dirty(){return model && JSON.stringify(model) !== JSON.stringify(loaded);}
function status(){ $('#publish-status').textContent = published && !dirty() ? 'Published' : dirty() ? 'Unpublished changes' : ''; $('#dirty').hidden = !dirty(); $('#undo').disabled = !undoStack.length || busy; $('#redo').disabled = !redoStack.length || busy; $('#publish').disabled = !dirty() || busy; }
function mutate(fn){if(!ownsLock || busy) return;commitPanel(false); const before = clone(model);fn(model);if(JSON.stringify(before) === JSON.stringify(model)) return;undoStack.push(before);redoStack=[];saveDraft();draw();}
function change(key,value){const [record,field] = key.split(':');mutate(m => {let obj = record.split('/').reduce((o,k)=>o[k],m);const parts=field.split('.');for(const p of parts.slice(0,-1)) obj=obj[p] ??= {};obj[parts.at(-1)] = value;});}
function get(key){const [record,field] = key.split(':');return [...record.split('/'),...field.split('.')].reduce((o,k)=>o?.[k],model);}
function undo(){if(!hasOwnership())return;commitPanel(false);if(!undoStack.length || busy)return;cancelInline();redoStack.push(clone(model));model=undoStack.pop();saveDraft();draw();refreshPanel();}
function redo(){if(!hasOwnership())return;commitPanel(false);if(!redoStack.length || busy)return;cancelInline();undoStack.push(clone(model));model=redoStack.pop();saveDraft();draw();refreshPanel();}
function activeUploads(){return (model.media || []).filter(n=>uploads.has(n));}
function draw(){
  const api=frame.contentWindow.__site;if(!api?.getS())return;
  const s=assemble(model);
  // IDs are editor-only annotations; assemble itself matches build.js's public shape.
  for(const c of s.categories){const ws=sorted(model.works).filter(([,w])=>w.file && w.title && !/\.heic$/i.test(w.file) && (w.category===c.slug || c.slug==='other-works' && !model.categories[w.category]));c.works.forEach((w,i)=>w.id=ws[i]?.[0]);}
  frame.contentWindow.__studioPictures=Object.fromEntries([...uploads].map(([n,u])=>[n,u.url]));
  s.thumbs=thumbs.filter(n=>!uploads.has(n));api.setS(s);
  frame.contentDocument.body.style.fontSize = s.settings.typeface==='Cormorant Garamond' ? '20px' : '';
  // The site rewrites menu URLs after rendering; update their labels via their route.
  for(const [k,v] of Object.entries(model.settings.look.labels || {})) frame.contentDocument.querySelectorAll('#menu a').forEach(a=>{if(a.getAttribute('href')===ROOT+k)a.textContent=v;});
  pageOptions();status();showProperties();decorate();
}
function pageOptions(){const value=frame.contentWindow.__site.pathOf();$('#page-switcher').innerHTML=[['','Home'],['about','About'],...sorted(model.categories).map(([id,c])=>['portfolio/'+id,c.title]),...['commission','shop','contact'].map(k=>[k,k[0].toUpperCase()+k.slice(1)])].map(([p,t])=>`<option value="${esc(p)}">${esc(t)}</option>`).join('');$('#page-switcher').value=value;}
function navigate(path){commitInline();deselect();frame.contentWindow.__site.navigate('/'+path);$('#page-switcher').value=path;}
function label(key){const field=key.split(':')[1];return field.startsWith('body.')?'Paragraph':field==='file'?'Picture':field[0].toUpperCase()+field.slice(1);}
let toolbar, hoverLabel, dragId;
function pictureReferences(){return [...Object.entries(model.works).map(([id,w])=>({key:'works/'+id+':file',file:w.file,title:w.title || id})),...Object.entries(model.pages).map(([id,p])=>({key:'pages/'+id+':image',file:p.image,title:p.title || id})),{key:'settings/look:logo.image',file:model.settings.look.logo?.image,title:'Logo'}].filter(p=>p.file);}
function missingPictures(){return pictureReferences().filter(p=>!uploads.has(base(p.file)) && !remotePictures.has(base(p.file)));}
function missingMessage(){const missing=missingPictures();return missing.length?'Picture missing: '+missing.map(p=>p.title).join(', ')+'. Choose picture again before publishing.':'';}
function decorate(){const doc=frame.contentDocument;if(!doc || !model)return;
  doc.body.classList.toggle('studio-preview',preview);
  doc.querySelectorAll('[data-edit]').forEach(el=>{el.tabIndex=0;el.dataset.studioLabel=label(el.dataset.edit);el.classList.toggle('studio-selected',el.dataset.edit===selected);});
  doc.querySelectorAll('[data-editlist] figure').forEach(el=>{el.draggable=!preview;});
  if(selected && !doc.querySelector(`[data-edit="${CSS.escape(selected)}"]`))selected=null;
  doc.querySelectorAll('[data-missing-picture]').forEach(el=>el.remove());
  for(const picture of missingPictures())doc.querySelectorAll(`[data-edit="${CSS.escape(picture.key)}"]`).forEach(el=>{
    const warning=doc.createElement('span');warning.dataset.missingPicture=picture.key;warning.hidden=preview;
    warning.style.cssText='display:block;background:white;color:#9b2525;padding:8px;font:14px Arial';
    warning.append('Picture missing — '+picture.title+' ');
    const button=doc.createElement('button');button.textContent='Choose picture again';button.onclick=e=>{e.preventDefault();e.stopPropagation();choosePicture(picture.key);};warning.append(button);(el.closest('.im') || el).after(warning);
  });
  positionToolbar();
}
function selectedElement(){return selected && frame.contentDocument.querySelector(`[data-edit="${CSS.escape(selected)}"]`);}
function workId(){return selected?.startsWith('works/') ? selected.split(':')[0].slice(6):null;}
function deselect(){selected=null;showProperties();decorate();}
function select(el){selected=el.dataset.edit;showProperties();decorate();}
function positionToolbar(){if(!toolbar)return;const el=selectedElement();toolbar.hidden=!el || preview || !!inline;if(toolbar.hidden)return;
  const picture=selected.endsWith(':file'), id=workId();
  toolbar.innerHTML=picture?'<button data-action="change">Change</button><button data-action="media">Open in Media</button>'+ (id?'<button data-action="details">Details</button><button data-action="up">Move up</button><button data-action="down">Move down</button><button data-action="delete">Delete</button>':''):'<button data-action="text">Edit text</button>';
  const r=el.getBoundingClientRect();toolbar.style.left=Math.max(8,Math.min(r.left,frame.contentWindow.innerWidth-toolbar.offsetWidth-8))+'px';toolbar.style.top=Math.max(8,Math.min(r.top-toolbar.offsetHeight-8,frame.contentWindow.innerHeight-toolbar.offsetHeight-8))+'px';
}
function startInline(el){if(!ownsLock || busy || inline || el.tagName==='IMG')return;select(el);const key=selected, original=el.textContent;inline={el,key,original};el.contentEditable='true';el.setAttribute('role','textbox');el.setAttribute('aria-label',label(key));el.focus();const range=frame.contentDocument.createRange();range.selectNodeContents(el);const sel=frame.contentWindow.getSelection();sel.removeAllRanges();sel.addRange(range);toolbar.hidden=true;
  el.onblur=()=>commitInline();el.oninput=persistInline;}
function finishInline(){const current=inline;if(!current)return;inline=null;current.el.onblur=null;current.el.oninput=null;current.el.removeAttribute('contenteditable');current.el.removeAttribute('role');return current;}
function inlineValue(current){let value=current.el.innerText.replace(/\r/g,'');return current.key.includes(':body.')?value:value.replace(/\n/g,' ');}
function persistInline(){if(!inline)return;writeRecovery({key:inline.key,value:inlineValue(inline)});clearTimeout(inlineTimer);inlineTimer=setTimeout(saveDraft,300);}
function commitInline(){const current=finishInline();if(!current)return;clearTimeout(inlineTimer);change(current.key,inlineValue(current));writeRecovery(null);decorate();}
function cancelInline(){const current=finishInline();if(current){current.el.textContent=current.original;clearTimeout(inlineTimer);writeRecovery(null);saveDraft();}positionToolbar();}
function keyboard(e){if(!hasOwnership())return;if(preview){if(e.key==='Escape')togglePreview();return;}if(e.key==='Escape'){e.preventDefault();if(inline)cancelInline();else {deselect();closePanel();}return;}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(inline)commitInline();e.shiftKey?redo():undo();return;}if(inline && e.key==='Enter' && !(e.shiftKey && inline.key.includes(':body.'))){e.preventDefault();commitInline();return;}}
function setupCanvas(){const doc=frame.contentDocument;const style=doc.createElement('style');style.textContent=`body:not(.studio-preview) [data-edit]{cursor:text}body:not(.studio-preview) img[data-edit]{cursor:pointer}body:not(.studio-preview) [data-edit]:hover{outline:1px solid #245bd7;outline-offset:3px}body:not(.studio-preview) .studio-selected{outline:2px solid #245bd7!important;outline-offset:3px}[contenteditable=true]{min-width:1ch;white-space:pre-wrap}#studio-toolbar{position:fixed;z-index:1000;display:flex;flex-wrap:wrap;gap:4px;padding:5px;background:#fff;color:#20242a;border:1px solid #dce0e5;border-radius:5px;box-shadow:0 2px 8px #0002;max-width:calc(100vw - 16px);font:12px 'Hanken Grotesk',Arial,sans-serif}#studio-toolbar button{padding:6px 8px;border:1px solid #dce0e5;border-radius:3px;background:white;color:#20242a;font:inherit}#studio-toolbar[hidden],#studio-hover[hidden]{display:none}#studio-hover{position:fixed;z-index:999;pointer-events:none;background:#245bd7;color:white;padding:2px 6px;font:12px Arial}body:not(.studio-preview) .slot a{pointer-events:none}body:not(.studio-preview) .rv{opacity:1;transform:none}body:not(.studio-preview) .slot img:not(.on){pointer-events:none}`;doc.head.append(style);
  toolbar=doc.createElement('div');toolbar.id='studio-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Selected element');toolbar.hidden=true;doc.body.append(toolbar);
  hoverLabel=doc.createElement('div');hoverLabel.id='studio-hover';hoverLabel.hidden=true;doc.body.append(hoverLabel);
  toolbar.addEventListener('mousedown',e=>e.preventDefault());
  toolbar.addEventListener('click',e=>{e.stopPropagation();const action=e.target.dataset.action;if(action==='text')startInline(selectedElement());if(action==='change')choosePicture(selected);if(action==='media')openPanel('media');if(action==='details')showDetails();if(action==='up')moveWork(workId(),-1);if(action==='down')moveWork(workId(),1);if(action==='delete')deleteWork();});
  doc.addEventListener('click',e=>{if(preview || toolbar.contains(e.target) || e.target.closest('[data-missing-picture]'))return;const el=e.target.closest('[data-edit]');if(el){e.preventDefault();e.stopImmediatePropagation();if(inline?.el===el)return;commitInline();select(el);if(el.tagName!=='IMG')startInline(el);}else if(!e.target.closest('#studio-details')){commitInline();deselect();}},true);
  doc.addEventListener('keydown',e=>{keyboard(e);if(!preview && !inline && (e.key==='Enter'||e.key===' ') && e.target.matches('[data-edit]')){e.preventDefault();e.stopImmediatePropagation();select(e.target);if(e.target.tagName!=='IMG')startInline(e.target);}},true);
  doc.addEventListener('paste',e=>{if(!inline)return;e.preventDefault();const text=e.clipboardData.getData('text/plain');const sel=frame.contentWindow.getSelection();if(sel.rangeCount){const r=sel.getRangeAt(0);r.deleteContents();const node=doc.createTextNode(text);r.insertNode(node);r.setStartAfter(node);r.collapse(true);sel.removeAllRanges();sel.addRange(r);persistInline();}});
  doc.addEventListener('pointerover',e=>{const el=e.target.closest('[data-edit]');hoverLabel.hidden=!el||preview||!!inline;if(!hoverLabel.hidden){const r=el.getBoundingClientRect();hoverLabel.textContent=label(el.dataset.edit);hoverLabel.style.left=Math.max(0,r.left)+'px';hoverLabel.style.top=Math.max(0,r.top-22)+'px';}});
  doc.addEventListener('pointerout',()=>hoverLabel.hidden=true);
  frame.contentWindow.addEventListener('pagehide',commitInline);
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)commitInline();});
  doc.addEventListener('studio:render',()=>{decorate();pageOptions();});
  frame.contentWindow.addEventListener('scroll',positionToolbar,{passive:true});frame.contentWindow.addEventListener('resize',positionToolbar);
  doc.addEventListener('dragstart',e=>{if(preview)return;const f=e.target.closest('[data-editlist] figure');if(!f)return;dragId=f.querySelector('[data-edit]').dataset.edit.split(':')[0].slice(6);e.dataTransfer.setData('text/plain',dragId);});
  doc.addEventListener('dragover',e=>{if(dragId && e.target.closest('[data-editlist]'))e.preventDefault();});
  doc.addEventListener('drop',e=>{const f=e.target.closest('[data-editlist] figure');if(!dragId||!f)return;e.preventDefault();const target=f.querySelector('[data-edit]').dataset.edit.split(':')[0].slice(6);reorderWork(dragId,target);dragId=null;});doc.addEventListener('dragend',()=>dragId=null);
}
function workList(id){const cat=model.works[id]?.category;return sorted(model.works).filter(([,w])=>w.category===cat).map(([id])=>id);}
function reorderWork(id,target){if(!model.works[id] || model.works[id].category!==model.works[target]?.category)return;const ids=workList(id);ids.splice(ids.indexOf(id),1);ids.splice(ids.indexOf(target),0,id);mutate(m=>ids.forEach((id,i)=>m.works[id].order=i+1));}
function moveWork(id,direction){if(!id)return;const ids=workList(id),i=ids.indexOf(id),j=i+direction;if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];mutate(m=>ids.forEach((id,i)=>m.works[id].order=i+1));}
function deleteWork(){const id=workId();if(id && confirm('Delete “'+model.works[id].title+'”? The picture will stay in Media.')){mutate(m=>{delete m.works[id];m.settings.home.featured=(m.settings.home.featured||[]).filter(x=>x!==id);});deselect();}}
function field(key,title,type='text',options){const value=pendingPanel?.key===key?pendingPanel.value:get(key);return `<label>${esc(title)}${type==='textarea'?`<textarea data-field="${esc(key)}">${esc(value)}</textarea>`:type==='select'?`<select data-field="${esc(key)}">${options.map(v=>`<option ${v===value?'selected':''}>${esc(v)}</option>`).join('')}</select>`:`<input data-field="${esc(key)}" type="${type}" ${type==='checkbox'?(value?'checked':''):`value="${esc(value)}"`}>`}</label>`;}
function pendingText(){return inline?{key:inline.key,value:inlineValue(inline)}:pendingPanel;}
function applyText(pending){const [record,field]=pending.key.split(':');let obj=record.split('/').reduce((o,k)=>o[k],model);const parts=field.split('.');for(const part of parts.slice(0,-1))obj=obj[part] ??= {};obj[parts.at(-1)]=pending.value;}
function commitPanel(redraw=true){
  if(!pendingPanel || !ownsLock || busy)return;
  const pending=pendingPanel;pendingPanel=null;clearTimeout(inlineTimer);
  const before=clone(model);applyText(pending);
  if(JSON.stringify(before)!==JSON.stringify(model)){undoStack.push(before);redoStack=[];}
  saveDraft();if(redraw)draw();
}
function commitEdits(){commitPanel(false);commitInline();}
function bindFields(container){container.querySelectorAll('[data-field]').forEach(el=>{
  const text=el.tagName==='TEXTAREA' || el.type==='text';
  if(text){
    el.addEventListener('focus',()=>{if(pendingPanel && pendingPanel.key!==el.dataset.field)commitPanel(false);commitInline();});
    el.addEventListener('input',()=>{if(!ownsLock || busy)return;pendingPanel={key:el.dataset.field,value:el.value};writeRecovery(pendingPanel);$('#draft-status').textContent='Saving…';clearTimeout(inlineTimer);inlineTimer=setTimeout(saveDraft,300);});
  }
  el.addEventListener('change',()=>{if(text)commitPanel();else change(el.dataset.field,el.type==='checkbox'?el.checked:el.value);if(el.type==='color')el.parentElement.querySelector('output').textContent=el.value;});
});}
function detailsFields(id){return ['title','medium','size','year','price'].map(k=>field('works/'+id+':'+k,k[0].toUpperCase()+k.slice(1))).join('')+field('works/'+id+':sold','Sold','checkbox');}
function showProperties(){const id=workId(),p=$('#properties');p.hidden=!id||!model.works[id]||preview;document.body.classList.toggle('has-properties',!p.hidden);if(p.hidden)return;p.innerHTML='<div class="panel-head"><h2>Work properties</h2><button aria-label="Close properties">×</button></div>'+detailsFields(id)+(missingPictures().some(p=>p.key==='works/'+id+':file')?'<p>Picture missing</p><button data-choose-again>Choose picture again</button>':'');p.querySelector('[data-choose-again]')?.addEventListener('click',()=>choosePicture('works/'+id+':file'));p.querySelector('button').onclick=deselect;bindFields(p);}
function showDetails(){let dialog=$('#details-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='details-dialog';document.body.append(dialog);}dialog.innerHTML='<h2>Work details</h2>'+detailsFields(workId())+'<button>Done</button>';bindFields(dialog);dialog.querySelector('button').onclick=()=>dialog.close();dialog.showModal();}
function closePanel(){commitPanel(false);panel=null;$('#panel').hidden=true;document.body.classList.remove('has-panel');document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-pressed','false'));}
function openPanel(name){commitPanel(false);panel=name;const p=$('#panel');p.hidden=false;document.body.classList.add('has-panel');if(innerWidth<=800){$('#properties').hidden=true;document.body.classList.remove('has-properties');}document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.panel===name)));const names={add:'Add work',pages:'Pages',design:'Design',media:'Media'};p.innerHTML=`<div class="panel-head"><h2>${names[name]}</h2><button id="close-panel" aria-label="Close panel">×</button></div><div id="panel-body"></div>`;$('#close-panel').onclick=closePanel;({add:addPanel,pages:pagesPanel,design:designPanel,media:mediaPanel})[name]($('#panel-body'));}
function refreshPanel(){if(panel)openPanel(panel);}
function slug(text){return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'untitled';}
function uniqueId(title,obj){let id=slug(title),n=1;while(obj[id])id=slug(title)+'-'+n++;return id;}
async function preparePicture(file){if(!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type))throw Error('Choose a PNG, JPEG, WebP or GIF picture.');const ext={ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[file.type];const name=slug(file.name.replace(/\.[^.]+$/,''))+'-'+crypto.randomUUID().slice(0,8)+'.'+ext;$('#draft-status').textContent='Saving…';
  const upload={key:draftKey()+':upload:'+name,ownerDraft:draftKey(),name,dataURL:'data:'+file.type+';base64,'+await base64(file)};
  // Keep bytes in their own record: queued older snapshots cannot overwrite them.
  // Commit before any synchronous recovery snapshot may reference this name.
  const saving=draftQueue.then(()=>draftTransaction('readwrite',store=>store.put(upload)));
  draftQueue=saving.catch(()=>{});await saving;
  uploads.set(name,{file,url:URL.createObjectURL(file),dataURL:upload.dataURL});return name;}
function choosePicture(target){pictureTarget=target;$('#picture-file').value='';$('#picture-file').click();}
$('#picture-file').onchange=async e=>{try{const n=await preparePicture(e.target.files[0]);mutate(m=>{m.media.push(n);if(pictureTarget){const [r,f]=pictureTarget.split(':');let obj=r.split('/').reduce((o,k)=>o[k],m);const parts=f.split('.');for(const k of parts.slice(0,-1))obj=obj[k];obj[parts.at(-1)]='/assets/work/'+n;}});refreshPanel();}catch(e){say(e.message);}};
function addPanel(p){p.innerHTML='<form id="add-form">'+['title','medium','size','year','price'].map(k=>`<label>${k[0].toUpperCase()+k.slice(1)}<input name="${k}" ${k==='title'?'required':''}></label>`).join('')+`<label>Picture<input name="picture" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required></label><label>Category<select name="category">${sorted(model.categories).map(([id,c])=>`<option value="${esc(id)}">${esc(c.title)}</option>`).join('')}</select></label><label>Sold<input type="checkbox" name="sold"></label><button class="primary">Add work</button></form>`;p.querySelector('form').onsubmit=async e=>{e.preventDefault();try{const d=new FormData(e.target),n=await preparePicture(d.get('picture')),id=uniqueId(d.get('title'),model.works);mutate(m=>{m.media.push(n);m.works[id]=Object.fromEntries(['title','medium','size','year','price','category'].map(k=>[k,d.get(k)]));Object.assign(m.works[id],{file:'/assets/work/'+n,sold:d.has('sold'),order:Math.max(0,...Object.values(m.works).filter(w=>w.category===d.get('category')).map(w=>w.order||99))+1});});navigate('portfolio/'+d.get('category'));closePanel();say('Work added');}catch(e){say(e.message);}};}
function pagesPanel(p){p.innerHTML=['','about','commission','shop','contact'].map(k=>`<div class="page-row"><button data-route="${k}">${k?k[0].toUpperCase()+k.slice(1):'Home'}</button></div>`).join('')+'<h3>Portfolio categories</h3>'+sorted(model.categories).map(([id,c])=>`<div class="category-row" draggable="true" data-category="${id}"><button data-route="portfolio/${id}">Open ${esc(c.title)}</button>${field('categories/'+id+':title','Title')}${field('categories/'+id+':intro','Intro','textarea')}<div class="move-buttons"><button data-cat-move="${id}" data-dir="-1" aria-label="Move ${esc(c.title)} up">Move up</button><button data-cat-move="${id}" data-dir="1" aria-label="Move ${esc(c.title)} down">Move down</button></div></div>`).join('')+'<form id="category-form"><h3>Add category</h3><label>Category title<input name="title" required></label><button>Add category</button></form>';bindFields(p);p.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>{navigate(b.dataset.route);if(innerWidth<=800)closePanel();});
  const reorder=(id,target)=>{const ids=sorted(model.categories).map(([id])=>id);ids.splice(ids.indexOf(id),1);ids.splice(target,0,id);mutate(m=>ids.forEach((id,i)=>m.categories[id].order=i+1));openPanel('pages');};
  p.querySelectorAll('[data-cat-move]').forEach(b=>b.onclick=()=>{const ids=sorted(model.categories).map(([id])=>id),j=ids.indexOf(b.dataset.catMove)+Number(b.dataset.dir);if(j>=0&&j<ids.length)reorder(b.dataset.catMove,j);});let dragged;
  p.querySelectorAll('[data-category]').forEach(row=>{row.ondragstart=e=>{if(e.target.matches('input,textarea')){e.preventDefault();return;}dragged=row.dataset.category;e.dataTransfer.setData('text/plain',dragged);};row.ondragover=e=>e.preventDefault();row.ondrop=e=>{e.preventDefault();if(dragged)reorder(dragged,sorted(model.categories).findIndex(([id])=>id===row.dataset.category));};});
  $('#category-form').onsubmit=e=>{e.preventDefault();const title=new FormData(e.target).get('title'),id=uniqueId(title,model.categories);mutate(m=>m.categories[id]={title,intro:'',order:Math.max(0,...Object.values(m.categories).map(c=>c.order||99))+1});openPanel('pages');navigate('portfolio/'+id);};}
function designPanel(p){p.innerHTML='<h3>Colours</h3>'+['background','text','accent'].map(k=>field('settings/look:colours.'+k,k[0].toUpperCase()+k.slice(1),'color').replace('</label>',`<output>${esc(model.settings.look.colours[k])}</output></label>`)).join('')+field('settings/look:typeface','Typeface','select',['Hanken Grotesk','Instrument Sans','DM Sans','Cormorant Garamond'])+field('settings/look:logo.style','Logo style','select',['mark','image'])+'<button id="logo-upload">Upload logo</button><h3>Menu labels</h3>'+['about','portfolio','commission','shop','contact'].map(k=>field('settings/look:labels.'+k,k[0].toUpperCase()+k.slice(1))).join('')+field('settings/look:footerLine','Footer line','textarea');bindFields(p);$('#logo-upload').onclick=()=>choosePicture('settings/look:logo.image');}
function mediaPanel(p){const names=[...new Set([...media,...activeUploads()])];p.innerHTML='<p>'+ (workId()?'Choose a picture for the selected work.':'Select a work picture on the canvas to replace it.')+'</p><button id="media-upload">Upload picture</button><div class="media-grid">'+names.map(n=>`<button data-media="${esc(n)}"><img src="${esc(uploads.get(n)?.url || ROOT+'assets/work/'+encodeURIComponent(n))}" alt="${esc(n)}" loading="lazy">${esc(n)}</button>`).join('')+'</div>';$('#media-upload').onclick=()=>choosePicture(null);p.querySelectorAll('[data-media]').forEach(b=>b.onclick=()=>{if(!workId()){say('Select a work picture on the canvas first.');return;}change('works/'+workId()+':file','/assets/work/'+b.dataset.media);say('Picture changed');});}
function togglePreview(){commitInline();preview=!preview;document.body.classList.toggle('preview',preview);$('#exit-preview').hidden=!preview;decorate();if(preview){toolbar.hidden=true;hoverLabel.hidden=true;}showProperties();}
function files(m){const result={};for(const group of ['works','categories','pages','settings'])for(const [id,value]of Object.entries(m[group]))result[`content/${group}/${id}.json`]=JSON.stringify(value,null,2);return result;}
function changes(){const before=files(loaded),after=files(model);return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]!==after[p]).map(path=>({path,content:after[path]??null}));}
function openPublish(){commitEdits();const list=changes(),pics=activeUploads().filter(n=>!loaded.media.includes(n));$('#publish-summary').innerHTML='<p>'+['works','categories','pages'].map(g=>`${list.filter(f=>f.path.startsWith('content/'+g+'/')).length} ${g}`).join(', ')+`, ${pics.length} pictures${list.some(f=>f.path.startsWith('content/settings/'))?', design / settings':''}</p><ul>`+list.map(f=>`<li>${esc(f.path.replace('content/',''))}${f.content===null?' (deleted)':''}</li>`).join('')+'</ul>';$('#publish-progress').textContent='';$('#publish-confirm').hidden=false;$('#publish-confirm').disabled=false;$('#publish-close').textContent='Cancel';const missing=missingMessage();if(missing){$('#publish-summary').textContent=missing;$('#publish-confirm').disabled=true;}$('#publish-dialog').showModal();}
async function checked(url,options){const r=await fetch(url,options);if(!r.ok){let message=await r.text();try{const x=JSON.parse(message);message=x.message||x.error_description||x.msg||message;}catch{}const error=Error(`${r.status}: ${message || r.statusText}`);error.status=r.status;throw error;}return r.status===204?null:r.json();}
function requestLogin(message){
  token=null;
  $('#login-error').textContent=message;
  if(!loginWait)loginWait=new Promise(resolve=>resumeLogin=resolve);
  if(!$('#login').open)$('#login').showModal();
  return loginWait;
}
async function gateway(path,method='GET',body){
  for(;;){
    if(!token){await requestLogin('Your session has expired. Sign in to continue. Your edits are safe.');continue;}
    if(Date.now()>=token.expires_at-60000){
      if(!refreshWait){
        const previous=token;
        refreshWait=(async()=>{
          try{const fresh=await checked(IDENTITY+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:previous.refresh_token})});if(token===previous)token={...previous,...fresh,expires_at:Date.now()+fresh.expires_in*1000};}
          catch(e){if(![400,401,403].includes(e.status))throw e;if(token===previous)await requestLogin('Your session has expired. Sign in to continue. Your edits are safe.');}
        })().finally(()=>refreshWait=null);
      }
      await refreshWait;continue;
    }
    if(method!=='GET')requireOwnership(); // Also fence retries after authentication waits.
    const authenticated=token;
    try{return await checked(GATEWAY+path,{method,headers:{Authorization:'Bearer '+authenticated.access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
    catch(e){if(e.status!==401)throw e;if(token===authenticated)await requestLogin('Please sign in again to continue. Your edits are safe.');}

  }
}
async function base64(file){const bytes=new Uint8Array(await file.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
// Read records from one immutable Git tree, or one synchronous local file snapshot.
const recordPath = /^content\/(works|categories|pages|settings)\/([a-z0-9-]+)\.json$/;
const picturePath = /^assets\/work\/[^/]+\.(png|jpe?g|webp|gif)$/i;
async function remoteSnapshot(){
  if(LOCAL)return checked(ROOT+'__dev/snapshot');
  const ref=await gateway('git/ref/heads/main'), sha=ref.object.sha;
  const commit=await gateway('git/commits/'+sha), tree=await gateway('git/trees/'+commit.tree.sha+'?recursive=1');
  if(tree.truncated)throw Error('The remote file listing is incomplete. Publish stopped.');
  const hashes={},records={};
  await Promise.all(tree.tree.filter(f=>f.type==='blob' && (recordPath.test(f.path)||picturePath.test(f.path))).map(async f=>{
    hashes[f.path]=f.sha;
    if(recordPath.test(f.path)){
      const blob=await gateway('git/blobs/'+f.sha);
      if(blob.encoding!=='base64')throw Error('Unsupported remote content encoding');
      records[f.path]=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));
    }
  }));
  return {sha,tree:commit.tree.sha,hashes,records};
}
function setRecord(m,path,value){const [,group,id]=path.match(recordPath);if(value===undefined)delete m[group][id];else m[group][id]=clone(value);}
function pictureNames(){return activeUploads().filter(n=>!loaded.media.includes(n));}
function conflictTitle(path,remote){
  if(recordPath.test(path)){const [,group,id]=path.match(recordPath);return model[group][id]?.title || loaded[group][id]?.title || remote.records[path]?.title || id;}
  const work=Object.values(model.works).find(w=>base(w.file)===base(path));return work?.title || base(path);
}
async function resolveConflicts(remote,paths){
  const dialog=$('#conflict-dialog'),keep=new Set();
  $('#conflict-records').innerHTML=paths.map(path=>`<li data-conflict-path="${esc(path)}"><strong>${esc(conflictTitle(path,remote))}</strong><small>${esc(path)}</small><button type="button" aria-pressed="false">Keep mine</button></li>`).join('');
  dialog.querySelectorAll('[data-conflict-path] button').forEach(button=>button.onclick=()=>{const path=button.parentElement.dataset.conflictPath;if(keep.has(path))keep.delete(path);else keep.add(path);button.setAttribute('aria-pressed',String(keep.has(path)));});
  await new Promise(resolve=>{$('#conflict-reload').onclick=()=>{dialog.close();resolve();};dialog.showModal();});
  for(const path of paths){
    if(recordPath.test(path)){
      if(!keep.has(path)){
        setRecord(model,path,remote.records[path]);
        // Undo must not resurrect a stale remote-only record.
        for(const state of [...undoStack,...redoStack])setRecord(state,path,remote.records[path]);
      }
      setRecord(loaded,path,remote.records[path]);
    }else if(!keep.has(path)){
      const name=base(path);uploads.delete(name);
      for(const state of [model,loaded,...undoStack,...redoStack])state.media=state.media.filter(n=>n!==name);
    }
  }
  baseline=remote;media=Object.keys(remote.hashes).filter(p=>picturePath.test(p)).map(base);
  saveDraft();draw();refreshPanel();
}
async function checkedSnapshot(){
  for(;;){
    const remote=await remoteSnapshot();requireOwnership();
    // Include remote-only records as well as every path we intend to write/delete.
    const paths=new Set([...Object.keys(baseline.records),...Object.keys(remote.records),...changes().map(f=>f.path),...pictureNames().map(n=>'assets/work/'+n)]);
    const conflicts=[...paths].filter(p=>baseline.hashes[p]!==remote.hashes[p]);
    if(!conflicts.length){remotePictures=new Set(Object.keys(remote.hashes).filter(p=>picturePath.test(p)).map(base));if(missingMessage())throw Error(missingMessage());return remote;}
    await resolveConflicts(remote,conflicts);
    // The dialog may stay open while someone else publishes. Check again.
  }
}
async function gatewayPublish(){
  for(let attempt=0;attempt<2;attempt++){
    const remote=await checkedSnapshot(),list=changes(),pictures=pictureNames(),tree=[];
    for(let i=0;i<pictures.length;i++){const n=pictures[i];$('#publish-progress').textContent=`Uploading ${i+1} of ${pictures.length} pictures…`;const blob=await gateway('git/blobs','POST',{content:await base64(uploads.get(n).file),encoding:'base64'});tree.push({path:'assets/work/'+n,mode:'100644',type:'blob',sha:blob.sha});}
    $('#publish-progress').textContent='Saving…';
    for(const f of list){const sha=f.content===null?null:(await gateway('git/blobs','POST',{content:f.content,encoding:'utf-8'})).sha;tree.push({path:f.path,mode:'100644',type:'blob',sha});}
    if(!tree.length)return remote;
    const newTree=await gateway('git/trees','POST',{base_tree:remote.tree,tree});
    requireOwnership();
    const next=await gateway('git/commits','POST',{message:'Update website in Studio',tree:newTree.sha,parents:[remote.sha]});
    try{
      requireOwnership();
      await gateway('git/refs/heads/main','PATCH',{sha:next.sha,force:false});
      const hashes={...remote.hashes};for(const f of tree){if(f.sha===null)delete hashes[f.path];else hashes[f.path]=f.sha;}
      return {sha:next.sha,tree:newTree.sha,hashes,records:Object.fromEntries(Object.entries(files(model)).map(([p,c])=>[p,JSON.parse(c)]))};
    }catch(e){
      if(attempt || ![409,422].includes(e.status))throw e;
      const fresh=await gateway('git/ref/heads/main');if(fresh.object.sha===remote.sha)throw e;
      // Never reuse stale blobs after main moves: compare and rebuild the payload.
    }
  }
}
async function localPublish(){
  for(let attempt=0;attempt<2;attempt++){
    const remote=await checkedSnapshot(),list=changes();
    for(const name of pictureNames())list.push({path:'assets/work/'+name,content:await base64(uploads.get(name).file),encoding:'base64'});
    requireOwnership();
    try{return await checked(ROOT+'__dev/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sha:remote.sha,files:list})});}
    catch(e){if(attempt || e.status!==409)throw e;}
  }
}
async function publish(){
  if(!ownsLock || busy)return;commitEdits();if(missingMessage()){$('#publish-progress').textContent=missingMessage();return;}busy=true;status();$('#publish-confirm').disabled=true;$('#publish-close').disabled=true;
  try{
    await saveDraft();requireOwnership();
    const result=LOCAL?await localPublish():await gatewayPublish();
    requireOwnership();baseline=result;
    loaded=clone(model);media=Object.keys(baseline.hashes).filter(p=>picturePath.test(p)).map(base);published=true;
    try{await clearDraft();$('#draft-status').textContent='';}
    catch(e){requireOwnership();$('#draft-status').textContent='Draft cleanup failed';say('Published, but the old draft could not be cleared: '+e.message);}
    requireOwnership();
    $('#publish-progress').innerHTML=`Published. Live in about a minute. <a href="${ROOT}" target="_blank" rel="noopener">View site</a>`;$('#publish-confirm').hidden=true;$('#publish-close').textContent='Done';
  }catch(e){$('#publish-progress').textContent=ownsLock?'Publish failed: '+e.message+'. Your changes are still here.':ownershipMessage;}
  finally{busy=false;$('#publish-confirm').disabled=false;$('#publish-close').disabled=false;status();}
}
let draftDB;
function openDraftDB(){
  if(!draftDB)draftDB=new Promise((resolve,reject)=>{const req=indexedDB.open('studio-drafts',1);req.onupgradeneeded=()=>req.result.createObjectStore('drafts',{keyPath:'key'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  return draftDB;
}
async function draftTransaction(mode,fn){
  const db=await openDraftDB();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',mode),req=fn(tx.objectStore('drafts'));tx.oncomplete=()=>resolve(req?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('Draft transaction aborted'));});
}
function draftKey(){return draftSite+':'+sessionId;}
function recoveryKey(key=draftKey()){return 'studio-pending:'+key;}
function draftState(pending=null){return {key:draftKey(),sessionId,site:draftSite,time:Date.now(),baselineSha:baseline.sha,baseline:clone(baseline),loaded:clone(loaded),model:clone(model),undo:clone(undoStack),redo:clone(redoStack),pending,uploads:[]};}
// Keep a synchronous recovery snapshot even after commit; only its pending field
// is cleared. Removing the whole snapshot here would reopen the unload race.
function writeRecovery(pending){
  if(!draftReady || !ownsLock)return;
  try{localStorage.setItem(recoveryKey(),JSON.stringify(draftState(pending)));}
  catch(e){say('Immediate text recovery failed: '+e.message);}
}
function saveDraft(){
  if(!draftReady || !model || !ownsLock)return draftQueue;
  published=false;const revision=++draftRevision;
  const pending=pendingText();
  writeRecovery(pending);
  const draft=draftState(pending),pictures=[...uploads];$('#draft-status').textContent='Saving…';status();
  draftQueue=draftQueue.then(async()=>{
    for(const [name,u] of pictures){if(!u.dataURL)u.dataURL='data:'+u.file.type+';base64,'+await base64(u.file);draft.uploads.push({name,dataURL:u.dataURL});}
    await draftTransaction('readwrite',store=>store.put(draft));
    if(revision===draftRevision)$('#draft-status').textContent=missingPictures().length?'Picture missing':'Saved';
  }).catch(e=>{if(revision===draftRevision)$('#draft-status').textContent='Draft save failed';say('Draft could not be saved: '+e.message);});
  return draftQueue;
}
function removeDraftRecords(key,fenced=false){return draftTransaction('readwrite',store=>{const req=store.getAll();req.onsuccess=()=>{if(fenced){try{requireOwnership();}catch{store.transaction.abort();return;}}for(const record of req.result)if(record.key===key || record.ownerDraft===key)store.delete(record.key);};});}
function clearDraft(){
  requireOwnership();clearTimeout(inlineTimer);++draftRevision;const key=draftKey();
  const clearing=draftQueue.then(()=>{requireOwnership();return removeDraftRecords(key,true);}).then(()=>{requireOwnership();localStorage.removeItem(recoveryKey(key));});
  draftQueue=clearing.catch(()=>{});return clearing;
}
async function restoreDraft(){
  try{
    const drafts=await draftTransaction('readonly',store=>store.getAll());
    const byKey=new Map(drafts.filter(d=>d.site===draftSite).map(d=>[d.key,d]));
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(!key.startsWith('studio-pending:'+draftSite+':'))continue;
      const recovery=JSON.parse(localStorage.getItem(key)),saved=byKey.get(recovery.key);
      if(!saved || recovery.time>=saved.time)byKey.set(recovery.key,{...recovery,uploads:saved?.uploads || []});
    }
    const candidates=[...byKey.values()].sort((a,b)=>Number(b.baseline.sha===baseline.sha)-Number(a.baseline.sha===baseline.sha)||b.time-a.time);
    for(const draft of candidates){
      const moved=draft.baseline.sha!==baseline.sha;
      $('#draft-message').textContent=moved?'The live site has moved on since this draft. Restore anyway and review conflicts when publishing, or Discard.':'Restore your unpublished draft from '+new Date(draft.time).toLocaleString()+'?';
      $('#draft-restore').textContent=moved?'Restore anyway':'Restore';
      const restore=await new Promise(resolve=>{const dialog=$('#draft-dialog');$('#draft-restore').onclick=()=>{dialog.close();resolve(true);};$('#draft-discard').onclick=()=>{dialog.close();resolve(false);};dialog.showModal();});
      requireOwnership();
      // Copy into a new session: an in-flight former publisher only knows the old key.
      sessionId=crypto.randomUUID();
      if(!restore){await removeDraftRecords(draft.key);localStorage.removeItem(recoveryKey(draft.key));sessionId=crypto.randomUUID();continue;}
      for(const u of [...(draft.uploads || []),...drafts.filter(d=>d.ownerDraft===draft.key)]){if(!u.dataURL)continue;const [header,data]=u.dataURL.split(','),type=header.slice(5,header.indexOf(';'));const file=new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],u.name,{type});uploads.set(u.name,{file,url:URL.createObjectURL(file),dataURL:u.dataURL});}
      model=draft.model;loaded=draft.loaded;baseline=draft.baseline;undoStack=draft.undo || [];redoStack=draft.redo || [];
      if(draft.pending){const before=clone(model);applyText(draft.pending);if(JSON.stringify(before)!==JSON.stringify(model)){undoStack.push(before);redoStack=[];}}
      $('#draft-status').textContent=missingPictures().length?'Picture missing':'Saved';return true;
    }
  }catch(e){say('Draft could not be restored: '+e.message);}
}
function lockScreen(){
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  for(const el of document.body.children)if(el.id!=='studio-lock')el.inert=true;
  let screen=$('#studio-lock');
  if(!screen){screen=document.createElement('main');screen.id='studio-lock';screen.style.cssText='position:fixed;inset:0;z-index:9999;background:white;color:#20242a;padding:40px';screen.innerHTML='<p>Studio is already open in another tab. Close it there, or <button id="studio-takeover">Take over here</button></p>';document.body.append(screen);}
  screen.hidden=false;$('#studio-takeover').onclick=async()=>{
    if(takingOver)return;takingOver=true;channel?.postMessage({type:'takeover',from:tabId});
    // Retry acquisition, never steal a native lock while the owner is saving.
    for(let i=0;i<40 && !ownsLock;i++){await acquireEditor();if(!ownsLock)await new Promise(r=>setTimeout(r,250));}
    takingOver=false;
  };
}
const ownershipMessage='Another tab took over; your changes are kept as a draft';
function revokeOwnership(){
  ownsLock=false;draftReady=false;clearInterval(leaseTimer);clearTimeout(inlineTimer);
  finishInline();lockScreen();
  let message=$('#studio-ownership-message');
  if(!message){message=document.createElement('p');message.id='studio-ownership-message';$('#studio-lock').prepend(message);}
  message.textContent=ownershipMessage;$('#publish-progress').textContent=ownershipMessage;
}
function hasOwnership(){
  if(ownsLock && !navigator.locks && readLease()?.owner!==tabId)revokeOwnership();
  return ownsLock;
}
function requireOwnership(){if(!hasOwnership())throw Error(ownershipMessage);}
async function yieldEditor(){
  if(!hasOwnership() || busy || !sessionLoaded)return;
  commitEdits();busy=true;await saveDraft();
  if($('#draft-status').textContent==='Draft save failed'){busy=false;status();return;}
  draftReady=false;busy=true;ownsLock=false;lockScreen();
  clearInterval(leaseTimer);if(readLease()?.owner===tabId)localStorage.removeItem(lockName);
  releaseLock?.();channel?.postMessage({type:'released',from:tabId});
}
if(channel)channel.onmessage=event=>{
  const message=event.data;if(message.from===tabId)return;
  if(message.type==='probe' && ownsLock)channel.postMessage({type:'owner',from:tabId});
  if(message.type==='owner')fallbackOwner=message.from;
  if(message.type==='takeover')yieldEditor();
};
let fallbackOwner=false, leaseTimer;
const leaseDuration=8000;
function readLease(){const raw=localStorage.getItem(lockName);if(!raw)return null;try{const lease=JSON.parse(raw);return lease && typeof lease.owner==='string'?lease:null;}catch{return {owner:raw,expires:0};}}
function refreshLease(claim=false){if(!claim && !hasOwnership())return;localStorage.setItem(lockName,JSON.stringify({owner:tabId,expires:Date.now()+leaseDuration}));}

async function enterEditor(){
  ownsLock=true;
  if(sessionLoaded){location.reload();return;}
  $('#studio-lock')?.remove();for(const el of document.body.children)el.inert=false;
  if(LOCAL)await load();else{$('#login').showModal();say('');}
}
async function acquireEditor(){
  if(acquiring || ownsLock)return;acquiring=true;
  try{
    if(navigator.locks){
      await new Promise((resolve,reject)=>{
        navigator.locks.request(lockName,{ifAvailable:true},async lock=>{
          if(!lock){lockScreen();resolve();return;}
          const held=new Promise(r=>releaseLock=r);await enterEditor();resolve();await held;
        }).catch(reject);
      });
    }else if(channel){
      let lease=readLease();
      if(lease?.owner!==tabId && lease?.expires>Date.now()){
        fallbackOwner=false;channel.postMessage({type:'probe',from:tabId});
        await new Promise(r=>setTimeout(r,1500));lease=readLease();
        if(fallbackOwner && lease?.expires>Date.now()){lockScreen();return;}
      }
      // Claim then settle simultaneous contenders before enabling any controls.
      refreshLease(true);await new Promise(r=>setTimeout(r,200));
      if(readLease()?.owner!==tabId){lockScreen();return;}
      leaseTimer=setInterval(()=>refreshLease(),2000);
      await enterEditor();
    }else{lockScreen();$('#studio-takeover').disabled=true;}
  }catch(e){lockScreen();say('Studio could not acquire the editing lock: '+e.message);}
  finally{acquiring=false;}
}
addEventListener('storage',e=>{if(!navigator.locks && (e.key===lockName || e.key===null))hasOwnership();});
addEventListener('pagehide',()=>{commitEdits();clearInterval(leaseTimer);if(readLease()?.owner===tabId)localStorage.removeItem(lockName);});
addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
async function load(){try{
  const remote=await remoteSnapshot();
  model={works:{},categories:{},pages:{},settings:{},media:[]};
  for(const [path,value] of Object.entries(remote.records))setRecord(model,path,value);
  baseline=remote;loaded=clone(model);
  const site=await checked(ROOT+'content/site.json');thumbs=site.thumbs || [];
  media=Object.keys(remote.hashes).filter(p=>picturePath.test(p)).map(base);
  remotePictures=new Set(LOCAL?await checked(ROOT+'__dev/list?dir=assets/work'):media);
  const restored=await restoreDraft();requireOwnership();draftReady=true;if(restored)await saveDraft();
  frame.src=ROOT+'?edit=1';await new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(frame.contentWindow.__site?.getS()){clearInterval(timer);resolve();}else if(Date.now()-start>20000){clearInterval(timer);reject(Error('The site canvas did not load.'));}},50);});setupCanvas();draw();sessionLoaded=true;say('Click text to edit. Select a picture for more options.');
}catch(e){say('Studio could not load: '+e.message);$('#notice').hidden=false;clearTimeout(noticeTimer);}}
$('#login-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{const d=new FormData(e.target),r=await checked(IDENTITY+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'password',username:d.get('email'),password:d.get('password')})});token={...r,expires_at:Date.now()+r.expires_in*1000};e.target.reset();$('#login').close();b.disabled=false;if(resumeLogin){const resume=resumeLogin;resumeLogin=null;loginWait=null;resume();}else if(!sessionLoaded)await load();}catch(e){$('#login-error').textContent=e.message;}finally{b.disabled=false;}};
$('#login').addEventListener('cancel',e=>e.preventDefault());
$('#page-switcher').onchange=e=>navigate(e.target.value);$('#undo').onclick=undo;$('#redo').onclick=redo;$('#device').onclick=()=>{document.body.classList.toggle('phone');const phone=document.body.classList.contains('phone');$('#device').textContent=phone?'Desktop':'Phone';$('#device').setAttribute('aria-pressed',String(phone));};$('#preview').onclick=togglePreview;$('#exit-preview').onclick=togglePreview;
document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>panel===b.dataset.panel?closePanel():openPanel(b.dataset.panel));$('#publish').onclick=openPublish;$('#publish-confirm').onclick=publish;$('#publish-close').onclick=()=>$('#publish-dialog').close();$('#publish-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});document.addEventListener('keydown',keyboard);addEventListener('pagehide',commitEdits);document.addEventListener('visibilitychange',()=>{if(document.hidden)commitEdits();});addEventListener('beforeunload',e=>{commitEdits();if(dirty()||busy){e.preventDefault();e.returnValue='';}});
// Inspection plus the normal inline commit/lifecycle condition for regression checks.
$('#conflict-dialog').addEventListener('cancel',e=>e.preventDefault());
$('#draft-dialog').addEventListener('cancel',e=>e.preventDefault());
window.Studio={commitInline,get shouldWarnOnUnload(){return !!dirty()||busy;},get draftSaved(){return draftQueue;},get model(){return clone(model);},assemble,get pending(){return activeUploads();}};
acquireEditor();
