/**
 * Tests for presentation (slide deck) mutation semantics (6.3E)
 * Tests the slide data structures and mutation operations in isolation
 * (without starting the HTTP server) using the same logic as the gateway routes.
 *
 * Run from gateway/ dir: node lib/__tests__/presentation-mutation.test.mjs
 */

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg || 'expected equality'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  }
}
function assertNotNull(v, msg) { if (v == null) throw new Error(msg || 'expected non-null'); }

// ── Pure mutation helpers (mirroring gateway route logic) ──

function makeSlide(id, title = '') {
  return {
    id,
    elements: [
      { type: 'textbox', left: 60, top: 40, width: 840, height: 60, text: title, fontSize: 36 },
    ],
    background: '#ffffff',
    notes: '',
  };
}

function makeDeck(...slides) {
  return { slides };
}

/** Find slide by id */
function findSlideIdx(deck, slideId) {
  return deck.slides.findIndex(s => s.id === slideId);
}

/** Reorder slides given a slide_id_order array */
function reorderSlides(deck, slideIdOrder) {
  const slideMap = new Map(deck.slides.map(s => [s.id, s]));
  const reordered = slideIdOrder.map(sid => slideMap.get(sid)).filter(Boolean);
  const mentioned = new Set(slideIdOrder);
  for (const s of deck.slides) {
    if (!mentioned.has(s.id)) reordered.push(s);
  }
  return { ...deck, slides: reordered };
}

/** Delete slide by id */
function deleteSlideById(deck, slideId) {
  const idx = findSlideIdx(deck, slideId);
  if (idx === -1) throw new Error(`SLIDE_NOT_FOUND: ${slideId}`);
  const slides = [...deck.slides];
  slides.splice(idx, 1);
  return { deck: { ...deck, slides }, deletedIdx: idx };
}

/** Update slide by id */
function updateSlideById(deck, slideId, patch) {
  const idx = findSlideIdx(deck, slideId);
  if (idx === -1) throw new Error(`SLIDE_NOT_FOUND: ${slideId}`);
  const slides = [...deck.slides];
  slides[idx] = { ...slides[idx], ...patch, id: slideId }; // preserve id
  return { ...deck, slides };
}

/** Insert element into slide */
function insertSlideElement(deck, slideId, element, afterIndex = null) {
  const idx = findSlideIdx(deck, slideId);
  if (idx === -1) throw new Error(`SLIDE_NOT_FOUND: ${slideId}`);
  const slides = [...deck.slides];
  const slide = { ...slides[idx] };
  const elements = [...(slide.elements || [])];
  const insertAt = afterIndex !== null ? Math.min(afterIndex + 1, elements.length) : elements.length;
  elements.splice(insertAt, 0, element);
  slides[idx] = { ...slide, elements };
  return { deck: { ...deck, slides }, elementIndex: insertAt };
}

/** Delete element from slide */
function deleteSlideElement(deck, slideId, elementIndex) {
  const idx = findSlideIdx(deck, slideId);
  if (idx === -1) throw new Error(`SLIDE_NOT_FOUND: ${slideId}`);
  const slides = [...deck.slides];
  const slide = { ...slides[idx] };
  const elements = [...(slide.elements || [])];
  if (elementIndex < 0 || elementIndex >= elements.length) throw new Error('ELEMENT_NOT_FOUND');
  elements.splice(elementIndex, 1);
  slides[idx] = { ...slide, elements };
  return { ...deck, slides };
}

// ── Tests: list_slides / read_slide ──

test('list_slides: returns slide_id and metadata for each slide', () => {
  const deck = makeDeck(makeSlide('slide-1', 'Intro'), makeSlide('slide-2', 'Body'));
  const listed = deck.slides.map((s, idx) => ({
    index: idx,
    slide_id: s.id,
    element_count: s.elements.length,
  }));
  assertEq(listed.length, 2);
  assertEq(listed[0].slide_id, 'slide-1');
  assertEq(listed[1].slide_id, 'slide-2');
});

test('read_slide: finds slide by stable slide_id', () => {
  const deck = makeDeck(makeSlide('s-a'), makeSlide('s-b'), makeSlide('s-c'));
  const idx = findSlideIdx(deck, 's-b');
  assertEq(idx, 1, 'slide-b is at index 1');
  assertEq(deck.slides[idx].id, 's-b');
});

test('read_slide: returns NOT_FOUND for unknown slide_id', () => {
  const deck = makeDeck(makeSlide('s-1'));
  const idx = findSlideIdx(deck, 'ghost');
  assertEq(idx, -1, 'unknown slide returns -1');
});

// ── Tests: add_slide / delete_slide ──

test('add_slide: appends new slide to deck', () => {
  const deck = makeDeck(makeSlide('s-1'));
  const newSlide = makeSlide('s-2', 'New Slide');
  const updated = { ...deck, slides: [...deck.slides, newSlide] };
  assertEq(updated.slides.length, 2);
  assertEq(updated.slides[1].id, 's-2');
});

test('delete_slide: removes correct slide, others intact', () => {
  const deck = makeDeck(makeSlide('s-1', 'A'), makeSlide('s-2', 'B'), makeSlide('s-3', 'C'));
  const { deck: result, deletedIdx } = deleteSlideById(deck, 's-2');
  assertEq(result.slides.length, 2, 'two slides remain');
  assertEq(result.slides[0].id, 's-1', 's-1 intact');
  assertEq(result.slides[1].id, 's-3', 's-3 intact');
  assertEq(deletedIdx, 1);
});

