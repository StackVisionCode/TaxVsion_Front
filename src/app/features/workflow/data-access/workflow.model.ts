/**
 * Modelo del constructor de workflows.
 *
 * ⚠️ No hay backend de workflows: ni motor, ni definición persistida, ni
 * ejecución (verificado sobre los 25 microservicios y las 31 rutas del
 * Gateway). Esto describe un documento que hoy vive en el navegador; el día
 * que exista el servicio, estos tipos son los que se mapearán al contrato.
 *
 * El documento es un **grafo**: pasos (las cartas) y conexiones (los hilos)
 * como entidades separadas. Cada tipo declara además su propósito, su acción,
 * sus salidas y **qué datos produce y consume**, que es lo que permite saber
 * qué variables tiene disponibles cada carta y avisar cuando le falta algo.
 *
 * Antes esto era un árbol implícito (`parentId` + `branch` en el paso): el
 * hilo no existía como dato, así que no podía tener identidad ni transportar
 * un contrato, y dos ramas no podían volver a unirse.
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

export type WorkflowCollaboratorRole = 'owner' | 'editor' | 'viewer';

/**
 * Una persona del workflow.
 *
 * `name`/`email` son un SNAPSHOT tomado al añadirla: los avatares del header
 * pintan desde localStorage en el primer frame, sin depender de que
 * `/auth/users` responda. El modal de Share sí consulta usuarios frescos.
 *
 * Honestidad: sin backend de workflows el rol se guarda con el borrador pero
 * no puede restringirle nada a nadie — este navegador tiene la única copia.
 */
export interface WorkflowCollaborator {
  userId: string;
  name: string;
  email: string;
  role: WorkflowCollaboratorRole;
}

export interface WorkflowDoc {
  id: string;
  name: string;
  steps: WorkflowStep[];
  /** Los hilos, como dato propio y no como algo derivado de los pasos. */
  connections: WorkflowConnection[];
  collaborators: WorkflowCollaborator[];
  updatedAtIso: string;
}

/**
 * Un hilo entre dos cartas.
 *
 * Es una entidad de primera clase: tiene identidad, se puede seleccionar y
 * borrar, y sabe exactamente de qué salida sale y a qué carta entra. Antes
 * esto se deducía de un `parentId` en el paso, así que el hilo no existía como
 * cosa y no podía tener estado propio.
 */
export interface WorkflowConnection {
  id: string;
  fromStepId: string;
  /** Id del puerto de salida del tipo de origen ('main', 'yes', 'no'). */
  fromPort: string;
  toStepId: string;
}

/** Una salida declarada por el tipo de paso. */
export interface WorkflowPort {
  id: string;
  label?: string;
}

/**
 * Un dato que una carta produce o necesita.
 *
 * Es lo que convierte el diagrama en algo que se puede razonar: con esto se
 * sabe qué variables tiene disponibles cada carta y cuáles le faltan.
 */
export interface WorkflowDataField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'object';
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
  control: 'text' | 'textarea' | 'select' | 'chips' | 'number';
  /** Solo para `select`. */
  options?: string[];
  placeholder?: string;
  /** Solo para `number`. */
  min?: number;
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
  /** Para qué existe esta carta, en una frase. */
  purpose: string;
  /** La operación concreta que ejecutaría si hubiera motor. */
  action: string;
  /** Salidas: una sola ('main') o dos cuando bifurca. */
  outputs: WorkflowPort[];
  /** Lo que esta carta MANDA a las siguientes. */
  produces: WorkflowDataField[];
  /** Lo que esta carta NECESITA recibir para poder actuar. */
  consumes: WorkflowDataField[];
  /** true = el paso abre dos ramas (Yes / No). */
  branching?: boolean;
  /** Campos del panel de configuración; sin esto solo se editan título y subtítulo. */
  fields?: WorkflowFieldDef[];
  /**
   * Cuánto duraría este paso en una ejecución real, estimado. Lo usa la
   * simulación del Preview; `delay` y `wait-for-event` lo ignoran y leen su
   * config (`duration` + `unit`).
   */
  estimatedMs?: number;
}

