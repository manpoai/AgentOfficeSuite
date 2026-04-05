'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as docApi from '@/lib/api/documents';
import type { Document as DocType, Revision as DocRevision } from '@/lib/api/documents';
import { Trash2, X, Search, Clock, MessageSquare as MessageSquareIcon, Download, Smile, Maximize2, Link2, Pin, ExternalLink, AtSign, Share2, Pencil } from 'lucide-react';
import { ContentTopBar } from '@/components/shared/ContentTopBar';
import { EmojiPicker } from '@/components/EmojiPicker';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/utils/error';
import { formatRelativeTime, formatDateTime } from '@/lib/utils/time';
import dynamic from 'next/dynamic';
import { SearchBar } from '@/components/editor';
import { CommentPanel } from '@/components/shared/CommentPanel';
import { RevisionHistory } from '@/components/shared/RevisionHistory';
import { EditFAB } from '@/components/shared/EditFAB';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { MobileCommentBar } from '@/components/shared/MobileCommentBar';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import * as gw from '@/lib/api/gateway';
import { useT } from '@/lib/i18n';
import { useKeyboardScope } from '@/lib/keyboard';
import type { ShortcutRegistration } from '@/lib/keyboard';
import { EditorSkeleton } from '@/components/shared/Skeleton';

const Editor = dynamic(
  () => import('@/components/editor/Editor').then(m => ({ default: m.Editor })),
  { ssr: false, loading: () => <EditorSkeleton /> }
);

const RevisionPreview = dynamic(() => import('@/components/RevisionPreview'), { ssr: false, loading: () => <EditorSkeleton /> });

/** Build a shareable link for a content item */
function buildContentLink(sel: { type: string; id: string }): string {
  const url = new URL(window.location.href);
  url.searchParams.set('id', `${sel.type}:${sel.id}`);
  return url.toString();
}

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

