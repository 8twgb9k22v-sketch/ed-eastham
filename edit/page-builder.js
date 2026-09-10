/* Page building uses the existing draft, history and publish transaction. */
'use strict';
const builderPage = () => frame.contentWindow.__site.pathOf() || 'home';
const builderCategory = () => {const route=builderPage();return route.startsWith('portfolio/') && model.categories[route.slice(10)] ? route.slice(10) : null;};
const pageBlocks = () => Object.entries(model.settings.look.blocks || {}).filter(([,b])=>b.page===builderPage()).sort((a,b)=>(a[1].order||0)-(b[1].order||0)||a[0].localeCompare(b[0]));
const pictureSource = name => uploads.get(base(name))?.url || ROOT+'assets/work/'+encodeURIComponent(base(name));
const originalContentPanel=contentPanel, originalAddPanel=addPanel, originalPositionToolbar=positionToolbar;
document.querySelector('[data-panel=content]').textContent='Build page';
addPanel=function(p){originalAddPanel(p);const category=builderCategory();if(category)p.querySelector('[name=category]').value=category;};
positionToolbar=function(){originalPositionToolbar();if(!toolbar||toolbar.hidden)return;const el=selectedElement();if(el?.tagName==='IMG'){const b=document.createElement('button');b.textContent='Size & placement';b.onclick=()=>selectComponent(el.dataset.component);toolbar.append(b);}};

function pictureLibrary(onChoose){
  let dialog=$('#picture-library');if(!dialog){dialog=document.createElement('dialog');dialog.id='picture-library';document.body.append(dialog);}
  const names=[...new Set([...media,...activeUploads()])];
  dialog.innerHTML='<div class="panel-head"><h2>Choose a picture</h2><button aria-label="Close picture library">×</button></div><label>Find a picture<input type="search" placeholder="Search filename"></label><div class="library-pictures">'+names.map(name=>`<button data-picture-name="${esc(name)}"><img src="${esc(pictureSource(name))}" loading="lazy" alt="${esc(name)}"><span>${esc(name)}</span></button>`).join('')+'</div>';
  dialog.querySelector('.panel-head button').onclick=()=>dialog.close();
  dialog.querySelector('input').oninput=e=>dialog.querySelectorAll('[data-picture-name]').forEach(b=>b.hidden=!b.dataset.pictureName.toLowerCase().includes(e.target.value.toLowerCase()));
  dialog.querySelectorAll('[data-picture-name]').forEach(b=>b.onclick=()=>{dialog.close();onChoose(b.dataset.pictureName);});dialog.showModal();
}
window.imageQuickControls=function(target,entry){
  if(!entry.picture)return;
  const key=entry.key, prefix='settings/look:components.'+key+'.'+componentDevice+'.',cfg=model.settings.look.components?.[key]?.[componentDevice] || {};
  const pictureKey=entry.edit || 'settings/look:components.'+key+'.image';
  const section=document.createElement('section');section.className='image-quick';
  section.innerHTML='<h3>Image controls</h3><button class="focus-photo" aria-label="Set the crop focus by clicking the picture"><img src="'+esc(entry.el.currentSrc || entry.el.src)+'" alt="Crop focus preview"><span style="left:'+(cfg.focalX??50)+'%;top:'+(cfg.focalY??50)+'%"></span></button><p class="help">Click the preview to choose the crop focus.</p><button data-picture-library>Choose from my pictures</button><label>Image size <output>'+Number(cfg.width||100)+'%</output><input data-image-size type="range" min="20" max="100" step="5" value="'+Number(cfg.width||100)+'"></label><div class="image-options" aria-label="Image alignment">'+['left','center','right'].map(value=>`<button data-image-align="${value}" aria-pressed="${cfg.align===value}">${value==='center'?'Centre':value[0].toUpperCase()+value.slice(1)}</button>`).join('')+'</div><div class="image-options" aria-label="Image shape">'+['Original','Square','Portrait','Wide'].map(value=>`<button data-image-shape="${value}">${value}</button>`).join('')+'</div><div class="component-pair"><button data-image-earlier>Move earlier</button><button data-image-later>Move later</button></div>';
  target.querySelector('.component-tabs').after(section);
  section.querySelector('[data-picture-library]').onclick=()=>pictureLibrary(name=>{change(pictureKey,'/assets/work/'+name);renderComponentControls();});
  const slider=section.querySelector('[data-image-size]');slider.oninput=()=>section.querySelector('output').textContent=slider.value+'%';slider.onchange=()=>change(prefix+'width',slider.value);
  section.querySelectorAll('[data-image-align]').forEach(b=>b.onclick=()=>{change(prefix+'align',b.dataset.imageAlign);renderComponentControls();});
  section.querySelectorAll('[data-image-shape]').forEach(b=>b.onclick=()=>{const shape=b.dataset.imageShape;mutate(m=>{m.settings.look.components ||= {};const component=m.settings.look.components[key] ||= {};const style=component[componentDevice] ||= {};Object.assign(style,{ratio:{Original:'',Square:'1 / 1',Portrait:'3 / 4',Wide:'16 / 9'}[shape],objectFit:shape==='Original'?'contain':'cover',width:style.width||100});});renderComponentControls();});
  section.querySelector('.focus-photo').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();const x=Math.round(Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100))),y=Math.round(Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100)));mutate(m=>{m.settings.look.components ||= {};const c=m.settings.look.components[key] ||= {};Object.assign(c[componentDevice] ||= {},{focalX:x,focalY:y});});renderComponentControls();};
  const block=entry.el.closest('[data-page-block]')?.dataset.pageBlock,id=entry.edit.startsWith('works/')?entry.edit.split(':')[0].slice(6):null;
  for(const [selector,direction] of [['[data-image-earlier]',-1],['[data-image-later]',1]]){const button=section.querySelector(selector);button.disabled=!block&&!id;button.onclick=()=>{block?movePageBlock(block,direction):moveWork(id,direction);renderComponentControls();};}
};