/** Duración de la simulación para un tipo que no declara la suya. */
export const DEFAULT_ESTIMATED_MS = 1500;

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
    purpose: 'Escuchar el buzón y arrancar cuando llega un correo.',
    action: 'Queda a la espera de correos entrantes y dispara el flujo con cada uno.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'from', label: 'From', type: 'string' },
      { key: 'subject', label: 'Subject', type: 'string' },
      { key: 'body', label: 'Body', type: 'string' },
      { key: 'receivedAt', label: 'Received at', type: 'date' },
    ],
    consumes: [],
    estimatedMs: 400,
    fields: [
      { key: 'mailbox', label: 'Mailbox', control: 'text', placeholder: 'support@company.com' },
      { key: 'folder', label: 'Folder', control: 'select', options: ['Inbox', 'Support', 'Sales', 'Billing'] },
      { key: 'fromFilter', label: 'Only from', control: 'text', placeholder: 'anyone' },
      { key: 'subjectContains', label: 'Subject contains', control: 'text' },
    ],
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
    purpose: 'Arrancar cuando alguien envía un formulario.',
    action: 'Recoge los campos del formulario y los pasa al flujo.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'email', label: 'Email', type: 'string' },
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'company', label: 'Company', type: 'string' },
      { key: 'message', label: 'Message', type: 'string' },
    ],
    consumes: [],
    fields: [{ key: 'form', label: 'Form', control: 'text', placeholder: 'Lead Generation Form' }],
    estimatedMs: 300,
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
    purpose: 'Arrancar solo, a una hora fija.',
    action: 'Dispara el flujo según la frecuencia configurada.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'firedAt', label: 'Fired at', type: 'date' },
    ],
    consumes: [],
    fields: [
      { key: 'frequency', label: 'Frequency', control: 'select', options: ['Hourly', 'Daily', 'Weekly', 'Monthly'] },
      { key: 'time', label: 'Time', control: 'text', placeholder: '09:00' },
    ],
    estimatedMs: 300,
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
    purpose: 'Arrancar cuando otro sistema llama.',
    action: 'Expone una URL y arranca con lo que le manden.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'payload', label: 'Payload', type: 'object' },
    ],
    consumes: [],
    estimatedMs: 400,
    fields: [
      { key: 'method', label: 'Method', control: 'select', options: ['POST', 'GET', 'PUT'] },
      { key: 'pathSlug', label: 'Path', control: 'text', placeholder: 'lead-intake' },
      { key: 'secret', label: 'Shared secret', control: 'text', placeholder: 'Draft only — not stored securely' },
    ],
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
    purpose: 'Arrancar a mano.',
    action: 'Alguien pulsa y el flujo empieza.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'startedBy', label: 'Started by', type: 'string' },
      { key: 'startedAt', label: 'Started at', type: 'date' },
    ],
    consumes: [],
    estimatedMs: 300,
    fields: [
      { key: 'buttonLabel', label: 'Button label', control: 'text', placeholder: 'Run workflow' },
      { key: 'instructions', label: 'Instructions', control: 'textarea', placeholder: 'What should the person check before running it?' },
    ],
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
    purpose: 'Analizar los datos y decidir por dónde sigue el flujo.',
    action: 'Manda los datos al modelo y clasifica el resultado en dos salidas.',
    outputs: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    produces: [
      { key: 'leadScore', label: 'Lead score', type: 'number' },
      { key: 'intent', label: 'Intent', type: 'string' },
      { key: 'summary', label: 'Summary', type: 'string' },
    ],
    consumes: [],
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
    estimatedMs: 4000,
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
    purpose: 'Completar datos que faltan.',
    action: 'Busca información adicional del contacto y la añade.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'company', label: 'Company', type: 'string' },
      { key: 'jobTitle', label: 'Job title', type: 'string' },
      { key: 'industry', label: 'Industry', type: 'string' },
    ],
    consumes: [
      { key: 'email', label: 'Email', type: 'string' },
    ],
    estimatedMs: 2500,
    fields: [
      { key: 'source', label: 'Source', control: 'select', options: ['Company database', 'Public records', 'Social profiles'] },
      { key: 'enrichFields', label: 'Fields to enrich', control: 'chips' },
    ],
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
    purpose: 'Partir el flujo según una regla.',
    action: 'Evalúa el campo configurado y sigue por Yes o por No.',
    outputs: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    produces: [],
    consumes: [],
    branching: true,
    fields: [
      { key: 'field', label: 'Field', control: 'text', placeholder: 'Lead Score' },
      { key: 'operator', label: 'Operator', control: 'select', options: ['is', 'is not', 'greater than', 'less than'] },
      { key: 'value', label: 'Value', control: 'text' },
    ],
    estimatedMs: 400,
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
    purpose: 'Mandar cada caso por su camino.',
    action: 'Elige una salida según el criterio configurado.',
    outputs: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    produces: [],
    consumes: [],
    branching: true,
    estimatedMs: 400,
    fields: [
      { key: 'criterion', label: 'Route by', control: 'text', placeholder: 'Lead source' },
      { key: 'matchValue', label: 'Match value', control: 'text' },
    ],
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
    purpose: 'Repetir los pasos siguientes por cada elemento.',
    action: 'Recorre la lista y ejecuta la rama una vez por elemento.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'item', label: 'Item', type: 'object' },
      { key: 'index', label: 'Index', type: 'number' },
    ],
    consumes: [],
    estimatedMs: 1500,
    fields: [
      { key: 'listSource', label: 'List source', control: 'text', placeholder: 'contacts' },
      { key: 'maxIterations', label: 'Max iterations', control: 'number', min: 1, placeholder: '100' },
    ],
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
    purpose: 'Escribir al contacto.',
    action: 'Envía el email con la plantilla configurada.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'messageId', label: 'Message id', type: 'string' },
      { key: 'sentAt', label: 'Sent at', type: 'date' },
    ],
    consumes: [
      { key: 'email', label: 'Email', type: 'string' },
    ],
    fields: [
      { key: 'template', label: 'Template', control: 'text', placeholder: 'Welcome email' },
      { key: 'subject', label: 'Subject', control: 'text' },
    ],
    estimatedMs: 2000,
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
    purpose: 'Mandar un mensaje de texto.',
    action: 'Envía el SMS al número del contacto.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'messageId', label: 'Message id', type: 'string' },
      { key: 'sentAt', label: 'Sent at', type: 'date' },
    ],
    consumes: [
      { key: 'phone', label: 'Phone', type: 'string' },
    ],
    estimatedMs: 1500,
    fields: [
      { key: 'message', label: 'Message', control: 'textarea', placeholder: 'Hi {{name}}, …' },
      { key: 'fromNumber', label: 'From number', control: 'text', placeholder: '+1 555 0100' },
    ],
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
    purpose: 'Crear una ficha nueva.',
    action: 'Da de alta el registro con los datos recibidos.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'recordId', label: 'Record id', type: 'string' },
    ],
    consumes: [],
    estimatedMs: 800,
    fields: [
      { key: 'recordType', label: 'Record type', control: 'select', options: ['Contact', 'Company', 'Deal', 'Task'] },
      { key: 'initialFields', label: 'Initial fields', control: 'chips' },
    ],
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
    purpose: 'Actualizar una ficha existente.',
    action: 'Escribe los cambios sobre el registro indicado.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'updatedAt', label: 'Updated at', type: 'date' },
    ],
    consumes: [
      { key: 'recordId', label: 'Record id', type: 'string' },
    ],
    estimatedMs: 800,
    fields: [
      { key: 'recordType', label: 'Record type', control: 'select', options: ['Contact', 'Company', 'Deal', 'Task'] },
      { key: 'fieldsToUpdate', label: 'Fields to update', control: 'chips' },
    ],
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
    purpose: 'Avisar a otro sistema.',
    action: 'Hace una llamada HTTP con los datos del flujo.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'responseStatus', label: 'Response status', type: 'number' },
      { key: 'responseBody', label: 'Response body', type: 'object' },
    ],
    consumes: [],
    estimatedMs: 1200,
    fields: [
      { key: 'url', label: 'URL', control: 'text', placeholder: 'https://…' },
      { key: 'method', label: 'Method', control: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      { key: 'payloadTemplate', label: 'Payload', control: 'textarea', placeholder: '{ "lead": "{{email}}" }' },
    ],
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
    purpose: 'Esperar antes de seguir.',
    action: 'Pausa el flujo el tiempo configurado.',
    outputs: [{ id: 'main' }],
    produces: [],
    consumes: [],
    estimatedMs: 1500,
    fields: [
      { key: 'duration', label: 'Duration', control: 'number', min: 1, placeholder: '2' },
      { key: 'unit', label: 'Unit', control: 'select', options: ['Minutes', 'Hours', 'Days'] },
    ],
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
    purpose: 'Esperar a que ocurra algo.',
    action: 'Retiene el flujo hasta que llega el evento esperado.',
    outputs: [{ id: 'main' }],
    produces: [
      { key: 'eventAt', label: 'Event at', type: 'date' },
    ],
    consumes: [],
    estimatedMs: 1500,
    fields: [
      { key: 'eventName', label: 'Event to wait for', control: 'text', placeholder: 'Document signed' },
      { key: 'timeoutDuration', label: 'Give up after', control: 'number', min: 1, placeholder: '3' },
      { key: 'timeoutUnit', label: 'Unit', control: 'select', options: ['Minutes', 'Hours', 'Days'] },
    ],
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
      purpose: 'This step type is no longer available',
      action: 'Nothing — the type was removed or renamed',
      outputs: [{ id: 'main' }],
      produces: [],
      consumes: [],
    }
  );
}

