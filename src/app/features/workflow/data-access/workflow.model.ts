/**
 * Modelo del constructor de workflows.
 *
 * ⚠️ No hay backend de workflows: ni motor, ni definición persistida, ni
 * ejecución (verificado sobre los 25 microservicios y las 31 rutas del
 * Gateway). Esto describe un documento que hoy vive en el navegador; el día
 * que exista el servicio, estos tipos son los que se mapearán al contrato.
 *
 * El árbol se guarda como **lista plana con `parentId` + `branch`** en vez de
 * un grafo con aristas: serializa trivialmente, el árbol se deriva al vuelo y
 * es la misma forma que ya usa `TaskTemplateStep` en el backend (orden +
 * dependencia del padre), así que el mapeo futuro es directo.
 */

export type WorkflowStepCategory = 'trigger' | 'ai-logic' | 'action' | 'utility';

export type WorkflowStepTypeId =
  // Triggers
  | 'new-email'
  | 'form-submitted'
  | 'schedule'
  | 'web-hook'
  | 'manual-trigger'
  // AI & logic
  | 'ai-agent'
  | 'data-enrichment'
  | 'condition'
  | 'router'
  | 'loop'
  // Actions
  | 'send-email'
  | 'send-sms'
  | 'create-record'
  | 'update-record'
  | 'web-hook-request'
  // Utilities
  | 'delay'
  | 'wait-for-event';

/** Rama por la que cuelga un paso de un padre que bifurca. */
export type WorkflowBranch = 'yes' | 'no';

export interface WorkflowStep {
  id: string;
  typeId: WorkflowStepTypeId;
  /** Título editable; arranca con el `defaultTitle` del tipo. */
  title: string;
  subtitle: string;
  /** null = raíz del flujo (el disparador). */
  parentId: string | null;
  /** Solo tiene valor cuando el padre bifurca (`isBranching`). */
  branch: WorkflowBranch | null;
  /** Configuración libre por tipo; la pinta el panel derecho. */
  config: Record<string, string | string[]>;
  /**
   * Posición en el lienzo, si el usuario movió el nodo.
   *
   * Cuando falta, el layout automático decide dónde va: así un paso recién
   * insertado aparece ordenado sin pedirle al usuario que lo coloque, pero en
   * cuanto lo arrastra su posición manda y ya no se le vuelve a mover debajo.
   */
  x?: number;
  y?: number;
}

export interface WorkflowDoc {
  id: string;
  name: string;
  steps: WorkflowStep[];
  updatedAtIso: string;
}

/**
 * Descriptor de un campo de configuración.
 *
 * El panel derecho se pinta a partir de esto en vez de tener un formulario
 * escrito a mano por cada uno de los 17 tipos. Añadir un campo es una línea
 * aquí, y el día que exista backend esto es lo que enviaría como esquema.
 */
export interface WorkflowFieldDef {
  key: string;
  label: string;
  control: 'text' | 'textarea' | 'select' | 'chips';
  /** Solo para `select`. */
  options?: string[];
  placeholder?: string;
}

/**
 * Paleta por tipo. Son clases de Tailwind y no hex sueltos: `accent` tiñe la
 * cabecera del nodo y `chip` el icono del catálogo.
 */
export interface WorkflowStepType {
  id: WorkflowStepTypeId;
  label: string;
  category: WorkflowStepCategory;
  /** Nombre de ionicon. */
  icon: string;
  /** Clases de la cabecera del nodo (fondo + texto). */
  accent: string;
  /** Clases del cuadrito de icono en el catálogo. */
  chip: string;
  /** Borde de la tarjeta del nodo. */
  border: string;
  defaultTitle: string;
  defaultSubtitle: string;
  /** true = el paso abre dos ramas (Yes / No). */
  branching?: boolean;
  /** Campos del panel de configuración; sin esto solo se editan título y subtítulo. */
  fields?: WorkflowFieldDef[];
}

export const WORKFLOW_CATEGORY_LABEL: Record<WorkflowStepCategory, string> = {
  trigger: 'Triggers',
  'ai-logic': 'AI & Logic',
  action: 'Actions',
  utility: 'Utilities',
};

/** Orden en que se listan las categorías en el panel "Add Step". */
export const WORKFLOW_CATEGORY_ORDER: WorkflowStepCategory[] = ['trigger', 'ai-logic', 'action', 'utility'];