test('delete_slide: throws SLIDE_NOT_FOUND for unknown id', () => {
  const deck = makeDeck(makeSlide('s-1'));
  try {
    deleteSlideById(deck, 'ghost');
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.message.includes('SLIDE_NOT_FOUND'), `expected SLIDE_NOT_FOUND, got: ${e.message}`);
  }
});

test('delete_slide: slide_ids on remaining slides are stable', () => {
  const deck = makeDeck(makeSlide('s-1'), makeSlide('s-2'), makeSlide('s-3'));
  const { deck: result } = deleteSlideById(deck, 's-1');
  assertEq(result.slides[0].id, 's-2', 's-2 id unchanged');
  assertEq(result.slides[1].id, 's-3', 's-3 id unchanged');
});

// ── Tests: reorder_slides ──

test('reorder_slides: reorders slides by slide_id_order', () => {
  const deck = makeDeck(makeSlide('s-1'), makeSlide('s-2'), makeSlide('s-3'));
  const result = reorderSlides(deck, ['s-3', 's-1', 's-2']);
  assertEq(result.slides[0].id, 's-3');
  assertEq(result.slides[1].id, 's-1');
  assertEq(result.slides[2].id, 's-2');
});

test('reorder_slides: slides not in order list are appended at end', () => {
  const deck = makeDeck(makeSlide('s-1'), makeSlide('s-2'), makeSlide('s-3'));
  const result = reorderSlides(deck, ['s-2']); // only mention s-2
  assertEq(result.slides[0].id, 's-2');
  // s-1 and s-3 appended in original order
  assert(result.slides.length === 3, 'all slides preserved');
});

test('reorder_slides: count unchanged', () => {
  const deck = makeDeck(makeSlide('a'), makeSlide('b'), makeSlide('c'));
  const result = reorderSlides(deck, ['c', 'b', 'a']);
  assertEq(result.slides.length, 3, 'same slide count');
});

// ── Tests: update_slide_element / insert_slide_element / delete_slide_element ──

test('update_slide_element: patches element text without affecting other elements', () => {
  const deck = makeDeck({
    id: 's-1',
    elements: [
      { type: 'textbox', text: 'Title', fontSize: 36 },
      { type: 'textbox', text: 'Body', fontSize: 20 },
    ],
    background: '#fff',
    notes: '',
  });
  const idx = findSlideIdx(deck, 's-1');
  const slides = [...deck.slides];
  const slide = { ...slides[idx] };
  const elements = [...slide.elements];
  elements[0] = { ...elements[0], text: 'Updated Title' };
  slides[idx] = { ...slide, elements };
  const result = { ...deck, slides };

  assertEq(result.slides[0].elements[0].text, 'Updated Title');
  assertEq(result.slides[0].elements[1].text, 'Body', 'element 1 unchanged');
  assertEq(result.slides[0].elements[0].fontSize, 36, 'fontSize preserved');
});

test('insert_slide_element: appends element to slide', () => {
  const deck = makeDeck({
    id: 's-1',
    elements: [{ type: 'textbox', text: 'A' }],
    background: '#fff',
    notes: '',
  });
  const { deck: result, elementIndex } = insertSlideElement(deck, 's-1', { type: 'shape', shapeType: 'circle' });
  assertEq(result.slides[0].elements.length, 2);
  assertEq(result.slides[0].elements[1].type, 'shape');
  assertEq(elementIndex, 1);
});

test('insert_slide_element: inserts at after_index position', () => {
  const deck = makeDeck({
    id: 's-1',
    elements: [
      { type: 'textbox', text: 'First' },
      { type: 'textbox', text: 'Third' },
    ],
    background: '#fff',
    notes: '',
  });
  const { deck: result } = insertSlideElement(deck, 's-1', { type: 'textbox', text: 'Second' }, 0);
  assertEq(result.slides[0].elements[0].text, 'First');
  assertEq(result.slides[0].elements[1].text, 'Second');
  assertEq(result.slides[0].elements[2].text, 'Third');
});

test('delete_slide_element: removes element, others intact', () => {
  const deck = makeDeck({
    id: 's-1',
    elements: [
      { type: 'textbox', text: 'Keep' },
      { type: 'textbox', text: 'Delete' },
      { type: 'shape', shapeType: 'circle' },
    ],
    background: '#fff',
    notes: '',
  });
  const result = deleteSlideElement(deck, 's-1', 1);
  assertEq(result.slides[0].elements.length, 2);
  assertEq(result.slides[0].elements[0].text, 'Keep');
  assertEq(result.slides[0].elements[1].shapeType, 'circle');
});

test('delete_slide_element: throws ELEMENT_NOT_FOUND for out-of-range index', () => {
  const deck = makeDeck({
    id: 's-1',
    elements: [{ type: 'textbox', text: 'Only' }],
    background: '#fff',
    notes: '',
  });
  try {
    deleteSlideElement(deck, 's-1', 5);
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.message.includes('ELEMENT_NOT_FOUND'), `got: ${e.message}`);
  }
});

// ── Human edits slide A, agent edits slide B — no overlap ──

test('isolation: agent edit of slide B does not affect slide A (human-edited)', () => {
  const originalSlideA = makeSlide('s-A', 'Human slide A');
  const deck = makeDeck(originalSlideA, makeSlide('s-B', 'Agent slide B'));

  // Agent updates only slide B
  const agentResult = updateSlideById(deck, 's-B', { notes: 'Added by agent' });

  // Slide A must be exactly as before
  assertEq(
    JSON.stringify(agentResult.slides[0]),
    JSON.stringify(originalSlideA),
    'slide A unchanged after agent edit of slide B',
  );
  assertEq(agentResult.slides[1].notes, 'Added by agent', 'slide B updated');
});

console.log(`\n[presentation-mutation] ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
