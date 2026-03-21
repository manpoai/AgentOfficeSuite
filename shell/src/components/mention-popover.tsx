'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as mm from '@/lib/api/mm';
import * as gw from '@/lib/api/gateway';
import { cn } from '@/lib/utils';

export interface MentionCandidate {
  id: string;
  username: string;
  displayName: string;
  isAgent?: boolean;
}

interface MentionPopoverProps {
  /** The full text of the input */
  text: string;
  /** Cursor position in the text */
  cursorPos: number;
  /** Called when a mention is selected — returns the text to insert */
  onSelect: (mention: MentionCandidate, replaceFrom: number, replaceTo: number) => void;
  /** Anchor element for positioning */
  anchorRef: React.RefObject<HTMLElement | null>;
}

function useMentionCandidates() {
  // Fetch agents from gateway
  const { data: agents = [] } = useQuery({
    queryKey: ['gw-agents'],
    queryFn: gw.listAgents,
    staleTime: 60_000,
  });

  // Fetch team members from MM
  const { data: teams } = useQuery({
    queryKey: ['mm-teams'],
    queryFn: mm.getTeams,
    staleTime: 120_000,
  });

  const teamId = teams?.[0]?.id;

  const { data: teamUsers = [] } = useQuery({
    queryKey: ['mm-team-users', teamId],
    queryFn: () => mm.autocompleteUsers('', teamId!),
    enabled: !!teamId,
    staleTime: 60_000,
  });

  // Merge: agents + MM users, deduplicated
  const candidates: MentionCandidate[] = [];
  const seen = new Set<string>();

  // Agents first (they're the primary use case per moonyaan)
  agents.forEach(a => {
    const key = a.name;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({
        id: a.agent_id,
        username: a.name,
        displayName: a.display_name || a.name,
        isAgent: true,
      });
    }
  });

  // MM users
  teamUsers.forEach(u => {
    const key = u.username;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({
        id: u.id,
        username: u.username,
        displayName: u.nickname || u.first_name || u.username,
      });
    }
  });

  return candidates;
}

/**
 * Detects @ trigger in text at cursor position.
 * Returns { query, start } if @ is active, null otherwise.
 */
function detectMentionTrigger(text: string, cursorPos: number): { query: string; start: number } | null {
  // Walk backwards from cursor to find @
  let i = cursorPos - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') {
      // Check that @ is at start or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) {
        const query = text.slice(i + 1, cursorPos);
        // Only trigger if query has no spaces (single word)
        if (!/\s/.test(query)) {
          return { query, start: i };
        }
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

export function useMentionPopover(text: string, cursorPos: number) {
  const candidates = useMentionCandidates();
  const trigger = detectMentionTrigger(text, cursorPos);

  if (!trigger) {
    return { isOpen: false, matches: [] as MentionCandidate[], triggerStart: 0, triggerEnd: 0, query: '' };
  }

  const q = trigger.query.toLowerCase();
  const matches = q
    ? candidates.filter(c =>
        c.username.toLowerCase().includes(q) ||
        c.displayName.toLowerCase().includes(q)
      ).slice(0, 8)
    : candidates.slice(0, 8);

  return {
    isOpen: matches.length > 0,
    matches,
    triggerStart: trigger.start,
    triggerEnd: cursorPos,
    query: trigger.query,
  };
}

export function MentionPopover({
  matches,
  selectedIndex,
  onSelect,
  anchorRect,
}: {
  matches: MentionCandidate[];
  selectedIndex: number;
  onSelect: (candidate: MentionCandidate) => void;
  anchorRect?: { left: number; bottom: number } | null;
}) {
  if (matches.length === 0 || !anchorRect) return null;

  return (
    <div
      className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 w-56 max-h-48 overflow-y-auto"
      style={{ left: anchorRect.left, bottom: `calc(100vh - ${anchorRect.bottom}px + 4px)` }}
    >
      {matches.map((m, i) => (
        <button
          key={m.id}
          onMouseDown={(e) => { e.preventDefault(); onSelect(m); }}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left',
            i === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50'
          )}
        >
          {m.isAgent ? (
            <span className="w-5 h-5 rounded-full bg-sidebar-primary/20 flex items-center justify-center text-[10px] text-sidebar-primary shrink-0">A</span>
          ) : (
            <img src={mm.getProfileImageUrl(m.id)} alt="" className="w-5 h-5 rounded-full bg-muted shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <span className="text-sm truncate block">{m.displayName}</span>
            <span className="text-[10px] text-muted-foreground">@{m.username}</span>
          </div>
          {m.isAgent && (
            <span className="text-[9px] bg-sidebar-primary/10 text-sidebar-primary px-1.5 py-0.5 rounded shrink-0">Agent</span>
          )}
        </button>
      ))}
    </div>
  );
}
