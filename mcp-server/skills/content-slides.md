# Content: Presentations (Slides)

Reference for working with aose presentations. Assumes you've read `00-role-and-principles.md`, `01-typical-tasks.md`, `02-platform-overview.md`, and `03-events-and-collaboration.md`.

## What It Is

Presentations are slide decks built from structured JSON. Each slide is an array of positioned elements (textboxes, shapes, images, tables) laid out on a 960×540 pixel canvas. A deck is an ordered list of slides, each with an optional background color or image and speaker notes.

Unlike documents (which are Markdown strings), slides are **not free-form text** — they're positioned elements with coordinates, sizes, and styling. You build them by constructing the JSON data structure.

## When to Use

Create a presentation when:

- The content will be **presented live** to an audience, with narrative pacing slide-by-slide.
- You need visual emphasis: diagrams, key numbers, flow between ideas.
- The human explicitly asks for "slides", "a deck", "a presentation", or names a context like a pitch or review.

Don't create a presentation when:

- The content is for reading (not presenting) — that's a document.
- There's a lot of text per "slide" — if each slide would be a wall of text, you want a document.
- The audience is "someone will read this later by themselves" — that's almost always a document.
- You're tempted to use slides because they look more "professional" — professionalism comes from matching format to purpose, not from using slides.

## Typical Patterns

### Pattern 1: Create a new deck from an outline

The human asks for a deck on topic X. You decide the slide sequence, build each slide, and report.

1. Plan the narrative: title → context → main points (one per slide) → summary / next steps.
2. For each slide, build the `elements` array: a title textbox, content elements, optional shapes.
3. Add speaker notes to every slide.
4. Create the presentation with the full slides array.
5. Report: title of the deck, number of slides, one-line outline.

### Pattern 2: Update a single slide

The human says "fix slide 3" or comments on a specific slide.

1. Call `list_slides(deck_id)` to get slide IDs and their content previews.
2. Identify the target slide by its `slide_id` (stable across reorders) or index.
3. Call `read_slide(deck_id, slide_id)` to get the full slide content.
4. Compute the updated elements.
5. Call `update_slide(deck_id, slide_id, patch)` to write only that slide.
6. Report which slide changed and what.

Use the `slide_id` field, not the array index. Index-based access breaks when slides are reordered.
Do **not** rebuild the whole deck to change one slide.

### Pattern 3: Add speaker notes to an existing deck

Speaker notes live in the `notes` field of each slide. Common request: "add speaker notes to the deck."

1. Read the deck.
2. For each slide, fill in the `notes` field. Notes should explain what to say, key numbers to emphasize, or context the visual doesn't convey.
3. Write the deck back.
4. Report done.

## Slide Structure

A slide is a JSON object:

```json
{
  "elements": [...],         // positioned elements
  "background": "#ffffff",   // background color (hex)
  "backgroundImage": null,   // optional image URL
  "notes": ""                // speaker notes (plain text)
}
```

A presentation is an array of slides, in order.

## Element Types

### Textbox

```json
{
  "type": "textbox",
  "left": 100, "top": 50,
  "width": 400, "height": 60,
  "text": "Your text here",
  "fontSize": 24,
  "fontFamily": "Inter",
  "fontWeight": "normal",
  "fontStyle": "normal",
  "textAlign": "left",
  "fill": "#1f2937",
  "opacity": 1,
  "angle": 0
}
```

Text properties:
- `fontSize`: 10–200px. Common sizes: 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96.
- `fontFamily`: Inter, Arial, Georgia, Times New Roman, Courier New, Verdana, Trebuchet MS, Comic Sans MS, Noto Sans SC, Noto Serif SC, Microsoft YaHei, PingFang SC.
- `fontWeight`: `"normal"` or `"bold"`.
- `fontStyle`: `"normal"` or `"italic"`.
- `underline`: `true` / `false`.
- `linethrough`: `true` / `false`.
- `textAlign`: `"left"` / `"center"` / `"right"` / `"justify"`.
- `lineHeight`: multiplier (default 1.3).
- `charSpacing`: character spacing in px.
- `padding`: inner padding in px.