export function isBranching(step: WorkflowStep): boolean {
  return stepType(step.typeId)?.branching === true;
}

/** Salidas del tipo del paso; siempre hay al menos una. */
export function outputsOf(step: WorkflowStep): WorkflowPort[] {
  const outputs = stepTypeOrFallback(step.typeId).outputs;
  return outputs.length > 0 ? outputs : [{ id: 'main' }];
}

// ---------- El grafo ----------

export function connectionsFrom(
  connections: WorkflowConnection[],
  stepId: string,
  port?: string,
): WorkflowConnection[] {
  return connections.filter(c => c.fromStepId === stepId && (port === undefined || c.fromPort === port));
}

export function connectionsTo(connections: WorkflowConnection[], stepId: string): WorkflowConnection[] {
  return connections.filter(c => c.toStepId === stepId);
}

/** Cuántos hilos entran en la carta. */
export function inDegree(connections: WorkflowConnection[], stepId: string): number {
  return connectionsTo(connections, stepId).length;
}

/** Cuántos hilos salen de la carta. */
export function outDegree(connections: WorkflowConnection[], stepId: string): number {
  return connectionsFrom(connections, stepId).length;
}

/** Las cartas que alimentan a esta. */
export function predecessorsOf(connections: WorkflowConnection[], stepId: string): string[] {
  return connectionsTo(connections, stepId).map(c => c.fromStepId);
}

