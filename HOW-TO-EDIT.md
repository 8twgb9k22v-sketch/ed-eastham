# Editing the site

Everything you can change lives in two places. No code needed.

## 1. Words: `content/site.json`

Open it in any text editor (TextEdit on Mac, Notepad on Windows). Each page has a
`title` and a `body`, which is a list of paragraphs in quotes. Change the words
between the quotes, keep the quotes and commas as they are, save.

- `email` at the top is used everywhere (Contact, Commission button, footer).
- `instagram`: paste your Instagram link between the quotes and a link appears.
- `home` > `featured`: the file names of the works that rotate on the homepage.

## 2. Pictures: the `assets/work` folder

1. Copy your photo into `assets/work` (JPEG, ideally under 2000 pixels on the long side).
2. In `content/site.json`, find the category (for example `"slug": "life-drawings"`)
   and add a line inside its `works` list:

   `{ "file": "my-drawing.jpg", "title": "Sitting figure", "medium": "Charcoal on paper", "size": "42 x 59 cm", "year": "2026" }`

   Put a comma between entries. `size` and `year` are optional.
3. To sell a piece, add `"price": "£450"` to its line and it appears in the Shop.

If the page goes blank after an edit, a comma or quote is missing. Paste the file
into https://jsonlint.com to find the line.

## 3. About page CV

In `content/site.json` under `about`, the `cv` list is empty. Add lines like
`{ "year": "2025", "text": "Group show, Somewhere Gallery, Manchester" }` and a
"Selected exhibitions and education" section appears under your bio.

## 4. Category intros

Each category has an `intro` field. A sentence there appears under the category title.
The site is always light, whatever the visitor's phone is set to.

## 5. Editing from a login screen instead (Decap CMS)

The folder `admin/` is a ready-made editing screen: `edeastham.co.uk/admin`, log in,
click a category, "Add work", upload the photo, fill in title and medium, Publish. The
site updates itself a minute later. It needs three free things set up once:

1. The site in a GitHub repository (github.com, free).
2. Hosting that rebuilds from that repository: Cloudflare Pages or Netlify (free).
3. A login: Netlify Identity (easiest, invite Ed by email) or GitHub login via a small
   helper. Then set `repo` and `backend` in `admin/config.yml`.

Until that is done the `/admin` page shows a config error and can be ignored.

## 6. Look and feel (Settings)

In the editor there is a **Settings** section (or the `settings` block in `content/site.json`):
- **Colours**: background, text and an accent for buttons and links. Keep text dark on a light background so it stays readable.
- **Typeface**: Hanken Grotesk (default), Instrument Sans, DM Sans, or Cormorant Garamond for a classic serif look.
- **Logo**: the EE mark, or upload your own image (PNG with a transparent background).
- **Home page**: show or hide Selected works, the category list and the Commission block; how many selected works to show.
- **Menu labels**: rename About, Portfolio, Commission, Shop, Contact.
- **Social links** and the **footer line**.
