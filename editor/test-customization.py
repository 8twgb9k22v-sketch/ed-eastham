"""Studio customization checks. No live writes; build verification uses a temporary copy."""
import asyncio
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = 'http://127.0.0.1:8793/ed-eastham/'

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1500, 'height': 1000}, reduced_motion='reduce')
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: asyncio.create_task(dialog.accept()))
        await page.goto(URL + 'edit/?local=1')
        await page.wait_for_function('window.Studio?.model && document.querySelector("#page-switcher").options.length')
        canvas = page.frame_locator('#site-frame')
        async def select(selector):
            key = await canvas.locator(selector).first.get_attribute('data-component')
            if not await page.locator('#component-list').count():
                await page.locator('[data-panel=components]').click()
            await page.locator('[data-component-select="'+key+'"]').click()
            return key
        async def value(suffix, text):
            field = page.locator('[data-field$=".'+suffix+'"]')
            await field.fill(text)
            await field.dispatch_event('change')
        await select('#selected h2')
        await value('text', 'From the studio')
        assert await canvas.locator('#selected h2').inner_text() == 'From the studio'
        await page.locator('#undo').click()
        assert await canvas.locator('#selected h2').inner_text() == 'Selected works'
        await page.locator('#redo').click()
        assert await canvas.locator('#selected h2').inner_text() == 'From the studio'
        await page.get_by_text('Type & colour', exact=True).click()
        await value('fontSize','45')
        assert await canvas.locator('#selected h2').evaluate('(el)=>getComputedStyle(el).fontSize') == '45px'
        print('PASS: static text, undo/redo and custom typography', flush=True)
        await select('#selected')
        await page.locator('#component-up').click()
        assert await canvas.locator('main>section').first.get_attribute('id') == 'selected'
        await page.locator('#undo').click()
        assert await canvas.locator('main>section').first.get_attribute('id') == 'stage'
        print('PASS: section movement and undo', flush=True)
        await select('#brand')
        await page.locator('#component-down').click()
        assert await canvas.locator('body>header>*').first.get_attribute('id') == 'burger'
        await page.locator('#undo').click()
        assert await canvas.locator('body>header>*').first.get_attribute('id') == 'brand'
        print('PASS: header movement and undo', flush=True)
        await select('#selected h2')
        target = await canvas.locator('#comm > div').first.get_attribute('data-component')
        await page.locator('#component-destination').select_option(target)
        assert await canvas.locator('#comm h2').count() == 2
        await page.locator('#undo').click()
        assert await canvas.locator('#selected h2').count() == 1
        print('PASS: move a component into a different section', flush=True)
        await select('#selected h2')
        await page.locator('[data-breakpoint=mobile]').click()
        await page.get_by_text('Type & colour', exact=True).click()
        await value('fontSize','24')
        assert await canvas.locator('#selected h2').evaluate('(el)=>getComputedStyle(el).fontSize') == '24px'
        await page.locator('[data-breakpoint=desktop]').click()
        assert await canvas.locator('#selected h2').evaluate('(el)=>getComputedStyle(el).fontSize') == '45px'
        print('PASS: independent phone and computer styles', flush=True)
        await select('#selected .label')
        await value('href', 'javascript:alert(1)')
        assert not (await canvas.locator('#selected .label').get_attribute('href')).startswith('javascript:')
        await value('href', '/ed-eastham/about')
        assert await canvas.locator('#selected .label').get_attribute('href') == '/ed-eastham/about'
        print('PASS: editable links reject executable URLs', flush=True)
        await select('#comm img')
        await page.locator('#component-media').select_option('work-07.jpg')
        assert 'work-07.jpg' in await canvas.locator('#comm img').get_attribute('src')
        await canvas.locator('#comm img').evaluate('(im)=>im.decode()')
        print('PASS: component picture replacement', flush=True)
        await page.locator('[data-panel=content]').click()
        assert await page.locator('[data-featured]').count() == 12
        await page.locator('#page-switcher').select_option('commission')
        await page.locator('[data-field="pages/commission:cta"]').wait_for()
        await page.locator('[data-field="pages/commission:cta"]').fill('Discuss a portrait')
        await page.locator('[data-field="pages/commission:cta"]').dispatch_event('change')
        assert await canvas.locator('.page > .cta').inner_text() == 'Discuss a portrait'
        print('PASS: complete page content controls', flush=True)
        await page.locator('#page-switcher').select_option('portfolio/painted-portraits')
        await canvas.locator('.works figure').first.wait_for()
        await select('.works figure')
        await value('width','75')
        styled = await canvas.locator('.works figure').first.get_attribute('data-component')
        await page.locator('#component-down').click()
        assert await canvas.locator('[data-component="'+styled+'"]').evaluate('(el)=>el.getBoundingClientRect().width < el.parentElement.getBoundingClientRect().width')
        await page.locator('[data-panel=pages]').click()
        intro=page.locator('[data-field="categories/painted-portraits:intro"]')
        await intro.fill('Portraits from the studio')
        await intro.dispatch_event('change')
        assert await canvas.locator('[data-component="'+styled+'"]').count() == 1
        print('PASS: artwork layout follows the work after reordering and adding an intro', flush=True)
        await page.locator('[data-panel=design]').click()
        await page.locator('[data-field="settings/look:logo.style"]').select_option('image')
        # Empty image mode must also be safe on repeated render.
        await page.locator('[data-field="settings/look:logo.style"]').select_option('mark')
        model = await page.evaluate('window.Studio.model')
        assembled = await page.evaluate('window.Studio.assemble(window.Studio.model)')
        with tempfile.TemporaryDirectory(prefix='ed-studio-build-') as folder:
            temp=Path(folder)
            shutil.copy(ROOT/'build.js',temp/'build.js')
            shutil.copytree(ROOT/'assets',temp/'assets')
            for group in ['works','categories','pages','settings']:
                directory=temp/'content'/group
                directory.mkdir(parents=True)
                for key,record in model[group].items():
                    (directory/(key+'.json')).write_text(json.dumps(record))
            subprocess.run(['node','build.js'],cwd=temp,check=True,capture_output=True)
            assert json.loads((temp/'content/site.json').read_text()) == assembled
        print('PASS: custom layout and content preserved by publishing build', flush=True)
        await page.evaluate('window.Studio.draftSaved')
        await page.reload()
        await page.locator('#draft-restore').click()
        await page.wait_for_function('document.querySelector("#page-switcher").options.length')
        assert await page.evaluate('window.Studio.model.settings.look.components') == model['settings']['look']['components']
        print('PASS: customization survives draft recovery', flush=True)
        await page.set_viewport_size({'width':390,'height':844})
        await page.locator('[data-panel=components]').click()
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        button=await page.locator('#publish').bounding_box()
        assert button and button['x']>=0 and button['x']+button['width']<=390
        await page.screenshot(path='/tmp/ed-studio-mobile.png')
        await page.set_viewport_size({'width':1500,'height':1000})
        await select('#selected h2')
        await page.screenshot(path='/tmp/ed-studio-desktop.png')
        assert not errors, errors
        print('PASS: mobile editor, no horizontal overflow or script errors', flush=True)
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
