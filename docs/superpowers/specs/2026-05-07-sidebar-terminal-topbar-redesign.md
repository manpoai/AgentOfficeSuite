# Sidebar Terminal + Top Bar Redesign

## Goal

Reorganize the AOSE desktop app layout: move the terminal from the bottom panel into the sidebar, add a top navigation bar with files/tasks/skills/memory/notifications tabs, and support light/dark terminal themes.

## Architecture

The redesign touches three areas: (1) top bar — new navigation strip with 5 icon tabs above the sidebar, (2) sidebar — terminal moves into the lower half, agent avatars at the bottom, (3) bottom panel — removed entirely. The main content area gains 100% vertical space. Web and Electron share the layout; terminal features are Electron-only behind `electronAPI` detection.

## Tech Stack

- Next.js (existing shell app)
- xterm.js + FitAddon (existing terminal rendering)
- next-themes (existing dark/light support)
- Tailwind CSS with CSS variables (existing theming)
- Electron IPC (existing terminal bridge)

---

## 1. Top Bar Navigation

### Current state
No dedicated top bar. The sidebar contains profile, search, agents button, and document tree in a single column.

### New design (from mockup)
A horizontal strip at the very top of the sidebar area, below the macOS traffic lights:

```
[traffic lights]  [files] [tasks] [skills] [memory] [notifications]
```

- **Files** (document icon, green/active) — shows the current sidebar content (document tree)
- **Tasks** (clipboard icon) — empty shell, placeholder page
- **Skills** (person/team icon) — empty shell, placeholder page
- **Memory** (chat bubble icon) — empty shell, placeholder page
- **Notifications** (bell icon) — opens notification panel (existing functionality, relocated)

### Behavior
- Icons are top-level navigation within the sidebar
- Only "Files" has real content; the other three render a centered placeholder ("Coming soon" or empty state)
- Active tab gets the green highlight (sidebar-primary color)
- The search bar and document tree sit below this icon strip (when Files is active)
- Notifications bell opens the existing notification dropdown (reuse NotificationPanel)

### Implementation
- New component: `SidebarTopNav.tsx`
- Renders inside ContentSidebar, replacing the current profile row position
- Profile row moves: avatar + username become part of the bottom area or stay at top but below the nav strip
- State: `activeTab: 'files' | 'tasks' | 'skills' | 'memory'`
- Notifications is not a tab but a bell icon button that toggles the existing notification dropdown

## 2. Sidebar Layout Changes

### Current state
- Default width: 232px, range 200-480px, stored in localStorage
- Content: profile row → search → agents/message buttons → document tree → logo
- Terminal is in a separate bottom panel (AgentTerminalPanel) in the main content area

### New design

#### Width
- Default width: **280px** (up from 232px)
- Range: 200-480px (unchanged)
- localStorage key: `aose-sidebar-width` (unchanged, just new default)
- Double-click reset: 280px (was 232px)

#### Vertical layout (top to bottom)

```
┌─────────────────────────┐
│ Profile row (avatar+name)│
│ Top nav icons            │
│ Search bar               │
├─────────────────────────┤
│                          │
│ Document tree (Pinned,   │
│   Library) — scrollable  │
│                          │
├─── drag handle ─────────┤  ← vertical resize (only when terminal open)
│                          │
│ Terminal (xterm, normal   │
│   stdin — user types in  │
│   terminal directly)     │
│                          │
├─────────────────────────┤
│ [avatar][avatar][avatar] │
│            [@Agents]     │
└─────────────────────────┘
```

#### Agent avatar bar (bottom)
- Always visible at sidebar bottom
- Shows agent avatars as small circles (32px), left-aligned
- If more agents than fit: show visible ones + `@ Agents` button absorbs the overflow count (e.g., `@ Agents (3)`)
- Green `@ Agents` button always present at the right side
- Click avatar → select that agent, expand terminal area
- Click `@ Agents` → open agent management panel (existing AgentPanelContent in popover) which also shows the full list of agents + "Connect new agent" entry
- No agent selected → terminal area collapsed, only avatar bar visible

#### Terminal area
- Only visible when an agent avatar is clicked (agent selected)
- Renders xterm.js with normal stdin enabled (user types directly in terminal, same as current behavior)
- Takes up lower portion of sidebar, above avatar bar
- Height adjustable via drag handle between document tree and terminal
- Default split: 60% tree / 40% terminal (when open)
- Min terminal height: 120px
- Min tree height: 100px

### Web vs Electron
- **Electron**: Full terminal + pty interaction
- **Web**: Agent avatars shown (from gateway API), click does nothing (no terminal). `@ Agents` button opens management panel only.