export const WORKFLOW_STEP_TYPES: WorkflowStepType[] = [
  // ---------- Triggers ----------
  {
    id: 'new-email',
    label: 'New Email',
    category: 'trigger',
    icon: 'mail-outline',
    accent: 'bg-emerald-50 text-emerald-700',
    chip: 'bg-emerald-500',
    border: 'border-emerald-200',
    defaultTitle: 'New Email Received',
    defaultSubtitle: 'Starts when an email arrives',
  },
  {
    id: 'form-submitted',
    label: 'Form Submitted',
    category: 'trigger',
    icon: 'document-text-outline',
    accent: 'bg-emerald-50 text-emerald-700',
    chip: 'bg-indigo-500',
    border: 'border-emerald-200',
    defaultTitle: 'New Lead Captured',
    defaultSubtitle: 'Form Submitted',
    fields: [{ key: 'form', label: 'Form', control: 'text', placeholder: 'Lead Generation Form' }],
  },
  {
    id: 'schedule',
    label: 'Schedule',
    category: 'trigger',
    icon: 'time-outline',
    accent: 'bg-emerald-50 text-emerald-700',
    chip: 'bg-sky-500',
    border: 'border-emerald-200',
    defaultTitle: 'On a schedule',
    defaultSubtitle: 'Runs at a fixed time',
    fields: [
      { key: 'frequency', label: 'Frequency', control: 'select', options: ['Hourly', 'Daily', 'Weekly', 'Monthly'] },
      { key: 'time', label: 'Time', control: 'text', placeholder: '09:00' },
    ],
  },
  {
    id: 'web-hook',
    label: 'Web Hook',
    category: 'trigger',
    icon: 'git-network-outline',
    accent: 'bg-emerald-50 text-emerald-700',
    chip: 'bg-amber-500',
    border: 'border-emerald-200',
    defaultTitle: 'Incoming web hook',
    defaultSubtitle: 'Starts on an HTTP call',
  },
  {
    id: 'manual-trigger',
    label: 'Manual Trigger',
    category: 'trigger',
    icon: 'play-outline',
    accent: 'bg-emerald-50 text-emerald-700',
    chip: 'bg-blue-500',
    border: 'border-emerald-200',
    defaultTitle: 'Manual start',
    defaultSubtitle: 'Someone runs it by hand',
  },

  // ---------- AI & logic ----------
  {
    id: 'ai-agent',
    label: 'AI Agent',
    category: 'ai-logic',
    icon: 'sparkles-outline',
    accent: 'bg-cyan-50 text-cyan-700',
    chip: 'bg-gray-900',
    border: 'border-cyan-200',
    defaultTitle: 'Lead Qualifier',
    defaultSubtitle: 'Score lead potential',
    branching: true,
    fields: [
      { key: 'agent', label: 'Agent', control: 'text', placeholder: 'Lead Qualifier' },
      {
        key: 'model',
        label: 'Model',
        control: 'select',
        // Lista fija: el backend no tiene ninguna integración de IA, así que
        // esto describe la intención, no modelos disponibles de verdad.
        options: ['Claude Fable 5', 'Claude Sonnet 5', 'Claude Opus 5'],
      },
      { key: 'prompt', label: 'Prompt', control: 'textarea', placeholder: 'Analyze the lead data and return…' },
      { key: 'inputVariable', label: 'Input Variable', control: 'chips' },
    ],
  },
  {
    id: 'data-enrichment',
    label: 'Data Enrichment',
    category: 'ai-logic',
    icon: 'layers-outline',
    accent: 'bg-cyan-50 text-cyan-700',
    chip: 'bg-fuchsia-500',
    border: 'border-cyan-200',
    defaultTitle: 'Enrich record',
    defaultSubtitle: 'Fill in missing data',
  },
  {
    id: 'condition',
    label: 'Condition',
    category: 'ai-logic',
    icon: 'git-branch-outline',
    accent: 'bg-cyan-50 text-cyan-700',
    chip: 'bg-teal-500',
    border: 'border-cyan-200',
    defaultTitle: 'Check condition',
    defaultSubtitle: 'Split the flow in two',
    branching: true,
    fields: [
      { key: 'field', label: 'Field', control: 'text', placeholder: 'Lead Score' },
      { key: 'operator', label: 'Operator', control: 'select', options: ['is', 'is not', 'greater than', 'less than'] },
      { key: 'value', label: 'Value', control: 'text' },
    ],
  },
  {
    id: 'router',
    label: 'Router / Branch',
    category: 'ai-logic',
    icon: 'shuffle-outline',
    accent: 'bg-cyan-50 text-cyan-700',
    chip: 'bg-slate-400',
    border: 'border-cyan-200',
    defaultTitle: 'Route the record',
    defaultSubtitle: 'Send it down a path',
    branching: true,
  },
  {
    id: 'loop',
    label: 'Loop',
    category: 'ai-logic',
    icon: 'repeat-outline',
    accent: 'bg-cyan-50 text-cyan-700',
    chip: 'bg-blue-500',
    border: 'border-cyan-200',
    defaultTitle: 'Repeat for each',
    defaultSubtitle: 'Run once per item',
  },

  // ---------- Actions ----------
  {
    id: 'send-email',
    label: 'Send Email',
    category: 'action',
    icon: 'paper-plane-outline',
    accent: 'bg-amber-50 text-amber-700',
    chip: 'bg-blue-500',
    border: 'border-amber-200',
    defaultTitle: 'Send Welcome Email',
    defaultSubtitle: 'Introduce product and next steps',
    fields: [
      { key: 'template', label: 'Template', control: 'text', placeholder: 'Welcome email' },
      { key: 'subject', label: 'Subject', control: 'text' },
    ],
  },
  {
    id: 'send-sms',
    label: 'Send SMS',
    category: 'action',
    icon: 'chatbubble-outline',
    accent: 'bg-amber-50 text-amber-700',
    chip: 'bg-emerald-500',
    border: 'border-amber-200',
    defaultTitle: 'Send SMS',
    defaultSubtitle: 'Text the contact',
  },
  {
    id: 'create-record',
    label: 'Create Record',
    category: 'action',
    icon: 'add-circle-outline',
    accent: 'bg-amber-50 text-amber-700',
    chip: 'bg-orange-500',
    border: 'border-amber-200',
    defaultTitle: 'Create Record',
    defaultSubtitle: 'Add a new entry',
  },
  {
    id: 'update-record',
    label: 'Update Record',
    category: 'action',
    icon: 'create-outline',
    accent: 'bg-rose-50 text-rose-700',
    chip: 'bg-rose-500',
    border: 'border-rose-200',
    defaultTitle: 'Update Lead Status',
    defaultSubtitle: 'Mark contacted and update score',
  },
  {
    id: 'web-hook-request',
    label: 'Web Hook Request',
    category: 'action',
    icon: 'globe-outline',
    accent: 'bg-amber-50 text-amber-700',
    chip: 'bg-indigo-500',
    border: 'border-amber-200',
    defaultTitle: 'Call web hook',
    defaultSubtitle: 'Send data to another system',
  },

  // ---------- Utilities ----------
  {
    id: 'delay',
    label: 'Delay',
    category: 'utility',
    icon: 'hourglass-outline',
    accent: 'bg-gray-100 text-gray-700',
    chip: 'bg-rose-500',
    border: 'border-gray-200',
    defaultTitle: 'Wait a while',
    defaultSubtitle: 'Pause before continuing',
  },
  {
    id: 'wait-for-event',
    label: 'Wait for Event',
    category: 'utility',
    icon: 'pause-circle-outline',
    accent: 'bg-gray-100 text-gray-700',
    chip: 'bg-red-500',
    border: 'border-gray-200',
    defaultTitle: 'Wait for event',
    defaultSubtitle: 'Continue when something happens',
  },
];

