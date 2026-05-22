/**
 * Build context_payload for comment events.
 * Provides structured context about the commented content for human and agent consumers.
 *
 * All user-visible labels/previews/summary lines are rendered via tServer in
 * the language passed by the caller (defaults to 'en'). The underlying i18n
 * key + params are NOT stored in the payload — the server renders once at
 * write time. If multilingual re-rendering is later needed, add _key/_params
 * fields alongside the rendered strings.
 */
import { tServer, DEFAULT_LANGUAGE } from './i18n-server.js';

export function buildContextPayload(db, {
  targetType, targetId, anchorType, anchorId, anchorMeta, text, actorName, parentId,
  lang = DEFAULT_LANGUAGE,
}) {
  const target = buildTarget(db, targetType, targetId);
  const anchor = buildAnchor(db, targetType, targetId, anchorType, anchorId, anchorMeta, lang);
  const summary = buildSummary(targetType, anchorType, text, actorName, lang);
  const minimalContext = buildMinimalContext(db, targetType, targetId, anchorType, anchorId, parentId);
  const writeBackTarget = buildWriteBackTarget(targetId, anchorType, anchorId);
  const recentEdits = buildRecentEdits(db, targetId);

  return {
    version: 2,
    target,
    anchor,
    summary,
    minimal_required_context: minimalContext,
    write_back_target: writeBackTarget,
    recent_edits: recentEdits,
  };
}

function buildTarget(db, targetType, targetId) {
  let title = null;
  try {
    if (targetType === 'task') {
      const rawId = targetId.startsWith('task:') ? targetId.slice(5) : targetId;
      const task = db.prepare('SELECT title FROM tasks WHERE id = ?').get(rawId);
      title = task?.title || null;
    } else {
      const item = db.prepare('SELECT title FROM content_items WHERE id = ?').get(targetId);
      title = item?.title || null;
    }
  } catch { /* ignore */ }

  return {
    type: targetType,
    id: targetId,
    title,
  };
}

function buildAnchor(db, targetType, targetId, anchorType, anchorId, anchorMeta, lang) {
  if (!anchorType || !anchorId) return null;
  const t = (k, p) => tServer(lang, k, p);

  switch (anchorType) {
    case 'row':
      return buildRowAnchor(db, targetId, anchorId, lang);

    case 'text-range':
      return {
        type: 'text-range',
        id: anchorId,
        label: t('commentContext.anchors.text_range'),
        preview: anchorMeta?.quote ? String(anchorMeta.quote).substring(0, 100) : null,
        meta: {
          quote: anchorMeta?.quote || null,
          heading_path: anchorMeta?.heading_path || null,
          blockId: anchorMeta?.blockId || null,
          blockOffset: anchorMeta?.blockOffset ?? null,
          blockEndOffset: anchorMeta?.blockEndOffset ?? null,
        },
      };

    case 'image':
      return {
        type: 'image',
        id: anchorId,
        label: t('commentContext.anchors.image'),
        preview: anchorMeta?.alt_text || t('commentContext.previews.image'),
        meta: {
          alt_text: anchorMeta?.alt_text || null,
          image_url: anchorMeta?.image_url || null,
        },
      };

    case 'table':
      return {
        type: 'table',
        id: anchorId,
        label: t('commentContext.anchors.table'),
        preview: anchorMeta?.preview || t('commentContext.previews.table'),
        meta: {},
      };

    case 'diagram_embed':
      return {
        type: 'diagram_embed',
        id: anchorId,
        label: t('commentContext.anchors.diagram_embed'),
        preview: anchorMeta?.preview || t('commentContext.previews.diagram_embed'),
        meta: {},
      };

    case 'mermaid':
      return {
        type: 'mermaid',
        id: anchorId,
        label: t('commentContext.anchors.mermaid'),
        preview: anchorMeta?.code ? String(anchorMeta.code).substring(0, 80) : t('commentContext.previews.mermaid'),
        meta: {
          code: anchorMeta?.code || null,
        },
      };

    case 'slide': {
      const idx = Number(anchorId) + 1;
      return {
        type: 'slide',
        id: anchorId,
        label: t('commentContext.anchors.slide', { index: idx }),
        preview: anchorMeta?.slide_title || t('commentContext.previews.slide', { index: idx }),
        meta: {
          slide_index: Number(anchorId),
          slide_title: anchorMeta?.slide_title || null,
        },
      };
    }

    case 'page': {
      const pageIdx = Number(anchorId) + 1;
      return {
        type: 'page',
        id: anchorId,
        label: t('commentContext.anchors.page', { index: pageIdx }),
        preview: anchorMeta?.page_title || t('commentContext.previews.page', { index: pageIdx }),
        meta: {
          page_index: Number(anchorId),
          page_title: anchorMeta?.page_title || null,
        },
      };
    }

    case 'element':
      return {
        type: 'element',
        id: anchorId,
        label: anchorMeta?.element_name || anchorMeta?.element_type || t('commentContext.anchors.element'),
        preview: anchorMeta?.preview || anchorMeta?.element_name || anchorMeta?.element_type || t('commentContext.previews.element_fallback'),
        meta: {
          slide_index: anchorMeta?.slide_index != null ? anchorMeta.slide_index : null,
          element_type: anchorMeta?.element_type || null,
          element_name: anchorMeta?.element_name || null,
          page_index: anchorMeta?.page_index != null ? anchorMeta.page_index : null,
          page_title: anchorMeta?.page_title || null,
          scene_id: anchorMeta?.scene_id || null,
          start: anchorMeta?.start != null ? anchorMeta.start : null,
          duration: anchorMeta?.duration != null ? anchorMeta.duration : null,
        },
      };

    case 'node':
      return {
        type: 'node',
        id: anchorId,
        label: t('commentContext.anchors.node'),
        preview: anchorMeta?.node_label || t('commentContext.previews.node'),
        meta: {
          node_label: anchorMeta?.node_label || null,
        },
      };

    case 'edge':
      return {
        type: 'edge',
        id: anchorId,
        label: t('commentContext.anchors.edge'),
        preview: anchorMeta?.edge_label || t('commentContext.previews.edge'),
        meta: {
          source_node_id: anchorMeta?.source_node_id || null,
          target_node_id: anchorMeta?.target_node_id || null,
          edge_label: anchorMeta?.edge_label || null,
        },
      };

    default:
      return { type: anchorType, id: anchorId, label: anchorType, preview: null, meta: {} };
  }
}