### Shape (24 types)

```json
{
  "type": "shape",
  "shapeType": "rounded-rect",
  "left": 200, "top": 150,
  "width": 200, "height": 100,
  "fill": "#e2e8f0",
  "stroke": "#94a3b8",
  "strokeWidth": 2,
  "strokeDashArray": null,
  "opacity": 1,
  "angle": 0
}
```

**Basic:** `rectangle`, `rounded-rect`, `circle`, `ellipse`, `triangle`
**Flowchart:** `parallelogram`, `trapezoid`, `stadium`, `hexagon`, `pentagon`, `octagon`, `star`, `cross`, `cloud`, `cylinder`
**Arrows:** `arrow-right`, `arrow-left`, `double-arrow`, `chevron-right`, `chevron-left`
**Callouts:** `callout`, `left-brace`, `right-brace`, `diamond`

Shape properties:
- `fill`: fill color (hex).
- `stroke`: border color (hex).
- `strokeWidth`: 0–20px.
- `strokeDashArray`: `null` (solid), `[8,4]` (dashed), `[2,4]` (dotted).
- `rx`, `ry`: corner radius for rectangles.
- `shadow`: `{ color, blur, offsetX, offsetY }` or `null`.

### Image

```json
{
  "type": "image",
  "src": "https://...",
  "left": 50, "top": 200,
  "width": 300, "height": 200,
  "scaleX": 1, "scaleY": 1,
  "stroke": null,
  "strokeWidth": 0,
  "borderRadius": 0,
  "opacity": 1,
  "angle": 0
}
```

### Table

```json
{
  "type": "table",
  "left": 100, "top": 300,
  "width": 500, "height": 200,
  "tableJSON": { ... }
}
```

Tables use a ProseMirror JSON structure with `table`, `table_header`, and `table_row` nodes.

### Embedded diagram

An image element with `src` in the format `diagram:<diagramId>` renders an embedded flowchart diagram from the same workspace. Use this to reference a standalone diagram inside a slide.

## Speaker Notes

The `notes` field of each slide is a plain-text string for presenter notes. Use them for:

- Talking points the presenter will say
- Metadata or context about the slide's content
- Instructions for future editors of the deck

Every slide should have notes. A deck without notes is unfinished.

## Edge Cases

- **Very dense slides.** A slide with 15 elements is probably overloaded. Split into two slides, or rethink the layout.
- **Off-canvas elements.** If `left + width > 960` or `top + height > 540`, the element extends beyond the visible area. Usually a bug.
- **Fonts that aren't in the supported list.** Pick from the documented list — other font families may not render consistently.
- **Very large font sizes on small textboxes.** The text will clip. Adjust the textbox size or reduce the font size.
- **Embedded diagrams that reference a deleted flowchart.** The slide stays but the image is broken. Remove the reference or point to a valid diagram.

## Anti-Patterns

- **Don't use slides when a document is the right format.** If the task is "write up X", write a doc. Slides are for narrative pacing in front of an audience.
- **Don't rebuild the whole deck to change one slide.** Use `update_slide(deck_id, slide_id, patch)` — not a full deck replace. The `slide_id` is stable and immune to reordering.
- **Don't use array index as a stable reference.** Slide indexes shift when slides are inserted or reordered. Always use `slide_id` for targeted operations.
- **Don't use `update_slide_element` on a slide you haven't read.** Call `read_slide` first to know the current element count and indexes.
- **Don't skip speaker notes.** A slide with no notes is unfinished. Even a short note like "emphasize the 40% growth" is better than nothing.
- **Don't use walls of text.** If a slide has more than ~6 lines or ~6 words per line, you're writing prose, not a slide. Move it to a doc.
- **Don't introduce a new color on every slide.** Pick 2–3 colors and stick to them throughout the deck.
- **Don't use font sizes below 14px.** They're unreadable when projected. See `06-output-standards.md`.
- **Don't fill every pixel.** Whitespace is content. A crowded slide is a failed slide.
- **Don't create "New Presentation" as a title.** A real title is the baseline.