export function DocPanel({ doc, customIcon, breadcrumb, onBack, onSaved, onDeleted, onNavigate, docListVisible, onToggleDocList }: {
  doc: DocType;
  customIcon?: string;
  breadcrumb: { id: string; title: string }[];
  onBack: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onNavigate: (docId: string) => void;
  docListVisible?: boolean;
  onToggleDocList?: () => void;
}) {
  const { t } = useT();

  // Register document keyboard scope + shortcuts for help panel display
  useKeyboardScope('document', DOC_SHORTCUTS);
  const queryClient = useQueryClient();

  // Shared comment fetch function — used by both highlight extraction and Comments component
  const fetchDocComments = useCallback(async () => {
    const comments = await docApi.listComments(doc.id);
    return comments.map(c => ({
      id: c.id,
      text: docApi.proseMirrorToText(c.data),
      actor: c.createdBy?.name || 'Unknown',
      parent_id: c.parentCommentId || null,
      resolved_by: c.resolvedBy || null,
      resolved_at: c.resolvedAt || null,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    }));
  }, [doc.id]);

  // Fetch comments — shared query key with Comments component so invalidation works
  const { data: docComments = [] } = useQuery({
    queryKey: ['doc-comments', doc.id],
    queryFn: fetchDocComments,
  });
  // Extract quoted text from comments for editor highlighting (skip resolved comments)
  const commentHighlightQuotes = useMemo(() => {
    return docComments
      .filter(c => !c.resolved_by) // Don't highlight resolved comments
      .map(c => {
        const match = c.text.match(/^>\s(.+?)(?:\n\n)/);
        return match ? { id: c.id, text: match[1] } : null;
      })
      .filter((q): q is { id: string; text: string } => q !== null);
  }, [docComments]);

  const [showComments, setShowComments] = useState(false);
  const [showDocMenu, setShowDocMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [commentQuote, setCommentQuote] = useState('');
  const [title, setTitle] = useState(doc.title);
  const [emoji, setEmoji] = useState<string | null>(customIcon || doc.icon?.trim() || null);
  const [text, setText] = useState(doc.text);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
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
  // New docs (empty title + text) auto-enter edit mode on mobile
  const [mobileEditMode, setMobileEditMode] = useState(() => !!(isMobile && !doc.title && !doc.text));
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
        setShowComments(true);
        // Calculate top offset of the selection for sidebar alignment
        const editorArea = document.querySelector('.outline-editor');
        if (editorArea) {
          const editorRect = editorArea.getBoundingClientRect();
          // Try selection range first (inline comments), then blockRect (block comments)
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

  // Click handler for comment marks in editor — highlight and open sidebar
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const commentEl = target.closest('.comment-marker') as HTMLElement | null;
      if (!commentEl) {
        // Clicked outside a comment mark — clear focus
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

      // Clear previous focus
      document.querySelectorAll('.comment-marker.comment-focused').forEach(el =>
        el.classList.remove('comment-focused')
      );

      // Add focus to all spans of this comment (may span multiple nodes)
      document.querySelectorAll(`#comment-${id}`).forEach(el =>
        el.classList.add('comment-focused')
      );
      setFocusedCommentId(id);

      // Calculate offset for sidebar alignment
      const editorArea = document.querySelector('.outline-editor');
      if (editorArea) {
        const editorRect = editorArea.getBoundingClientRect();
        const markRect = commentEl.getBoundingClientRect();
        setCommentTopOffset(markRect.top - editorRect.top);
      }

      // Open comments sidebar if not already open
      if (!showComments) setShowComments(true);
    };
    document.addEventListener('mouseup', handler);
    return () => document.removeEventListener('mouseup', handler);
  }, [focusedCommentId, showComments]);

  // Global Cmd+F / Cmd+H to open search bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'f') {
        // Only intercept if not already inside ProseMirror (editor handles its own)
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

  // Reset local state and cancel pending saves when switching to a different document
  useEffect(() => {
    // Cancel any pending saves from previous doc
    if (titleSaveTimerRef.current) { clearTimeout(titleSaveTimerRef.current); titleSaveTimerRef.current = null; }
    if (textSaveTimerRef.current) { clearTimeout(textSaveTimerRef.current); textSaveTimerRef.current = null; }
    docIdRef.current = doc.id;
    setTitle(doc.title);
    setEmoji(customIcon || doc.icon?.trim() || null);
    setText(doc.text);
    latestTitleRef.current = doc.title;
    latestTextRef.current = doc.text;
    latestEmojiRef.current = (customIcon || doc.icon || null) as string | null;
    setSaveStatus('saved');
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

  // Shared save execution — saves document via Gateway API
  const executeSave = useCallback(async (saveDocId: string, titleVersion: number, textVersion: number) => {
    if (saveDocId !== docIdRef.current) return;
    setSaveStatus('saving');
    try {
      const savingTitle = latestTitleRef.current;
      const savingText = latestTextRef.current;
      const savingEmoji = latestEmojiRef.current;
      const docEmoji = savingEmoji && (savingEmoji.startsWith('/api/') || savingEmoji.startsWith('http')) ? null : savingEmoji;
      const titleToSave = savingTitle ?? '';
      const savedDoc = await docApi.updateDocument(saveDocId, titleToSave, savingText, docEmoji);
      // Only update cache if no newer save of either type has been scheduled
      if (titleVersionRef.current !== titleVersion || textVersionRef.current !== textVersion) return;
      const confirmedTitle = savedDoc.title;
      const confirmedEmoji = savingEmoji;
      queryClient.setQueryData<DocType>(['document', saveDocId], (old) =>
        old ? { ...old, title: confirmedTitle, text: savingText, icon: confirmedEmoji } : old
      );
      queryClient.invalidateQueries({ queryKey: ['content-items'] });
      if (saveDocId === docIdRef.current) {
        setSaveStatus('saved');
      }
    } catch (e) {
      showError('Auto-save failed', e);
      if (saveDocId === docIdRef.current) setSaveStatus('error');
    }
  }, [queryClient]);

  // Schedule title save — only updates title ref, does not touch text ref
  const scheduleTitleSave = useCallback((newTitle: string, newEmoji?: string | null) => {
    latestTitleRef.current = newTitle;
    if (newEmoji !== undefined) latestEmojiRef.current = newEmoji;
    setSaveStatus('unsaved');
    if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
    // Also cancel any pending text save — the combined save will include both
    if (textSaveTimerRef.current) { clearTimeout(textSaveTimerRef.current); textSaveTimerRef.current = null; }
    const saveDocId = docIdRef.current;
    const tv = ++titleVersionRef.current;
    const xv = textVersionRef.current;
    titleSaveTimerRef.current = setTimeout(() => executeSave(saveDocId, tv, xv), 500);
  }, [executeSave]);

  // Schedule text save — only updates text ref, does not touch title ref
  const scheduleTextSave = useCallback((newText: string) => {
    latestTextRef.current = newText;
    setSaveStatus('unsaved');
    if (textSaveTimerRef.current) clearTimeout(textSaveTimerRef.current);
    // Also cancel any pending title save — the combined save will include both
    if (titleSaveTimerRef.current) { clearTimeout(titleSaveTimerRef.current); titleSaveTimerRef.current = null; }
    const saveDocId = docIdRef.current;
    const tv = titleVersionRef.current;
    const xv = ++textVersionRef.current;
    textSaveTimerRef.current = setTimeout(() => executeSave(saveDocId, tv, xv), 500);
  }, [executeSave]);

  // Flush any pending save immediately
  const flushDocSave = useCallback(() => {
    if (titleSaveTimerRef.current || textSaveTimerRef.current) {
      if (titleSaveTimerRef.current) { clearTimeout(titleSaveTimerRef.current); titleSaveTimerRef.current = null; }
      if (textSaveTimerRef.current) { clearTimeout(textSaveTimerRef.current); textSaveTimerRef.current = null; }
      executeSave(docIdRef.current, titleVersionRef.current, textVersionRef.current);
    }
  }, [executeSave]);

  useEffect(() => {
    // Flush on tab/window switch
    const onVisibilityChange = () => {
      if (document.hidden) flushDocSave();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    // Flush on page unload
    const onBeforeUnload = () => flushDocSave();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Flush on unmount (switching to another content item)
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
      // Image-based icon: save to Gateway as custom icon (URL icons not stored in doc metadata)
      // Clear doc's native emoji field
      scheduleTitleSave(title, null);
      try {
        await gw.setDocIcon(doc.id, selectedEmoji);
        queryClient.invalidateQueries({ queryKey: ['content-items'] });
      } catch (e) {
        showError('Failed to save custom icon', e);
      }
    } else {
      // Unicode emoji or null (remove): save to Gateway doc metadata, remove custom icon
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
    onDeleted(); // delegate to parent — handles children dialog, trash, navigation
  };

  const statusText = saveStatus === 'saving' ? t('content.saving') : saveStatus === 'unsaved' ? t('content.unsaved') : saveStatus === 'error' ? t('content.saveFailed') : '';

  // Mobile preview/edit mode: on mobile, default to read-only preview
  const mobileReadOnly = isMobile && !mobileEditMode;

  const getEditorView = useCallback(() => {
    const mount = document.querySelector('.outline-editor-mount') as any;
    return mount?.__pmView || null;
  }, []);

  // Cancel mobile edit mode
  const handleMobileCancel = useCallback(() => {
    setMobileEditMode(false);
  }, []);

  // Save from mobile edit mode
  const handleMobileSave = useCallback(() => {
    setMobileEditMode(false);
  }, []);

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
          metaLine={
            <button
              onClick={() => setShowHistory(true)}
              className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
            >
              Last modified: {formatRelativeTime(doc.updated_at)}
              {doc.updated_by && <span> by {doc.updated_by}</span>}
            </button>
          }
          statusText={statusText}
          statusError={saveStatus === 'error'}
          mode={isMobile && mobileEditMode ? 'edit' : 'preview'}
          onCancelEdit={handleMobileCancel}
          onSave={handleMobileSave}
          onHistory={() => setShowHistory(true)}
          onComments={() => setShowComments(v => !v)}
          menuItems={[
            { icon: Link2, label: 'Copy link', shortcut: '⌘⇧L', onClick: () => { navigator.clipboard.writeText(buildContentLink({ type: 'doc', id: doc.id })); } },
            { icon: Pin, label: 'Pin to top', onClick: () => {} },
            { icon: Download, label: 'Download', onClick: () => {
              const blob = new Blob([doc.text], { type: 'text/markdown' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `${title}.md`; a.click();
              URL.revokeObjectURL(url);
            } },
            { icon: Share2, label: 'Share', onClick: () => {} },
            { icon: Trash2, label: 'Move to Trash', danger: true, onClick: handleDelete },
            { icon: Clock, label: 'Version History', separator: true, shortcut: '⌘⇧H', onClick: () => setShowHistory(true) },
            { icon: MessageSquareIcon, label: 'Comments', shortcut: '⌘J', onClick: () => setShowComments(true) },
            { icon: Search, label: 'Search and Replace', shortcut: '⌘F', onClick: () => { setShowSearch(true); setSearchWithReplace(false); } },
            { icon: Maximize2, label: 'Full width', separator: true, desktopOnly: true, onClick: () => {}, desktopRender: (
              <DocMenuToggle icon={Maximize2} label="Full width" checked={fullWidth} onChange={async (v) => {
                setFullWidth(v);
                await docApi.updateDocument(doc.id, undefined, undefined, undefined, { fullWidth: v });
              }} />
            ) },
          ]}
          actions={<>
            {/* Search — Figma: magnifying glass */}
            <button
              onClick={() => { setShowSearch(true); setSearchWithReplace(false); }}
              className="p-2 text-black/70 dark:text-white/70 hover:text-foreground rounded transition-colors"
              title={t('toolbar.search')}
            >
              <Search className="h-4 w-4" />
            </button>
            {/* Share button — Figma: bordered, external-link icon + text */}
            <button className="flex items-center gap-1.5 h-8 px-3 ml-1 border border-black/20 dark:border-white/20 rounded-lg text-sm font-medium text-black/70 dark:text-white/70 hover:bg-black/[0.04] transition-colors">
              <ExternalLink className="h-4 w-4" />
              {t('actions.share')}
            </button>
            {/* History — Figma: bordered square */}
            <button
              onClick={() => setShowHistory(v => !v)}
              className={cn('flex items-center justify-center w-8 h-8 ml-1 border border-black/20 dark:border-white/20 rounded-lg transition-colors', showHistory ? 'text-sidebar-primary bg-sidebar-primary/10 border-sidebar-primary/20' : 'text-black/70 dark:text-white/70 hover:bg-black/[0.04]')}
              title={t('content.versionHistory')}
            >
              <Clock className="h-4 w-4" />
            </button>
            {/* @ Comments — Figma: green circle */}
            <button
              onClick={() => setShowComments(v => !v)}
              className={cn('flex items-center justify-center w-8 h-8 ml-1 rounded-lg transition-colors', showComments ? 'bg-sidebar-primary/80' : 'bg-sidebar-primary hover:bg-sidebar-primary/90')}
              title={t('content.comments')}
            >
              <AtSign className="h-4 w-4 text-white" />
            </button>
          </>}
        />
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        <div className={cn('flex-1 min-h-0 min-w-0 flex flex-col overflow-y-auto', fullWidth && 'doc-full-width')}>
          {/* Revision preview banner with exit button */}
          {previewRevision && (
            <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 shrink-0">
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-sm text-amber-800 dark:text-amber-300 flex-1">
                {t('content.previewingVersion') || 'Previewing historical version'} — {formatDateTime(previewRevision.createdAt)}
              </span>
              <button
                onClick={() => { setShowHistory(false); setPreviewRevision(null); setPrevRevision(null); }}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                {t('content.exitPreview') || 'Exit preview'}
              </button>
            </div>
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
                        // Place cursor at start of first block (pos 1 = inside first block node)
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
            {previewRevision ? (
              <RevisionPreview
                key={previewRevision.id + (highlightChanges ? '-diff' : '')}
                data={previewRevision.data}
                prevData={prevRevision?.data}
                highlightChanges={highlightChanges}
              />
            ) : (
              <Editor
                key={`${doc.id}-${editorKey}${mobileReadOnly ? '-ro' : ''}`}
                defaultValue={doc.text}
                onChange={handleTextChange}
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
        targetType="doc"
        targetId={`doc:${doc.id}`}
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
              onClose={() => setShowComments(false)}
            />
          </div>
          <BottomSheet open={true} onClose={() => setShowComments(false)} title={t('content.comments')} initialHeight="full">
            <CommentPanel
              targetType="doc"
              targetId={`doc:${doc.id}`}
              onClose={() => setShowComments(false)}
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
              onRestore={async () => {
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
              onRestore={async () => {
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

    </div>
  );
}
