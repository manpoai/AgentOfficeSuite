import { FileText, Table2, Presentation, GitBranch, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface EntityNameDef {
  singular: string;
  singularKey: string;
  createLabelKey: string;
  icon: LucideIcon;
  type: string;
}

export const ENTITY_NAMES: Record<string, EntityNameDef> = {
  doc: {
    singular: 'Doc',
    singularKey: 'entities.doc',
    createLabelKey: 'actions.newDoc',
    icon: FileText,
    type: 'doc',
  },
  table: {
    singular: 'Table',
    singularKey: 'entities.table',
    createLabelKey: 'actions.newTable',
    icon: Table2,
    type: 'table',
  },
  presentation: {
    singular: 'Slides',
    singularKey: 'entities.slides',
    createLabelKey: 'actions.newSlides',
    icon: Presentation,
    type: 'presentation',
  },
  diagram: {
    singular: 'Flowchart',
    singularKey: 'entities.flowchart',
    createLabelKey: 'actions.newFlowchart',
    icon: GitBranch,
    type: 'diagram',
  },
  agent: {
    singular: 'Agent',
    singularKey: 'entities.agent',
    createLabelKey: 'actions.newAgent',
    icon: Users,
    type: 'agent',
  },
};

export const CREATABLE_TYPES = ['doc', 'table', 'presentation', 'diagram'] as const;
export type CreatableType = typeof CREATABLE_TYPES[number];
