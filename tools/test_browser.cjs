/* node tools/test_browser.cjs [path to Playwright]; no server required. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/tmp/xkcd-browser/browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/tmp/xkcd-browser/browsers';
let playwright;
try { playwright = require(process.argv[2] || 'playwright'); }
catch { playwright = require('/tmp/xkcd-browser/node_modules/playwright'); }
const root = path.resolve(__dirname, '..');
const url = pathToFileURL(path.join(root, 'index.html')).href;
const output = path.join(__dirname, 'screenshots');
fs.mkdirSync(output, { recursive: true });
const data = JSON.parse(fs.readFileSync(path.join(root, 'comics.js'), 'utf8').replace(/^window\.XKCD_DATA=/, '').replace(/;\s*$/, ''));

(async () => {
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.route(/^https?:/, route => route.abort()); // Everything must work offline.
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const active = () => page.locator('#bookHost .page:not([inert])');
    const hash = () => page.evaluate(() => location.hash);
    const go = async n => { await page.evaluate(h => location.hash = h, String(n)); await page.waitForTimeout(150); };
    const key = async k => { await page.keyboard.press(k); await page.waitForTimeout(180); };
    await page.goto(url);
    await page.waitForSelector('#bookHost .stf__parent');
    assert.equal(await active().count(), 1, 'Only the visible page is interactive');
    await page.screenshot({ path: path.join(output, 'cover-desktop.png') });
    await active().getByRole('button', { name: 'Start at the beginning' }).click();
    assert.equal(await hash(), '#1');
    await key('ArrowRight'); assert.equal(await hash(), '#2', 'Next advances one comic');
    await key('ArrowLeft'); assert.equal(await hash(), '#1', 'Previous returns one comic');
    await go(403); await key('ArrowRight'); assert.equal(await hash(), '#405', 'Skip intentionally absent #404');
    for (let n = 0; n < 12; n++) await key('ArrowRight');
    assert.equal(await hash(), '#417', 'Turns work across virtual windows');
    assert.ok(await page.locator('#bookHost .page').count() <= 7, 'Book does not mount the whole archive');
    await page.locator('#search').fill('python');
    await page.waitForTimeout(220);
    assert.match(await page.locator('#searchResults').innerText(), /Python/);
    await page.locator('#search').press('Enter'); assert.equal(await hash(), '#353');
    await active().locator('.comic-image').evaluate(img => img.decode());
    await page.screenshot({ path: path.join(output, 'comic-desktop.png') });
    const geometry = await active().locator('.comic-image').boundingBox();
    assert.ok(geometry.width > 400 && geometry.height > 150, 'Comic gets substantial reading space');
    await active().getByRole('button', { name: 'Enlarge Python' }).click();
    assert.ok(await page.locator('#imageDialog').isVisible());
    const published = n => data.comics.find(c => c.num === n).width;
    const viewer = n => page.evaluate(n => { const v = document.querySelector('#imageViewport'), i = document.querySelector('#fullImage');
      return { width: i.offsetWidth, natural: n, vScroll: v.scrollHeight > v.clientHeight + 1, hScroll: v.scrollWidth > v.clientWidth + 1, toggle: !document.querySelector('#zoomBtn').hidden }; }, published(n));
    let view = await viewer(353);
    assert.ok(view.width > view.natural && !view.vScroll && !view.hScroll, 'Enlarged image is scaled up to fill the dialog without scrolling');
    assert.ok(view.toggle, 'Size toggle is offered when actual size differs from fit');
    await page.locator('#zoomBtn').click(); view = await viewer(353);
    assert.equal(view.width, view.natural, 'Actual size shows the image pixels');
    await page.locator('#fullImage').click(); assert.ok((await viewer(353)).width > view.natural, 'Clicking the image returns to fit');
    await key('ArrowRight'); assert.equal(await hash(), '#353', 'Modal stops book keyboard navigation');
    await key('Escape');
    await active().getByRole('button', { name: 'Text', exact: true }).click();
    assert.match(await page.locator('#textBody').innerText(), /antigravity/i);
    assert.equal(await page.locator('#textBody a[href^="https://www.explainxkcd.com/wiki/index.php/353:"]').count(), 1, 'Transcript links to its explain xkcd page');
    assert.equal(await page.locator('#textBody a[href="https://creativecommons.org/licenses/by-sa/3.0/"]').count(), 1, 'Transcript shows its CC BY-SA license');
    assert.match(await page.locator('#textBody').innerText(), /Official transcript/);
    await key('Escape');
    let prompted = null; page.once('dialog', d => { prompted = d.defaultValue(); d.dismiss(); });
    await active().getByRole('button', { name: 'Share' }).click(); await page.waitForTimeout(100);
    assert.ok(prompted === `${data.siteUrl}comic/353/` || await active().getByRole('button', { name: 'Link copied' }).count(), 'Share gives the previewable link');
    await page.locator('#search').fill('sudo make me a sandwich');
    await page.locator('#search').press('Enter'); assert.equal(await hash(), '#149', 'Enter searches current input before debounce fires');
    await page.locator('#search').fill('#404'); await page.waitForTimeout(220);
    assert.match(await page.locator('#searchResults').innerText(), /intentionally absent/);
    await page.locator('#search').fill('zzzxxyynonexistent'); await page.waitForTimeout(220);
    assert.match(await page.locator('#searchResults').innerText(), /No matches/);
    await page.locator('#search').fill(''); await page.locator('#search').press('Escape');
    await page.locator('#browseMode').click();
    const cards = () => page.locator('.comic-card').count(), card = n => page.locator(`.comic-card[data-open="${n}"]`);
    const scrollToY = async y => { await page.evaluate(y => scrollTo(0, y === 'end' ? document.documentElement.scrollHeight : y), y); await page.waitForTimeout(120); };
    assert.equal(await page.locator('.comic-card').first().getAttribute('data-open'), '1');
    assert.ok(await cards() < 100, 'Browse mounts only rows near the viewport');
    await scrollToY('end'); await card(data.latestAvailable).waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
    assert.equal(await card(data.latestAvailable).count(), 1, 'Scrolling reaches the end of the collection');
    assert.equal(await card(1).count(), 0, 'Rows far behind the viewport are released');
    assert.ok(await cards() < 100, 'Mounted cards stay bounded deep in the grid');
    await scrollToY(0); assert.equal(await card(1).count(), 1, 'Scrolling back rebuilds earlier rows');
    await scrollToY(await page.evaluate(() => document.documentElement.scrollHeight / 2));
    const deep = await page.evaluate(() => [...document.querySelectorAll('.comic-card')].find(el => el.getBoundingClientRect().top > 120).dataset.open);
    const depth = await page.evaluate(() => scrollY);
    await card(deep).click(); assert.equal(await hash(), '#' + deep);
    await page.locator('#browseMode').click();
    assert.equal(await page.evaluate(() => scrollY), depth, 'Returning to Browse keeps the scroll position');
    assert.ok(await card(deep).evaluate(el => el.classList.contains('selected')), 'The comic just read is marked');
    await key('Home'); assert.equal(await hash(), '#' + deep, 'Home scrolls Browse instead of opening the book cover');
    await page.setViewportSize({ width: 700, height: 1000 }); await page.waitForTimeout(400);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.comic-card')].some(el => el.getBoundingClientRect().bottom > 0 && el.getBoundingClientRect().top < innerHeight)), 'Resizing keeps cards in view');
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(400);
    await page.locator('#yearFilter').selectOption('2026');
    await page.locator('#sortOrder').selectOption('newest');
    assert.equal(await page.locator('.comic-card').first().getAttribute('data-open'), String(data.latestAvailable));
    await page.locator('#search').fill('zzzxxyynonexistent'); await page.waitForTimeout(220);
    assert.equal(await page.locator('.comic-card').count(), 0);
    await page.locator('#yearFilter').selectOption('');
    await page.locator('#search').fill('orbital mechanics'); await page.waitForTimeout(220);
    assert.ok(await page.locator('.comic-card[data-open="1356"]').count());
    await page.locator('.comic-card[data-open="1356"]').click(); assert.equal(await hash(), '#1356');
    await go(1732); await active().locator('.image-button').click(); view = await viewer(1732);
    assert.ok(view.vScroll && !view.hScroll && view.width === view.natural, 'A very tall image keeps its width and scrolls instead of shrinking to a sliver');
    await key('Escape');
    await key('i'); assert.equal(await page.evaluate(() => document.querySelector('dialog[open]')?.id), 'tocDialog', 'i opens the index');
    await page.locator('#comicNumber').fill('1663'); await page.locator('#numberGo').click();
    assert.equal(await hash(), '#1663');
    assert.match(await active().innerText(), /interactive xkcd/i);
    await go(data.latestAvailable); await key('ArrowRight'); assert.equal(await hash(), '#end');
    assert.ok(await page.locator('#nextBtn').isDisabled());
    await go(''); assert.ok(await page.locator('#prevBtn').isDisabled());
    await go(100); await key('ArrowRight'); await page.waitForFunction(() => location.hash === '#101'); await page.goBack(); await page.waitForTimeout(150);
    assert.equal(await hash(), '#100', 'Browser Back restores comic');
    await page.goForward(); await page.waitForTimeout(150); assert.equal(await hash(), '#101');
    // A click in the outer 30% of a page turns back on the left and forward on the right; buttons keep their own actions.
    const footerClear = () => active().locator('.page-footer').evaluate(f => {
      const edge = f.closest('.page').getBoundingClientRect(), corner = Math.min(104, Math.max(48, edge.width * .11));
      return [...f.querySelectorAll('a,button')].every(el => { const r = el.getBoundingClientRect(); return r.left >= edge.left + corner - 1 && r.right <= edge.right - corner + 1; });
    });
    await go(353); const book = await page.locator('#bookHost').boundingBox();
    const click = async (fx, fy) => { await page.mouse.click(book.x + book.width * fx, book.y + book.height * fy); await page.waitForTimeout(250); };
    await click(.99, .99); assert.equal(await hash(), '#354', 'Bottom-right corner turns forward');
    await click(.99, .01); assert.equal(await hash(), '#355', 'Top-right corner turns forward');
    await click(.01, .99); assert.equal(await hash(), '#354', 'Bottom-left corner turns back');
    await click(.01, .5); assert.equal(await hash(), '#353', 'Left edge turns back');
    await click(.35, .01); await click(.65, .01); assert.equal(await hash(), '#353', 'Clicks in the middle of the page do not turn it');
    await active().locator('[data-text]').click(); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.querySelector('dialog[open]')?.id), 'textDialog', 'Footer buttons keep their own action');
    assert.equal(await hash(), '#353'); await key('Escape');
    assert.ok(await footerClear(), 'Footer controls stay out of the corners');
    await page.mouse.move(book.x + book.width - 8, book.y + book.height - 8);
    for (let n = 0; n < 4; n++) { await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250); }
    assert.equal(await hash(), '#357', 'Repeated corner clicks keep turning past the mounted pages');
    const drag = async (from, to) => {
      const y = book.y + book.height - 8; await page.mouse.move(book.x + book.width * from, y); await page.mouse.down();
      await page.mouse.move(book.x + book.width * to, y, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(300);
    };
    await go(353); await drag(.99, .75); assert.equal(await hash(), '#354', 'Dragging a page a fifth of the way across turns it');
    await drag(.99, .85); assert.equal(await hash(), '#354', 'A shorter drag springs back');
    await drag(.01, .25); assert.equal(await hash(), '#353', 'Dragging back a fifth of the way across turns back');
    await drag(.01, .15); assert.equal(await hash(), '#353', 'A shorter back drag springs back');
    assert.ok(await page.locator('#bookHost.framed').count(), 'Slide inside the book is the default');
    await drag(.99, .85); assert.ok(await page.locator('.book.mirrored').count(), 'Sliding forward uses the mirrored book');
    await active().locator('[data-text]').click(); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.querySelector('dialog[open]')?.id), 'textDialog', 'A mirrored page still works normally'); await key('Escape');
    await page.evaluate(() => { window.frames = 0; const raf = requestAnimationFrame; window.requestAnimationFrame = cb => { window.frames++; return raf(cb); }; });
    await page.waitForTimeout(1000); assert.ok(await page.evaluate(() => window.frames) < 90, 'Replaced books stop animating');
    // Turn sends the current page away from either side; the choice is remembered.
    await page.locator('#aboutBtn').click(); await page.locator('input[name="turnStyle"][value="turn"]').check(); await key('Escape');
    await page.reload(); await page.waitForSelector('#bookHost .page:not([inert]) .comic-title');
    assert.equal(await page.evaluate(() => localStorage.getItem('xkcdNotebook.turnStyle')), 'turn');
    await click(.99, .5); assert.equal(await hash(), '#354', 'Turn forward from the right');
    await click(.01, .5); assert.equal(await hash(), '#353', 'Turn back from the left');
    await drag(.01, .15); assert.ok(await page.locator('.book.mirrored').count(), 'Turning back uses the mirrored book');
    await drag(.99, .75); assert.equal(await hash(), '#354', 'A turn drag a fifth of the way across turns');
    await key('ArrowLeft'); assert.equal(await hash(), '#353', 'Keys follow the turn style');
    // Slide inside the book slides the same way but keeps the moving page within the book's edges.
    await page.locator('#aboutBtn').click(); await page.locator('input[name="turnStyle"][value="framed"]').check(); await key('Escape');
    assert.equal(await page.locator('#bookHost .book').evaluate(el => getComputedStyle(el).overflowX), 'clip', 'Slide inside the book clips the moving page');
    await click(.99, .5); assert.equal(await hash(), '#354', 'Framed slide forward from the right');
    await click(.01, .5); assert.equal(await hash(), '#353', 'Framed slide back from the left');
    await page.evaluate(() => localStorage.setItem('xkcdNotebook.turnStyle', 'slide')); await page.reload(); await page.waitForSelector('#bookHost .page:not([inert]) .comic-title');
    assert.ok(await page.locator('#bookHost.framed').count(), 'A saved style that is no longer offered falls back to Slide inside the book');
    await page.evaluate(() => localStorage.removeItem('xkcdNotebook.turnStyle'));
    await page.mouse.move(5, 5); await go(''); await click(.01, .5); assert.equal(await hash(), '', 'The cover has nothing before it');
    await go('%E0%A4%A'); assert.equal(await active().locator('h1').innerText(), 'xkcd');
    await page.goto(pathToFileURL(path.join(root, 'comic', '1838', 'index.html')).href); await page.waitForSelector('#bookHost .page:not([inert]) .comic-title');
    assert.equal(await hash(), '#1838', 'A share page forwards readers to its comic');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(220); await go(353);
      await page.screenshot({ path: path.join(output, `comic-${width}.png`) });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].map(el => ({ tag: el.tagName, id: el.id, class: el.className, x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })).filter(x => x.width && (x.right > innerWidth + 1 || x.x < -1)).slice(0, 25)));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px viewport has no horizontal overflow`);
      const box = await active().locator('.page-content').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      assert.ok(await footerClear(), `Footer controls stay out of the corners at ${width}px`);
      await active().locator('.comic-image').evaluate(img => img.decode());
      await page.screenshot({ path: path.join(output, `comic-${width}.png`) });
    }
    for (const [width, height] of [[375, 667], [1280, 720]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(220); await go('');
      assert.match(await active().innerText(), /Continue reading #\d+/, 'Cover offers to resume the last comic');
      assert.ok(await active().locator('.page-content').evaluate(el => el.scrollHeight <= el.clientHeight + 1), `Cover fits a ${width}×${height} screen without scrolling`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), `Book view fits a ${width}×${height} window without a page scrollbar`);
    }
    await go('intro');
    assert.ok(await active().locator('.page-content').evaluate(el => el.scrollHeight <= el.clientHeight + 1), 'Intro fits a 1280×720 screen without scrolling');
    assert.deepEqual(errors, [], 'No browser exceptions');
    await context.close();
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await touchContext.route(/^https?:/, r => r.abort());
    const phone = await touchContext.newPage();
    await phone.goto(url + '#353'); await phone.waitForSelector('.page:not([inert]) .comic-title');
    const cdp = await touchContext.newCDPSession(phone);
    async function gesture(x1, y1, x2, y2) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
      for (let step = 1; step <= 6; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2-x1)*step/6, y: y1 + (y2-y1)*step/6 }] });
        await phone.waitForTimeout(30);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await phone.waitForTimeout(650);
    }
    await gesture(320, 360, 70, 360);
    assert.equal(await phone.evaluate(() => location.hash), '#354', 'Swipe turns exactly one page');
    await phone.locator('#prevBtn').tap(); await phone.waitForTimeout(650);
    assert.equal(await phone.evaluate(() => location.hash), '#353', 'Animated Previous works on touch');
    await gesture(195, 560, 195, 330);
    assert.equal(await phone.evaluate(() => location.hash), '#353', 'Vertical gesture does not turn the comic');
    const phoneBook = await phone.locator('#bookHost').boundingBox();
    await phone.touchscreen.tap(phoneBook.x + phoneBook.width - 8, phoneBook.y + phoneBook.height - 8); await phone.waitForTimeout(650);
    assert.equal(await phone.evaluate(() => location.hash), '#354', 'Tapping the right corner turns forward');
    await phone.touchscreen.tap(phoneBook.x + 8, phoneBook.y + phoneBook.height / 2); await phone.waitForTimeout(650);
    assert.equal(await phone.evaluate(() => location.hash), '#353', 'Tapping the left edge turns back');
    const sharp = data.comics.find(c => c.num > 3000 && c.image2x);
    await phone.evaluate(n => { location.hash = '#' + n; }, sharp.num); await phone.waitForTimeout(400);
    assert.match(await phone.locator('.page:not([inert]) .comic-image').evaluate(img => img.currentSrc), /\/2x\//, 'High-density screens get the 2x image');
    await touchContext.close();
    // Dark mode darkens the surroundings but keeps pages, and so the comics, on white; a chosen theme overrides the system.
    const darkContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    await darkContext.route(/^https?:/, r => r.abort());
    const dark = await darkContext.newPage();
    await dark.goto(url + '#353'); await dark.waitForSelector('#bookHost .page:not([inert]) .comic-title');
    // Average channel of an element's background colour, or of its linear gradient's first colour.
    const shade = selector => dark.evaluate(sel => {
      const style = getComputedStyle(document.querySelector(sel)), image = style.backgroundImage;
      const css = style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? style.backgroundColor : image.slice(image.indexOf('linear-gradient'));
      return css.match(/rgba?\(([^)]+)\)/)[1].split(',').slice(0, 3).map(Number).reduce((x, y) => x + y) / 3;
    }, selector);
    assert.ok(await shade('body') < 60, 'Dark mode darkens the page around the book');
    assert.equal(await shade('#bookHost .page:not([inert])'), 255, 'Book pages stay white in dark mode');
    assert.ok(await dark.locator('#bookHost .page:not([inert]) .comic-caption').evaluate(el => getComputedStyle(el).color.match(/\d+/g).slice(0, 3).map(Number).every(v => v < 90)), 'Page text stays dark on its white page');
    assert.equal(await dark.locator('[data-theme-choice="auto"]').getAttribute('aria-pressed'), 'true', 'Auto, following the system, is the default');
    await dark.locator('[data-theme-choice="light"]').click();
    await dark.reload(); await dark.waitForSelector('#bookHost .page:not([inert]) .comic-title');
    assert.equal(await dark.locator('[data-theme-choice="light"]').getAttribute('aria-pressed'), 'true', 'The switch shows the saved choice');
    assert.equal(await dark.evaluate(() => document.documentElement.dataset.theme), 'light', 'A chosen theme is applied before the page draws');
    assert.ok(await shade('body') > 200, 'Light overrides a dark system setting');
    await darkContext.close();
    console.log(`PASS: offline book, real archive search, modal controls, browse filters, number index, history, boundaries, virtual pages, click, drag and tap turns in both styles, mobile widths, touch gestures and dark mode (${data.comics.length} entries).`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
