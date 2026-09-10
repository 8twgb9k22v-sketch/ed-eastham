"""Check image controls and empty-page building without publishing to the live site."""
import asyncio
import base64
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parent.parent
URL='http://127.0.0.1:8793/ed-eastham/'
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=')

async def main():
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True)
        ctx=await browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
        page=await ctx.new_page();errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
        await page.goto(URL+'edit/?local=1')
        await page.wait_for_function('document.querySelector("#page-switcher").options.length')
        canvas=page.frame_locator('#site-frame')
        await page.locator('#page-switcher').select_option('portfolio/pen-and-ink')
        await canvas.get_by_text('Make this page yours',exact=True).wait_for()
        await canvas.get_by_role('button',name='Add artwork',exact=True).click()
        assert await page.locator('#add-form [name=category]').input_value()=='pen-and-ink'
        await page.locator('#close-panel').click()
        print('PASS: empty page actions and automatic category selection',flush=True)
        await canvas.get_by_role('button',name='Add text box',exact=True).click()
        await page.locator('#block-dialog [name=title]').fill('About these drawings')
        await page.locator('#block-dialog [name=text]').fill('First line.\nSecond line.')
        await page.locator('#block-dialog [type=submit]').click()
        assert await canvas.locator('.page-block-text p').inner_text()=='First line.\nSecond line.'
        assert await canvas.locator('.empty').count()==0
        await page.locator('#undo').click()
        assert await canvas.locator('.page-block').count()==0
        await page.locator('#redo').click()
        assert await canvas.locator('.page-block-text').count()==1
        print('PASS: add text, remove Coming soon, undo and redo',flush=True)
        await page.locator('[data-build-action=image]').click()
        await page.locator('#block-dialog [data-pick-existing]').click()
        await page.locator('[data-picture-name="work-07.jpg"]').click()
        await page.locator('#block-dialog [name=caption]').fill('A study in ink')
        await page.locator('#block-dialog [type=submit]').click()
        await canvas.locator('.page-block-image img').evaluate('(im)=>im.decode()')
        await page.locator('#close-panel').click()
        await canvas.locator('.page-block-image img').click()
        await canvas.get_by_role('button',name='Size & placement',exact=True).click()
        slider=page.locator('[data-image-size]');await slider.fill('60');await slider.dispatch_event('change')
        await page.locator('[data-image-align=right]').click()
        await page.locator('[data-image-shape=Square]').click()
        assert await canvas.locator('.page-block-image img').evaluate('(im)=>getComputedStyle(im).aspectRatio')=='1 / 1'
        assert await canvas.locator('.page-block-image img').evaluate('(im)=>getComputedStyle(im).objectFit')=='cover'
        await page.locator('.focus-photo').click(position={'x':25,'y':25})
        assert await canvas.locator('.page-block-image img').evaluate('(im)=>getComputedStyle(im).objectPosition')!='50% 50%'
        print('PASS: thumbnail selection, image size, alignment, crop and focal point',flush=True)
        await page.locator('[data-panel=content]').click()
        image_card=page.locator('[data-block-card]').filter(has=page.locator('summary img'))
        await image_card.locator('summary').click()
        await image_card.locator('[data-block-copy]').click()
        assert await canvas.locator('.page-block-image').count()==2
        last=page.locator('[data-block-card]').last
        await last.locator('summary').click()
        await last.locator('[data-block-delete]').click()
        assert await canvas.locator('.page-block-image').count()==1
        await page.locator('#undo').click()
        assert await canvas.locator('.page-block-image').count()==2
        # Remove the duplicate again, then move the original before the text.
        last=page.locator('[data-block-card]').last
        await last.locator('summary').click();await last.locator('[data-block-delete]').click()
        image_card=page.locator('[data-block-card]').last
        await image_card.locator('summary').click();await image_card.locator('[data-block-up]').click()
        assert 'page-block-image' in await canvas.locator('[data-page-block]').first.get_attribute('class')
        print('PASS: duplicate, remove, restore and reorder page blocks',flush=True)
        await page.locator('[data-build-action=bulk]').click()
        assert await page.locator('#bulk-dialog [name=category]').input_value()=='pen-and-ink'
        await page.locator('#bulk-dialog [name=pictures]').set_input_files([
            {'name':'First drawing.png','mimeType':'image/png','buffer':PNG},
            {'name':'Second drawing.png','mimeType':'image/png','buffer':PNG}])
        await page.locator('#bulk-dialog [type=submit]').click()
        await page.wait_for_function('Object.values(window.Studio.model.works).filter(w=>w.category==="pen-and-ink").length===2')
        await canvas.locator('.works figure').first.wait_for()
        assert await canvas.locator('.works figure').count()==2
        await page.locator('[data-gallery="2"]').click()
        assert await canvas.locator('.works').evaluate('(el)=>getComputedStyle(el).gridTemplateColumns.split(" ").length')==2
        print('PASS: bulk uploads create a working gallery and layout presets apply',flush=True)
        await page.locator('#preview').click()
        assert not await canvas.locator('.studio-page-add').is_visible()
        await page.locator('#exit-preview').click()
        await page.locator('#device').click()
        assert await canvas.locator('.works').evaluate('(el)=>getComputedStyle(el).gridTemplateColumns.split(" ").length')==1
        assert await canvas.locator('body').evaluate('()=>document.documentElement.scrollWidth<=innerWidth')
        print('PASS: editor-only actions stay out of Preview; phone gallery stays one column',flush=True)
        await page.evaluate('window.Studio.draftSaved')
        model=await page.evaluate('window.Studio.model')
        assembled=await page.evaluate('window.Studio.assemble(window.Studio.model)')
        pictures=await page.evaluate('Object.fromEntries([...uploads].map(([name,u])=>[name,u.dataURL]))')
        with tempfile.TemporaryDirectory(prefix='ed-builder-build-') as folder:
            temp=Path(folder);shutil.copy(ROOT/'build.js',temp/'build.js');shutil.copytree(ROOT/'assets',temp/'assets')
            for name,data in pictures.items():(temp/'assets/work'/name).write_bytes(base64.b64decode(data.split(',')[1]))
            for group in ['works','categories','pages','settings']:
                directory=temp/'content'/group;directory.mkdir(parents=True)
                for key,record in model[group].items():(directory/(key+'.json')).write_text(json.dumps(record))
            subprocess.run(['node','build.js'],cwd=temp,check=True,capture_output=True)
            assert json.loads((temp/'content/site.json').read_text())==assembled
        await page.reload();await page.locator('#draft-restore').click()
        await page.wait_for_function('document.querySelector("#page-switcher").options.length')
        await page.locator('#page-switcher').select_option('portfolio/pen-and-ink')
        await canvas.locator('.works figure').first.wait_for()
        assert await canvas.locator('.works figure').count()==2
        assert await canvas.locator('.page-block').count()==2
        for image in await canvas.locator('.works img').all():await image.evaluate('(im)=>im.decode()')
        print('PASS: build output matches preview; new blocks and uploaded artwork survive reload',flush=True)
        await page.locator('[data-panel=content]').click()
        await page.locator('[data-build-action=bulk]').click()
        await page.locator('#bulk-dialog [name=pictures]').set_input_files([
            {'name':'Third drawing.png','mimeType':'image/png','buffer':PNG},
            {'name':'Broken drawing.png','mimeType':'image/png','buffer':b'not an image'}])
        await page.locator('#bulk-dialog [type=submit]').click()
        await page.get_by_text('1 added. This picture cannot be opened.',exact=False).wait_for()
        assert await page.evaluate('Object.values(window.Studio.model.works).filter(w=>w.category==="pen-and-ink").length')==3
        await page.locator('#bulk-dialog [type=submit]').click()
        await page.get_by_text('0 added. This picture cannot be opened.',exact=False).wait_for()
        assert await page.evaluate('Object.values(window.Studio.model.works).filter(w=>w.category==="pen-and-ink").length')==3
        await page.locator('#bulk-dialog [data-cancel]').click()
        print('PASS: corrupt files are rejected and bulk retry does not duplicate completed uploads',flush=True)
        await page.locator('[data-panel=content]').click()
        await page.locator('[data-panel=content]').click()
        assert await page.locator('[data-managed-work]').count()==3
        managed=page.locator('[data-managed-work]').first
        await managed.locator('summary').click()
        await managed.locator('[data-field$=":title"]').fill('Renamed in the page builder')
        await managed.locator('[data-field$=":title"]').dispatch_event('change')
        assert 'Renamed in the page builder' in await managed.locator('summary').inner_text()
        await managed.locator('[data-work-remove]').click()
        assert await page.locator('[data-managed-work]').count()==2
        await page.locator('#undo').click()
        assert await page.locator('[data-managed-work]').count()==3
        print('PASS: artwork manager shows every upload, edits details, removes and restores artwork',flush=True)
        await page.screenshot(path='/tmp/ed-builder-desktop.png')
        await page.set_viewport_size({'width':390,'height':844})
        await page.screenshot(path='/tmp/ed-builder-phone.png')
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not errors,errors
        print('PASS: mobile editor and no browser errors',flush=True)
        await browser.close()

if __name__=='__main__':asyncio.run(main())
