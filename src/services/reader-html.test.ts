import assert from 'node:assert/strict';
import test from 'node:test';
import { stripLeadingChapterHeading, leadingHeadLabel, leadingHeadNote, leadingHeadTitle } from './reader-html';

test('Agamennone title comes from the XML heading, independently of stale DB metadata', () => {
  const html = '<div><h3><span class="head-label">CAPITOLO I.</span><em>I più antichi Sismoscopî.</em></h3><p>Text.</p></div>';
  const databaseTitle = 'CAPITOLO I. I più antichi Sismoscopî.';
  const title = leadingHeadTitle(html) || databaseTitle;
  assert.equal(title, 'I più antichi Sismoscopî.');
  assert.equal(leadingHeadLabel(html), 'CAPITOLO I.');
  assert.equal(stripLeadingChapterHeading(html, title), '<div><p>Text.</p></div>');
});

test('XML title excludes notes and falls back when no leading title exists', () => {
  assert.equal(leadingHeadTitle('<div><h2>New <em>title</em><button class="note"><sup>3</sup></button></h2><p>Body.</p></div>'), 'New title');
  assert.equal(leadingHeadTitle('<div><p>Body.</p><h2>Later heading</h2></div>'), '');
  assert.equal(leadingHeadTitle('<div><h2><span class="head-label">IV</span></h2></div>'), '');
});

test('removes a matching TEI heading from the start of chapter HTML', () => {
  const html = '<div type="div3">\n   <h3>Slutul se însoară cu zeiţa frumuseţii</h3>\n   <p>Textul începe aici.</p>\n</div>';
  assert.equal(
    stripLeadingChapterHeading(html, 'Slutul se însoară cu zeiţa frumuseţii'),
    '<div type="div3">\n   <p>Textul începe aici.</p>\n</div>',
  );
});

test('does not remove a non-matching or non-leading heading', () => {
  const html = '<div><p>Prefaţă.</p><h3>Slutul se însoară cu zeiţa frumuseţii</h3></div>';
  assert.equal(stripLeadingChapterHeading(html, 'Slutul se însoară cu zeiţa frumuseţii'), html);
  assert.equal(stripLeadingChapterHeading('<div><h3>Alt titlu</h3><p>Text</p></div>', 'Slutul'), '<div><h3>Alt titlu</h3><p>Text</p></div>');
});

test('removes a heading whose sur-title label makes the visible text differ from the TOC title', () => {
  // teidiv2html.xsl renders the heading's label as a head-label span; the
  // TOC head carries the title without it - "Fuga" titles "IV Fuga".
  const html = '<div type="div2">\n   <h2>\n      <span class="head-label">IV</span> Fuga</h2>\n   <div class="lg"><p class="l">Vers.</p></div>\n</div>';
  assert.equal(
    stripLeadingChapterHeading(html, 'Fuga'),
    '<div type="div2">\n   <div class="lg"><p class="l">Vers.</p></div>\n</div>',
  );
  // A TOC head that carries the label itself still matches the full text.
  assert.equal(stripLeadingChapterHeading(html, 'IV Fuga'), '<div type="div2">\n   <div class="lg"><p class="l">Vers.</p></div>\n</div>');
});

test('leadingHeadLabel extracts the leading heading\'s sur-title label', () => {
  assert.equal(leadingHeadLabel('<div><h2><span class="head-label">IV</span> Fuga</h2><p>x</p></div>'), 'IV');
  assert.equal(leadingHeadLabel('<div><h3>Plain heading</h3><p>x</p></div>'), '');
  // Not leading: visible prose before the heading - the label stays with it.
  assert.equal(leadingHeadLabel('<div><p>Preface text.</p><h2><span class="head-label">IV</span> Fuga</h2></div>'), '');
});

test('removes a heading that differs from the TOC title only in footnote-ref spacing', () => {
  // Calvin's letters: the heading carries a footnote ref rendered with a
  // trailing space ("CXXXII.—To Viret. [490]"), the TOC head without one
  // ("CXXXII.—To Viret.[490]") - same heading, must still be stripped.
  const html = '<div type="div3">\n   <h3>CXXXII.—To Viret.<ref target="#Footnote_490_490">[490]</ref> </h3>\n   <p class="subtitle">Journey of Calvin in Switzerland.</p>\n</div>';
  assert.equal(
    stripLeadingChapterHeading(html, 'CXXXII.—To Viret.[490]'),
    '<div type="div3">\n   <p class="subtitle">Journey of Calvin in Switzerland.</p>\n</div>',
  );
});

test('removes a heading differing from the TOC title in footnote/punctuation form', () => {
  // Sabatier's sources study: TOC title "II. First Life by Thomas of
  // Celano7" (ref text glued on), a cached/older heading rendering
  // "II. First Life by Thomas of Celano. <ref>7</ref>" - same heading.
  const html = '<div type="div4">\n   <h4>II. First Life by Thomas of Celano. <ref target="#Footnote_7_632">[7]</ref> </h4>\n   <p class="justify">Thomas of Celano, in writing this legend.</p>\n</div>';
  assert.equal(
    stripLeadingChapterHeading(html, 'II. First Life by Thomas of Celano7'),
    '<div type="div4">\n   <p class="justify">Thomas of Celano, in writing this legend.</p>\n</div>',
  );
});

test('removes a duplicated heading even when it carries a footnote button whose visible number would otherwise block the match', () => {
  // A TEI <note> (not <ref>) footnote right after the title renders as a
  // .note button with a visible <sup> number (teidiv2html.xsl) - unlike a
  // <ref>, that number never makes it into the extracted head/TOC title
  // (the server strips <note> subnodes before building it), so comparing
  // raw visible text left a trailing "416" that never matched "Res
  // angusta" and the heading went unstripped, duplicating the title.
  // leadingHeadNote (below) is what pulls the footnote marker itself back
  // out before this runs - ReaderView renders it next to its own title.
  const html = '<div type="div4">\n   <h4>\n      <span class="head-label">Chapitre VI</span>\n      <em>Res angusta</em>\n      <em><em><button type="button" class="btn note" title="Footnote text"><sup>416</sup></button></em></em>\n   </h4>\n   <p class="justify">Cette soirée laissa à Marius un ébranlement profond.</p>\n</div>';
  assert.equal(
    stripLeadingChapterHeading(html, 'Res angusta'),
    '<div type="div4">\n   <p class="justify">Cette soirée laissa à Marius un ébranlement profond.</p>\n</div>',
  );
});

test('leadingHeadNote extracts the leading heading\'s footnote marker', () => {
  const html = '<div type="div4">\n   <h4>\n      <span class="head-label">Chapitre VI</span>\n      <em>Res angusta</em>\n      <em><em><button type="button" class="btn note" title="Footnote text"><sup>416</sup></button></em></em>\n   </h4>\n   <p class="justify">Text.</p>\n</div>';
  assert.equal(leadingHeadNote(html), '<button type="button" class="btn note" title="Footnote text"><sup>416</sup></button>');
  // No note at all.
  assert.equal(leadingHeadNote('<div><h3>Plain heading</h3><p>x</p></div>'), '');
  // Not leading: visible prose before the heading - nothing is pulled out.
  assert.equal(
    leadingHeadNote('<div><p>Preface.</p><h4><button type="button" class="btn note" title="t"><sup>1</sup></button></h4></div>'),
    '',
  );
});