## 3. Terminal Theme (Light/Dark)

### Current state
Terminal uses a hardcoded dark theme:
```js
theme: {
  background: '#1a1a2e',
  foreground: '#e0e0e0',
  cursor: '#ffffff',
  selectionBackground: '#3a3a5e',
}
```

### New design
Two theme presets that follow the global AOSE theme:

**Light mode:**
```js
{
  background: '#ffffff',        // or match --card: hsl(0 0% 100%)
  foreground: '#1a1a1a',
  cursor: '#333333',
  selectionBackground: '#d0d0d0',
  selectionForeground: '#1a1a1a',
}
```

**Dark mode:**
```js
{
  background: '#1a1a2e',        // keep current dark
  foreground: '#e0e0e0',
  cursor: '#ffffff',
  selectionBackground: '#3a3a5e',
}
```

### Implementation
- In `AgentTerminalTab.tsx`, read current theme from `useTheme()` or from a prop
- Apply the matching xterm theme on mount
- Listen for theme changes and update terminal theme dynamically via `terminal.options.theme = ...`
- The terminal container background should also match (CSS class toggle)

## 4. Bottom Panel Removal

### Current state
`AgentTerminalPanel` renders in `AppShell.tsx` below `<main>`, with its own tab bar, resize handle, and collapse/expand.

### New design
- Remove `AgentTerminalPanel` from `AppShell.tsx`
- Terminal rendering moves into the sidebar (new component within ContentSidebar)
- The `AgentTerminalTab` component is reused as-is for xterm rendering
- Tab management (multiple agents) is replaced by avatar selection in the bottom bar
- The `ensureGlobalListener` / `resetGlobalListener` pattern stays unchanged

## 5. Component Breakdown

### New components
1. **`SidebarTopNav.tsx`** — 5-icon navigation strip
2. **`SidebarTerminal.tsx`** — Terminal area within sidebar (wraps AgentTerminalTab + manages selected agent state)
3. **`SidebarAgentBar.tsx`** — Bottom avatar row + Agents button
4. **`EmptyTabPage.tsx`** — Placeholder for tasks/skills/memory tabs

### Modified components
1. **`ContentSidebar.tsx`** — Major restructure: integrate new components, remove agents/message buttons from current position, adjust width defaults
2. **`AppShell.tsx`** — Remove `AgentTerminalPanel` import and rendering
3. **`AgentTerminalTab.tsx`** — Add theme support (light/dark)
4. **`globals.css`** — Add terminal theme CSS variables (optional, could be inline)

### Removed components
1. **`AgentTerminalPanel.tsx`** — Replaced by sidebar-integrated terminal

## 6. State Management

### Agent selection state
- `selectedAgentId: string | null` — which agent's terminal is shown
- Lives in ContentSidebar (or lifted to ContentPage if needed)
- `null` = terminal collapsed

### Terminal split position
- `terminalHeight: number` — pixels for terminal area
- Stored in localStorage: `aose-sidebar-terminal-height`
- Only active when `selectedAgentId !== null`

### Active sidebar tab
- `activeSidebarTab: 'files' | 'tasks' | 'skills' | 'memory'`
- Lives in ContentSidebar
- Stored in localStorage: `aose-sidebar-tab`

## 7. Edge Cases

- **Sidebar collapsed (w-14)**: Agent avatars hidden, terminal hidden. Only show collapsed icons (existing behavior). Expanding sidebar restores terminal if an agent was selected.
- **Sidebar width too narrow for terminal**: FitAddon handles dynamic column count. At 200px width, terminal gets ~25 columns — usable for chat but tight. Acceptable.
- **Agent deleted while terminal open**: Close terminal, deselect agent, remove avatar.
- **Page refresh**: Reconnect to existing pty via buffer replay (existing behavior), restore selected agent from localStorage.
- **Multiple agents**: Only one terminal visible at a time (selected agent). Switching avatars switches terminal. Each agent's xterm instance stays alive in DOM (display:none for inactive).

## 8. Scope Boundaries

### In scope
- Top bar with 5 icon tabs (files active, others empty shell)
- Sidebar width default 280px
- Terminal in sidebar with vertical resize
- Agent avatar bar at sidebar bottom
- Light/dark terminal theme
- Remove bottom AgentTerminalPanel
- Web compatibility (no terminal, avatars shown, Agents button works)

### Out of scope
- Tasks/Skills/Memory page content (empty placeholders only)
- Fine-grained agent permissions UI
- Terminal custom fonts/sizes settings
- Remote terminal via WebSocket (web client seeing terminal output)
- Agent status indicators on avatars (green dot = running) — can add later but not blocking
