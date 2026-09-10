"""Run node editor/dev-server.js, then python3 editor/test-editor.py.
All content/assets bytes are restored, including after a failed assertion.
Uses the installed Playwright; no dependencies are installed by this script.
"""
import asyncio, base64, hashlib, json, os, subprocess, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = 'http://127.0.0.1:8793/ed-eastham/'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=')

def listing():
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in ROOT.rglob('*') if p.is_file() and '.git' not in p.parts}

async def main():
    snapshot = {p: p.read_bytes() for folder in ['content', 'assets'] for p in (ROOT/folder).rglob('*') if p.is_file()}
    directories = {p for folder in ['content', 'assets'] for p in (ROOT/folder).rglob('*') if p.is_dir()}
    failures=[]
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True)
        context=await browser.new_context(viewport={'width':1440,'height':1000}, reduced_motion='reduce')
        page=await context.new_page(); errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
        page.on('dialog',lambda d:asyncio.create_task(d.accept()))
        async def canvas():
            return page.frame_locator('#site-frame')
        async def navigate(route):
            await page.locator('#page-switcher').select_option(route)
            await page.wait_for_function('(route)=>document.querySelector("#site-frame").contentWindow.__site.pathOf()===route',arg=route)
            await page.wait_for_timeout(250)
        async def test1():
            await page.goto(URL+'edit/?local=1')
            await page.wait_for_function('window.Studio && document.querySelector("#site-frame").contentWindow.__site?.getS() && document.querySelector("#page-switcher").options.length>0')
            await page.frame_locator('#site-frame').locator('#stage').wait_for()
            assert not errors, errors
        async def test2():
            await navigate('portfolio/painted-portraits')
            title=page.frame_locator('#site-frame').locator('[data-edit="works/work-03:title"]')
            await title.click();await title.fill('Studio test portrait');await title.press('Enter')
            assert await title.inner_text()=='Studio test portrait'
            assert await page.locator('#dirty').is_visible()
            await page.locator('#undo').click();assert await title.inner_text()=='Untitled'
            await page.locator('#redo').click();assert await title.inner_text()=='Studio test portrait'
            await title.click();await title.fill('Cancelled text');await title.press('Escape')
            assert await title.inner_text()=='Studio test portrait'
        async def test3():
            im=page.frame_locator('#site-frame').locator('[data-edit="works/work-03:file"]').first
            await im.click();await page.frame_locator('#site-frame').get_by_role('button',name='Change',exact=True).click()
            await page.locator('#picture-file').set_input_files({'name':'test-picture.png','mimeType':'image/png','buffer':PNG})
            await page.wait_for_function('window.Studio.model.works["work-03"].file.includes("test-picture-")')
            assert (await im.get_attribute('src')).startswith('blob:')
            await im.evaluate('(im)=>im.decode()')
        async def test4():
            im=page.frame_locator('#site-frame').locator('[data-edit="works/work-01:file"]')
            await im.click()
            for _ in range(2):await page.frame_locator('#site-frame').get_by_role('button',name='Move up',exact=True).click()
            order=await page.evaluate('window.Studio.model.works["work-01"].order')
            assert order==1,order
            first=page.frame_locator('#site-frame').locator('.works figure').first
            assert await first.locator('img').get_attribute('data-edit')=='works/work-01:file'
        async def test5():
            await page.locator('[data-panel=design]').click()
            accent=page.locator('[data-field="settings/look:colours.accent"]')
            await accent.fill('#1264a3');await accent.dispatch_event('change')
            await page.locator('#close-panel').click();await navigate('commission')
            colour=await page.frame_locator('#site-frame').locator('.cta').evaluate('(el)=>getComputedStyle(el).color')
            assert colour=='rgb(18, 100, 163)',colour
        async def test6():
            await page.locator('[data-panel=add]').click()
            form=page.locator('#add-form');await form.locator('[name=title]').fill('Studio added work')
            await form.locator('[name=medium]').fill('Test ink')
            await form.locator('[name=category]').select_option('painted-portraits')
            await form.locator('[name=picture]').set_input_files({'name':'added-picture.png','mimeType':'image/png','buffer':PNG})
            await form.get_by_role('button',name='Add work',exact=True).click()
            title=page.frame_locator('#site-frame').locator('[data-edit="works/studio-added-work:title"]')
            await title.wait_for();assert await title.inner_text()=='Studio added work'
            await page.locator('[data-panel=media]').click()
            assert await page.locator('[data-media^="added-picture-"]').count()==1
            await page.locator('#close-panel').click()
        async def test7():
            before=listing();m=await page.evaluate('window.Studio.model')
            expected={f'assets/work/{n}' for n in m['media']}
            for group in ['works','categories','pages','settings']:
                for name,value in m[group].items():
                    p=ROOT/f'content/{group}/{name}.json'
                    if not p.exists() or json.loads(p.read_text())!=value:expected.add(str(p.relative_to(ROOT)))
            await page.locator('#publish').click();assert 'pictures' in await page.locator('#publish-summary').inner_text()
            await page.locator('#publish-confirm').click();await page.get_by_text('Published. Live in about a minute.',exact=False).wait_for()
            after=listing();changed={p for p in before.keys()|after.keys() if before.get(p)!=after.get(p)}
            assert changed==expected,(changed,expected)
            assert json.loads((ROOT/'content/works/work-03.json').read_text())['title']=='Studio test portrait'
            assert json.loads((ROOT/'content/settings/look.json').read_text())['colours']['accent']=='#1264a3'
            for n in m['media']:assert (ROOT/'assets/work'/n).read_bytes()==PNG
            env={k:v for k,v in os.environ.items() if k!='GITHUB_ACTIONS'}
            result=subprocess.run(['node','build.js'],cwd=ROOT,env=env,capture_output=True,text=True)
            assert result.returncode==0,result.stderr
            built=json.loads((ROOT/'content/site.json').read_text())
            assert any(w['title']=='Studio test portrait' for c in built['categories'] for w in c['works'])
            assembled=await page.evaluate('window.Studio.assemble(window.Studio.model)')
            assert built==assembled,'Browser assembly differs from build.js'
            assert not await page.locator('#dirty').is_visible()
            await page.locator('#publish-close').click()
        async def test8():
            mobile_context=await browser.new_context();mobile=await mobile_context.new_page();await mobile.set_viewport_size({'width':390,'height':844})
            await mobile.goto(URL+'edit/?local=1');await mobile.wait_for_function('document.querySelector("#page-switcher").options.length>0')
            await mobile.locator('#page-switcher').select_option('about')
            title=mobile.frame_locator('#site-frame').locator('[data-edit="pages/about:title"]')
            await title.click();await title.fill('About the artist');await title.press('Enter')
            assert await title.inner_text()=='About the artist'
            rect=await mobile.locator('#publish').bounding_box();assert rect and rect['x']>=0 and rect['x']+rect['width']<=390
            await mobile.locator('#publish').click();assert await mobile.locator('#publish-confirm').is_visible()
            await mobile.locator('#publish-close').click();mobile.on('dialog',lambda d:asyncio.create_task(d.accept()));await mobile_context.close()
        # Each new regression gets its own storage, so test 8's draft cannot interfere.
        async def regression_page():
            ctx=await browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
            p=await ctx.new_page()
            p.on('dialog',lambda d:asyncio.create_task(d.accept()))
            await p.goto(URL+'edit/?local=1')
            await p.wait_for_function('document.querySelector("#page-switcher").options.length>0')
            return ctx,p
        async def regression_navigate(p,route):
            await p.locator('#page-switcher').select_option(route)
            await p.wait_for_function('(route)=>document.querySelector("#site-frame").contentWindow.__site.pathOf()===route',arg=route)
            await p.frame_locator('#site-frame').locator('.works figure').first.wait_for()
        async def test9():
            paths=[ROOT/'content/works/work-03.json',ROOT/'content/works/work-06.json']
            originals={p:p.read_bytes() for p in paths}
            ctx,p=await regression_page()
            try:
                await regression_navigate(p,'portfolio/painted-portraits')
                title=p.frame_locator('#site-frame').locator('[data-edit="works/work-03:title"]')
                await title.click();await title.fill('Local concurrent portrait');await title.press('Enter')
                remote=json.loads(originals[paths[1]]);remote['title']='Remote concurrent portrait'
                response=await ctx.request.put(URL+'__dev/file?path=content/works/work-06.json',data=json.dumps(remote))
                assert response.ok,await response.text()
                await p.locator('#publish').click();await p.locator('#publish-confirm').click()
                row=p.locator('#conflict-records [data-conflict-path="content/works/work-06.json"]')
                await row.wait_for()
                assert json.loads(originals[paths[1]])['title'] in await row.inner_text()
                assert await row.get_by_role('button',name='Keep mine',exact=True).is_visible()
                # Nothing local goes live while the conflict is awaiting a decision.
                assert paths[0].read_bytes()==originals[paths[0]]
                await p.get_by_role('button',name='Reload latest',exact=True).click()
                await p.wait_for_function('window.Studio.model.works["work-06"].title==="Remote concurrent portrait"')
                remote_title=p.frame_locator('#site-frame').locator('[data-edit="works/work-06:title"]')
                assert await remote_title.inner_text()=='Remote concurrent portrait'
                await p.get_by_text('Published. Live in about a minute.',exact=False).wait_for()
                assert json.loads(paths[0].read_text())['title']=='Local concurrent portrait'
                assert json.loads(paths[1].read_text())['title']=='Remote concurrent portrait'
                assert await p.locator('#publish-status').inner_text()=='Published'
                await p.locator('#publish-close').click();await p.reload()
                await p.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                assert not await p.locator('#draft-dialog').is_visible(),'Published draft was not cleared'
            finally:
                await ctx.close()
                for path,data in originals.items():path.write_bytes(data)
        async def test10():
            ctx,p=await regression_page()
            try:
                await regression_navigate(p,'portfolio/painted-portraits')
                title=p.frame_locator('#site-frame').locator('[data-edit="works/work-03:title"]')
                await title.click();await title.fill('Pending inline title')
                assert await p.evaluate('window.Studio.model.works["work-03"].title')!='Pending inline title'
                await p.evaluate('window.dispatchEvent(new Event("pagehide"))')
                assert await p.evaluate('window.Studio.model.works["work-03"].title')=='Pending inline title'
                assert await p.evaluate('window.Studio.shouldWarnOnUnload')
                assert await p.evaluate('typeof window.Studio.commitInline')=='function'
                assert await p.evaluate('!window.dispatchEvent(new Event("beforeunload",{cancelable:true}))')
                await p.evaluate('window.Studio.draftSaved')
            finally:await ctx.close()
        async def test11():
            ctx,p=await regression_page()
            try:
                await regression_navigate(p,'portfolio/painted-portraits')
                await p.frame_locator('#site-frame').locator('[data-edit="works/work-03:file"]').first.click()
                # Existing works have blank years: exercise the failing branch explicitly.
                for field,value in [('year','2026'),('size','30 × 40 cm')]:
                    control=p.locator('[data-field="works/work-03:'+field+'"]')
                    await control.fill(value);await control.dispatch_event('change')
                caption=p.frame_locator('#site-frame').locator('[data-edit="works/work-03:title"]').locator('xpath=ancestor::figure').locator('figcaption')
                year=caption.locator('[data-edit="works/work-03:year"]')
                medium=caption.locator('[data-edit="works/work-03:medium"]')
                assert await year.count()==1 and await medium.count()==1
                assert await year.inner_text()=='2026'
                assert await medium.inner_text()==await p.evaluate('window.Studio.model.works["work-03"].medium')
                assert await caption.evaluate('(el)=>{const spans=[...el.querySelectorAll("[data-edit]")];const y=spans.find(e=>e.dataset.edit.endsWith(":year")),m=spans.find(e=>e.dataset.edit.endsWith(":medium"));return y!==m && !y.contains(m) && !m.contains(y)}')
                public=await ctx.new_page();await public.goto(URL+'portfolio/painted-portraits')
                await public.wait_for_function('window.__site?.getS()')
                # Render the identical year/size through the public renderer, without IDs/hooks.
                work=await p.evaluate('window.Studio.model.works["work-03"]')
                await public.evaluate('(work)=>{const s=window.__site.getS();const w=s.categories.flatMap(c=>c.works).find(w=>w.file===work.file.split("/").pop());w.year=work.year;w.size=work.size;window.__site.setS(s)}',work)
                public_caption=public.locator('.works figure').filter(has=public.locator('img[src$="/'+work['file'].split('/')[-1]+'"]')).locator('figcaption')
                assert await caption.inner_text()==await public_caption.inner_text()
                await p.evaluate('window.Studio.draftSaved')
            finally:await ctx.close()
        async def test12():
            ctx,p=await regression_page()
            before=listing()
            try:
                await regression_navigate(p,'portfolio/painted-portraits')
                title=p.frame_locator('#site-frame').locator('[data-edit="works/work-03:title"]')
                await title.click();await title.fill('Restored unpublished portrait');await title.press('Enter')
                image=p.frame_locator('#site-frame').locator('[data-edit="works/work-03:file"]').first
                await image.click();await p.frame_locator('#site-frame').get_by_role('button',name='Change',exact=True).click()
                await p.locator('#picture-file').set_input_files({'name':'draft-picture.png','mimeType':'image/png','buffer':PNG})
                await p.wait_for_function('window.Studio.pending.some(n=>n.startsWith("draft-picture-"))')
                await p.evaluate('window.Studio.draftSaved')
                assert await p.locator('#draft-status').inner_text()=='Saved'
                await p.reload()
                await p.locator('#draft-dialog').wait_for()
                assert 'Restore your unpublished draft from' in await p.locator('#draft-message').inner_text()
                await p.get_by_role('button',name='Restore',exact=True).click()
                await p.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                await regression_navigate(p,'portfolio/painted-portraits')
                assert await title.inner_text()=='Restored unpublished portrait'
                assert await p.evaluate('window.Studio.model.works["work-03"].title')=='Restored unpublished portrait'
                assert await p.locator('#publish-status').inner_text()=='Unpublished changes'
                assert (await image.get_attribute('src')).startswith('blob:')
                await image.evaluate('(im)=>im.decode()')
                assert listing()==before,'Draft saving changed live files'
            finally:await ctx.close()
        async def test13():
            # Exercise both native Web Locks and the BroadcastChannel fallback.
            for fallback in [False,True]:
                ctx=await browser.new_context(viewport={'width':1440,'height':1000})
                if fallback:
                    await ctx.add_init_script("Object.defineProperty(navigator,'locks',{value:undefined})")
                a=await ctx.new_page()
                a.on('dialog',lambda d:asyncio.create_task(d.accept()))
                try:
                    await a.goto(URL+'edit/?local=1')
                    await a.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                    b=await ctx.new_page()
                    await b.goto(URL+'edit/?local=1')
                    await b.locator('#studio-lock').wait_for()
                    assert 'Studio is already open in another tab.' in await b.locator('#studio-lock').inner_text()
                    assert await b.locator('#canvas').evaluate('(el)=>el.inert')
                    assert await b.locator('#page-switcher option').count()==0
                    await a.close()
                    await b.get_by_role('button',name='Take over here',exact=True).click()
                    await b.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                    await regression_navigate(b,'portfolio/painted-portraits')
                    title=b.frame_locator('#site-frame').locator('[data-edit="works/work-03:title"]')
                    await title.click();await title.fill('Saved during hand-over')
                    # Takeover of a living editor must save and disable it first.
                    c=await ctx.new_page()
                    await c.goto(URL+'edit/?local=1')
                    await c.locator('#studio-lock').wait_for()
                    assert await c.locator('#page-switcher option').count()==0
                    await c.get_by_role('button',name='Take over here',exact=True).click()
                    await c.locator('#draft-dialog').wait_for()
                    assert await b.locator('#studio-lock').is_visible()
                    assert await b.locator('#canvas').evaluate('(el)=>el.inert')
                    await c.get_by_role('button',name='Restore',exact=True).click()
                    await c.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                    assert await c.evaluate('window.Studio.model.works["work-03"].title')=='Saved during hand-over'
                finally:await ctx.close()
        async def test14():
            ctx,p=await regression_page()
            try:
                await regression_navigate(p,'portfolio/painted-portraits')
                title=p.frame_locator('#site-frame').locator('[data-edit="works/work-03:title"]')
                original=await p.evaluate('window.Studio.model.works["work-03"].title')
                await title.click();await title.fill('Survives a real reload')
                assert await p.evaluate('window.Studio.model.works["work-03"].title')==original
                recovery=await p.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('studio-pending:')).map(k=>JSON.parse(localStorage[k]))")
                assert any(d.get('pending')=={'key':'works/work-03:title','value':'Survives a real reload'} for d in recovery)
                # No Enter, blur, synthetic lifecycle event, or draft-save wait.
                await p.reload()
                await p.locator('#draft-dialog').wait_for()
                await p.get_by_role('button',name='Restore',exact=True).click()
                await p.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                await regression_navigate(p,'portfolio/painted-portraits')
                assert await title.inner_text()=='Survives a real reload'
                assert await p.evaluate('window.Studio.model.works["work-03"].title')=='Survives a real reload'
                await p.locator('#undo').click()
                assert await title.inner_text()==original
            finally:await ctx.close()
        async def test15():
            ctx,p=await regression_page()
            try:
                await regression_navigate(p,'portfolio/painted-portraits')
                title=p.frame_locator('#site-frame').locator('[data-edit="works/work-03:title"]')
                await title.click();await title.fill('Missing picture regression');await title.press('Enter')
                image=p.frame_locator('#site-frame').locator('[data-edit="works/work-03:file"]').first
                await image.click();await p.frame_locator('#site-frame').get_by_role('button',name='Change',exact=True).click()
                await p.locator('#picture-file').set_input_files({'name':'crash-picture.png','mimeType':'image/png','buffer':PNG})
                await p.wait_for_function('window.Studio.model.works["work-03"].file.includes("crash-picture-")')
                await p.evaluate('window.Studio.draftSaved')
                assert await p.locator('#draft-status').inner_text()=='Saved'
                # Remove only durable bytes, retaining both model and synchronous recovery references.
                await p.evaluate("""async()=>{
                    const name=window.Studio.model.works['work-03'].file.split('/').pop();
                    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('studio-drafts',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
                    await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),r=store.getAll();r.onsuccess=()=>{for(const d of r.result){if(d.ownerDraft && d.name===name){store.delete(d.key);continue;}d.uploads=(d.uploads||[]).filter(u=>u.name!==name);store.put(d);}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
                    const recoveries=Object.keys(localStorage).filter(k=>k.startsWith('studio-pending:')).map(k=>JSON.parse(localStorage[k]));
                    if(!recoveries.some(d=>d.model.works['work-03'].file.endsWith(name)))throw Error('Missing recovery reference');
                }""")
                await p.reload();await p.locator('#draft-dialog').wait_for()
                await p.get_by_role('button',name='Restore',exact=True).click()
                await p.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                await regression_navigate(p,'portfolio/painted-portraits')
                warning=p.frame_locator('#site-frame').locator('[data-missing-picture="works/work-03:file"]').first
                assert 'Picture missing' in await warning.inner_text()
                await image.click()
                assert 'Picture missing' in await p.locator('#properties').inner_text()
                await p.locator('#publish').click()
                assert 'Missing picture regression' in await p.locator('#publish-summary').inner_text()
                assert 'Picture missing' in await p.locator('#publish-summary').inner_text()
                assert await p.locator('#publish-confirm').is_disabled()
                await p.locator('#publish-close').click()
                async with p.expect_file_chooser() as picker:
                    await p.locator('#properties').get_by_role('button',name='Choose picture again',exact=True).click()
                await (await picker.value).set_files({'name':'recovered-picture.png','mimeType':'image/png','buffer':PNG})
                await p.wait_for_function('window.Studio.model.works["work-03"].file.includes("recovered-picture-")')
                assert await warning.count()==0
                assert 'Picture missing' not in await p.locator('#properties').inner_text()
                await image.evaluate('(im)=>im.decode()')
                await p.locator('#publish').click();assert await p.locator('#publish-confirm').is_enabled()
                await p.locator('#publish-close').click()
            finally:await ctx.close()
        async def test16():
            # Both an expired lease and an unexpired marker whose owner never answers.
            for expired in [True,False]:
                ctx=await browser.new_context(viewport={'width':1440,'height':1000})
                await ctx.add_init_script("Object.defineProperty(navigator,'locks',{value:undefined})")
                p=await ctx.new_page();p.on('dialog',lambda d:asyncio.create_task(d.accept()))
                try:
                    await p.goto(URL+'edit/?local=1')
                    await p.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                    await p.locator('[data-panel=design]').click()
                    field=p.locator('[data-field="settings/look:footerLine"]')
                    await field.fill('Draft from another session');await field.dispatch_event('change')
                    await p.evaluate('window.Studio.draftSaved')
                    await p.close()
                    seed=await ctx.new_page();await seed.goto(URL)
                    key=await seed.evaluate("""async expired=>{
                        const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('studio-drafts',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
                        const draft=await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),r=store.getAll();let d;r.onsuccess=()=>{d=r.result[0];d.sessionId='other-session';d.key=d.site+':other-session';d.time=Date.now()+1000;store.put(d);};tx.oncomplete=()=>resolve(d);tx.onerror=()=>reject(tx.error);});db.close();
                        localStorage.setItem('studio:'+draft.site,JSON.stringify({owner:'dead-tab',expires:Date.now()+(expired?-60000:60000)}));
                        return draft.key;
                    }""",expired)
                    editor=await ctx.new_page();editor.on('dialog',lambda d:asyncio.create_task(d.accept()))
                    await editor.goto(URL+'edit/?local=1');await editor.locator('#draft-dialog').wait_for()
                    assert not await editor.locator('#studio-lock').is_visible()
                    await editor.get_by_role('button',name='Restore',exact=True).click()
                    await editor.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                    assert not await editor.locator('#canvas').evaluate('(el)=>el.inert')
                    assert await editor.evaluate("""async key=>{
                        const lease=JSON.parse(localStorage.getItem('studio:'+key.replace(/:other-session$/,'')));
                        if(lease.owner==='dead-tab' || lease.expires<=Date.now())return false;
                        const db=await new Promise(resolve=>{const r=indexedDB.open('studio-drafts',1);r.onsuccess=()=>resolve(r.result);});
                        const d=await new Promise(resolve=>{const r=db.transaction('drafts').objectStore('drafts').get(key);r.onsuccess=()=>resolve(r.result);});db.close();
                        return d?.sessionId==='other-session' && d.model.settings.look.footerLine==='Draft from another session';
                    }""",key),'Reclaiming the lease removed another session draft'
                finally:await ctx.close()
        async def test17():
            ctx,p=await regression_page()
            try:
                await p.locator('[data-panel=design]').click()
                field=p.locator('[data-field="settings/look:footerLine"]')
                await field.fill('Footer survives a focused reload')
                assert await field.evaluate('(el)=>el===document.activeElement')
                assert await p.evaluate('window.Studio.model.settings.look.footerLine')!='Footer survives a focused reload'
                recovery=await p.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('studio-pending:')).map(k=>JSON.parse(localStorage[k]))")
                assert any(d.get('pending')=={'key':'settings/look:footerLine','value':'Footer survives a focused reload'} for d in recovery)
                # Real reload, with no blur/change or explicit save/lifecycle call.
                await p.reload();await p.locator('#draft-dialog').wait_for()
                await p.get_by_role('button',name='Restore',exact=True).click()
                await p.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                assert await p.evaluate('window.Studio.model.settings.look.footerLine')=='Footer survives a focused reload'
                await p.locator('[data-panel=design]').click()
                assert await field.input_value()=='Footer survives a focused reload'
            finally:await ctx.close()
        async def test18():
            before=listing()
            originals={p:p.read_bytes() for folder in ['content','assets'] for p in (ROOT/folder).rglob('*') if p.is_file()}
            ctx=await browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
            # Model a suspended owner's heartbeat without freezing its pending HTTP request.
            await ctx.add_init_script("""
                Object.defineProperty(navigator,'locks',{value:undefined});
                const interval=window.setInterval.bind(window);
                window.setInterval=(fn,ms,...args)=>interval(()=>{if(ms!==2000 || !window.pauseLease)fn(...args);},ms);
            """)
            a=await ctx.new_page();a.on('dialog',lambda d:asyncio.create_task(d.accept()))
            response_task=None
            async def drafts(p):
                return await p.evaluate("""async()=>{
                    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('studio-drafts',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
                    try{return await new Promise((resolve,reject)=>{const r=db.transaction('drafts').objectStore('drafts').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}
                }""")
            try:
                await a.goto(URL+'edit/?local=1')
                await a.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                await regression_navigate(a,'portfolio/painted-portraits')
                title=a.frame_locator('#site-frame').locator('[data-edit="works/work-03:title"]')
                await title.click();await title.fill('Lease owner A publication');await title.press('Enter')
                image=a.frame_locator('#site-frame').locator('[data-edit="works/work-03:file"]').first
                await image.click();await a.frame_locator('#site-frame').get_by_role('button',name='Change',exact=True).click()
                await a.locator('#picture-file').set_input_files({'name':'lease-picture.png','mimeType':'image/png','buffer':PNG})
                await a.wait_for_function('window.Studio.model.works["work-03"].file.includes("lease-picture-")')
                await a.evaluate('window.Studio.draftSaved')
                old=next(d for d in await drafts(a) if d.get('model',{}).get('works',{}).get('work-03',{}).get('title')=='Lease owner A publication')
                published_model=await a.evaluate('window.Studio.model')
                picture=published_model['works']['work-03']['file'].split('/')[-1]
                assert (await ctx.request.get(URL+'__dev/slow?ms=20000')).ok
                await a.locator('#publish').click()
                response_task=asyncio.create_task(a.wait_for_event('response',predicate=lambda r:r.url.endswith('/__dev/publish') and r.request.method=='POST',timeout=45000))
                async with a.expect_request('**/__dev/publish'):
                    await a.locator('#publish-confirm').click()
                assert await a.locator('#publish-close').is_disabled(),'A must still be publishing at takeover'
                lease_key='studio:'+old['site']
                old_owner=await a.evaluate("""key=>{
                    window.pauseLease=true;
                    const lease=JSON.parse(localStorage.getItem(key));lease.expires=0;
                    localStorage.setItem(key,JSON.stringify(lease));return lease.owner;
                }""",lease_key)
                b=await ctx.new_page();b.on('dialog',lambda d:asyncio.create_task(d.accept()))
                await b.goto(URL+'edit/?local=1');await b.locator('#draft-dialog').wait_for()
                await a.locator('#studio-lock').wait_for()
                assert await a.locator('#publish-close').is_disabled(),'Revocation must happen while A is busy'
                replacement_owner=await b.evaluate('key=>JSON.parse(localStorage.getItem(key)).owner',lease_key)
                await b.get_by_role('button',name='Restore',exact=True).click()
                await b.wait_for_function('document.querySelector("#page-switcher").options.length>0')
                await b.evaluate('window.Studio.draftSaved')
                restored=next(d for d in await drafts(b) if d.get('site')==old['site'] and d['key']!=old['key'])
                assert restored['sessionId']!=old['sessionId'] and restored['key']!=old['key']
                assert any(u['name']==picture for u in restored['uploads'])
                await regression_navigate(b,'portfolio/painted-portraits')
                title_b=b.frame_locator('#site-frame').locator('[data-edit="works/work-03:title"]')
                assert await title_b.inner_text()=='Lease owner A publication'
                await title_b.click();await title_b.fill('Replacement B active draft');await title_b.press('Enter')
                await b.evaluate('window.Studio.draftSaved')
                assert not response_task.done(),'Delay must cover B restore and edit'
                response=await response_task;assert response.ok,await response.text()
                await response.finished()
                await a.wait_for_function('!document.querySelector("#publish-close").disabled')
                assert await a.locator('#studio-lock').is_visible()
                assert await a.locator('#canvas').evaluate('(el)=>el.inert')
                message='Another tab took over; your changes are kept as a draft'
                assert message in await a.locator('#studio-lock').inner_text()
                assert await a.locator('#publish-progress').inner_text()==message
                # Resume heartbeat callbacks too: a revoked owner must never reclaim its lease.
                await a.evaluate('window.pauseLease=false')
                await a.wait_for_timeout(2200)
                lease=await b.evaluate('key=>JSON.parse(localStorage.getItem(key))',lease_key)
                assert lease['owner']==replacement_owner and lease['owner']!=old_owner and lease['expires']>await b.evaluate('Date.now()')
                active=next(d for d in await drafts(b) if d['key']==restored['key'])
                assert active['model']['works']['work-03']['title']=='Replacement B active draft'
                upload=next(u for u in active['uploads'] if u['name']==picture)
                assert base64.b64decode(upload['dataURL'].split(',')[1])==PNG
                assert await title_b.inner_text()=='Replacement B active draft'
                image_b=b.frame_locator('#site-frame').locator('[data-edit="works/work-03:file"]').first
                assert (await image_b.get_attribute('src')).startswith('blob:')
                await image_b.evaluate('(im)=>im.decode()')
                assert not await b.locator('#canvas').evaluate('(el)=>el.inert')
                # The already-sent local transaction may complete, but only A's payload goes live.
                expected={'assets/work/'+picture}
                for group in ['works','categories','pages','settings']:
                    for name,value in published_model[group].items():
                        path=ROOT/f'content/{group}/{name}.json'
                        if path not in originals or json.loads(originals[path])!=value:expected.add(str(path.relative_to(ROOT)))
                        assert json.loads(path.read_text())==value
                assert (ROOT/'assets/work'/picture).read_bytes()==PNG
                after=listing()
                assert {p for p in before.keys()|after.keys() if before.get(p)!=after.get(p)}==expected
            finally:
                # Let an accepted delayed write finish before restoring bytes, even on failure.
                try:
                    if response_task is not None:
                        response=await response_task;await response.finished()
                finally:
                    await ctx.request.get(URL+'__dev/slow?ms=0')
                    await ctx.close()
                    for folder in ['content','assets']:
                        for path in (ROOT/folder).rglob('*'):
                            if path.is_file() and path not in originals:path.unlink()
                    for path,data in originals.items():
                        if not path.exists() or path.read_bytes()!=data:path.write_bytes(data)
        try:
            for number,test in enumerate([test1,test2,test3,test4,test5,test6,test7,test8,test9,test10,test11,test12,test13,test14,test15,test16,test17,test18],1):
                try:await test();print(f'{number}. PASS',flush=True)
                except Exception as exc:
                    import traceback;tb=traceback.extract_tb(exc.__traceback__);where=' | '.join(f'line {f.lineno}: {f.line.strip()[:90]}' for f in tb if 'test-editor' in f.filename)[-400:]
                    failures.append((number,f'{exc!r} @ {where}'));print(f'{number}. FAIL: {exc!r} @ {where}',flush=True)
            public=await context.new_page();public_errors=[]
            public.on('pageerror',lambda e:public_errors.append(str(e)))
            public.on('console',lambda m:public_errors.append(m.text) if m.type=='error' else None)
            await public.goto(URL+'index.html');await public.wait_for_function('window.__site?.getS()')
            # Explicit index.html is treated as an unknown route by the existing router, but renders home.
            assert await public.locator('main').inner_text()
            await public.goto(URL);await public.locator('#stage').wait_for();await public.wait_for_timeout(500)
            assert not public_errors,public_errors
            assert await public.locator('[contenteditable],#studio-toolbar').count()==0
            print('Public site: PASS (index.html and root render; no console errors)',flush=True)
            assert not errors,errors
        except Exception as exc:failures.append(('public/console',str(exc)));print(f'Public/console: FAIL: {exc}',flush=True)
        finally:
            await browser.close()
            for folder in ['content','assets']:
                for p in (ROOT/folder).rglob('*'):
                    if p.is_file() and p not in snapshot:p.unlink()
            for p,data in snapshot.items():
                if not p.exists() or p.read_bytes()!=data:p.write_bytes(data)
            for folder in ['content','assets']:
                for p in sorted((ROOT/folder).rglob('*'),reverse=True):
                    if p.is_dir() and p not in directories and not any(p.iterdir()):p.rmdir()
    return 1 if failures else 0

if __name__=='__main__':sys.exit(asyncio.run(main()))
