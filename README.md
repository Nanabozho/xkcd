# xkcd Notebook

**[Read the notebook](https://nanabozho.github.io/xkcd/)** · [Source on GitHub](https://github.com/nanabozho/xkcd) · [CC BY-NC 2.5](LICENSE)

A standalone, single-layer flip notebook: one comic per page, based on the Arabic and Mythos notebooks in the parent folder. No framework, build step, account, or server is needed to read it.

Open **index.html** directly in a browser. Everything needed for reading and searching is local. Alternatively, from this folder run `python3 -m http.server 8000` and visit <http://localhost:8000>. The folder can also be served by GitHub Pages as-is.

## Collection

Snapshot checked **October 1, 2026**, through **#3305, Ground Effect**:

- **3,304 entries**, covering every numbered comic from #1 through #3305 except the deliberately nonexistent #404.
- **3,302 downloaded comic images**, in their original formats and dimensions.
- **2,213 double-resolution images** for the comics xkcd publishes them for (nearly every comic since #1084 in 2012, and a few earlier ones). High-density screens get them on book pages, and the enlarged view always uses them; thumbnails keep the standard image.
- **3,302 transcripts from [explain xkcd](https://www.explainxkcd.com/)**, written by its contributors: the dialogue and lettering, plus descriptions of what is drawn. Every comic has one except #1116 Traffic Lights, whose page has a frame-by-frame breakdown instead, and #3283 Size and Lifespan, whose transcript is not written yet. They are under CC BY-SA 3.0; see [Credits and license](#credits-and-license).
- **1,664 official transcripts** from xkcd, through #1677 in 2016, where xkcd stopped supplying them.
- **#1608 Hoverboard and #1663 Garden** have no static image in the official API. Their pages include metadata and links to the original interactive works.

Other interactive comics have their API image here; use **Original on xkcd** for games, maps, live behavior, and the full experience. Animated images retain their original format. Click a comic to enlarge it: the whole image is fitted to the window, small comics are enlarged (up to 3×), and very tall posters keep their width and scroll. **Actual size**, or a click on the image, switches to the image's own pixels whenever that differs; **Open image** shows the original file.

The API supplies an unrelated podium transcript for Garden. That text is retained in the raw metadata cache but excluded from the reader and search, with an explanatory note; Garden's explain xkcd transcript is used as usual. No missing dialogue is invented.

## Search

Search includes titles, hover text, the explain xkcd transcripts and xkcd's official transcripts. Results show the matching passage and its source: **Title**, **Hover text** or **Transcript**. The two transcripts of a comic count once, whichever matches better, so older comics, which have both, don't outrank newer ones. Because the explain xkcd transcripts describe the drawings and name the recurring characters, searches such as `beret guy` or `black hat` work too.

- `python` finds #353 first.
- `correct horse battery staple` finds #936, Password Strength.
- `stir the pile` finds #1838, Machine Learning, which has no official transcript.
- `"sudo make me a sandwich"` searches an exact phrase.
- `#353` jumps to a comic number; `2026-09` searches a publication month.
- Separate keywords are combined with AND and may match different text fields. Word prefixes and modest spelling tolerance help with remembered wording. This is text search, not visual or semantic image search.

## Reading

- **Book**: animated page turns, one comic per page; **Browse**: cards, year filter, order, and search results in one continuous scrolling grid. Opening a comic and returning to Browse keeps your place.
- **← / →**, a horizontal swipe, or a click, tap or drag near either side of the page turns pages: the outer 30% on the left goes back, on the right forward, and a drag turns the page once it is a fifth of the way across. Vertical gestures scroll page content.
- **?** sets how pages move: **Slide**, the default, brings the next page in over the one you're on, from either side, inside the book's edges; **Turn** turns the page you're on away, from either side.
- Dark mode follows the system setting (Auto); the sun / half-circle / moon switch in the top bar sets Light, Auto or Dark. It darkens everything around the book, while the pages, and so the comics, stay white as in the original.
- **/** focuses search; **b** opens Book; **g** opens Browse; **r** opens a random comic; **i** opens the year/number index.
- Click the comic to enlarge it; **Escape** closes dialogs.
- Click the navigator's title to open the year/number index.
- Links such as `index.html#1838` open a particular comic. Browser Back/Forward restores the page.
- **Share** on a comic gives a link such as <https://nanabozho.github.io/xkcd/comic/1838/> (the share sheet on phones, the clipboard elsewhere). Posted in chat apps or social media, it previews with that comic's title, hover text and image, then opens the comic in the notebook. `#1838` links can't do this: preview crawlers never see the part after `#`.
- A fresh visit opens the cover. **Continue reading** resumes the last comic saved on that browser.

Only five book pages are mounted at a time. The Browse grid is as long as the whole collection, but only rows near the viewport exist on the page (at most about 60 cards on a desktop window, 12 on a phone); rows are rebuilt when you scroll back to them, and their images load only then. The complete search index stays local. The collection occupies approximately 190 MB including source caches and validation screenshots.

## Updating the archive

The reader needs no dependencies. Updating requires Python 3.10+, `requests` and `Pillow`.

```sh
python3 -m pip install requests Pillow
python3 tools/sync.py
```

The updater queries [xkcd's official API](https://xkcd.com/json.html) and [archive](https://xkcd.com/archive/), downloads missing images, reads transcripts from [explain xkcd's wiki API](https://www.explainxkcd.com/wiki/api.php) and regenerates `comics.js`. It resumes from cached metadata, images and transcripts. Downloads from xkcd use at most six workers; the wiki, a volunteer-run site, gets one request at a time with a pause between, 50 pages per request. Nothing runs automatically on a schedule.

Each run checks again:

- **The 10 newest comics**: their metadata, standard and double-resolution images, and transcripts, which can still appear or change in the first days.
- **Any missing image**, from xkcd.
- **Any comic without an explain xkcd transcript**, or with one the wiki marks incomplete. A new comic's transcript usually appears within hours to days; until then the comic is simply searchable by title and hover text, and the next run asks again.

Older transcripts are kept as cached. To re-read all of them (about 70 requests):

```sh
python3 tools/sync.py --refresh-transcripts
```

To rebuild from the cached files without any network requests:

```sh
python3 tools/sync.py --offline
```

`data/sync-report.json` records archive coverage and any download or transcript errors. `data/metadata/` holds the API responses; `data/explain/` holds each comic's transcript section from explain xkcd as wikitext, with the page and revision it came from, and is converted to plain text when `comics.js` is built; `data/hires/` records each comic page's double-resolution image (xkcd lists it only in the page's `srcset`), and `images/2x/` holds those files. `comic/<number>/index.html` are the share pages, regenerated with `comics.js`; their absolute URLs come from `SITE_URL` in `tools/sync.py`, so change it if you publish the notebook elsewhere. A 2x file is used only when it is the same picture at higher resolution, so a few (#231, #2067, #2591) are kept but ignored. `comics.js` is the only generated data file: plain JSON after a `window.XKCD_DATA=` prefix, which lets `index.html` load it with a `<script>` tag when opened directly from disk (browsers block `fetch` of local files). Other tools can read it by removing that prefix and the final `;`. Keep the caches to make updates resumable.

## Validation

```sh
node tools/test_search.cjs
node tools/test_browser.cjs /path/to/playwright
```

The browser test uses Playwright/Chromium, blocks all HTTP requests, and checks real search examples, transcript source links and license, image enlargement, index jumps, page boundaries, history, click, drag and tap page turns, browse filtering and windowed scrolling, mobile widths and touch swipes. It saves desktop and mobile screenshots in `tools/screenshots/`.

## Credits and license

Comics and accompanying text are **© Randall Munroe**, from [xkcd.com](https://xkcd.com/), shared under [CC BY-NC 2.5](https://xkcd.com/license.html). Preserve attribution and use this collection noncommercially. Every comic page links back to its original.

The notebook's original code, documentation and arrangement are **Copyright © 2026 Nanabozho and contributors**, also licensed under **Creative Commons Attribution–NonCommercial 2.5**, as requested. The full, unmodified license text is in [LICENSE](LICENSE); detailed attribution and scope are in [COMIC-LICENSE.txt](COMIC-LICENSE.txt). This is an unofficial reader and is not affiliated with or endorsed by Randall Munroe. The comics retain Randall's copyright and original license; no ownership of them is claimed by this project.

**Transcripts from explain xkcd** are written by the [explain xkcd](https://www.explainxkcd.com/) contributors and licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), as the wiki's [copyright page](https://www.explainxkcd.com/wiki/index.php/explain_xkcd:Copyrights) requires; that license, not this project's, covers them. The notebook converts their wiki markup to plain text, leaving out the wiki's notices and footnotes. Each transcript links to the page it came from in the **Text** view, and search results credit explain xkcd. The comic dialogue they quote remains © Randall Munroe under CC BY-NC 2.5.

Original comic image files are preserved unchanged. The notebook adds display sizing, organization and search. Credit, the license link and links to the original comic appear in the reader, including the enlarged-image and transcript views. The browse and search views also include attribution.

**Third-party exception:** page turns use StPageFlip, **Copyright © 2020 Nodlik**, under its original **MIT license**, preserved in [vendor/page-flip-LICENSE](vendor/page-flip-LICENSE); the two small local fixes are noted at the top of the vendored file. That library is not relicensed. The notebook makes no runtime requests to analytics, font services, or remote search services.

The CC BY-NC 2.5 license text was obtained from the [SPDX license list](https://github.com/spdx/license-list-data/blob/main/text/CC-BY-NC-2.5.txt). The authoritative terms and Randall's reuse statement are linked above.

## Other xkcd browsers and search tools

- [findxkcd](https://findxkcd.com/) browses and searches topics, characters, keywords, transcripts and dates using Typesense. [Source code](https://github.com/typesense/showcase-xkcd-search).
- [Explain xkcd](https://www.explainxkcd.com/wiki/index.php/Main_Page) provides searchable explanations, transcripts, categories and comic navigation.
- [Relevant XKCD](https://relevantxkcd.appspot.com/) accepts a description or a sentence about the comic you want to find.
- [Oh No Robot's xkcd search](https://www.ohnorobot.com/index.php?comic=56) searches an older, partial transcript collection (the site reports 1,705 episodes).

These are independent projects. Listings checked October 1, 2026; their coverage and availability may differ from this offline notebook.
