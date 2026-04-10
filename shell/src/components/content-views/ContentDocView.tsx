'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { TextSelection } from 'prosemirror-state';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as docApi from '@/lib/api/documents';
import type { Document as DocType, Revision as DocRevision } from '@/lib/api/documents';
import { X, Search, Clock, MessageSquare as MessageSquareIcon, Download, Smile, Maximize2, Link2, Pin, Undo2, Redo2, ExternalLink, AtSign, Share2, Pencil, Trash2, ListTree } from 'lucide-react';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { buildFixedTopBarActionItems, renderFixedTopBarActions } from '@/actions/content-topbar-fixed.actions';
import { EmojiPicker } from '@/components/EmojiPicker';
import { cn } from '@/lib/utils';
import { formatRelativeTime, formatDateTime } from '@/lib/utils/time';
import dynamic from 'next/dynamic';
import { SearchBar, DocOutline, DocOutlineList, extractHeadings, scrollToHeading } from '@/components/editor';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { RevisionHistory } from '@/components/shared/RevisionHistory';
import { RevisionPreviewBanner } from '@/components/shared/RevisionPreviewBanner';
import { EditorSkeleton } from '@/components/shared/Skeleton';
import { EditFAB } from '@/components/shared/EditFAB';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { MobileCommentBar } from '@/components/shared/MobileCommentBar';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useT } from '@/lib/i18n';
import { useKeyboardScope } from '@/lib/keyboard';
import type { ShortcutRegistration } from '@/lib/keyboard';
import * as gw from '@/lib/api/gateway';
import { showError } from '@/lib/utils/error';
import { buildContentLink } from '@/lib/hooks/use-content-tree';
import { buildContentTopBarCommonMenuItems } from '@/actions/content-topbar-common.actions';

const Editor = dynamic(
  () => import('@/components/editor/Editor').then(m => ({ default: m.Editor })),
  { ssr: false, loading: () => <EditorSkeleton /> }
);

const RevisionPreview = dynamic(() => import('@/components/RevisionPreview'), { ssr: false, loading: () => <EditorSkeleton /> });

const DOC_SHORTCUTS: ShortcutRegistration[] = [
  { id: 'doc-bold', key: 'b', modifiers: { meta: true }, handler: () => {}, label: 'Bold', category: 'Document', priority: 0 },
  { id: 'doc-italic', key: 'i', modifiers: { meta: true }, handler: () => {}, label: 'Italic', category: 'Document', priority: 0 },
  { id: 'doc-underline', key: 'u', modifiers: { meta: true }, handler: () => {}, label: 'Underline', category: 'Document', priority: 0 },
  { id: 'doc-strikethrough', key: 's', modifiers: { meta: true, shift: true }, handler: () => {}, label: 'Strikethrough', category: 'Document', priority: 0 },
];

function DocMenuToggle({ icon: Icon, label, checked, onChange }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      <span className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted'
      )}>
        <span className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform mt-0.5 ml-0.5',
          checked ? 'translate-x-4' : 'translate-x-0'
        )} />
      </span>
    </button>
  );
}

/** Remove base64 src from any uploading image nodes before persisting to backend. */
function sanitizeDocJson(json: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!json) return null;
  const cleaned = JSON.parse(JSON.stringify(json));
  function walk(node: any) {
    if (node.type === 'image' && node.attrs?.uploading) {
      node.attrs.src = '';
      delete node.attrs.uploading;
    }
    if (node.content) node.content.forEach(walk);
  }
  if (cleaned.content) cleaned.content.forEach(walk);
  return cleaned;
}

