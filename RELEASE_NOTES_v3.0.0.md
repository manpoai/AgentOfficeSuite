# v3.0.0 — Canvas and Video

Two new content types join the AOSE editor family, bringing the total to six: Docs, Databases, Slides, Flowcharts, **Canvas**, and **Video**.

## New: Canvas Editor

An infinite canvas editor for freeform visual design across multiple pages.

- **Drawing tools**: rectangles, circles, text, images, SVG vector paths, lines
- **Frames (pages)**: organize designs into named frames; per-frame PNG/SVG export
- **Vector editing**: pen tool for bezier paths, point-level editing, open/closed paths
- **Boolean operations**: union, subtract, intersect, exclude on vector shapes
- **Group/ungroup**: nested groups with double-click drill-in
- **Property panel**: fill, stroke, corner radius, shadow, opacity, blend mode, typography
- **Layer panel**: drag-to-reorder, visibility toggle, hierarchical frame/element tree
- **Keyboard shortcuts**: registered in global help panel (V/R/O/T/A/L tool keys, Cmd+G group)

Canvas MCP tools: `create_canvas`, `update_canvas`, `get_canvas`, `add_canvas_element`, `update_canvas_element`, `delete_canvas_element`, `add_canvas_page`, `delete_canvas_page`, `batch_canvas_operations`.

## New: Video Editor

A timeline-based motion graphics editor for creating animated content.

- **Scene-based timeline**: multiple scenes, each with independent duration and element tracks
- **Keyframe animation**: per-property keyframes with 8 easing presets (linear, ease-in, ease-out, ease-in-out, spring, bounce, elastic, steps)
- **Animatable properties**: position, size, rotation, opacity, fill color, stroke color, corner radius
- **Drawing tools**: shapes, text, images, lines — shared tooling with Canvas editor
- **Playback**: real-time preview with play/pause, scrubbing, per-scene navigation
- **Export**: MP4 and WebM via ffmpeg.wasm, with progress indicator

Video MCP tools: `create_video`, `update_video`, `get_video`, `add_video_element`, `update_video_element`, `delete_video_element`, `add_video_scene`, `delete_video_scene`.

## Comment Anchoring

Both Canvas and Video now support the same comment anchoring infrastructure as the other four editors:

- **Canvas**: element-level and page-level comment anchoring via right-click menu
- **Video**: element-level comment anchoring via canvas preview and timeline bar right-click
- **Gateway**: `page` anchor type added to context-builder; `element` anchor enhanced with Canvas/Video meta fields (element_name, page_index, scene_id, start, duration)

## Other Changes

- **MCP SDK upgraded** to v1.29.0 (fixes hono and path-to-regexp vulnerabilities)
- **Debug logging removed** from Canvas and Video editor code
- **Keyboard shortcuts** registered via `useKeyboardScope` for Canvas (8 shortcuts) and Video (2 shortcuts), now visible in the global help panel
- **i18n**: all new anchor types and shortcut labels translated across en/zh/ja/ko

## Version Alignment

All packages are now version-aligned:

| Package | Version |
|---------|---------|
| aose-main | 3.0.0 |
| aose-mcp | 3.0.0 |
| aose-gateway | 3.0.0 |
| aose-shell | 3.0.0 |
| aose-adapter | 0.3.1 |

## Upgrade

```bash
# Global install
npm install -g aose-main@latest
aose update

# Or one-shot
npx aose-main@latest
```

Agents with MCP configured will pick up the new Canvas and Video tools automatically after `npx aose-mcp` restarts. No configuration changes needed.
