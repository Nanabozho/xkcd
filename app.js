(() => {
  'use strict';
  const $ = (selector, el = document) => el.querySelector(selector);
  const $$ = (selector, el = document) => [...el.querySelectorAll(selector)];
  const D = window.XKCD_DATA, comics = D.comics;
  if (!comics.length) { $('#bookHost').textContent = 'No comics have been downloaded yet. Run tools/sync.py to build the collection.'; return; }
  const esc = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const number = n => n.toLocaleString('en-US');
  const dateLabel = date => new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
  const storage = { get(key) { try { return localStorage.getItem('xkcdNotebook.' + key); } catch { return null; } }, set(key, value) { try { localStorage.setItem('xkcdNotebook.' + key, value); } catch {} } };
  const external = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
  const bySA = '<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="license noopener noreferrer">CC BY-SA 3.0</a>';
  const comicCredit = () => `© ${external('https://xkcd.com/', 'Randall Munroe')} <span class="license-short">· <a href="https://xkcd.com/license.html" target="_blank" rel="license noopener noreferrer">CC BY-NC 2.5</a></span>`;
  const byNumber = new Map(comics.map((c, i) => [c.num, i]));
  const years = [...new Set(comics.map(c => c.date.slice(0, 4)))].sort();
  const engine = new ComicSearch(comics);
  const lastPage = comics.length + 2, BUFFER_ROWS = 4, SLIDE_MS = 160, TURN_MS = 220;
  const host = $('#bookHost'), search = $('#search'), results = $('#searchResults');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let page = fromHash(), mode = 'book', flip = null, windowStart = 0, windowEnd = 0, mirrored = false, pageNodes = [];
  // Framed slides inside the book's edges (the default); Turn turns the page away. Slide, which lets the moving page swing
  // past the book's edges, works too but is commented out under "?". A saved style that isn't offered falls back to Framed.
  const offeredStyles = $$('input[name="turnStyle"]').map(input => input.value);
  let turnStyle = offeredStyles.includes(storage.get('turnStyle')) ? storage.get('turnStyle') : 'framed';
  let mountId = 0, rebaseTimer = null, resizeTimer = null, browseMatches = [], browseKey = null, browseScroll = 0;
  let browseRows = [0, 0], browseCols = 0, browseAnchor = 0;
  let searchTimer = null, resultMatches = [], selectedResult = -1, renderedQuery = '';
  let savedNumber = Number(storage.get('lastComic')), enlarged = null, zoomed = false;

  function highlight(text, terms) {
    const escaped = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!escaped.length) return esc(text);
    const regex = new RegExp(escaped.join('|'), 'gi');
    let result = '', start = 0;
    for (const match of String(text).matchAll(regex)) {
      result += esc(text.slice(start, match.index)) + '<mark>' + esc(match[0]) + '</mark>';
      start = match.index + match[0].length;
    }
    return result + esc(text.slice(start));
  }
  function comicOnPage() { return comics[page - 2]; }
  function fromHash() {
    let hash; try { hash = decodeURIComponent(location.hash.slice(1)); } catch { return 0; }
    if (hash === 'intro') return 1;
    if (hash === 'end') return lastPage;
    const match = hash.match(/^(?:comic\/)?(\d+)$/);
    const index = match && byNumber.get(Number(match[1]));
    return index != null ? index + 2 : 0;
  }
  function fragment() { return page === 0 ? '' : page === 1 ? '#intro' : page === lastPage ? '#end' : '#' + comicOnPage().num; }
  function coverHTML() {
    return `<div class="page-content"><div><div class="cover-kicker">The collected webcomic · Randall Munroe</div><h1>xkcd</h1><div class="cover-rule"></div><h2>A notebook for the curious.</h2><p class="cover-copy">Small drawings. Very big ideas.<br>Romance, sarcasm, math, and language —<br>one comic, one turn of the page.</p><div class="cover-actions"><button data-open="${comics[0].num}">Start at the beginning →</button><button class="cover-secondary" data-open="${comics.at(-1).num}">Latest comic ↗</button>${byNumber.has(savedNumber) ? `<button class="cover-secondary" data-open="${savedNumber}">Continue reading #${savedNumber} →</button>` : ''}</div></div><div class="cover-bottom"><span>${number(comics.length)} entries · ${years[0]}–${years.at(-1)}<br>${comicCredit()}</span><button data-page="1">Inside this notebook →</button></div></div>`;
  }
  function introHTML() {
    return `<div class="page-content"><span class="eyebrow">Inside this notebook</span><h2>That comic you almost remember.</h2><p>Search a title, a few keywords, or a fragment of dialogue. The index includes titles, Randall's hover text, transcripts from explain xkcd that also describe what is drawn, and xkcd's official transcripts where available.</p><p>Try <button data-query="python">python</button>, <button data-query="correct horse battery staple">correct horse battery staple</button>, or <button data-query="orbital mechanics">orbital mechanics</button>. Put a phrase in quotation marks for an exact match.</p><div class="shortcuts"><span><kbd>←</kbd><kbd>→</kbd> Turn pages</span><span><kbd>/</kbd> Search</span><span><kbd>g</kbd> Browse</span><span><kbd>b</kbd> Book</span><span><kbd>r</kbd> Random</span><span><kbd>i</kbd> Index</span></div><p class="intro-extra">Click a comic to enlarge it. The hover text is printed beneath it; <strong>Text</strong> opens its hover text and transcript. Interactive comics link to their full experience on xkcd.</p><p class="muted intro-extra">${number(D.counts.localImages)} local images · ${number(D.counts.explainTranscripts)} transcripts from explain xkcd · ${number(D.counts.transcripts)} official transcripts.<br>Comics © Randall Munroe · ${external(D.licenseUrl, D.license)}</p><button data-open="${comics[0].num}">Open the first comic →</button></div>`;
  }
  // Thumbnails stay on the standard image; pages offer high-density screens the 2x file where xkcd has one.
  function imageHTML(c, thumb = false) {
    if (!c.image) return '';
    const srcset = !thumb && c.image2x ? ` srcset="${esc(c.image)} 1x, ${esc(c.image2x)} 2x"` : '';
    return `<img class="comic-image" src="${esc(c.image)}"${srcset} alt="${esc(c.title)}" title="${esc(c.alt)}" width="${c.width || 600}" height="${c.height || 400}" ${thumb ? 'loading="lazy"' : 'loading="eager"'} decoding="async">`;
  }
  function comicHTML(c) {
    return `<div class="page-content"><div class="page-header"><span>xkcd / ${String(c.num).padStart(4, '0')}</span><time datetime="${c.date}">${dateLabel(c.date)}</time></div><h2 class="comic-title">${esc(c.title)}</h2><figure class="comic-frame">${c.image ? `<button class="image-button" data-zoom="${c.num}" aria-label="Enlarge ${esc(c.title)}">${imageHTML(c)}</button>` : `<div class="interactive-note"><strong>An interactive xkcd</strong><p>This entry has no static comic image in the official API. Open the original to explore it.</p>${external(c.source, 'Open ' + c.title)}</div>`}</figure>${c.alt ? `<p class="comic-caption"><small>Hover text</small>${esc(c.alt)}</p>` : ''}<div class="page-footer"><span class="comic-credit">${comicCredit()}</span><span class="page-actions"><button data-text="${c.num}">Text</button><button data-share="${c.num}">Share</button></span>${external(c.source, 'Original on xkcd').replace(' on xkcd', '<span class="on-xkcd"> on xkcd</span>')}</div></div>`;
  }
  function pageHTML(p) {
    const kind = p === 0 ? 'cover' : p === 1 ? 'intro-page' : p === lastPage ? 'end-page' : 'comic-page';
    const content = p === 0 ? coverHTML() : p === 1 ? introHTML() : p === lastPage ? `<div class="page-content"><span class="eyebrow">The end, for now</span><h2>There is always another tangent.</h2><p>${number(comics.length)} entries through #${D.latestAvailable}.<br>New comics continue at ${external('https://xkcd.com/', 'xkcd.com')}.</p><button data-random>Find a random comic →</button></div>` : comicHTML(comics[p - 2]);
    return `<article class="page ${kind}" ${p === 0 ? 'data-density="hard"' : ''}>${content}</article>`;
  }
  // A mirrored book holds its pages in reverse order.
  function slot(p) { return mirrored ? windowEnd - p : p - windowStart; }
  function markActive() {
    const active = pageNodes[slot(page)];
    $$('.page', host).forEach(el => { el.inert = el !== active; el.setAttribute('aria-hidden', String(el !== active)); });
  }
  function mountBook(mirror = false) {
    clearTimeout(rebaseTimer);
    const generation = ++mountId;
    // Pages still in the window are kept, images and all, so a rebuild doesn't redraw them from scratch.
    // The cover is rebuilt because its "Continue reading" button follows the comic you are on.
    const kept = new Map(pageNodes.map((el, i) => [mirrored ? windowEnd - i : windowStart + i, el]));
    kept.delete(0);
    if (flip) { try { flip.destroy(); } catch {} flip = null; }
    const stage = host.parentElement;
    const width = Math.max(240, Math.floor(Math.min(1040, stage.clientWidth, stage.clientHeight * 1.48)));
    const height = Math.floor(stage.clientHeight);
    host.style.width = width + 'px'; host.style.height = height + 'px';
    windowStart = Math.max(0, page - 2); windowEnd = Math.min(lastPage, page + 2); mirrored = mirror;
    const order = Array.from({ length: windowEnd - windowStart + 1 }, (_, i) => mirrored ? windowEnd - i : windowStart + i);
    const book = document.createElement('div'), fresh = document.createElement('template');
    book.className = mirrored ? 'book mirrored' : 'book';
    for (const p of order) {
      if (!kept.has(p)) { fresh.innerHTML = pageHTML(p); kept.set(p, fresh.content.firstElementChild); }
      book.append(kept.get(p));
    }
    host.replaceChildren(book);
    pageNodes = $$('.page', host);
    // Only five pages exist at once, even with thousands of comics in the collection.
    if (!window.St?.PageFlip) { pageNodes.forEach((el, i) => el.hidden = i !== slot(page)); markActive(); return; }
    flip = new St.PageFlip(host.firstElementChild, { width, height, size: 'fixed', minWidth: width, maxWidth: width, minHeight: height, maxHeight: height,
      startPage: slot(page), usePortrait: true, showCover: false, autoSize: false, drawShadow: true, maxShadowOpacity: .2,
      showPageCorners: false, mobileScrollSupport: true, disableFlipByClick: false, flippingTime: reduced.matches ? 1 : 440 });
    flip.loadFromHTML(pageNodes);
    // Presses only reach the library near either side (see the mousedown handler), so the page's halves decide their direction.
    // StPageFlip settles a drag by the spine, which on a single page is its left edge; here a fifth of the way across is enough.
    const controller = flip.flipController;
    controller.getDirectionByPoint = function (point) { const rect = this.getBoundsRect(); return point.x - rect.pageWidth < rect.pageWidth / 2 ? 1 : 0; };
    // Turns and slides take a fixed time whatever the distance, and ease out so most of the movement comes first.
    const timing = controller.getAnimationDuration.bind(controller);
    controller.getAnimationDuration = size => reduced.matches ? timing(size) : turnStyle === 'turn' ? TURN_MS : SLIDE_MS;
    const render = flip.getRender(), startAnimation = render.startAnimation.bind(render);
    render.startAnimation = (frames, duration, done) => {
      const last = frames.length - 1;
      startAnimation(frames.map((_, i) => frames[Math.round((1 - (1 - i / (last || 1)) ** 3) * last)]), duration, done);
    };
    // A page coming in starts at the page's edge rather than a page-width beyond it, so it shows at once.
    controller.flip = function (point) {
      if (this.calc !== null) this.render.finishAnimation();
      if (!this.start(point)) return;
      const rect = this.getBoundsRect(), inset = rect.height / 10, bottom = this.calc.getCorner() === 'bottom';
      const from = { x: this.calc.getDirection() === 1 ? -inset : rect.pageWidth - inset, y: bottom ? rect.height - inset : inset };
      this.setState('flipping'); this.calc.calc(from);
      this.animateFlippingTo(from, { x: -rect.pageWidth, y: bottom ? rect.height : 0 }, true);
    };
    controller.stopMove = function () {
      if (!this.calc) return;
      const at = this.calc.getPosition(), rect = this.getBoundsRect(), y = this.calc.getCorner() === 'bottom' ? rect.height : 0;
      const turned = this.calc.getDirection() === 0 ? at.x <= rect.pageWidth * .8 : at.x <= -rect.pageWidth * .2;
      this.animateFlippingTo(at, { x: turned ? -rect.pageWidth : rect.pageWidth, y }, turned);
    };
    if (mirrored) { const ui = flip.getUI(); ui.getMousePos = (x, y) => { const r = ui.distElement.getBoundingClientRect(); return { x: r.right - x, y: y - r.top }; }; }
    flip.on('flip', event => {
      if (generation !== mountId) return;
      page = mirrored ? windowEnd - event.data : windowStart + event.data;
      syncUI(true);
      scheduleRebase(generation);
    });
    markActive();
  }
  function scheduleRebase(generation) {
    clearTimeout(rebaseTimer);
    rebaseTimer = setTimeout(() => {
      if (generation !== mountId || mode !== 'book') return;
      if (flip?.getState() !== 'read') { scheduleRebase(generation); return; }
      mountBook();
    }, 60);
  }
  function syncUI(push = false) {
    const c = comicOnPage();
    const label = c ? c.title : page === 1 ? 'Inside this notebook' : page === lastPage ? 'Back cover' : 'Cover';
    $('#position').textContent = c ? `#${c.num} · ${number(page - 1)} / ${number(comics.length)}` : `${number(comics.length)} entries`;
    $('#currentTitle').textContent = label;
    $('#prevBtn').disabled = page <= 0;
    $('#nextBtn').disabled = page >= lastPage;
    $('#tocBtn').setAttribute('aria-label', `Open comic index. ${label}`);
    document.title = c ? `xkcd #${c.num}: ${c.title} · Notebook` : 'xkcd Notebook';
    const hash = fragment();
    if (push && location.hash !== hash) history.pushState(null, '', location.pathname + location.search + hash);
    if (c) { savedNumber = c.num; storage.set('lastComic', c.num); }
    $('#announcer').textContent = c ? `Comic ${c.num}, ${c.title}` : label;
    if (flip) markActive();
  }
  function goTo(target, { animate = false, history = true } = {}) {
    target = Math.max(0, Math.min(lastPage, target));
    if (mode !== 'book') setMode('book', false);
    closeSearch();
    if (animate && flip && target >= windowStart && target <= windowEnd && Math.abs(target - page) === 1) {
      if (flip.getState() !== 'read') return;
      orient(target - page);
      if (turnStyle === 'turn') flip.flipNext(); else flip.flipPrev();
    } else {
      page = target; mountBook(); syncUI(history);
    }
  }
  // StPageFlip has two motions: the page turns away to the left, or the one before it comes in from the left.
  // The same motions from the right come from a mirrored book with its pages reversed, so both sides can turn, or both slide.
  function mirrorFor(direction) { return turnStyle === 'turn' ? direction < 0 : direction > 0; }
  // Every turn or slide starts from a fresh book, even when the book already faces the right way,
  // so going either way does the same work and takes the same time.
  function orient(direction) { mountBook(mirrorFor(direction)); }
  function openComic(n) { if (byNumber.has(Number(n))) goTo(byNumber.get(Number(n)) + 2); }
  function navigate(direction) {
    if (mode === 'browse') return;
    // As with clicks, a key or swipe during a turn finishes that turn first, so quick presses all count.
    if (flip?.getState() === 'flipping') flip.getRender().finishAnimation();
    if (page + direction < 0 || page + direction > lastPage) return;
    goTo(page + direction, { animate: true });
  }
  function randomComic() { openComic(comics[Math.floor(Math.random() * comics.length)].num); }
  function setMode(next, render = true) {
    const from = mode;
    if (from === 'browse' && next !== 'browse') browseScroll = scrollY;
    mode = next;
    $('#bookView').hidden = mode !== 'book'; $('#browseView').hidden = mode !== 'browse';
    $('#bookMode').classList.toggle('active', mode === 'book'); $('#browseMode').classList.toggle('active', mode === 'browse');
    $('#bookMode').setAttribute('aria-pressed', String(mode === 'book')); $('#browseMode').setAttribute('aria-pressed', String(mode === 'browse'));
    $('.navigator').hidden = mode !== 'book';
    closeSearch();
    if (render && mode === 'book') { mountBook(); syncUI(); }
    // Returning from a comic keeps the cards already loaded and the scroll position.
    else if (render && from !== 'browse') { if (browseQuery() !== browseKey) renderBrowse(); else { markSelectedCard(); scrollTo(0, browseScroll); placeBrowse(); } }
  }
  function browseQuery() { return [search.value.trim(), $('#yearFilter').value, $('#sortOrder').value].join('\n'); }
  function cardHTML(m) {
    const c = comics[m.index];
    return `<button class="comic-card${c.num === comicOnPage()?.num ? ' selected' : ''}" data-open="${c.num}" aria-label="Open xkcd ${c.num}: ${esc(c.title)}"><span class="card-image">${c.image ? imageHTML(c, true) : '<span class="no-preview">An interactive xkcd ↗</span>'}</span><span class="card-body"><span class="card-meta"><span>#${c.num}</span><time datetime="${c.date}">${dateLabel(c.date)}</time></span><h2>${esc(c.title)}</h2>${m.snippet ? `<span class="match-label">${esc(m.label)}</span><p>${highlight(m.snippet, m.terms)}</p>` : `<p>${esc(c.alt.slice(0, 130))}${c.alt.length > 130 ? '…' : ''}</p>`}</span></button>`;
  }
  function markSelectedCard() { $$('.comic-card', $('#grid')).forEach(el => el.classList.toggle('selected', Number(el.dataset.open) === comicOnPage()?.num)); }
  function renderBrowse() {
    const year = $('#yearFilter').value, order = $('#sortOrder').value, query = search.value.trim();
    browseKey = browseQuery();
    browseMatches = engine.search(query).filter(m => !year || comics[m.index].date.startsWith(year));
    if (order !== 'relevance') browseMatches.sort((a, b) => (comics[a.index].num - comics[b.index].num) * (order === 'newest' ? -1 : 1));
    $('#browseTitle').textContent = query ? 'Search the collection' : 'Browse xkcd';
    $('#browseSummary').textContent = `${number(browseMatches.length)} ${query ? 'matches' : 'entries'}${year ? ' in ' + year : ''}`;
    $('#grid').innerHTML = browseMatches.length ? '' : '<div class="empty-grid">No comics match these words.<br>Try fewer keywords, a different spelling, or another year.</div>';
    browseRows = [0, 0]; browseCols = 0;
    scrollTo(0, 0); placeBrowse();
  }
  // Rows have a fixed height, so the grid keeps the full length while only rows near the viewport are mounted.
  function placeBrowse() {
    const grid = $('#grid');
    if (mode !== 'browse' || !browseMatches.length) { grid.style.paddingTop = grid.style.height = ''; return; }
    const style = getComputedStyle(grid), cols = style.gridTemplateColumns.split(' ').length;
    const gap = parseFloat(style.rowGap) || 0, pitch = parseFloat(style.gridAutoRows) + gap, rows = Math.ceil(browseMatches.length / cols);
    const top = grid.getBoundingClientRect().top + scrollY;
    grid.style.height = rows * pitch - gap + 'px';
    // A new column count reflows every row; keep the same comic at the top of the view.
    if (browseCols && cols !== browseCols) { grid.innerHTML = ''; browseRows = [0, 0]; scrollTo(0, top + Math.floor(browseAnchor / cols) * pitch); }
    browseCols = cols;
    const first = Math.max(0, Math.floor((scrollY - top) / pitch)), last = Math.min(rows, Math.max(1, Math.ceil((scrollY + innerHeight - top) / pitch)));
    browseAnchor = first * cols;
    const [from, to] = browseRows;
    if (to > from && from <= Math.max(0, first - 1) && to >= Math.min(rows, last + 1)) return;
    const next = [Math.max(0, first - BUFFER_ROWS), Math.min(rows, last + BUFFER_ROWS)];
    const html = (a, b) => browseMatches.slice(a * cols, b * cols).map(cardHTML).join('');
    if (next[0] >= to || next[1] <= from) grid.innerHTML = html(...next);
    else {
      // Keep cards that stay in range so their images are not reloaded.
      const items = (a, b) => Math.min(b * cols, browseMatches.length) - a * cols;
      for (let n = next[0] > from ? items(from, next[0]) : 0; n > 0; n--) grid.firstElementChild.remove();
      for (let n = next[1] < to ? items(next[1], to) : 0; n > 0; n--) grid.lastElementChild.remove();
      if (next[0] < from) grid.insertAdjacentHTML('afterbegin', html(next[0], from));
      if (next[1] > to) grid.insertAdjacentHTML('beforeend', html(to, next[1]));
    }
    grid.style.paddingTop = next[0] * pitch + 'px';
    browseRows = next;
  }
  function closeSearch() { results.hidden = true; search.setAttribute('aria-expanded', 'false'); selectedResult = -1; }
  function showSearch() {
    clearTimeout(searchTimer);
    if (mode === 'browse') { closeSearch(); renderBrowse(); return; }
    const query = search.value.trim();
    if (!query) { closeSearch(); return; }
    renderedQuery = query;
    resultMatches = engine.search(query);
    selectedResult = resultMatches.length ? 0 : -1;
    results.innerHTML = `<div class="search-count"><span>${number(resultMatches.length)} matches · titles, hover text & dialogue</span>${resultMatches.length ? '<button data-all-results>View all →</button>' : ''}</div>` + (resultMatches.length ? resultMatches.slice(0, 10).map((m, i) => {
      const c = comics[m.index];
      return `<button class="search-result${i === 0 ? ' active' : ''}" data-open="${c.num}"><span class="result-heading"><strong>${esc(c.title)}</strong><small>#${c.num}</small></span><span class="match-label">${esc(m.label)}</span><p>${highlight(m.snippet, m.terms)}</p></button>`;
    }).join('') : `<div class="no-results">${/^#?404$/.test(query) ? 'Comic #404 is intentionally absent from xkcd.' : 'No matches. Try fewer keywords, or remove quotation marks to search the words separately.'}</div>`);
    results.insertAdjacentHTML('beforeend', `<p class="search-credit">Comics ${comicCredit()} · Transcripts from ${external('https://www.explainxkcd.com/', 'explain xkcd')}, ${bySA}</p>`);
    results.hidden = false; search.setAttribute('aria-expanded', 'true');
  }
  function openIndex() {
    closeSearch();
    const year = comicOnPage()?.date.slice(0, 4) || years[0];
    $('#tocYear').value = year; renderIndex(); $('#numberMessage').textContent = '';
    $('#tocDialog').showModal();
    requestAnimationFrame(() => $('.toc-item.current')?.scrollIntoView({ block: 'center' }));
  }
  function renderIndex() {
    const year = $('#tocYear').value;
    $('#tocList').innerHTML = comics.filter(c => c.date.startsWith(year)).map(c => `<button class="toc-item${c.num === comicOnPage()?.num ? ' current' : ''}" data-open="${c.num}"><small>#${c.num} · ${dateLabel(c.date)}</small>${esc(c.title)}</button>`).join('');
  }
  function goNumber() {
    const n = Number($('#comicNumber').value);
    if (!byNumber.has(n)) { $('#numberMessage').textContent = n === 404 ? 'Comic #404 is intentionally absent from xkcd.' : `Enter a comic number between 1 and ${D.latestAvailable}.`; return; }
    $('#tocDialog').close(); openComic(n);
  }
  function enlarge(n) {
    const c = comics[byNumber.get(n)]; if (!c?.image) return;
    $('#imageTitle').textContent = `#${c.num} · ${c.title}`;
    $('#fullImage').src = c.image2x || c.image; $('#fullImage').alt = c.title;
    $('#imageAlt').textContent = c.alt; $('#fullImageLink').href = c.image2x || c.image;
    $('#imageCredit').innerHTML = `${comicCredit()} · ${external(c.source, 'Original #' + c.num + ' on xkcd')}`;
    enlarged = c; zoomed = false;
    $('#imageDialog').showModal(); fitImage();
  }
  // Fit shows the whole image as large as the dialog allows (at most 3×, beyond which it only blurs).
  // An image so tall that fitting would shrink it below half size fits its width and scrolls instead.
  function fitImage() {
    const dialog = $('#imageDialog'), view = $('#imageViewport'), img = $('#fullImage'), c = enlarged;
    if (!dialog.open || !c?.width) return;
    img.style.width = img.style.height = '0px'; view.style.maxHeight = '';
    const pad = parseFloat(getComputedStyle(view).paddingLeft);
    let w = view.clientWidth - 2 * pad;
    const h = Math.floor(innerHeight * .94 - (dialog.offsetHeight - view.offsetHeight) - 2 * pad);
    let fit = Math.min(w / c.width, h / c.height, 3);
    if (fit < .5 && c.height / c.width > h / w) { w -= scrollbarWidth(); fit = Math.min(w / c.width, 1); }
    const scale = zoomed ? 1 : fit, differs = Math.abs(fit - 1) > .05;
    img.style.width = Math.floor(c.width * scale) + 'px'; img.style.height = Math.floor(c.height * scale) + 'px';
    view.style.maxHeight = h + 2 * pad + 'px';
    view.classList.toggle('actual', zoomed);
    $('#zoomBtn').hidden = !differs;
    $('#zoomBtn').textContent = zoomed ? 'Fit to window' : 'Actual size';
    img.style.cursor = !differs ? '' : (zoomed ? fit > 1 : fit < 1) ? 'zoom-in' : 'zoom-out';
  }
  // Switching size keeps the clicked point (or the centre) in view.
  function toggleZoom(e) {
    const view = $('#imageViewport'), img = $('#fullImage');
    if ($('#zoomBtn').hidden) return;
    let r = img.getBoundingClientRect();
    const fx = e ? (e.clientX - r.left) / r.width : .5, fy = e ? (e.clientY - r.top) / r.height : .5;
    zoomed = !zoomed; fitImage();
    r = img.getBoundingClientRect(); const v = view.getBoundingClientRect();
    view.scrollLeft += r.left + fx * r.width - (v.left + v.width / 2);
    view.scrollTop += r.top + fy * r.height - (v.top + v.height / 2);
  }
  let scrollbar = null;
  function scrollbarWidth() {
    if (scrollbar == null) { const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;top:-99px;width:99px;height:9px;overflow:scroll'; document.body.append(probe); scrollbar = probe.offsetWidth - probe.clientWidth; probe.remove(); }
    return scrollbar;
  }
  // comic/N/ links carry a preview of that comic; #N links would all preview as the notebook's front page.
  async function share(n, button) {
    const c = comics[byNumber.get(n)], url = `${D.siteUrl}comic/${n}/`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: `xkcd #${n}: ${c.title}`, url }); return; }
      await navigator.clipboard.writeText(url);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (!copyText(url)) { prompt('Copy this link:', url); return; }
    }
    button.textContent = 'Link copied'; $('#announcer').textContent = 'Link copied';
    setTimeout(() => { button.textContent = 'Share'; }, 1800);
  }
  // Pages opened from disk have no clipboard API.
  function copyText(text) {
    const field = Object.assign(document.createElement('textarea'), { value: text });
    field.style.cssText = 'position:fixed;opacity:0'; document.body.append(field); field.select();
    let copied = false; try { copied = document.execCommand('copy'); } catch {}
    field.remove(); return copied;
  }
  function showText(n) {
    const c = comics[byNumber.get(n)];
    const dialog = $('#textDialog');
    $('#textTitle').textContent = `#${c.num} · ${c.title}`;
    const section = (heading, text, credit = '') => `<section class="text-section"><h3>${heading}</h3><p>${esc(text)}</p>${credit}</section>`;
    // explain xkcd's transcripts stay under their own license and link to the page they came from.
    const explained = c.explainTranscript
      ? section('Transcript', c.explainTranscript, `<p class="modal-credit">From ${external(c.explainUrl, 'explain xkcd')}, written by its contributors · ${bySA}</p>`)
      : section('Transcript', 'explain xkcd has no transcript for this comic yet.');
    const official = c.transcript || c.transcriptNote ? section('Official transcript', c.transcript || c.transcriptNote) : '';
    $('#textBody').innerHTML = section('Hover text', c.alt || 'No hover text supplied.') + explained + official;
    $('#textBody').insertAdjacentHTML('beforeend', `<p class="modal-credit">Hover text${official ? ' and official transcript' : ''} from ${external(c.source, 'xkcd #' + c.num + ': ' + c.title)} · ${comicCredit()}</p>`);
    dialog.showModal();
  }

  document.body.insertAdjacentHTML('beforeend', '<dialog id="textDialog" aria-labelledby="textTitle"><form method="dialog" class="dialog-head"><div><span class="eyebrow">Searchable text</span><h2 id="textTitle"></h2></div><button class="close-btn" aria-label="Close text">×</button></form><div id="textBody" class="dialog-body"></div></dialog>');
  $('#brandCount').textContent = `${number(comics.length)} entries · Randall Munroe`;
  $('#coverage').textContent = `${number(comics.length)} entries through #${D.latestAvailable}; ${number(D.counts.localImages)} local images, ${number(D.counts.explainTranscripts)} transcripts from explain xkcd and ${number(D.counts.transcripts)} official transcripts. Archive checked ${D.archiveCheckedAt?.slice(0, 10) || D.generatedAt.slice(0, 10)}.`;
  for (const year of years) { $('#yearFilter').add(new Option(year, year)); $('#tocYear').add(new Option(year, year)); }
  $('#comicNumber').max = D.latestAvailable;
  $('#bookMode').onclick = () => setMode('book'); $('#browseMode').onclick = () => setMode('browse');
  $('#prevBtn').onclick = () => navigate(-1); $('#nextBtn').onclick = () => navigate(1);
  $('#randomBtn').onclick = randomComic;
  $('#tocBtn').onclick = openIndex; $('#aboutBtn').onclick = () => $('#aboutDialog').showModal();
  // Auto follows the system; Light and Dark override it. The page head applies a saved choice before anything is drawn.
  function setTheme(choice) {
    if (choice === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = choice;
    for (const button of $$('[data-theme-choice]')) button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice));
  }
  const savedTheme = storage.get('theme');
  setTheme(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'auto');
  for (const button of $$('[data-theme-choice]')) button.onclick = () => { storage.set('theme', button.dataset.themeChoice); setTheme(button.dataset.themeChoice); };
  host.classList.toggle('framed', turnStyle === 'framed');
  for (const input of $$('input[name="turnStyle"]')) {
    input.checked = input.value === turnStyle;
    input.onchange = () => { turnStyle = input.value; storage.set('turnStyle', turnStyle); host.classList.toggle('framed', turnStyle === 'framed'); };
  }
  $('#tocYear').onchange = renderIndex; $('#numberGo').onclick = goNumber;
  $('#comicNumber').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); goNumber(); } };
  $('#yearFilter').onchange = renderBrowse; $('#sortOrder').onchange = renderBrowse;
  $('#zoomBtn').onclick = () => toggleZoom(); $('#fullImage').onclick = toggleZoom;
  search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(showSearch, 120); };
  // The index is built on the way to the first search, once the focused box has painted.
  search.onfocus = () => { setTimeout(() => engine.build()); if (search.value.trim()) showSearch(); };
  search.onkeydown = e => {
    if (e.key === 'Escape') { closeSearch(); search.blur(); return; }
    if (e.key === 'Enter') {
      e.preventDefault(); clearTimeout(searchTimer);
      if (mode === 'browse') { renderBrowse(); return; }
      if (results.hidden || renderedQuery !== search.value.trim()) showSearch();
      const match = resultMatches[Math.max(0, selectedResult)];
      if (match) { openComic(comics[match.index].num); search.blur(); }
    }
    if (!results.hidden && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      selectedResult = Math.max(0, Math.min(Math.min(10, resultMatches.length) - 1, selectedResult + (e.key === 'ArrowDown' ? 1 : -1)));
      $$('.search-result', results).forEach((el, i) => el.classList.toggle('active', i === selectedResult));
      $$('.search-result', results)[selectedResult]?.scrollIntoView({ block: 'nearest' });
    }
  };
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) closeSearch();
    const target = e.target.closest('[data-open],[data-page],[data-random],[data-query],[data-dialog],[data-zoom],[data-text],[data-share],[data-all-results]');
    if (!target || target.closest('[inert]')) return;
    if (target.hasAttribute('data-open')) { target.closest('dialog')?.close(); openComic(target.dataset.open); }
    else if (target.hasAttribute('data-page')) goTo(Number(target.dataset.page));
    else if (target.hasAttribute('data-random')) randomComic();
    else if (target.hasAttribute('data-query')) { search.value = target.dataset.query; search.focus(); showSearch(); }
    else if (target.hasAttribute('data-dialog')) { if (target.dataset.dialog === 'tocDialog') openIndex(); }
    else if (target.hasAttribute('data-zoom')) enlarge(Number(target.dataset.zoom));
    else if (target.hasAttribute('data-text')) showText(Number(target.dataset.text));
    else if (target.hasAttribute('data-share')) share(Number(target.dataset.share), target);
    else if (target.hasAttribute('data-all-results')) setMode('browse');
  });
  // A click, tap or drag in the outer 30% of a page turns back on the left and forward on the right.
  // Links, buttons and the middle of the page are left alone.
  function sideOf(e) {
    if (mode !== 'book' || e.button !== 0 || e.target.closest('button,a,summary')) return 0;
    const r = host.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, direction = x < .3 ? -1 : x > .7 ? 1 : 0;
    return page + direction < 0 || page + direction > lastPage ? 0 : direction;
  }
  host.addEventListener('mousedown', e => {
    if (!flip || !sideOf(e)) { e.stopPropagation(); return; }
    // A press during a turn finishes that turn first, so quick clicks never run past the mounted pages.
    const turning = flip.getState() !== 'read';
    if (turning) flip.getRender().finishAnimation();
    const direction = sideOf(e);
    // The book is then rebuilt around the current page, facing the way this press needs, and the new book takes over the press.
    e.stopPropagation(); e.preventDefault();
    if (!direction) return;
    mountBook(mirrorFor(direction)); flip.startUserTouch(flip.getUI().getMousePos(e.clientX, e.clientY));
  }, { capture: true });
  // Swipes are handled here rather than by the library, so tall pages still scroll vertically.
  let touch = null, suppressUntil = 0;
  host.addEventListener('touchstart', e => {
    e.stopPropagation(); touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { capture: true, passive: true });
  host.addEventListener('touchmove', e => {
    e.stopPropagation(); if (!touch || e.touches.length !== 1) { touch = null; return; }
    const dx = e.touches[0].clientX - touch.x, dy = e.touches[0].clientY - touch.y;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5 && e.cancelable) e.preventDefault();
  }, { capture: true, passive: false });
  host.addEventListener('touchend', e => {
    e.stopPropagation(); const start = touch; touch = null;
    if (!start || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      suppressUntil = Date.now() + 450; if (e.cancelable) e.preventDefault(); navigate(dx < 0 ? 1 : -1);
    }
  }, { capture: true, passive: false });
  host.addEventListener('touchcancel', () => { touch = null; });
  host.addEventListener('click', e => { if (Date.now() < suppressUntil) { e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true });
  // Missing or manually removed files leave a working path to the official comic.
  document.addEventListener('error', e => {
    const image = e.target;
    // A copy without images/2x still has the standard file.
    if (image.id === 'fullImage' && enlarged?.image2x && image.getAttribute('src') === enlarged.image2x) { image.src = enlarged.image; return; }
    if (!image.matches?.('.comic-image')) return;
    if (image.hasAttribute('srcset')) { image.removeAttribute('srcset'); return; }
    // Neighbouring pages are mounted too, so link the failed image's own comic, not the visible one.
    const own = comics[byNumber.get(Number(image.closest('[data-zoom]')?.dataset.zoom))];
    if (image.closest('.comic-frame')) image.closest('.comic-frame').innerHTML = `<div class="interactive-note">This image could not be loaded.<br>${external(own?.source || D.source, 'Read on xkcd')}</div>`;
    else { image.hidden = true; image.parentElement.insertAdjacentHTML('beforeend', '<span class="no-preview">Open comic →</span>'); }
  }, true);
  document.addEventListener('keydown', e => {
    if ($('dialog[open]') || e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (e.key === '/') { e.preventDefault(); search.focus(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navigate(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); navigate(-1); }
    else if (e.key.toLowerCase() === 'b') setMode('book');
    else if (e.key.toLowerCase() === 'g') setMode('browse');
    else if (e.key.toLowerCase() === 'r') randomComic();
    else if (e.key.toLowerCase() === 'i') openIndex();
    else if (mode === 'book' && e.key === 'Home') goTo(0);
    else if (mode === 'book' && e.key === 'End') goTo(lastPage);
  });
  for (const dialog of $$('dialog')) dialog.addEventListener('click', e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  });
  window.addEventListener('hashchange', () => goTo(fromHash(), { history: false }));
  window.addEventListener('popstate', () => goTo(fromHash(), { history: false }));
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (mode === 'book') mountBook(); else placeBrowse(); fitImage(); }, 140); });
  // Scroll events already arrive once per frame; placing rows here fills them in before that frame paints.
  addEventListener('scroll', () => { if (mode === 'browse') placeBrowse(); }, { passive: true });
  mountBook(); syncUI();
})();
