/* Local, weighted keyword search. No network service and no generated descriptions. */
(function (root) {
  'use strict';
  const normalize = text => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = text => normalize(text).split(' ').filter(Boolean);
  // xkcd's own transcript and explain xkcd's mostly repeat each other, so they count once: whichever matches better.
  const fields = [ ['title', 'Title', 12], ['alt', 'Hover text', 5], ['transcript', 'Transcript', 4, 'transcript'], ['explainTranscript', 'Transcript', 4, 'transcript'] ];
  const stopwords = new Set('a an the and or of to in on at is it for with about comic xkcd where that this was i remember something'.split(' '));
  function oneEdit(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, errors = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++errors > 1) return false;
      if (a.length <= b.length) j++;
      if (a.length >= b.length) i++;
    }
    return errors + Number(i < a.length || j < b.length) <= 1;
  }
  class ComicSearch {
    constructor(comics) {
      this.comics = comics;
      this.documents = comics.map(c => fields.map(([key]) => normalize(c[key])));
      this.index = new Map();
      comics.forEach((c, i) => {
        const tokens = new Set(words(this.documents[i].join(' ') + ' ' + c.date + ' ' + c.num));
        for (const token of tokens) {
          if (!this.index.has(token)) this.index.set(token, new Set());
          this.index.get(token).add(i);
        }
      });
      this.vocabulary = [...this.index.keys()];
      this.cache = new Map();
    }
    search(query) {
      query = query.trim();
      if (this.cache.has(query)) return this.cache.get(query);
      const put = result => { if (this.cache.size > 40) this.cache.clear(); this.cache.set(query, result); return result; };
      if (!query) return put(this.comics.map((_, index) => ({ index, score: 0, label: '', snippet: '', terms: [] })));
      if (/^#?\d+$/.test(query)) {
        const number = Number(query.replace('#', ''));
        const index = this.comics.findIndex(c => c.num === number);
        const direct = index < 0 ? [] : [{ index, score: 1000, label: 'Comic number', snippet: this.comics[index].title, terms: [] }];
        // A bare year is also useful, while #2005 always means the comic number.
        if (!query.startsWith('#') && number >= 2005 && number <= 2100) {
          this.comics.forEach((c, i) => { if (c.date.startsWith(query) && i !== index) direct.push({ index: i, score: 1, label: 'Publication year', snippet: c.date, terms: [query] }); });
        }
        return put(direct);
      }
      if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(query)) {
        return put(this.comics.flatMap((c, index) => c.date.startsWith(query) ? [{ index, score: 100, label: 'Publication date', snippet: c.date, terms: [query] }] : []));
      }
      const phrases = [...query.matchAll(/"([^"]+)"/g)].map(m => normalize(m[1])).filter(Boolean);
      const remainder = words(query.replace(/"[^"]+"/g, ' '));
      let tokens = [...new Set(remainder.filter(t => !stopwords.has(t)))];
      if (!tokens.length && !phrases.length) tokens = [...new Set(remainder)];
      if (!tokens.length && !phrases.length) return put([]);
      const groups = [...tokens.map(token => {
        const variants = [token];
        // Prefix matching catches remembered word stems and plurals.
        if (token.length >= 3) this.vocabulary.forEach(word => {
          if (word !== token && word.startsWith(token)) variants.push(word);
        });
        const found = new Set(variants.flatMap(word => [...(this.index.get(word) || [])]));
        return { token, variants, found, fuzzy: false };
      }), ...phrases.map(phrase => ({ token: phrase, variants: [phrase],
        found: new Set(this.documents.flatMap((doc, index) => doc.some(t => (' ' + t + ' ').includes(' ' + phrase + ' ')) ? [index] : [])), fuzzy: false }))];
      const intersect = () => {
        const sorted = [...groups].sort((a, b) => a.found.size - b.found.size);
        return sorted.length ? [...sorted[0].found].filter(i => sorted.every(g => g.found.has(i))) : [];
      };
      let candidates = intersect();
      // Only broaden spelling when the exact keyword combination found nothing.
      if (!candidates.length && tokens.length) {
        for (const group of groups.slice(0, tokens.length)) {
          if (group.token.length < 4) continue;
          const similar = this.vocabulary.filter(word => oneEdit(group.token, word));
          for (const word of similar) {
            if (!group.variants.includes(word)) group.variants.push(word);
            for (const i of this.index.get(word)) group.found.add(i);
          }
          group.fuzzy = true;
        }
        candidates = intersect();
      }
      const result = candidates.map(index => {
        const comic = this.comics[index], doc = this.documents[index];
        let best = -1, bestValue = 0;
        const matchedTerms = new Set(), scores = {};
        doc.forEach((text, f) => {
          const padded = ' ' + text + ' ';
          let value = 0;
          for (const group of groups) {
            const match = group.variants.find(word => padded.includes(' ' + word + ' '));
            if (match) {
              value += fields[f][2] * (match === group.token ? 2 : 1);
              matchedTerms.add(match);
            }
          }
          const phrase = normalize(query.replaceAll('"', ''));
          if (phrase && padded.includes(' ' + phrase + ' ')) value += fields[f][2] * 3;
          const group = fields[f][3] || fields[f][0];
          scores[group] = Math.max(scores[group] || 0, value);
          if (value > bestValue) { bestValue = value; best = f; }
        });
        const score = Object.values(scores).reduce((a, b) => a + b, 0);
        const raw = best < 0 ? comic.date : String(comic[fields[best][0]] || '').replace(/\s+/g, ' ');
        const terms = [...matchedTerms];
        const hit = Math.min(...terms.map(t => raw.toLowerCase().indexOf(t)).filter(n => n >= 0));
        const start = Number.isFinite(hit) ? Math.max(0, hit - 55) : 0;
        const snippet = (start ? '…' : '') + raw.slice(start, start + 210) + (raw.length > start + 210 ? '…' : '');
        return { index, score, label: best < 0 ? 'Date' : fields[best][1], snippet, terms };
      }).sort((a, b) => b.score - a.score || this.comics[a.index].num - this.comics[b.index].num);
      return put(result);
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { ComicSearch, normalize };
  else root.ComicSearch = ComicSearch;
})(typeof window === 'undefined' ? globalThis : window);