function buildRowAnchor(db, targetId, rowId, lang) {
  return {
    type: 'row',
    id: rowId,
    label: tServer(lang, 'commentContext.anchors.row', { id: rowId }),
    preview: `Row #${rowId}`,
    meta: {
      row_id: rowId,
      primary_text: null,
      fields: {},
    },
  };
}

function buildSummary(targetType, anchorType, text, actorName, lang) {
  const kindRaw = tServer(lang, `commentContext.summary.kinds.${targetType}`);
  const kind = kindRaw.startsWith('commentContext.summary.kinds.')
    ? tServer(lang, 'commentContext.summary.kinds.content')
    : kindRaw;
  let textSummary;
  if (!anchorType) {
    textSummary = tServer(lang, 'commentContext.summary.comment_on_whole', { kind });
  } else if (anchorType === 'row') {
    textSummary = tServer(lang, 'commentContext.summary.comment_on_row');
  } else {
    // Look up a generic anchor label (strip type-specific placeholders).
    // 'slide' and 'row' carry {{index}}/{{id}} placeholders in their labels,
    // so we read dedicated 'kinds' entries for those cases instead.
    const anchorSlug = anchorType.replace(/-/g, '_');
    const genericKey = (anchorType === 'slide' || anchorType === 'row')
      ? `commentContext.summary.anchorKinds.${anchorSlug}`
      : `commentContext.anchors.${anchorSlug}`;
    const anchorLabelRaw = tServer(lang, genericKey);
    const anchorLabel = anchorLabelRaw === genericKey ? anchorType : anchorLabelRaw;
    textSummary = tServer(lang, 'commentContext.summary.comment_on_anchor', { anchor: anchorLabel });
  }

  return {
    comment_text: (text || '').substring(0, 200),
    comment_author: actorName,
    text_summary: textSummary,
  };
}

function buildMinimalContext(db, targetType, targetId, anchorType, anchorId, parentId) {
  const ctx = {};

  // Thread context: sibling comments in same thread
  if (parentId) {
    try {
      const siblings = db.prepare(
        'SELECT text, actor_id, created_at FROM comments WHERE parent_id = ? ORDER BY created_at ASC LIMIT 10'
      ).all(parentId);
      if (siblings.length > 0) {
        ctx.thread_comments = siblings.map(c => ({ actor: c.actor_id, text: c.text, at: c.created_at }));
      }
    } catch { /* ignore */ }
  }

  // Content snippet
  try {
    if (targetType === 'doc') {
      const item = db.prepare('SELECT text FROM content_items WHERE id = ?').get(targetId);
      if (item?.text) {
        if (anchorType === 'text-range' && anchorId) {
          // Try to extract surrounding context from the text
          const text = item.text;
          const idx = anchorId ? Math.max(0, text.indexOf(anchorId)) : 0;
          const start = Math.max(0, idx - 500);
          const end = Math.min(text.length, idx + 500);
          ctx.content_snippet = text.slice(start, end);
        } else {
          ctx.content_snippet = item.text.slice(0, 1000);
        }
      }
    } else if (targetType === 'table') {
      // For table+row anchor, get the row data
      if (anchorType === 'row' && anchorId) {
        const row = db.prepare('SELECT data FROM table_rows WHERE id = ? OR row_id = ?').get(anchorId, anchorId);
        if (row?.data) ctx.row_data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      }
    }
  } catch { /* ignore */ }

  return Object.keys(ctx).length > 0 ? ctx : null;
}

function buildWriteBackTarget(targetId, anchorType, anchorId) {
  return {
    target_id: targetId,
    anchor_type: anchorType || null,
    anchor_id: anchorId || null,
  };
}

function buildRecentEdits(db, targetId) {
  try {
    const revisions = db.prepare(
      'SELECT actor_id, created_at, description FROM content_revisions WHERE content_id = ? ORDER BY created_at DESC LIMIT 3'
    ).all(targetId);
    if (revisions.length === 0) return null;
    return revisions.map(r => ({ actor: r.actor_id, timestamp: r.created_at, description: r.description || null }));
  } catch {
    return null;
  }
}
