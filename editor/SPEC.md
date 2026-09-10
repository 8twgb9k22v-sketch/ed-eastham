# Studio: click-to-edit editor for edeastham (spec)

Written by Claude (director). Implemented by Codex (worker). Read fully before coding.

## What it is
A visual editor that runs on top of the live site itself, the way the Wix Editor does: Ed opens
`/edit/`, logs in, and edits the real pages by clicking on them. Text is edited inline, pictures
are swapped by clicking them, works are dragged into order, colours and fonts change from a
Design panel, and one **Publish** button saves everything as a single commit. The existing
form-based editor (`/admin/`) stays as a fallback; nothing about the public site's look changes.

## Constraints (hard)
- Vanilla JS, no framework, no build step. Files: `edit/index.html`, `edit/editor.js`,
  `edit/editor.css`. Hosted with the site on GitHub Pages under the `/ed-eastham` subpath
  (see how `SUB`/`ROOT` are computed in `index.html`; the editor must work at both
  `/ed-eastham/edit/` and, later, `/edit/` on the real domain).
- Changes to `index.html` limited to hooks: `data-edit` attributes on rendered elements and a
  small `window.__site` API (below). No visual change to the public site.
- Login: Netlify Identity (GoTrue) at `https://ed-eastham.netlify.app/.netlify/identity`
  (use gotrue-js from a CDN or a minimal fetch wrapper: `POST /token` with
  `grant_type=password`, then `Authorization: Bearer <access_token>`).
- Saving: Netlify Git Gateway proxies the GitHub API at
  `https://ed-eastham.netlify.app/.netlify/git/github/` (repo `8twgb9k22v-sketch/ed-eastham`,
  branch `main`). Publish = one commit via the Git Data endpoints: get ref `heads/main`, get
  base tree, create blobs (text as utf-8, images as base64), create tree, create commit, update
  ref. Never force-update; if the ref moved, refetch and retry once.
- Local development backend for tests: `editor/dev-server.js` (Node, no dependencies) serves the
  repository folder and accepts `PUT /__dev/file?path=...` (body = bytes) and
  `GET /__dev/list?dir=...`. The editor uses it when opened with `?local=1` (no login).
- UI typeface Hanken Grotesk (already loaded by the site). Calm, minimal, no gradients.
- Accessibility: keyboard reachable, Esc deselects, Cmd/Ctrl+Z / Shift+Z undo/redo.

## Content model
The editor edits the split content files the site is built from (see `build.js`):
- `content/works/<id>.json`: `{ title, file, category, medium, size, year, price, sold, order }`
- `content/categories/<id>.json`: `{ title, intro, order }` (id is the address slug)
- `content/pages/{about,commission,shop,contact}.json`
- `content/settings/{site,home,look}.json`
- Pictures in `assets/work/`; the publish workflow makes thumbnails and shrinks big files.
Add to `build.js`: write `content/index.json` = `{ "works": [ids], "categories": [ids] }` so the
editor can load every file directly from the site with plain `fetch` (no gateway reads).
Port `build.js`'s assembly to the browser as `assemble(model)` returning the same shape as
`content/site.json`, so the site's own render code draws the edited state instantly.

## Hooks to add in `index.html`
- `window.__site = { getS: () => S, setS(next) { S = next; applySettings(); buildMenu(); render(); }, render, navigate, pathOf }`
- When rendering, mark editable elements:
  - `data-edit="works/<id>:title"` on work titles (captions, lightbox), `":medium"`, `":year"`, `":price"`
  - `data-edit="works/<id>:file"` on work `<img>` elements
  - `data-edit="pages/<key>:title"` on page h1, `"pages/<key>:body.<n>"` on each paragraph
  - `data-edit="categories/<id>:title"` and `":intro"`
  - `data-edit="settings/site:tagline"` on the tagline, `"settings/site:wordmark"` on the wordmark
  - `data-editlist="works:<categoryId>"` on the works grid container (reorder target)
