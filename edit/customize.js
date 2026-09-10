/* Layout and content controls reuse Studio's undo, recovery and publish pipeline. */
'use strict';
let componentSelection = null, componentDevice = 'desktop', componentSearch = '';
const oldOpenPanel = openPanel, oldClosePanel = closePanel;
const componentRegistry = () => frame.contentWindow.SiteComponents?.registry || new Map();
const componentEntry = () => componentRegistry().get(componentSelection);
const configKey = suffix => 'settings/look:components.' + componentSelection + '.' + suffix;
const customizationStyle = document.createElement('link');customizationStyle.rel='stylesheet';customizationStyle.href='customize.css';document.head.append(customizationStyle);
for (const [name,title] of [['components','Components'],['content','Content']]) {
  const button=document.createElement('button');button.dataset.panel=name;button.textContent=title;
  button.onclick=()=>panel===name?closePanel():openPanel(name);$('#rail').append(button);
}
openPanel = function(name) {
  if(!['components','content'].includes(name)){oldOpenPanel(name);frame.contentDocument?.body.classList.remove('component-picking');return;}
  commitEdits();panel=name;$('#panel').hidden=false;document.body.classList.add('has-panel');
  $('#properties').hidden=true;document.body.classList.remove('has-properties');
  document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.panel===name)));
  $('#panel').innerHTML=`<div class="panel-head"><h2>${name==='components'?'Components':'Page content'}</h2><button id="close-panel" aria-label="Close panel">×</button></div><div id="panel-body"></div>`;
  $('#close-panel').onclick=closePanel;
  frame.contentDocument?.body.classList.toggle('component-picking',name==='components');
  if(name==='components')componentsPanel($('#panel-body'));else contentPanel($('#panel-body'));
};
closePanel = function(){oldClosePanel();frame.contentDocument?.body.classList.remove('component-picking');};
function componentControlsMarkup(entry) {
  const cfg=model.settings.look.components?.[entry.key] || {}, device=configKey(componentDevice+'.');
  const options=(fieldName,title,values)=>field(device+fieldName,title,'select',['',...values]);
  const numeric=(fieldName,title,min,max)=>field(device+fieldName,title,'number').replace('type="number"',`type="number" min="${min}" max="${max}" step="${fieldName==='lineHeight'?'0.1':'1'}" placeholder="Original"`);
  const inherited=entry.edit && !entry.picture && entry.el.tagName!=='SVG';
  return `<div class="component-heading"><p class="component-name">${esc(entry.name)}</p><button id="component-parent">Select container</button></div>`+
    (entry.leaf?field(inherited?entry.edit:configKey('text'),'Text','textarea'):'')+
    (entry.el.tagName==='A'?field(configKey('href'),'Link address'):'')+
    (entry.picture?`<button id="component-picture">Change picture</button><label>Or use an uploaded picture<select id="component-media"><option value="">Choose a picture</option>${[...new Set([...media,...activeUploads()])].map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></label>`+field(configKey('alt'),'Image description'):'')+
    `<div class="component-tabs" aria-label="Layout applies to"><button data-breakpoint="desktop" aria-pressed="${componentDevice==='desktop'}">Computer</button><button data-breakpoint="mobile" aria-pressed="${componentDevice==='mobile'}">Phone</button></div><p class="help">These layout changes apply to ${componentDevice==='mobile'?'phones':'screens wider than 700px'}. Blank fields keep the original design.</p>`+
    '<div class="component-pair"><button id="component-up">Move before</button><button id="component-down">Move after</button></div><p class="help">Move within the current container. Select container to move the whole section.</p>'+ moveDestinationMarkup(entry)+
    field(device+'hidden','Hide on '+(componentDevice==='mobile'?'phone':'computer'),'checkbox')+
    '<details open><summary>Position & size</summary>'+options('align','Horizontal position',['left','center','right'])+numeric('width','Width (%)',10,100)+numeric('marginTop','Space above (px)',0,240)+numeric('marginBottom','Space below (px)',0,240)+numeric('padding','Inside spacing (px)',0,160)+
    (componentDevice==='desktop'?numeric('x','Fine position: left / right (px)',-300,300)+numeric('y','Fine position: up / down (px)',-300,300):'')+'</details>'+
    (!entry.leaf && !entry.picture?'<details><summary>Arrange contents</summary>'+options('layout','Arrangement',['stack','columns'])+numeric('columns','Number of columns',1,4)+numeric('gap','Space between items (px)',0,160)+options('alignItems','Vertical alignment',['start','center','end','stretch'])+'</details>':'')+
    '<details><summary>Type & colour</summary>'+options('textAlign','Text alignment',['left','center','right'])+numeric('fontSize','Text size (px)',10,160)+options('fontWeight','Text weight',['300','400','500','600','700'])+options('fontStyle','Style',['normal','italic'])+numeric('lineHeight','Line height',1,2.5)+numeric('letterSpacing','Letter spacing (px)',-2,12)+['color','backgroundColor','borderColor'].map((name,i)=>field(device+name,['Text colour','Background colour','Border colour'][i]).replace('type="text"','type="text" placeholder="#161615" pattern="#[0-9a-fA-F]{6}"')).join('')+numeric('borderWidth','Border thickness (px)',0,12)+numeric('borderRadius','Round corners (px)',0,100)+'</details>'+
    (entry.picture?'<details open><summary>Picture framing</summary>'+options('objectFit','Fit',['contain','cover'])+options('ratio','Shape',['1 / 1','4 / 3','3 / 4','16 / 9'])+numeric('maxHeight','Maximum height (px)',40,1600)+numeric('focalX','Focus: left / right (%)',0,100)+numeric('focalY','Focus: top / bottom (%)',0,100)+'</details>':'')+
    '<button id="component-reset">Reset this screen’s styles</button>';
}
function componentsPanel(p) {
  p.innerHTML='<p class="help">Click anything on the page to select it. Use the list for hidden items or a whole section.</p><label>Find a component<input id="component-search" placeholder="Heading, picture, footer…"></label><div id="component-list" class="component-list"></div><div id="component-controls"></div>';
  $('#component-search').value=componentSearch;
  $('#component-search').oninput=e=>{componentSearch=e.target.value;renderComponentList();};
  renderComponentList();renderComponentControls();
}
function moveDestinationMarkup(entry) {
  if(!entry.el.closest('main') || entry.el.closest('footer') || entry.el.matches('main,input,textarea,label,figure') || entry.el.closest('.works,.sel,.catlist'))return '';
  const choices=[...componentRegistry().values()].filter(e=>e.key!==entry.key && !entry.el.contains(e.el) && e.el.closest('main') && !e.el.closest('footer,.works,.sel,.catlist') && e.el.matches('main,section,div') && !e.el.matches('.slot,.im,.portrait,.logo'));
  return '<label>Move to another container<select id="component-destination"><option value="">Choose a container</option>'+choices.map(e=>`<option value="${e.key}">${esc(e.name)}</option>`).join('')+'</select></label>';
}
function renderComponentList() {
  const list=$('#component-list');if(!list)return;
  list.innerHTML=[...componentRegistry().values()].sort((a,b)=>a.el.compareDocumentPosition(b.el)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1).filter(e=>e.name.toLowerCase().includes(componentSearch.toLowerCase())).map(e=>`<button data-component-select="${e.key}" aria-pressed="${componentSelection===e.key}" style="padding-left:${8+Math.min(e.depth,5)*8}px">${esc(e.name || 'Container')}</button>`).join('');
  list.querySelectorAll('button').forEach(b=>b.onclick=()=>selectComponent(b.dataset.componentSelect));
}
function selectComponent(key) {
  commitEdits();componentSelection=key;selected=null;showProperties();toolbar.hidden=true;
  if(panel!=='components')openPanel('components');else{renderComponentList();renderComponentControls();}
  highlightComponent();
  componentEntry()?.el.scrollIntoView({block:'nearest',behavior:'instant'});
}
function highlightComponent() {
  frame.contentDocument.querySelectorAll('.component-selected').forEach(el=>el.classList.remove('component-selected'));
  if(!preview && panel==='components')componentEntry()?.el.classList.add('component-selected');
}
function renderComponentControls() {
  const target=$('#component-controls');if(!target)return;
  const entry=componentEntry();target.innerHTML=entry?componentControlsMarkup(entry):'<p class="help">Choose a component above, or click it on the page.</p>';
  if(!entry)return;
  const cfg=model.settings.look.components?.[entry.key] || {};
  const defaults={text:entry.el.textContent,href:entry.el.getAttribute('href'),alt:entry.el.getAttribute('alt')};
  for(const [name,value] of Object.entries(defaults)) {const input=target.querySelector(`[data-field="${configKey(name)}"]`);if(input && cfg[name]==null)input.value=value||'';}
  bindFields(target);
  $('#component-parent').disabled=!componentRegistry().has(entry.parent);
  $('#component-parent').onclick=()=>selectComponent(entry.parent);
  target.querySelectorAll('[data-breakpoint]').forEach(b=>b.onclick=()=>{commitEdits();componentDevice=b.dataset.breakpoint;document.body.classList.toggle('phone',componentDevice==='mobile');$('#device').textContent=componentDevice==='mobile'?'Desktop':'Phone';$('#device').setAttribute('aria-pressed',String(componentDevice==='mobile'));renderComponentControls();});
  const peers=[...entry.el.parentElement.children].filter(el=>componentRegistry().has(el.dataset.component));
  $('#component-up').disabled=!componentRegistry().has(entry.parent)||peers.indexOf(entry.el)<=0;$('#component-down').disabled=!componentRegistry().has(entry.parent)||peers.indexOf(entry.el)===peers.length-1;
  $('#component-up').onclick=()=>moveComponent(-1);$('#component-down').onclick=()=>moveComponent(1);
  $('#component-destination')?.addEventListener('change',e=>{if(e.target.value){change(configKey('parent'),e.target.value);renderComponentList();renderComponentControls();highlightComponent();}});
  $('#component-reset').onclick=()=>{mutate(m=>{const cfg=m.settings.look.components?.[entry.key];if(cfg)delete cfg[componentDevice];});renderComponentControls();};
  const pictureKey=entry.edit || configKey('image');
  $('#component-picture')?.addEventListener('click',()=>choosePicture(pictureKey));
  $('#component-media')?.addEventListener('change',e=>{if(e.target.value)change(pictureKey,'/assets/work/'+e.target.value);});
  window.imageQuickControls?.(target,entry);
}
function moveComponent(direction) {
  const entry=componentEntry(),parent=entry?.el.parentElement;if(!entry||!parent)return;
  const ids=[...parent.children].map(el=>el.dataset.component).filter(Boolean),index=ids.indexOf(entry.key),to=index+direction;
  if(index<0 || to<0 || to>=ids.length)return;
  // Artwork/category order belongs to its records, so moving it is consistent on every page.
  if(entry.el.dataset.pageBlock) {
    window.movePageBlock?.(entry.el.dataset.pageBlock,direction);
  } else if(entry.el.matches('figure') && entry.el.closest('[data-editlist]')) {
    const id=entry.el.querySelector('[data-edit^="works/"]')?.dataset.edit.split(':')[0].slice(6);moveWork(id,direction);
  } else {
    [ids[index],ids[to]]=[ids[to],ids[index]];
    change('settings/look:components.'+parent.dataset.component+'.children',ids);
  }
  renderComponentList();renderComponentControls();highlightComponent();
}
function listFields(p,record,name,title,fields) {
  const section=document.createElement('section');section.className='content-group';p.append(section);
  const obj=record.split('/').reduce((o,k)=>o[k],model),items=obj[name] || [];
  section.innerHTML='<h3>'+esc(title)+'</h3>'+items.map((item,i)=>'<div class="content-item">'+(fields?fields.map(([key,label])=>field(record+':'+name+'.'+i+'.'+key,label,'textarea')).join(''):field(record+':'+name+'.'+i,'Paragraph '+(i+1),'textarea'))+`<div class="component-pair"><button data-list-up="${i}" ${i===0?'disabled':''}>Move up</button><button data-list-remove="${i}">Remove</button></div></div>`).join('')+'<button data-list-add>Add '+esc(title.toLowerCase().replace(/s$/,''))+'</button>';
  bindFields(section);
  const update=fn=>{mutate(m=>{const r=record.split('/').reduce((o,k)=>o[k],m);r[name] ||= [];fn(r[name]);});openPanel('content');};
  section.querySelector('[data-list-add]').onclick=()=>update(items=>items.push(fields?Object.fromEntries(fields.map(([k])=>[k,''])):''));
  section.querySelectorAll('[data-list-remove]').forEach(b=>b.onclick=()=>update(items=>items.splice(Number(b.dataset.listRemove),1)));
  section.querySelectorAll('[data-list-up]').forEach(b=>b.onclick=()=>update(items=>{const i=Number(b.dataset.listUp);[items[i-1],items[i]]=[items[i],items[i-1]];}));
}
function contentPanel(p) {
  const route=frame.contentWindow.__site.pathOf(),page=model.pages[route];
  p.innerHTML='<p class="help">Content for this page, plus contact details used throughout the site. Changes stay in your draft until you publish.</p>';
  if(page) {
    p.insertAdjacentHTML('beforeend',field('pages/'+route+':title','Page title'));
    listFields(p,'pages/'+route,'body','Paragraphs');
    if(route==='about') {const b=document.createElement('button');b.textContent='Change bio picture';b.onclick=()=>choosePicture('pages/about:image');p.append(b);listFields(p,'pages/about','cv','Exhibitions',[['year','Year'],['text','Description']]);}
    if(route==='commission'){listFields(p,'pages/commission','steps','Steps',[['t','Title'],['d','Description']]);p.insertAdjacentHTML('beforeend',field('pages/commission:cta','Enquiry button text'));}
  }
  if(!route) {
    const box=document.createElement('section');box.innerHTML='<h3>Home page</h3>'+['showSelectedWorks','showCategories','showCommission'].map((key,i)=>field('settings/home:'+key,['Show selected works','Show portfolio categories','Show commission section'][i],'checkbox')).join('')+field('settings/home:selectedCount','Selected works count','number')+'<h3>Rotating artwork</h3>'+sorted(model.works).map(([id,w])=>`<label class="featured-choice"><input type="checkbox" data-featured="${esc(id)}" ${(model.settings.home.featured||[]).includes(id)?'checked':''}>${esc(w.title)}<small>${esc(model.categories[w.category]?.title || '')}</small></label>`).join('');p.append(box);
    box.querySelectorAll('[data-featured]').forEach(b=>b.onchange=()=>mutate(m=>{const selected=new Set(m.settings.home.featured||[]);b.checked?selected.add(b.dataset.featured):selected.delete(b.dataset.featured);m.settings.home.featured=[...selected];}));
  }
  const site=document.createElement('details');site.innerHTML='<summary>Site details & contact</summary>'+['name','wordmark','tagline','email','instagram','location'].map(key=>field('settings/site:'+key,{name:'Artist name',wordmark:'Header name',tagline:'Tagline',email:'Contact email',instagram:'Instagram address',location:'Location'}[key])).join('');p.append(site);
  listFields(p,'settings/look','social','Social links',[['label','Label'],['url','Address']]);
  // List controls already bind their own fields.
  [...p.querySelectorAll('[data-field]')].filter(el=>!el.closest('.content-group')).forEach(el=>{const wrapper=document.createElement('div');el.parentElement.before(wrapper);wrapper.append(el.parentElement);bindFields(wrapper);});
}
window.setupCustomization = function() {
  const doc=frame.contentDocument;
  const style=doc.createElement('style');style.textContent='body.component-picking:not(.studio-preview) [data-component]:hover{outline:1px dashed #245bd7!important;outline-offset:2px;cursor:pointer}body.component-picking:not(.studio-preview) .component-selected{outline:2px solid #245bd7!important;outline-offset:3px}body.studio-preview .component-selected{outline:none!important}';doc.head.append(style);
  frame.contentWindow.addEventListener('click',e=>{if(preview || panel!=='components'||e.target.closest('#studio-toolbar,#studio-hover,.studio-page-add'))return;const el=e.target.closest('[data-component]');if(el){e.preventDefault();e.stopImmediatePropagation();selectComponent(el.dataset.component);}},true);
  frame.contentWindow.addEventListener('keydown',e=>{if(preview || panel!=='components' || !['Enter',' '].includes(e.key) || !e.target.matches('[data-component]'))return;e.preventDefault();e.stopImmediatePropagation();selectComponent(e.target.dataset.component);},true);
  let lastRoute='';
  doc.addEventListener('studio:render',()=>{const route=frame.contentWindow.__site.pathOf();if(route!==lastRoute){lastRoute=route;componentSelection=null;if(['components','content'].includes(panel))openPanel(panel);}else if(panel==='components'){renderComponentList();highlightComponent();}});
  window.setupPageBuilder?.();
};
