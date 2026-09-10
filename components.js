/* Shared component customization for the public site and Studio canvas. */
(() => {
  'use strict';
  const registry = new Map(), originals = new WeakMap(), identities = new WeakMap(), originalOrders = new WeakMap();
  const keyFor = path => 'c' + Array.from(new TextEncoder().encode(path), b => b.toString(16).padStart(2, '0')).join('');
  const allowedTags = 'header,nav,section,footer,div,h1,h2,h3,p,a,button,img,svg.mark,ul,ol,li,figure,figcaption,span,b,em,form,label,input,textarea';
  const number = (value, low, high) => Number.isFinite(Number(value)) ? Math.min(high, Math.max(low, Number(value))) : low;
  const color = value => /^#[\da-f]{6}$/i.test(value);
  function safeLink(value) {
    const text = String(value || '').trim();
    return /^(https?:\/\/|mailto:|tel:|#|\/(?!\/))/i.test(text) && !/[\u0000-\u001f]/.test(text) ? text : null;
  }
  function declarations(settings = {}) {
    const rules = [];
    const px = {fontSize:[10,160],gap:[0,160],padding:[0,160],marginTop:[0,240],marginBottom:[0,240],borderRadius:[0,100],borderWidth:[0,12],maxHeight:[40,1600]};
    const prop = name => name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    for (const [name, limits] of Object.entries(px)) if (settings[name] !== '' && settings[name] != null) rules.push(`${prop(name)}:${number(settings[name], ...limits)}px!important`);
    for (const name of ['color','backgroundColor','borderColor']) if (color(settings[name])) rules.push(`${prop(name)}:${settings[name]}!important`);
    if (settings.borderWidth > 0) rules.push('border-style:solid!important');
    if (settings.width !== '' && settings.width != null) rules.push(`width:${number(settings.width,10,100)}%!important;max-width:100%!important;min-width:0!important`);
    if (settings.letterSpacing !== '' && settings.letterSpacing != null) rules.push(`letter-spacing:${number(settings.letterSpacing,-2,12)}px!important`);
    if (settings.lineHeight !== '' && settings.lineHeight != null) rules.push(`line-height:${number(settings.lineHeight,1,2.5)}!important`);
    const choices = {textAlign:['left','center','right'],fontWeight:['300','400','500','600','700'],fontStyle:['normal','italic'],objectFit:['contain','cover'],alignItems:['start','center','end','stretch']};
    for (const [name, values] of Object.entries(choices)) if (values.includes(settings[name])) rules.push(`${prop(name)}:${settings[name]}!important`);
    if (['left','center','right'].includes(settings.align)) rules.push(`margin-left:${settings.align === 'left' ? '0' : 'auto'}!important;margin-right:${settings.align === 'right' ? '0' : 'auto'}!important;justify-self:${{left:'start',center:'center',right:'end'}[settings.align]}!important`);
    if (['stack','columns'].includes(settings.layout)) rules.push(`display:grid!important;grid-template-columns:${settings.layout === 'stack' ? 'minmax(0,1fr)' : `repeat(${number(settings.columns || 2,1,4)},minmax(0,1fr))`}!important`);
    if (settings.ratio && ['1 / 1','4 / 3','3 / 4','16 / 9'].includes(settings.ratio)) rules.push(`aspect-ratio:${settings.ratio}!important;height:auto!important${settings.maxHeight==null||settings.maxHeight===''?';max-height:none!important':''}`);
    if (settings.focalX != null || settings.focalY != null) rules.push(`object-position:${number(settings.focalX ?? 50,0,100)}% ${number(settings.focalY ?? 50,0,100)}%!important`);
    if (settings.x != null || settings.y != null) rules.push(`translate:${number(settings.x || 0,-300,300)}px ${number(settings.y || 0,-300,300)}px!important`);
    if (settings.hidden === true) rules.push('display:none!important');
    return rules.join(';');
  }
  function apply(site, route, pictureURL) {
    renderBlocks(site,route,pictureURL);
    registry.clear();
    let sheet = document.getElementById('component-styles');
    if (!sheet) { sheet = document.createElement('style'); sheet.id = 'component-styles'; document.head.append(sheet); }
    sheet.textContent = '';
    const settings = site.settings?.components || {};
    // Keep labels with nested inputs/icons editable without replacing those controls.
    document.querySelectorAll('#main label, #menu button').forEach(el => {
      if(!el.children.length)return;
      [...el.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE && node.textContent.trim()).forEach(node=>{const span=document.createElement('span');node.before(span);span.append(node);});
    });
    const roots = [...document.querySelectorAll('body > header, #menu, main#main, main footer')];
    // Header/menu nodes survive site renders. Restore their baseline order before applying
    // the current settings so Undo also reverses their structural changes.
    for(const root of roots) for(const el of [root,...root.querySelectorAll('*')]) {
      const current=[...el.children],saved=originalOrders.get(el);
      if(saved && current.length===saved.length && saved.every(child=>child.parentElement===el)) saved.forEach(child=>el.append(child));
      else originalOrders.set(el,current);
    }
    // The site uses <main id="main">; footer gets a global identity across every route.
    for (const root of roots) {
      const prefix = root.tagName === 'FOOTER' ? 'footer' : root.id === 'main' ? route || 'home' : root.id || 'header';
      const visit = (el, parentPath, depth) => {
        if (root.id === 'main' && el !== root && el.tagName === 'FOOTER') return;
        if (el.closest('#studio-toolbar,#studio-hover') || ['SCRIPT','STYLE','USE','RECT','I','BR'].includes(el.tagName)) return;
        const record = el.matches('figure,.sel>a,.catlist>li') ? el.querySelector('[data-edit^="works/"],[data-edit^="categories/"]')?.dataset.edit.split(':')[0] : '';
        const signature = node => node.tagName.toLowerCase() + (node.classList[0] ? '-'+node.classList[0] : '');
        const similar = [...(el.parentElement?.children || [])].filter(node=>signature(node)===signature(el));
        const identity = record || el.dataset.edit || el.id || el.dataset.pageBlock || (signature(el)+'-'+similar.indexOf(el));
        const path = identities.get(el) || (el === root ? prefix : parentPath + '/' + identity);
        identities.set(el,path);
        const key = keyFor(path);
        el.dataset.component = key;
        if (el.matches(allowedTags) || el === root) {
          const leaf = !el.children.length && !['IMG','INPUT','TEXTAREA','SVG'].includes(el.tagName);
          let original = originals.get(el);
          if (!original) { original = {text:el.textContent,href:el.getAttribute('href'),src:el.getAttribute('src'),alt:el.getAttribute('alt')}; originals.set(el,original); }
          const entry = {key,el,parent:el.parentElement?.dataset.component,depth,leaf,edit:el.dataset.edit || '',picture:el.tagName === 'IMG'};
          const titles = {stage:'Home introduction section',selected:'Selected works section',cats:'Portfolio categories section',comm:'Commission section',main:'Page',brand:'Header logo and name',burger:'Menu button',menu:'Navigation',cf:'Contact form'};
          const containers = {row:'Heading row',sel:'Artwork grid',catlist:'Category list',slot:'Rotating artwork',portrait:'Bio picture container',col:'Footer links',im:'Picture container',logo:'Central logo',two:'Text and picture layout',text:'Paragraphs',works:'Artwork grid',bottom:'Footer bottom line'};
          const type = /^H[1-6]$/.test(el.tagName)?'Heading':el.tagName==='A'?'Link':el.tagName==='BUTTON'?'Button':el.tagName==='P'?'Paragraph':'Text';
          entry.name = titles[el.id] || (el.tagName === 'FOOTER' ? 'Footer' : el.tagName === 'IMG' ? 'Picture: ' + (el.alt || 'Artwork') : el.tagName.toLowerCase() === 'svg' ? 'Logo mark' : (leaf ? type+': '+String(settings[key]?.text ?? original.text).trim().slice(0,50) : containers[el.classList[0]] || el.tagName.toLowerCase()));
          registry.set(key,entry);
        }
        [...el.children].forEach(child => visit(child,path,depth+1));
      };
      visit(root,prefix,0);
    }
    const styles = [];
    for (const entry of registry.values()) {
      const {el,key,leaf,picture} = entry, cfg = settings[key] || {}, original = originals.get(el);
      if (leaf && !entry.edit && cfg.text != null) el.textContent = cfg.text;
      else if (leaf && !entry.edit) el.textContent = original.text;
      if (el.tagName === 'A') { const href = safeLink(cfg.href) || original.href; if (href != null) el.setAttribute('href',href); }
      if (picture && !entry.edit && cfg.image) { el.src = pictureURL(String(cfg.image).replace(/^.*\//,'')); el.removeAttribute('data-full'); }
      if (picture && cfg.alt != null) el.alt = cfg.alt;
      const selector = `[data-component="${key}"]`;
      styles.push(`${selector}{${declarations(cfg.common)}}`);
      styles.push(`@media(min-width:701px){${selector}{${declarations(cfg.desktop)}}}`);
      styles.push(`@media(max-width:700px){${selector}{${declarations(cfg.mobile)}}}`);
      if (Array.isArray(cfg.children)) {
        const children = [...el.children], ordered = cfg.children.map(id => children.find(child => child.dataset.component === id)).filter(Boolean);
        [...ordered,...children.filter(child=>!ordered.includes(child))].forEach(child=>el.append(child));
      }
    }
    for (const entry of registry.values()) {
      const parent=registry.get(settings[entry.key]?.parent)?.el;
      if(parent && parent!==entry.el && !entry.el.contains(parent) && parent.closest('main') && entry.el.closest('main') && !parent.closest('footer') && !entry.el.closest('footer')) parent.append(entry.el);
    }
    for(const entry of registry.values()) {
      const ids=settings[entry.key]?.children;if(!Array.isArray(ids))continue;
      const children=[...entry.el.children],ordered=ids.map(id=>children.find(child=>child.dataset.component===id)).filter(Boolean);
      [...ordered,...children.filter(child=>!ordered.includes(child))].forEach(child=>entry.el.append(child));
    }
    for (const entry of registry.values()) entry.parent=entry.el.parentElement?.dataset.component;
    sheet.textContent = styles.join('\n');
  }
  function renderBlocks(site,route,pictureURL) {
    const main=document.getElementById('main');if(!main)return;
    main.querySelectorAll('[data-page-block]').forEach(el=>el.remove());
    const blocks=Object.entries(site.settings?.blocks || {}).filter(([,b])=>b.page===(route||'home') && ['text','image'].includes(b.type)).sort((a,b)=>(a[1].order||0)-(b[1].order||0)||a[0].localeCompare(b[0]));
    const container=main.querySelector(':scope>.page')||main;
    let style=document.getElementById('page-block-styles');
    if(!style){style=document.createElement('style');style.id='page-block-styles';style.textContent=`.page-block{margin:48px 0;max-width:100%;min-width:0}.page-block h2{font-size:clamp(24px,3vw,38px);font-weight:400;line-height:1.25;margin-bottom:20px}.page-block-text p{max-width:65ch;white-space:pre-wrap;font-size:inherit}.page-block-image img{width:100%;max-height:800px;object-fit:contain}.page-block figcaption{font-size:14px;color:var(--muted);margin-top:14px;white-space:pre-wrap}main>.page-block{margin:48px var(--gutter)}@media(max-width:700px){.page-block{margin-top:28px;margin-bottom:28px}.page-block-image img{max-height:560px}}`;document.head.append(style);}
    for(const [id,block] of blocks){
      const element=document.createElement(block.type==='image'?'figure':'section');element.className='page-block page-block-'+block.type;element.dataset.pageBlock=id;
      const editable=(tag,field,value)=>{const el=document.createElement(tag);el.textContent=value || '';el.dataset.edit='settings/look:blocks.'+id+'.'+field;return el;};
      if(block.title)element.append(editable('h2','title',block.title));
      if(block.type==='text')element.append(editable('p','text',block.text));
      else if(block.image){const img=document.createElement('img');img.src=pictureURL(String(block.image).replace(/^.*\//,''));img.alt=block.alt||block.title||'';img.loading='lazy';img.dataset.edit='settings/look:blocks.'+id+'.image';element.append(img);if(block.caption)element.append(editable('figcaption','caption',block.caption));}
      const start=container===main?main.querySelector('#selected,#cats,#comm,footer'):container.querySelector(':scope>.works,:scope>.empty,:scope>.two,:scope>.text,:scope>.catlist,:scope>.steps,:scope>#cf,:scope>.nextcat');
      const end=container===main?main.querySelector('footer'):container.querySelector(':scope>.nextcat');
      container.insertBefore(element,block.position==='after'?end:start);
    }
    if(blocks.length)main.querySelector('.empty')?.remove();
  }
  window.SiteComponents = {apply, registry, declarations, safeLink};
})();