- If `location.search` contains `edit=1`, `index.html` must NOT redirect or change; the editor
  page embeds the site in an `<iframe src="/ed-eastham/?edit=1">` and talks to it via
  `iframe.contentWindow.__site`. Same origin, so direct access is fine.

## Editor UI (copy the Wix Editor's model, not its look)
- **Top bar**: left: mark + "Ed Eastham · Studio"; centre: page switcher (Home, About, each
  category, Commission, Shop, Contact); right: Undo, Redo, Desktop/Phone toggle (resizes the
  iframe to 390px), Preview (hides all editor chrome and outlines), **Publish** (primary).
  An "Unsaved changes" dot appears next to Publish when the model differs from the loaded state.
- **Left rail** (icons with labels): Add work, Pages, Design, Media. Each opens a panel that
  slides in beside the rail:
  - Add work: title, picture (file picker), category, medium, size, year, price, sold → adds a
    work file and a picture upload; the new work appears in the canvas.
  - Pages: list of pages and categories; click to navigate the canvas; rename category titles,
    edit intro, reorder categories (drag), add a category.
  - Design: background, text and accent colours (native colour inputs with the current hex),
    typeface select (the four the site supports), logo style and upload, menu labels, footer
    line. Changes apply to the canvas live.
  - Media: every picture in `assets/work` plus pending uploads; click to use it for the selected
    work; upload button.
- **Canvas**: hovering an editable element shows a 1px outline and a small label ("Title",
  "Picture", "Paragraph"); clicking selects it (2px outline) and shows a floating toolbar
  above it with the actions for that element:
  - Text: edit inline (contenteditable, single line for titles, multi-line for paragraphs),
    Enter/blur commits, Esc cancels.
  - Picture: Change (file picker), Open in Media, and for works: Details (title, medium, size,
    year, price, sold in a small popover), Move up / Move down, Delete (with confirm).
  - Works grid: drag a work to reorder within its category; drop updates `order` fields.
- **Properties panel** on the right for the selected work (same fields as Details) so both
  Wix habits work: click-and-type on the canvas, or fill in fields.
- **Publish** flow: dialog listing what changed (n works, n pictures, n pages, design),
  progress ("Uploading 2 of 3 pictures…", "Saving…"), then "Published. Live in about a minute"
  with a link to the site. On error, show the message and keep the changes.
- **Undo/Redo**: full model snapshots (JSON) on a stack; pictures are referenced by name so
  snapshots stay small.
- **Leaving with unsaved changes** asks first.
- **Phone**: the editor itself should be usable on a phone (panels become bottom sheets), but
  desktop is the priority; do not spend time on drag on touch, provide Move up/down instead.

## Tests (required, Playwright for Python is installed: `from playwright.async_api import async_playwright`)
`editor/test-editor.py`, run against `node editor/dev-server.js` on port 8793:
1. Loads `/ed-eastham/edit/?local=1` (dev server must map `/ed-eastham/` to the folder root)
   with no console errors; the canvas shows the home page.
2. Navigate to a category, click a work title, type a new title, press Enter: canvas shows it,
   Unsaved dot appears, Undo restores it, Redo re-applies.
3. Change a work's picture with a test PNG: canvas shows the new picture (blob preview).
4. Reorder: move the last work to first via Move up or drag; `order` values in the model change.
5. Design: set the accent colour; canvas buttons reflect it.
6. Add work with picture; it appears in the canvas and the Media panel.
7. Publish (local backend): files on disk change: the work JSON, the new picture in
   `assets/work/`, `look.json`; `node build.js` then produces a `site.json` containing the new
   title. Nothing else on disk changed (compare a listing before/after).
8. Phone viewport (390 wide): editor loads, a text can be edited, Publish is reachable.
Print a one-line PASS/FAIL per test and exit non-zero on any failure.

## Definition of done
- All tests pass locally and the command to run them is documented at the top of `editor.js`.
- Publishing through Git Gateway is implemented exactly as specified but marked "not exercised"
  in the report (it needs a real login); everything else verified.
- Report: what was built (files), what was verified with which test, what remains unverified,
  and any deviation from this spec with the reason.
