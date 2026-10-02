const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ComicSearch } = require('../search.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'comics.js'), 'utf8').replace(/^window\.XKCD_DATA=/, '').replace(/;\s*$/, ''));
const comics = data.comics, search = new ComicSearch(comics);
const results = q => search.search(q).map(r => comics[r.index].num);
assert.equal(new Set(comics.map(c => c.num)).size, comics.length);
assert.equal(comics.length, data.latestAvailable - 1);
assert.deepEqual(data.missing, []);
assert.ok(!comics.some(c => c.num === 404));
assert.equal(results('python')[0], 353);
assert.deepEqual(results('#353'), [353]);
assert.deepEqual(results('#404'), []);
assert.ok(results('correct horse battery staple').includes(936));
assert.ok(results('"sudo make me a sandwich"').includes(149));
assert.ok(results('orbital mechanics').includes(1356));
assert.ok(comics.every(c => !('ocr' in c) && !('ocrStatus' in c)), 'No OCR text is published');
assert.equal(comics.find(c => c.num === 1838).transcript, '');
assert.equal(results('stir the pile')[0], 1838, 'Remembered dialogue is found in the explain xkcd transcript alone');
assert.equal(search.search('stir the pile')[0].label, 'Transcript');
assert.ok(results('beret guy').length > 50, 'explain xkcd transcripts name the recurring characters');
assert.ok(data.counts.explainTranscripts > 3250 && data.counts.explainTranscripts === comics.filter(c => c.explainTranscript).length);
for (const c of comics) {
  // Each explain xkcd transcript must link to the page it came from (CC BY-SA attribution).
  if (c.explainTranscript) assert.match(c.explainUrl, new RegExp(`^https://www\\.explainxkcd\\.com/wiki/index\\.php/${c.num}:_`), `#${c.num} links its transcript source`);
  else assert.equal(c.explainUrl, '');
  assert.ok(!/\{\{\s*incomplete transcript|\[\[File:|<br\s*\/?>|'''/i.test(c.explainTranscript), `#${c.num} transcript has no wiki markup left`);
}
assert.ok(results('eletric').includes(3214), 'One-letter spelling tolerance');
assert.ok(results('2005-09').every(n => comics.find(c => c.num === n).date.startsWith('2005-09')));
assert.deepEqual(results('zzzxxyynonexistent'), []);
assert.deepEqual(results('"correct staple horse battery"'), [], 'Quoted words must be contiguous and in order');
const fixture = new ComicSearch([
  { num: 1, date: '2020-01-01', title: 'First', alt: 'amber', transcript: 'violet telescopes' },
  { num: 2, date: '2020-01-02', title: 'Second', alt: 'amber', transcript: 'Only amber' },
]);
assert.equal(fixture.search('amber telescopes').length, 1, 'AND keywords can span hover text and transcript');
assert.equal(fixture.search('violet')[0].label, 'Transcript');
assert.equal(fixture.search('"violet telescopes"')[0].index, 0);
const both = new ComicSearch([
  { num: 1, date: '2010-01-01', title: 'Old', alt: '', transcript: 'a violet tree', explainTranscript: '[Cueball:] a violet tree' },
  { num: 2, date: '2020-01-01', title: 'New', alt: '', transcript: '', explainTranscript: '[Cueball:] a violet tree' },
]).search('violet');
assert.equal(both[0].score, both[1].score, 'A comic with both transcripts scores no higher than one with explain xkcd only');
for (const c of comics) {
  if (c.image) assert.ok(fs.existsSync(path.join(__dirname, '..', c.image)), `Local image #${c.num} exists`);
  if (c.image2x) assert.ok(fs.existsSync(path.join(__dirname, '..', c.image2x)), `2x image #${c.num} exists`);
  // Link previews read the per-comic share page; its image must be a published file.
  const share = fs.readFileSync(path.join(__dirname, '..', 'comic', String(c.num), 'index.html'), 'utf8');
  const shown = share.match(/og:image" content="([^"]+)"/);
  if (c.image) assert.ok(shown && [c.image, c.image2x].map(p => data.siteUrl + p).includes(shown[1]), `Share page #${c.num} previews its own image`);
}
console.log(`PASS: ${comics.length} entries, image files, keyword combinations, quotes, spelling tolerance, dates, comic numbers and transcript sources (${data.counts.explainTranscripts} from explain xkcd).`);
