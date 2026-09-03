// Assembles content/site.json (what the site reads) from the small files the editor writes.
// Runs on every Netlify deploy; run `node build.js` locally after editing.
const fs = require('fs'), path = require('path');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const dir = p => fs.existsSync(p) ? fs.readdirSync(p).filter(f => f.endsWith('.json')).map(f => ({ id: f.replace(/\.json$/, ''), ...read(path.join(p, f)) })) : [];
const base = f => (f || '').replace(/^.*\//, '');
const site = read('content/settings/site.json');
const home = read('content/settings/home.json');
const look = read('content/settings/look.json');
const pages = {}; for (const k of ['about', 'commission', 'shop', 'contact']) pages[k] = read(`content/pages/${k}.json`);
if (pages.about.image) pages.about.image = base(pages.about.image);
const works = dir('content/works').sort((a, b) => (a.order || 99) - (b.order || 99) || a.id.localeCompare(b.id));
const cats = dir('content/categories').sort((a, b) => (a.order || 99) - (b.order || 99));
const out = {
  ...site,
  home: { featured: (home.featured || []).map(id => { const w = works.find(x => x.id === id || base(x.file) === id || base(x.file) === id + '.jpg'); return w ? base(w.file) : id; }) },
  pages,
  settings: { colours: look.colours, typeface: look.typeface, logo: look.logo && { style: look.logo.style, image: base(look.logo.image) }, home: { showSelectedWorks: home.showSelectedWorks !== false, showCategories: home.showCategories !== false, showCommission: home.showCommission !== false, selectedCount: home.selectedCount || 6 }, labels: look.labels, social: look.social || [], footerLine: look.footerLine || '' },
  categories: cats.map(c => ({ slug: c.slug || c.id, title: c.title, intro: c.intro || '', works: works.filter(w => w.category === (c.slug || c.id)).map(w => ({ file: base(w.file), title: w.title, medium: w.medium, size: w.size || '', year: w.year || '', price: w.price || '', sold: !!w.sold })) }))
};
fs.writeFileSync('content/site.json', JSON.stringify(out, null, 2));
console.log('content/site.json built:', out.categories.length, 'categories,', works.length, 'works');