const TYPE_BY_ID = new Map<WorkflowStepTypeId, WorkflowStepType>(WORKFLOW_STEP_TYPES.map(t => [t.id, t]));

export function stepType(typeId: WorkflowStepTypeId): WorkflowStepType | undefined {
  return TYPE_BY_ID.get(typeId);
}

/** Un tipo desconocido (documento viejo, tipo retirado) no debe romper el render. */
export function stepTypeOrFallback(typeId: WorkflowStepTypeId): WorkflowStepType {
  return (
    TYPE_BY_ID.get(typeId) ?? {
      id: typeId,
      label: typeId,
      category: 'action',
      icon: 'help-outline',
      accent: 'bg-gray-100 text-gray-700',
      chip: 'bg-gray-400',
      border: 'border-gray-200',
      defaultTitle: typeId,
      defaultSubtitle: 'Unknown step type',
    }
  );
}

export function isBranching(step: WorkflowStep): boolean {
  return stepType(step.typeId)?.branching === true;
}

export function childrenOf(steps: WorkflowStep[], parentId: string | null, branch?: WorkflowBranch): WorkflowStep[] {
  return steps.filter(
    step => step.parentId === parentId && (branch === undefined || step.branch === branch),
  );
}

export function rootStep(steps: WorkflowStep[]): WorkflowStep | null {
  return steps.find(step => step.parentId === null) ?? null;
}

/** Ids del paso y de todo lo que cuelga de él — borrar un nodo se lleva su subárbol. */
export function descendantIds(steps: WorkflowStep[], stepId: string): string[] {
  const collected: string[] = [stepId];
  for (let i = 0; i < collected.length; i++) {
    for (const child of steps.filter(step => step.parentId === collected[i])) {
      collected.push(child.id);
    }
  }
  return collected;
}

/**
 * Pares clave/valor del pie de la tarjeta (`Form: Lead Generation Form`,
 * `Model: Claude Fable 5`…). Salen de `config`, así que el nodo refleja lo que
 * se configuró sin que el canvas sepa nada de cada tipo.
 */
export function summaryPairs(step: WorkflowStep): { label: string; value: string }[] {
  return Object.entries(step.config)
    .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : `${value}`.trim().length > 0))
    .slice(0, 3)
    .map(([label, value]) => ({
      label: label.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()),
      value: Array.isArray(value) ? value.join(', ') : `${value}`,
    }));
}
