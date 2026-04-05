import { FileText, Table2, Presentation, GitBranch, type LucideIcon } from 'lucide-react';

export const TYPE_ICONS: Record<string, LucideIcon> = {
  doc: FileText,
  table: Table2,
  presentation: Presentation,
  diagram: GitBranch,
};

export const TYPE_LABELS: Record<string, string> = {
  doc: 'Document',
  table: 'Table',
  presentation: 'Presentation',
  diagram: 'Diagram',
};