/** Cartas que no reciben nada: por ahí empieza el flujo. */
export function rootSteps(steps: WorkflowStep[], connections: WorkflowConnection[]): WorkflowStep[] {
  return steps.filter(step => inDegree(connections, step.id) === 0);
}

/**
 * ¿Añadir `from → to` cerraría un ciclo?
 *
 * Se comprueba ANTES de conectar: un ciclo dejaría el grafo en un estado que
 * el layout no sabe ordenar por niveles, y el flujo no tendría principio.
 */
export function wouldCycle(connections: WorkflowConnection[], fromStepId: string, toStepId: string): boolean {
  if (fromStepId === toStepId) {
    return true;
  }
  // ¿Se llega a `from` partiendo de `to`? Si sí, el hilo nuevo cierra el lazo.
  const seen = new Set<string>([toStepId]);
  const queue = [toStepId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of connectionsFrom(connections, current).map(c => c.toStepId)) {
      if (next === fromStepId) {
        return true;
      }
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Motivo por el que un hilo no se puede crear, o null si es válido. */
export function connectionError(
  connections: WorkflowConnection[],
  fromStepId: string,
  fromPort: string,
  toStepId: string,
): string | null {
  if (fromStepId === toStepId) {
    return "A step can't connect to itself";
  }
  if (connections.some(c => c.fromStepId === fromStepId && c.fromPort === fromPort && c.toStepId === toStepId)) {
    return 'These steps are already connected';
  }
  if (wouldCycle(connections, fromStepId, toStepId)) {
    return 'That would create a loop';
  }
  return null;
}

// ---------- Qué recibe y qué manda cada carta ----------

/**
 * Todo lo que llega a una carta: la unión de lo que producen todas las que la
 * alimentan, directa o indirectamente. Recorrido hacia atrás con `Set` de
 * visitados, que además protege de un documento con ciclos.
 */
export function availableFieldsAt(
  steps: WorkflowStep[],
  connections: WorkflowConnection[],
  stepId: string,
): WorkflowDataField[] {
  const byId = new Map(steps.map(step => [step.id, step]));
  const fields = new Map<string, WorkflowDataField>();
  const seen = new Set<string>([stepId]);
  const queue = predecessorsOf(connections, stepId);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (seen.has(currentId)) {
      continue;
    }
    seen.add(currentId);
    const step = byId.get(currentId);
    if (step) {
      for (const field of stepTypeOrFallback(step.typeId).produces) {
        fields.set(field.key, field);
      }
    }
    queue.push(...predecessorsOf(connections, currentId));
  }
  return [...fields.values()];
}

/** Lo que la carta necesita y nadie aguas arriba le está mandando. */
export function missingInputs(
  steps: WorkflowStep[],
  connections: WorkflowConnection[],
  stepId: string,
): WorkflowDataField[] {
  const step = steps.find(s => s.id === stepId);
  if (!step) {
    return [];
  }
  const available = new Set(availableFieldsAt(steps, connections, stepId).map(field => field.key));
  return stepTypeOrFallback(step.typeId).consumes.filter(field => !available.has(field.key));
}

/**
 * Pie de la tarjeta: lo que la carta MANDA. Antes era un volcado de `config`,
 * que decía cómo está configurada pero no qué entrega a las siguientes.
 */
export function summaryPairs(step: WorkflowStep): { label: string; value: string }[] {
  const type = stepTypeOrFallback(step.typeId);
  const configured = Object.entries(step.config)
    .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : `${value}`.trim().length > 0))
    .map(([label, value]) => ({
      label: label.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()),
      value: Array.isArray(value) ? value.join(', ') : `${value}`,
    }));

  const sends =
    type.produces.length > 0
      ? [{ label: 'Sends', value: type.produces.map(field => field.label).join(', ') }]
      : [];

  return [...configured, ...sends].slice(0, 3);
}