export function ContentDocView({ doc, customIcon, breadcrumb, onBack, onSaved, onDeleted, onNavigate, docListVisible, onToggleDocList, focusCommentId: initialFocusCommentId, showComments, onShowComments, onCloseComments, onToggleComments, isPinned, onTogglePin }: {
  doc: DocType;
  customIcon?: string;
  breadcrumb: { id: string; title: string }[];
  onBack: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onNavigate: (docId: string) => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
  focusCommentId?: string;
  showComments: boolean;
  onShowComments: () => void;
  onCloseComments: () => void;
  onToggleComments: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  const { t } = useT();

  // Register document keyboard scope + shortcuts for help panel display
  useKeyboardScope('document', DOC_SHORTCUTS);
  const queryClient = useQueryClient();

  // Fetch comments — unified queryKey matches CommentPanel so both share same cache
  const unifiedDocId = `doc:${doc.id}`;
  const { data: docComments = [] } = useQuery({
    queryKey: ['comments', 'doc', unifiedDocId, undefined],
    queryFn: () => gw.listContentComments(unifiedDocId),
    staleTime: 10_000,
  });
  // Extract quoted text from comments for editor highlighting (skip resolved comments)
  const commentHighlightQuotes = useMemo(() => {
    return docComments
      .filter(c => !c.resolved_by)
      .map(c => {
        const anchor = c.context_payload?.anchor;
        if (!anchor) return null;
        const quote = anchor.meta?.quote || anchor.preview;
        if (!quote && !anchor.type) return null;
        return { id: c.id, text: (quote as string) || '', anchorType: anchor.type as string };
      })
      .filter((q): q is { id: string; text: string; anchorType?: string } => q !== null);
  }, [docComments]);

  const [activeFocusCommentId, setActiveFocusCommentId] = useState<string | undefined>(initialFocusCommentId);

  const navigateToAnchor = useCallback((anchor: { type: string; id: string; meta?: Record<string, unknown> }) => {
    // Delay to let click event finish processing before moving focus/scroll
    setTimeout(() => {
      try {
        const getPmView = () => (document.querySelector('.outline-editor-mount') as any)?.__pmView;
        if (anchor.type === 'text-range') {
          const quote = (anchor.meta?.quote as string) || '';
          if (!quote) return;
          const view = getPmView();
          if (!view) { console.warn('[navigateToAnchor] ProseMirror view not found'); return; }
          const { doc } = view.state;
          let from = -1;
          doc.descendants((node: any, pos: number) => {
            if (from >= 0) return false;
            if (node.isText && node.text?.includes(quote)) {
              from = pos + node.text.indexOf(quote);
              return false;
            }
          });
          if (from >= 0) {
            view.dispatch(view.state.tr.setSelection(
              TextSelection.create(doc, from, from + quote.length)
            ).scrollIntoView());
            view.focus();
          } else {
            console.warn('[navigateToAnchor] Quote not found in doc:', quote);
          }
        } else {
          const typeMap: Record<string, string> = {
            image: '.comment-marker-block img, .comment-marker-block',
            table: '.comment-marker-block table, .comment-marker-block',
            mermaid: '.comment-marker-block',
            diagram_embed: '.comment-marker-block',
          };
          const sel = typeMap[anchor.type] || '.comment-marker-block';
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          else console.warn('[navigateToAnchor] Block element not found:', sel);
        }
      } catch (e) {
        console.error('[navigateToAnchor] Error:', e);
      }
    }, 50);
  }, []);
  const [showDocMenu, setShowDocMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [commentQuote, setCommentQuote] = useState('');
  const [commentAnchor, setCommentAnchor] = useState<{ type: string; id: string; meta?: Record<string, unknown> } | null>(null);
  const [title, setTitle] = useState(doc.title);
  const [emoji, setEmoji] = useState<string | null>(customIcon || doc.icon?.trim() || null);
  const [text, setText] = useState(doc.text);
  const [reliabilityStatus, setReliabilityStatus] = useState<'clean' | 'dirty' | 'flushing' | 'flush_failed'>('clean');
  const [flushRetryCount, setFlushRetryCount] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showTitleIcon, setShowTitleIcon] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [fullWidth, setFullWidth] = useState(doc.full_width ?? false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchWithReplace, setSearchWithReplace] = useState(false);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [commentTopOffset, setCommentTopOffset] = useState<number | null>(null);
  const [insightsEnabled, setInsightsEnabled] = useState(true);
  const isMobile = useIsMobile();
  const [mobileEditMode, setMobileEditMode] = useState(() => !!(isMobile && !doc.title && !doc.text));
  const [showMobileOutline, setShowMobileOutline] = useState(false);
  const [previewRevision, setPreviewRevision] = useState<DocRevision | null>(null);
  const [prevRevision, setPrevRevision] = useState<DocRevision | null>(null);
  const [highlightChanges, setHighlightChanges] = useState(false);
  const titleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleVersionRef = useRef(0);
  const textVersionRef = useRef(0);
  const docIdRef = useRef(doc.id);
  const latestTitleRef = useRef(doc.title);
  const latestTextRef = useRef(doc.text);
  const latestEmojiRef = useRef((customIcon || doc.icon || null) as string | null);
  const latestDocJsonRef = useRef<Record<string, unknown> | null>(doc.data_json || null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Update sidebar doc list via Gateway when title/emoji change
  const updateDocCache = useCallback((newTitle: string, newEmoji: string | null) => {
    gw.updateContentItem(`doc:${doc.id}`, { title: newTitle, icon: newEmoji }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
    }).catch(() => {});
  }, [doc.id, queryClient]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.text) {
        setCommentQuote(detail.text);
        setCommentAnchor(detail.anchorType ? {
          type: detail.anchorType,
          id: detail.anchorId,
          meta: detail.anchorMeta,
        } : null);
        onShowComments();
        const editorArea = document.querySelector('.outline-editor');
        if (editorArea) {
          const editorRect = editorArea.getBoundingClientRect();
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const rangeRect = sel.getRangeAt(0).getBoundingClientRect();
            if (rangeRect.height > 0) {
              setCommentTopOffset(rangeRect.top - editorRect.top);
              return;
            }
          }
          if (detail.blockRect) {
            setCommentTopOffset(detail.blockRect.top - editorRect.top);
          }
        }
      }
    };
    window.addEventListener('editor-comment', handler);
    return () => window.removeEventListener('editor-comment', handler);
  }, []);

  // Click handler for comment marks in editor
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const commentEl = target.closest('.comment-marker') as HTMLElement | null;
      if (!commentEl) {
        if (focusedCommentId) {
          document.querySelectorAll('.comment-marker.comment-focused').forEach(el =>
            el.classList.remove('comment-focused')
          );
          setFocusedCommentId(null);
        }
        return;
      }
      const id = commentEl.id.replace('comment-', '');
      const resolved = commentEl.getAttribute('data-resolved');
      if (resolved) return;

      document.querySelectorAll('.comment-marker.comment-focused').forEach(el =>
        el.classList.remove('comment-focused')
      );

      document.querySelectorAll(`#comment-${id}`).forEach(el =>
        el.classList.add('comment-focused')
      );
      setFocusedCommentId(id);
      setActiveFocusCommentId(id);

      const editorArea = document.querySelector('.outline-editor');
      if (editorArea) {
        const editorRect = editorArea.getBoundingClientRect();
        const markRect = commentEl.getBoundingClientRect();
        setCommentTopOffset(markRect.top - editorRect.top);
      }

      if (!showComments) onShowComments();
    };
    document.addEventListener('mouseup', handler);
    return () => document.removeEventListener('mouseup', handler);
  }, [focusedCommentId, showComments, onShowComments]);

  // Global Cmd+F / Cmd+H to open search bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'f') {
        if ((e.target as HTMLElement)?.closest?.('.ProseMirror')) return;
        e.preventDefault();
        setShowSearch(true);
        setSearchWithReplace(false);
      }
      if (mod && e.key === 'h') {
        if ((e.target as HTMLElement)?.closest?.('.ProseMirror')) return;
        e.preventDefault();
        setShowSearch(true);
        setSearchWithReplace(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const handler = () => { gw.createContentManualSnapshot(`doc:${doc?.id}`).catch(() => {}); };
    window.addEventListener('save-current', handler);
    return () => window.removeEventListener('save-current', handler);
  }, [doc?.id]);

  // Ref so that the doc.id useEffect can call flushDocSave without stale closure
  const flushDocSaveRef = useRef<() => void>(() => {});

  // Reset local state and cancel pending saves when switching to a different document
  useEffect(() => {
    // Flush pending save for the *previous* document before switching
    flushDocSaveRef.current();
    if (titleSaveTimerRef.current) { clearTimeout(titleSaveTimerRef.current); titleSaveTimerRef.current = null; }
    if (textSaveTimerRef.current) { clearTimeout(textSaveTimerRef.current); textSaveTimerRef.current = null; }
    docIdRef.current = doc.id;
    setTitle(doc.title);
    setEmoji(customIcon || doc.icon?.trim() || null);
    setText(doc.text);
    latestTitleRef.current = doc.title;
    latestTextRef.current = doc.text;
    latestEmojiRef.current = (customIcon || doc.icon || null) as string | null;
    setReliabilityStatus('clean');
    setFlushRetryCount(0);
    setShowHistory(false);
    setPreviewRevision(null);
    setPrevRevision(null);
    setMobileEditMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojiPicker]);

  // Shared save execution
  const executeSave = useCallback(async (saveDocId: string, titleVersion: number, textVersion: number, attempt = 0) => {
    if (saveDocId !== docIdRef.current) return;
    setReliabilityStatus('flushing');
    try {
      const savingTitle = latestTitleRef.current;
      const savingText = latestTextRef.current;
      const savingEmoji = latestEmojiRef.current;
      const docEmoji = savingEmoji && (savingEmoji.startsWith('/api/') || savingEmoji.startsWith('http')) ? null : savingEmoji;
      const titleToSave = savingTitle ?? '';
      const savedDoc = await docApi.updateDocument(saveDocId, titleToSave, savingText, docEmoji, undefined, sanitizeDocJson(latestDocJsonRef.current) || undefined);
      if (titleVersionRef.current !== titleVersion || textVersionRef.current !== textVersion) return;
      const confirmedTitle = savedDoc.title;
      const confirmedEmoji = savingEmoji;
      queryClient.setQueryData<DocType>(['document', saveDocId], (old) =>
        old ? { ...old, title: confirmedTitle, text: savingText, icon: confirmedEmoji } : old
      );
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
      if (saveDocId === docIdRef.current) {
            setReliabilityStatus('clean');
        setFlushRetryCount(0);
      }
    } catch (e) {
      if (attempt < 2) {
        setFlushRetryCount(attempt + 1);
        setTimeout(() => executeSave(saveDocId, titleVersion, textVersion, attempt + 1), 400 * (attempt + 1));
        return;
      }
      showError(t('errors.autoSaveFailed'), e);
      if (saveDocId === docIdRef.current) {
        setReliabilityStatus('flush_failed');
        setFlushRetryCount(attempt + 1);
      }
    }
  }, [queryClient, t]);

  // Snapshot-based save — used by flushDocSave so ref changes after flush don't affect this save
  const executeSaveWithSnapshot = useCallback(async (
    snapshot: { docId: string; title: string | null; text: string; emoji: string | null; docJson: Record<string, unknown> | null },
    attempt = 0,
  ) => {
    const { docId: saveDocId, title: savingTitle, text: savingText, emoji: savingEmoji, docJson } = snapshot;
    setReliabilityStatus('flushing');
    try {
      const docEmoji = savingEmoji && (savingEmoji.startsWith('/api/') || savingEmoji.startsWith('http')) ? null : savingEmoji;
      const titleToSave = savingTitle ?? '';
      await docApi.updateDocument(saveDocId, titleToSave, savingText, docEmoji, undefined, sanitizeDocJson(docJson) || undefined);
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
      if (saveDocId === docIdRef.current) {
        setReliabilityStatus('clean');
        setFlushRetryCount(0);
      }
    } catch (e) {
      if (attempt < 2) {
        setFlushRetryCount(attempt + 1);
        setTimeout(() => executeSaveWithSnapshot(snapshot, attempt + 1), 400 * (attempt + 1));
        return;
      }
      showError(t('errors.autoSaveFailed'), e);
      if (saveDocId === docIdRef.current) {
        setReliabilityStatus('flush_failed');
        setFlushRetryCount(attempt + 1);
      }
    }
  }, [queryClient, t]);

  const scheduleTitleSave = useCallback((newTitle: string, newEmoji?: string | null) => {
    latestTitleRef.current = newTitle;
    if (newEmoji !== undefined) latestEmojiRef.current = newEmoji;
    setReliabilityStatus('dirty');
    if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
    if (textSaveTimerRef.current) { clearTimeout(textSaveTimerRef.current); textSaveTimerRef.current = null; }
    const saveDocId = docIdRef.current;
    const tv = ++titleVersionRef.current;
    const xv = textVersionRef.current;
    titleSaveTimerRef.current = setTimeout(() => executeSave(saveDocId, tv, xv), 500);
  }, [executeSave]);

  const scheduleTextSave = useCallback((newText: string) => {
    latestTextRef.current = newText;
    setReliabilityStatus('dirty');
    if (textSaveTimerRef.current) clearTimeout(textSaveTimerRef.current);
    if (titleSaveTimerRef.current) { clearTimeout(titleSaveTimerRef.current); titleSaveTimerRef.current = null; }
    const saveDocId = docIdRef.current;
    const tv = titleVersionRef.current;
    const xv = ++textVersionRef.current;
    textSaveTimerRef.current = setTimeout(() => executeSave(saveDocId, tv, xv), 500);
  }, [executeSave]);

  const flushDocSave = useCallback(() => {
    if (titleSaveTimerRef.current || textSaveTimerRef.current) {
      if (titleSaveTimerRef.current) { clearTimeout(titleSaveTimerRef.current); titleSaveTimerRef.current = null; }
      if (textSaveTimerRef.current) { clearTimeout(textSaveTimerRef.current); textSaveTimerRef.current = null; }
      // Snapshot current values immediately — ref changes after this point don't affect this save
      executeSaveWithSnapshot({
        docId: docIdRef.current,
        title: latestTitleRef.current,
        text: latestTextRef.current,
        emoji: latestEmojiRef.current,
        docJson: latestDocJsonRef.current,
      });
    }
  }, [executeSaveWithSnapshot]);

  // Keep ref current so doc.id useEffect can always call latest flushDocSave
  useEffect(() => {
    flushDocSaveRef.current = flushDocSave;
  });

  // Listen for flush requests from page.tsx (handleSelect / handleMobileBack)
  useEffect(() => {
    const handler = () => flushDocSave();
    window.addEventListener('flush-doc-save', handler);
    return () => window.removeEventListener('flush-doc-save', handler);
  }, [flushDocSave]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) flushDocSave();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (reliabilityStatus === 'dirty' || reliabilityStatus === 'flush_failed') {
        e.preventDefault();
        e.returnValue = '';
      }
      flushDocSave();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      flushDocSave();
    };
  }, [flushDocSave]);

  useEffect(() => {
    return () => {
      if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
      if (textSaveTimerRef.current) clearTimeout(textSaveTimerRef.current);
    };
  }, [doc.id]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    updateDocCache(newTitle, emoji);
    scheduleTitleSave(newTitle);
  };

  const handleEmojiSelect = async (selectedEmoji: string | null) => {
    setEmoji(selectedEmoji);
    setShowEmojiPicker(false);
    updateDocCache(title, selectedEmoji);

    const isUrl = selectedEmoji && (selectedEmoji.startsWith('/api/') || selectedEmoji.startsWith('http'));

    if (isUrl) {
      scheduleTitleSave(title, null);
      try {
        await gw.setDocIcon(doc.id, selectedEmoji);
        queryClient.invalidateQueries({ queryKey: ['content-items'] });
      } catch (e) {
        showError(t('errors.saveCustomIconFailed'), e);
      }
    } else {
      scheduleTitleSave(title, selectedEmoji);
      try {
        await gw.removeDocIcon(doc.id);
        queryClient.invalidateQueries({ queryKey: ['content-items'] });
      } catch (e) {
        // Ignore if no custom icon existed
      }
    }
  };

  const handleTextChange = (newText: string) => {
    setText(newText);
    scheduleTextSave(newText);
  };

  const handleDelete = () => {
    onDeleted();
  };

  const handleExport = useCallback(() => {
    const blob = new Blob([doc.text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${title || 'document'}.md`; a.click();
    URL.revokeObjectURL(url);
  }, [doc.text, title]);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(buildContentLink({ type: 'doc', id: doc.id }));
  }, [doc.id]);

  const statusText = reliabilityStatus === 'flushing'
    ? t('content.saving')
    : reliabilityStatus === 'dirty'
      ? t('content.unsaved')
      : reliabilityStatus === 'flush_failed'
        ? `${t('content.saveFailed')} (${flushRetryCount}/3)`
        : '';

  const mobileReadOnly = isMobile && !mobileEditMode;

  const getEditorView = useCallback(() => {
    const mount = document.querySelector('.outline-editor-mount') as any;
    return mount?.__pmView || null;
  }, []);

  const handleMobileCancel = useCallback(() => {
    setMobileEditMode(false);
  }, []);

  const handleMobileSave = useCallback(() => {
    flushDocSave();
    setMobileEditMode(false);
  }, [flushDocSave]);

  return (
    <div className="flex-1 min-w-0 flex flex-row h-full overflow-hidden">
      {/* Left column: TopBar + editor content — card style */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-card md:rounded-lg md:shadow-[0px_0px_20px_0px_rgba(0,0,0,0.08)] md:overflow-hidden relative z-[1]">
      {/* Top bar — breadcrumb + actions */}
      <div className="flex items-center border-b border-border bg-card shrink-0 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.02)]">
        <ContentTopBar
          breadcrumb={breadcrumb}
          onNavigate={onNavigate}
          onBack={onBack}
          docListVisible={docListVisible}
          onToggleDocList={onToggleDocList}
          title={title || breadcrumb?.[breadcrumb.length - 1]?.title || ''}
          titlePlaceholder={t('content.untitled')}
          metaLine={
            <button
              onClick={() => setShowHistory(true)}
              className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
            >
              {t('content.lastModified')}: {formatRelativeTime(doc.updated_at)}
              {doc.updated_by && <span> {t('content.by')} {doc.updated_by}</span>}
            </button>
          }
          statusText={statusText}
          statusError={reliabilityStatus === 'flush_failed'}
          onRetry={reliabilityStatus === 'flush_failed' ? () => {
            setFlushRetryCount(0);
            executeSave(docIdRef.current, titleVersionRef.current, textVersionRef.current);
          } : undefined}
          mode={isMobile && mobileEditMode ? 'edit' : 'preview'}
          onCancelEdit={handleMobileCancel}
          onSave={handleMobileSave}
          onHistory={() => setShowHistory(true)}
          onComments={() => onToggleComments()}
          extraMobileActions={!mobileEditMode ? (
            <button
              onClick={() => setShowMobileOutline(true)}
              className="p-1.5 text-foreground"
              title="目录"
            >
              <ListTree className="h-6 w-6" />
            </button>
          ) : undefined}
          menuItems={[
            ...buildContentTopBarCommonMenuItems(t, {
              id: doc.id,
              type: 'doc',
              title: title || doc.title || '',
              pinned: isPinned ?? false,
              url: buildContentLink({ type: 'doc', id: doc.id }),
              startRename: () => {},
              openIconPicker: () => {},
              togglePin: () => onTogglePin?.(),
              deleteItem: handleDelete,
              downloadItem: () => {
                const blob = new Blob([doc.text], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `${title}.md`; a.click();
                URL.revokeObjectURL(url);
              },
              shareItem: () => {},
              copyLink: () => { navigator.clipboard.writeText(buildContentLink({ type: 'doc', id: doc.id })); },
              showHistory: () => setShowHistory(true),
              showComments: () => onShowComments(),
              search: () => { setShowSearch(true); setSearchWithReplace(false); },
            }),
            { icon: Maximize2, label: t('content.fullWidth'), separator: true, desktopOnly: true, onClick: () => {}, desktopRender: (
              <DocMenuToggle icon={Maximize2} label={t('content.fullWidth')} checked={fullWidth} onChange={async (v) => {
                setFullWidth(v);
                await docApi.updateDocument(doc.id, undefined, undefined, undefined, { fullWidth: v });
              }} />
            ) },
          ]}
          actions={renderFixedTopBarActions(
            buildFixedTopBarActionItems(t, {
              id: doc.id,
              type: 'doc',
              title: doc.title,
              pinned: isPinned ?? false,
              url: typeof window !== 'undefined' ? window.location.href : '',
              startRename: () => {},
              openIconPicker: () => {},
              togglePin: () => onTogglePin?.(),
              deleteItem: handleDelete,
              downloadItem: handleExport,
              shareItem: () => {},
              copyLink: handleCopyLink,
              showHistory: () => setShowHistory(v => !v),
              showComments: () => onToggleComments(),
              search: () => { setShowSearch(true); setSearchWithReplace(false); },
              showHistoryActive: showHistory,
              showCommentsActive: showComments,
            }),
            { t, ctx: { showHistoryActive: showHistory, showCommentsActive: showComments } as any }
          )}
        />
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        <div className={cn('flex-1 min-h-0 min-w-0 flex flex-col overflow-y-auto', fullWidth && 'doc-full-width')}>
          {/* Revision preview banner */}
          {previewRevision && (
            <RevisionPreviewBanner
              createdAt={previewRevision.createdAt}
              onExit={() => { setShowHistory(false); setPreviewRevision(null); setPrevRevision(null); }}
              onRestore={async () => {
                if (!confirm(t('content.restoreVersionWarning', { type: t('content.typeDoc') }))) return;
                try {
                  await gw.restoreContentRevision(`doc:${doc.id}`, previewRevision.id);
                  setShowHistory(false);
                  setPreviewRevision(null);
                  setPrevRevision(null);
                  // Refresh editor in-place instead of full page reload
                  await queryClient.invalidateQueries({ queryKey: ['document', doc.id] });
                  await queryClient.invalidateQueries({ queryKey: ['content-items'] });
                  const restored = await queryClient.fetchQuery({ queryKey: ['document', doc.id], queryFn: () => docApi.getDocument(doc.id) });
                  setTitle(restored.title);
                  setText(restored.text);
                  latestTitleRef.current = restored.title;
                  latestTextRef.current = restored.text;
                  latestEmojiRef.current = (restored.icon || null) as string | null;
                  setEditorKey(k => k + 1);
                  onSaved();
                } catch (e: unknown) {
                  alert(e instanceof Error ? e.message : t('content.restoreVersionFailed'));
                }
              }}
            />
          )}
          {/* Title area — emoji inline when set, hover icon positioned outside */}
          <div
            className="doc-title-wrap"
            onMouseEnter={() => setShowTitleIcon(true)}
            onMouseLeave={() => { if (!showEmojiPicker) setShowTitleIcon(false); }}
          >
          <div className="doc-title-area group/title">
            <div className="relative flex items-center" ref={emojiPickerRef}>
              {/* Emoji or hover icon — absolute positioned to the LEFT, outside content area */}
              {!previewRevision && emoji ? (
                <button
                  onClick={() => setShowEmojiPicker(v => !v)}
                  className="absolute -left-12 top-1/2 -translate-y-1/2 text-4xl leading-none hover:opacity-70 transition-opacity"
                  title={t('icon.changeIcon')}
                >
                  {emoji.startsWith('/api/') || emoji.startsWith('http') ? (
                    <img src={emoji} alt="icon" className="w-9 h-9 rounded object-cover" />
                  ) : emoji}
                </button>
              ) : !previewRevision && showTitleIcon ? (
                <button
                  onClick={() => setShowEmojiPicker(v => !v)}
                  className="absolute -left-10 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground/30 hover:text-muted-foreground hover:bg-black/5 transition-all"
                  title={t('icon.addIcon')}
                >
                  <Smile className="h-6 w-6" />
                </button>
              ) : null}
              {/* Title — show revision title (read-only) or editable input */}
              {previewRevision ? (
                <div className="flex-1 min-w-0 text-[2.5rem] font-bold text-foreground leading-tight opacity-70">
                  {previewRevision.title || t('content.untitled')}
                </div>
              ) : (
                <input
                  ref={titleInputRef}
                  autoFocus={!doc.title && !mobileReadOnly}
                  readOnly={mobileReadOnly}
                  value={title}
                  onChange={handleTitleChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const wrapper = (e.target as HTMLElement).closest('.doc-title-wrap');
                      const mount = wrapper?.parentElement?.querySelector('.outline-editor-mount') as any;
                      const view = mount?.__pmView;
                      if (view) {
                        view.focus();
                        const sel = view.state.selection.constructor.create(view.state.doc, 1);
                        view.dispatch(view.state.tr.setSelection(sel));
                      }
                    }
                  }}
                  placeholder={t('content.untitled')}
                  className="flex-1 min-w-0 text-[2.5rem] font-bold text-foreground bg-transparent border-none outline-none placeholder:text-muted-foreground/30 leading-tight"
                />
              )}
              {/* Emoji picker dropdown */}
              {showEmojiPicker && !previewRevision && (
                <div className="absolute -left-12 top-full mt-1 z-50 rounded-lg shadow-xl overflow-hidden">
                  <EmojiPicker
                    onSelect={(em) => handleEmojiSelect(em)}
                    onRemove={emoji ? () => handleEmojiSelect(null) : undefined}
                    onUploadImage={async (file) => {
                      const result = await docApi.uploadFile(file, doc.id);
                      return result.url;
                    }}
                  />
                </div>
              )}
            </div>
            <div className="mb-8" />
          </div>
          </div>

          {/* Search bar — sticky at top of scroll container */}
          {!previewRevision && showSearch && (
            <div className="sticky top-0 z-30 flex justify-end pr-4">
              <SearchBar
                getView={() => {
                  const mount = document.querySelector('.outline-editor-mount') as any;
                  return mount?.__pmView || null;
                }}
                showReplace={searchWithReplace}
                onClose={() => setShowSearch(false)}
              />
            </div>
          )}

          {/* Editor / Revision preview area */}
          <div className="relative flex-1 min-h-0">
            {!previewRevision && !isMobile && (
              <DocOutline getView={getEditorView} />
            )}
            {previewRevision ? (
              <RevisionPreview
                key={previewRevision.id + (highlightChanges ? '-diff' : '')}
                data={previewRevision.data}
                prevData={prevRevision?.data}
                highlightChanges={highlightChanges}
              />
            ) : (
              <Editor
                key={`${doc.id}-${editorKey}`}
                defaultValue={doc.text}
                defaultDocJson={doc.data_json}
                onChange={handleTextChange}
                onDocJson={(json) => { latestDocJsonRef.current = json; scheduleTextSave(latestTextRef.current); }}
                readOnly={mobileReadOnly}
                placeholder={t('content.editorPlaceholder')}
                documentId={doc.id}
                onSearchOpen={(withReplace) => { setShowSearch(true); setSearchWithReplace(withReplace); }}
                commentQuotes={commentHighlightQuotes}
              />
            )}
          </div>
        </div>

      </div>

    {/* Mobile: comment bar (preview mode only) + EditFAB */}
    {isMobile && !mobileEditMode && (
      <MobileCommentBar
        onClick={() => { onShowComments(); setShowHistory(false); }}
        rightSlot={
          <button
            onClick={() => setMobileEditMode(true)}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-card text-foreground shadow-[0px_0px_20px_0px_rgba(0,0,0,0.08)] border border-border shrink-0"
          >
            <Pencil className="w-5 h-5" />
          </button>
        }
      />
    )}
    {isMobile && mobileEditMode && (
      <EditFAB
        isEditing={true}
        onEdit={() => setMobileEditMode(true)}
        onSave={handleMobileSave}
        onCancel={handleMobileCancel}
      />
    )}
    </div>{/* end left column */}

      {/* Sidebar — full height on desktop, BottomSheet on mobile */}
      {showComments && !showHistory && (
        <>
          <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
            <CommentPanel
              targetType="doc"
              targetId={`doc:${doc.id}`}
              anchorType={commentAnchor?.type}
              anchorId={commentAnchor?.id}
              anchorMeta={commentAnchor?.meta}
              onClose={() => onCloseComments()}
              focusCommentId={activeFocusCommentId}
              onAnchorUsed={() => setCommentAnchor(null)}
              onNavigateToAnchor={navigateToAnchor}
            />
          </div>
          <BottomSheet open={true} onClose={() => onCloseComments()} initialHeight="full">
            <CommentPanel
              targetType="doc"
              targetId={`doc:${doc.id}`}
              anchorType={commentAnchor?.type}
              anchorId={commentAnchor?.id}
              anchorMeta={commentAnchor?.meta}
              onClose={() => onCloseComments()}
              focusCommentId={activeFocusCommentId}
              onAnchorUsed={() => setCommentAnchor(null)}
              onNavigateToAnchor={navigateToAnchor}
              autoFocus
            />
          </BottomSheet>
        </>
      )}

      {showHistory && (
        <>
          <div className="hidden md:flex w-[304px] bg-sidebar flex-col shrink-0 overflow-hidden h-full">
            <RevisionHistory
              contentType="doc"
              contentId={doc.id}
              onClose={() => { setShowHistory(false); setPreviewRevision(null); setPrevRevision(null); }}
              onCreateManualVersion={async () => { await gw.createContentManualSnapshot(`doc:${doc.id}`); }}
              onSelectRevision={(rev) => {
                if (!rev) { setPreviewRevision(null); setPrevRevision(null); return; }
                setPreviewRevision({ id: rev.id, documentId: doc.id, title: '', trigger_type: rev.trigger_type || null, description: rev.description || null, data: rev.data, createdAt: rev.created_at, createdBy: { id: rev.created_by || '', name: rev.created_by || '' } });
              }}
              onRestore={async () => {
                setPreviewRevision(null); setPrevRevision(null);
                await queryClient.invalidateQueries({ queryKey: ['document', doc.id] });
                await queryClient.invalidateQueries({ queryKey: ['content-items'] });
                const restored = await queryClient.fetchQuery({ queryKey: ['document', doc.id], queryFn: () => docApi.getDocument(doc.id) });
                setTitle(restored.title);
                setText(restored.text);
                latestTitleRef.current = restored.title;
                latestTextRef.current = restored.text;
                latestEmojiRef.current = (restored.icon || null) as string | null;
                setEditorKey(k => k + 1);
                onSaved();
              }}
            />
          </div>
          {/* Mobile: RevisionHistory renders its own BottomSheet internally */}
          <div className="md:hidden">
            <RevisionHistory
              contentType="doc"
              contentId={doc.id}
              onClose={() => { setShowHistory(false); setPreviewRevision(null); setPrevRevision(null); }}
              onCreateManualVersion={async () => { await gw.createContentManualSnapshot(`doc:${doc.id}`); }}
              onSelectRevision={(rev) => {
                if (!rev) { setPreviewRevision(null); setPrevRevision(null); return; }
                setPreviewRevision({ id: rev.id, documentId: doc.id, title: '', trigger_type: rev.trigger_type || null, description: rev.description || null, data: rev.data, createdAt: rev.created_at, createdBy: { id: rev.created_by || '', name: rev.created_by || '' } });
              }}
              onRestore={async () => {
                setPreviewRevision(null); setPrevRevision(null);
                await queryClient.invalidateQueries({ queryKey: ['document', doc.id] });
                await queryClient.invalidateQueries({ queryKey: ['content-items'] });
                const restored = await queryClient.fetchQuery({ queryKey: ['document', doc.id], queryFn: () => docApi.getDocument(doc.id) });
                setTitle(restored.title);
                setText(restored.text);
                latestTitleRef.current = restored.title;
                latestTextRef.current = restored.text;
                latestEmojiRef.current = (restored.icon || null) as string | null;
                setEditorKey(k => k + 1);
                onSaved();
              }}
            />
          </div>
        </>
      )}

      {/* Mobile: More menu is now handled by ContentTopBar via menuItems */}

      {/* Mobile: Doc outline BottomSheet */}
      {isMobile && (
        <BottomSheet
          open={showMobileOutline}
          onClose={() => setShowMobileOutline(false)}
          title="目录"
          initialHeight="half"
        >
          <DocOutlineList
            headings={(() => {
              const view = getEditorView();
              return view ? extractHeadings(view.state.doc) : [];
            })()}
            onSelect={(pos: number) => {
              setShowMobileOutline(false);
              setTimeout(() => scrollToHeading(getEditorView(), pos), 300);
            }}
          />
        </BottomSheet>
      )}

    </div>
  );
}