window.movePageBlock=function(id,direction){
  const current=model.settings.look.blocks[id],siblings=pageBlocks().filter(([,b])=>(b.position||'before')===(current.position||'before')),index=siblings.findIndex(([key])=>key===id),next=index+direction;
  if(index<0||next<0||next>=siblings.length)return;
  [siblings[index],siblings[next]]=[siblings[next],siblings[index]];
  mutate(m=>siblings.forEach(([key],i)=>m.settings.look.blocks[key].order=i+1));
};
function addPageBlock(block){
  const id=uniqueId(block.title || block.type,model.settings.look.blocks || {}),page=builderPage();
  mutate(m=>{m.settings.look.blocks ||= {};m.settings.look.blocks[id]={...block,page,order:Math.max(0,...pageBlocks().map(([,b])=>b.order||0))+1};});
  openPanel('content');frame.contentDocument.querySelector('[data-page-block="'+id+'"]')?.scrollIntoView({block:'center',behavior:'instant'});
  return id;
}
function blockForm(type){
  let dialog=$('#block-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='block-dialog';document.body.append(dialog);}
  dialog.innerHTML='<form><h2>Add '+(type==='image'?'an image':'a text box')+'</h2><label>Heading (optional)<input name="title"></label>'+(type==='text'?'<label>Text<textarea name="text" placeholder="Write your text here" required></textarea></label>':'<label>Upload a picture<input name="picture" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><button type="button" data-pick-existing>Or choose from my pictures</button><div data-chosen-picture></div><label>Caption (optional)<textarea name="caption"></textarea></label><label>Image description<input name="alt" placeholder="Describe the image for visitors using a screen reader"></label>')+'<label>Place it<select name="position"><option value="before">Above the artwork</option><option value="after">Below the artwork</option></select></label><p data-block-error role="alert"></p><div class="dialog-actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">Add to page</button></div></form>';
  let existing=null;dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
  dialog.querySelector('[data-pick-existing]')?.addEventListener('click',()=>pictureLibrary(name=>{existing=name;dialog.querySelector('[name=picture]').value='';dialog.querySelector('[data-chosen-picture]').innerHTML='<img class="chosen-picture" alt="Selected picture" src="'+esc(pictureSource(name))+'">';}));
  dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const submit=dialog.querySelector('[type=submit]');submit.disabled=true;try{requireOwnership();const data=new FormData(e.target),block={type,title:data.get('title'),position:data.get('position')};if(type==='text')block.text=data.get('text');else{const file=data.get('picture');let name=existing;if(file?.size){name=await preparePicture(file);requireOwnership();mutate(m=>m.media.push(name));}if(!name)throw Error('Choose or upload a picture first.');Object.assign(block,{image:'/assets/work/'+name,caption:data.get('caption'),alt:data.get('alt')});}dialog.close();addPageBlock(block);}catch(error){dialog.querySelector('[data-block-error]').textContent=error.message;}finally{submit.disabled=false;}};
  dialog.showModal();
}
function bulkArtwork(){
  let dialog=$('#bulk-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='bulk-dialog';document.body.append(dialog);}
  dialog.innerHTML='<form><h2>Add several artworks</h2><p class="help">Each picture becomes its own editable artwork. You can rename them and add details afterwards.</p><label>Portfolio category<select name="category">'+sorted(model.categories).map(([id,c])=>`<option value="${id}" ${builderCategory()===id?'selected':''}>${esc(c.title)}</option>`).join('')+'</select></label><label>Pictures<input name="pictures" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple required></label><label>Medium (optional)<input name="medium" placeholder="e.g. Pen and ink"></label><p data-bulk-progress role="status"></p><div class="dialog-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Add artworks</button></div></form>';
  let uploading=false;
  const completed=new Set(),fileKey=file=>[file.name,file.size,file.lastModified].join('|');
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.oncancel=e=>{if(uploading)e.preventDefault();};
  dialog.querySelector('form').onsubmit=async e=>{
    e.preventDefault();if(uploading)return;
    const data=new FormData(e.target),files=data.getAll('pictures').filter(file=>file.size&&!completed.has(fileKey(file))),category=data.get('category');
    if(!files.length){dialog.querySelector('[data-bulk-progress]').textContent='Those pictures have already been added. Choose more pictures or close this window.';return;}
    uploading=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);let count=0;
    try{
      for(const file of files){
        requireOwnership();dialog.querySelector('[data-bulk-progress]').textContent='Adding picture '+(count+1)+' of '+files.length+'…';
        const name=await preparePicture(file);requireOwnership();
        const title=file.name.replace(/\.[^.]+$/,'').replace(/[-_]/g,' ');
        mutate(m=>{const id=uniqueId(title,m.works);m.media.push(name);m.works[id]={title,file:'/assets/work/'+name,category,medium:data.get('medium')||'',size:'',year:'',price:'',sold:false,order:Math.max(0,...Object.values(m.works).filter(w=>w.category===category).map(w=>w.order||0))+1};});
        completed.add(fileKey(file));count++;
      }
      dialog.close();navigate('portfolio/'+category);openPanel('content');say(count+' artworks added to your draft.');
    }catch(error){dialog.querySelector('[data-bulk-progress]').textContent=count+' added. '+error.message+' Completed uploads are kept; retrying skips those pictures.';}
    finally{uploading=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  };dialog.showModal();
}
function galleryPreset(columns){
  const grid=frame.contentDocument.querySelector('.works');if(!grid){say('Add your first artwork, then choose the gallery layout.');return;}
  const key=grid.dataset.component;
  mutate(m=>{m.settings.look.components ||= {};const c=m.settings.look.components[key] ||= {};Object.assign(c.desktop ||= {},{layout:'columns',columns,gap:columns===1?80:32});Object.assign(c.mobile ||= {},{layout:'stack',gap:40});});
  say(columns===1?'Large artwork layout applied.':columns+'-column gallery applied. Phones use one column.');
}
contentPanel=function(p){
  originalContentPanel(p);
  const builder=document.createElement('section');builder.className='page-builder';p.prepend(builder);
  builder.innerHTML='<h3>Build this page</h3><p class="help">Add artwork to the portfolio, or add image and text blocks around it. Everything stays in your draft until Publish.</p><div class="builder-actions"><button data-build-action="artwork">Add artwork</button><button data-build-action="bulk">Upload several</button><button data-build-action="image">Add image</button><button data-build-action="text">Add text box</button></div><h3>Gallery layout</h3><div class="image-options"><button data-gallery="1">Large images</button><button data-gallery="2">Two columns</button><button data-gallery="3">Three columns</button></div><div id="page-block-list"></div>';
  builder.querySelectorAll('[data-build-action]').forEach(b=>b.onclick=()=>builderAction(b.dataset.buildAction));
  builder.querySelectorAll('[data-gallery]').forEach(b=>b.onclick=()=>galleryPreset(Number(b.dataset.gallery)));
  if(!frame.contentDocument.querySelector('.works'))builder.querySelectorAll('[data-gallery]').forEach(b=>b.disabled=true);
  const category=builderCategory();
  if(category){const info=document.createElement('section');info.innerHTML='<h3>Portfolio page</h3>'+field('categories/'+category+':title','Page title')+field('categories/'+category+':intro','Introduction','textarea');builder.append(info);bindFields(info);}
  if(category){
    const artworks=sorted(model.works).filter(([,w])=>w.category===category),section=document.createElement('section');section.className='artwork-manager';
    section.innerHTML='<h3>Your artworks ('+artworks.length+')</h3>';builder.append(section);
    for(const [id,w] of artworks){
      const card=document.createElement('details');card.className='block-card';card.dataset.managedWork=id;
      card.innerHTML='<summary><img src="'+esc(pictureSource(w.file))+'" alt="">'+esc(w.title)+'</summary>'+detailsFields(id)+'<button data-work-picture>Change picture</button><button data-work-library>Choose existing picture</button><div class="image-options"><button data-work-up>Up</button><button data-work-down>Down</button><button data-work-remove>Remove</button></div>';
      section.append(card);bindFields(card);
      card.querySelector('[data-field$=":title"]').addEventListener('change',()=>{card.querySelector('summary').lastChild.textContent=model.works[id]?.title || 'Artwork';});
      card.querySelector('[data-work-picture]').onclick=()=>choosePicture('works/'+id+':file');
      card.querySelector('[data-work-library]').onclick=()=>pictureLibrary(name=>{change('works/'+id+':file','/assets/work/'+name);openPanel('content');});
      card.querySelector('[data-work-up]').onclick=()=>{moveWork(id,-1);openPanel('content');};card.querySelector('[data-work-down]').onclick=()=>{moveWork(id,1);openPanel('content');};
      card.querySelector('[data-work-remove]').onclick=()=>{mutate(m=>{delete m.works[id];m.settings.home.featured=(m.settings.home.featured||[]).filter(key=>key!==id);});openPanel('content');say('Artwork removed. Undo brings it back; its picture stays in Media.');};
      card.querySelector('[data-field$=":category"]').addEventListener('change',()=>openPanel('content'));
    }
  }
  const list=builder.querySelector('#page-block-list');
  if(pageBlocks().length)list.innerHTML='<h3>Your page blocks</h3>';
  for(const [id,b] of pageBlocks()){
    const box=document.createElement('details');box.className='block-card';box.dataset.blockCard=id;
    box.innerHTML='<summary>'+(b.image?'<img src="'+esc(pictureSource(b.image))+'" alt="">':'')+esc(b.title || (b.type==='image'?'Image block':'Text box'))+'</summary>'+field('settings/look:blocks.'+id+'.title','Heading')+(b.type==='text'?field('settings/look:blocks.'+id+'.text','Text','textarea'):field('settings/look:blocks.'+id+'.caption','Caption','textarea')+field('settings/look:blocks.'+id+'.alt','Image description')+'<button data-block-picture>Change picture</button>')+`<label>Position<select data-block-position><option value="before" ${b.position!=='after'?'selected':''}>Above artwork</option><option value="after" ${b.position==='after'?'selected':''}>Below artwork</option></select></label><div class="image-options"><button data-block-up>Up</button><button data-block-down>Down</button><button data-block-style>Size & style</button></div><div class="component-pair"><button data-block-copy>Duplicate</button><button data-block-delete>Remove</button></div>`;
    list.append(box);bindFields(box);
    box.querySelector('[data-field$=".title"]').addEventListener('change',()=>{box.querySelector('summary').lastChild.textContent=model.settings.look.blocks[id]?.title || (b.type==='image'?'Image block':'Text box');});
    box.querySelector('[data-block-position]').onchange=e=>change('settings/look:blocks.'+id+'.position',e.target.value);
    box.querySelector('[data-block-up]').onclick=()=>{movePageBlock(id,-1);openPanel('content');};box.querySelector('[data-block-down]').onclick=()=>{movePageBlock(id,1);openPanel('content');};
    box.querySelector('[data-block-copy]').onclick=()=>addPageBlock({...clone(model.settings.look.blocks[id]),title:b.title?b.title+' (copy)':''});
    box.querySelector('[data-block-delete]').onclick=()=>{mutate(m=>delete m.settings.look.blocks[id]);openPanel('content');say('Block removed. Undo brings it back.');};
    box.querySelector('[data-block-picture]')?.addEventListener('click',()=>choosePicture('settings/look:blocks.'+id+'.image'));
    box.querySelector('[data-block-style]').onclick=()=>{const element=frame.contentDocument.querySelector('[data-page-block="'+id+'"]');if(element)selectComponent((element.querySelector('img') || element).dataset.component);};
  }
};
function builderAction(action){if(action==='artwork')openPanel('add');else if(action==='bulk')bulkArtwork();else blockForm(action);}
window.setupPageBuilder=function(){
  const doc=frame.contentDocument,style=doc.createElement('style');style.textContent='.studio-page-add{border:1px dashed #aab3c0;background:#f7f9fc;color:#20242a;padding:28px;margin:32px 0;font:15px Arial;line-height:1.6}.studio-page-add strong{display:block;margin-bottom:6px}.studio-page-add div{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.studio-page-add button{font:14px Arial;background:white;border:1px solid #c4ccd7;padding:12px 16px;border-radius:5px;color:#20242a}.studio-preview .studio-page-add{display:none!important}';doc.head.append(style);
  const decorateBuilder=()=>{doc.querySelectorAll('.studio-page-add').forEach(el=>el.remove());const category=builderCategory();if(!category)return;const c=frame.contentWindow.__site.getS().categories.find(c=>c.slug===category),empty=!c?.works.length;const box=doc.createElement('aside');box.className='studio-page-add';box.innerHTML='<strong>'+(empty?'Make this page yours':'Add to this portfolio page')+'</strong>'+(empty?'Add your first artwork to get the same gallery as the other portfolio pages. You can also add text and standalone pictures.':'Add more artwork, pictures or text. Changes stay in your draft until you publish.')+'<div><button data-build-action="artwork">Add artwork</button><button data-build-action="bulk">Upload several</button><button data-build-action="image">Add image</button><button data-build-action="text">Add text box</button></div>';box.querySelectorAll('button').forEach(b=>b.onclick=()=>builderAction(b.dataset.buildAction));const placeholder=doc.querySelector('.empty');if(placeholder)placeholder.replaceWith(box);else{const page=doc.querySelector('main>.page');page?.insertBefore(box,page.querySelector('.nextcat'));}};
  doc.addEventListener('studio:render',decorateBuilder);
};
