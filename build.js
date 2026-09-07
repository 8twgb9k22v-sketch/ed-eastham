// Assembles content/site.json (what the site reads) from the small files the editor writes.
// Runs on every Netlify deploy; run `node build.js` locally after editing.
const fs = require('fs'), path = require('path');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const dir = p => fs.existsSync(p) ? fs.readdirSync(p).filter(f => f.endsWith('.json')).map(f => ({ id: f.replace(/\.json$/, ''), ...read(path.join(p, f)) })) : [];
const base = f => (f || '').replace(/^.*\//, '');
/* Shrink big uploads and make thumbnails at publish time (sharp is installed by the publish workflow; skipped when absent). */
let sharp = null; try { sharp = require('sharp'); } catch (e) {}
const WORK = 'assets/work', THUMBS = 'assets/work/thumbs';
async function optimise(){
  if (!sharp) return console.log('sharp not installed here: images left as uploaded');
  fs.mkdirSync(THUMBS, { recursive: true });
  for (const f of fs.readdirSync(WORK).filter(f => /\.(jpe?g|png|webp)$/i.test(f))) {
   try {
    const src = path.join(WORK, f), stat = fs.statSync(src); let img = sharp(src); const meta = await img.metadata();
    if ((meta.width || 0) > 1800 || stat.size > 700000) {
      await sharp(src).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toFile(src + '.tmp');
      fs.renameSync(src + '.tmp', src); console.log('shrunk', f, Math.round(stat.size / 1024) + 'KB ->', Math.round(fs.statSync(src).size / 1024) + 'KB');
    }
    const t = path.join(THUMBS, f);
    if (!fs.existsSync(t)) { await sharp(src).rotate().resize({ width: 640, height: 640, fit: 'inside' }).jpeg({ quality: 80 }).toFile(t); console.log('thumb', f); }
   } catch (e) { console.log('could not process', f, '(left as is):', e.message); }
  }
  for (const f of fs.readdirSync(WORK)) if (/\.heic$/i.test(f)) console.log('WARNING: ' + f + ' is a HEIC file; browsers cannot show it. Re-save it as JPEG.');
}
const site = read('content/settings/site.json');
const home = read('content/settings/home.json');
const look = read('content/settings/look.json');
const pages = {}; for (const k of ['about', 'commission', 'shop', 'contact']) pages[k] = read(`content/pages/${k}.json`);
if (pages.about.image) pages.about.image = base(pages.about.image);
const works = dir('content/works').filter(w => w.file && w.title).sort((a, b) => (a.order || 99) - (b.order || 99) || a.id.localeCompare(b.id));
const cats = dir('content/categories').map(c => ({ ...c, slug: c.id })).sort((a, b) => (a.order || 99) - (b.order || 99));
const known = new Set(cats.map(c => c.slug));
const orphans = works.filter(w => !known.has(w.category));
if (orphans.length) { console.log('works without a matching category, shown under "Other works":', orphans.map(w => w.id).join(', ')); cats.push({ slug: 'other-works', title: 'Other works', intro: '', order: 999 }); orphans.forEach(w => { w.category = 'other-works'; }); }
const out = {
  ...site,
  home: { featured: (home.featured || []).map(id => { const w = works.find(x => x.id === id || base(x.file) === id || base(x.file) === id + '.jpg'); return w ? base(w.file) : null; }).filter(Boolean) },
  pages,
  settings: { colours: look.colours, typeface: look.typeface, logo: look.logo && { style: look.logo.style, image: base(look.logo.image) }, home: { showSelectedWorks: home.showSelectedWorks !== false, showCategories: home.showCategories !== false, showCommission: home.showCommission !== false, selectedCount: home.selectedCount || 6 }, labels: look.labels, social: look.social || [], footerLine: look.footerLine || '' },
  categories: cats.map(c => ({ slug: c.slug, title: c.title, intro: c.intro || '', works: works.filter(w => w.category === c.slug).map(w => ({ file: base(w.file), title: w.title, medium: w.medium, size: w.size || '', year: w.year || '', price: w.price || '', sold: !!w.sold })) }))
};
optimise().then(() => {
  out.thumbs = fs.existsSync(THUMBS) ? fs.readdirSync(THUMBS).filter(f => /\.(jpe?g|png|webp)$/i.test(f)) : [];
  fs.writeFileSync('content/site.json', JSON.stringify(out, null, 2));
  /* a real index.html at every address, so pages answer 200 and links unfurl properly */
  if (process.env.GITHUB_ACTIONS) { const html = fs.readFileSync('index.html', 'utf8'); for (const r of ['about', 'commission', 'shop', 'contact', 'portfolio', ...out.categories.map(c => 'portfolio/' + c.slug)]) { fs.mkdirSync(r, { recursive: true }); fs.writeFileSync(path.join(r, 'index.html'), html); } console.log('static copies for', 5 + out.categories.length, 'addresses'); }
  console.log('content/site.json built:', out.categories.length, 'categories,', works.length, 'works,', out.thumbs.length, 'thumbs');
});
