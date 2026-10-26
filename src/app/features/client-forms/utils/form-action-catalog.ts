import type {
  FormAction,
  FormActionTrigger,
  FormActionType,
  FormDefinition,
} from '@shared/utils/data-collection/form-definition.model';

/** Permiso que habilita la pestaña de mapeo y el panel "After submission" (P-16/P-17). */
export const CONFIGURE_ACTIONS_PERMISSION = 'tasks.form_templates.configure_actions';

/**
 * Una entrada del catálogo cerrado de acciones (P-17.1). Los disparadores replican
 * `StructureValidator.TriggerAllowed`; ninguna acción fuera de esta lista se puede crear.
 */
export interface FormActionDescriptor {
  type: FormActionType;
  label: string;
  description: string;
  triggers: readonly FormActionTrigger[];
  defaultTrigger: FormActionTrigger;
  /** Implícitas: ocurren siempre y el backend rechaza configurarlas. */
  implicit: boolean;
  /** Operación del catálogo de mapeo que exige cobertura; null si no mapea datos. */
  mappingOperation: string | null;
  /** Módulo del plan de la oficina del que depende; null si no depende de ninguno. */
  module: string | null;
  /** `comingSoon`: el backend todavía no la ejecuta (la planifica como Skipped). */
  availability: 'available' | 'comingSoon';
  requirements: readonly string[];
  key: string;
}

export const FORM_ACTION_CATALOG: readonly FormActionDescriptor[] = [
  {
    type: 'notifyStaff',
    label: 'Notify staff',
    description: 'The responsible staff member is notified when the client submits.',
    triggers: ['onSubmit'],
    defaultTrigger: 'onSubmit',
    implicit: true,
    mappingOperation: null,
    module: null,
    availability: 'available',
    requirements: [],
    key: 'notify_staff',
  },
  {
    type: 'routeToReview',
    label: 'Send to review',
    description: 'Submitted forms wait in the review inbox.',
    triggers: ['onSubmit'],
    defaultTrigger: 'onSubmit',
    implicit: true,
    mappingOperation: null,
    module: null,
    availability: 'available',
    requirements: [],
    key: 'route_to_review',
  },
  {
    type: 'createCustomer',
    label: 'Create client',
    description: 'Creates the client from the mapped answers when the sender is not a client yet.',
    triggers: ['onSubmit', 'manual'],
    defaultTrigger: 'onSubmit',
    implicit: false,
    mappingOperation: 'CreateCustomer',
    module: 'customers',
    availability: 'available',
    requirements: [
      'Only runs for requests sent to someone who is not a client yet.',
      'Every field the client record requires must be mapped.',
    ],
    key: 'create_client',
  },
  {
    type: 'updateCustomerProfile',
    label: 'Update client profile',
    description: 'Staff approve the answers and apply them to the client profile.',
    triggers: ['manual'],
    defaultTrigger: 'manual',
    implicit: false,
    mappingOperation: 'UpdateCustomerProfile',
    module: 'customers',
    availability: 'comingSoon',
    requirements: ['The request must be sent to an existing client.'],
    key: 'update_profile',
  },
  {
    type: 'generateSummary',
    label: 'Generate PDF summary',
    description: 'Saves a PDF copy of the answers in the client documents.',
    triggers: ['onSubmit', 'onComplete'],
    defaultTrigger: 'onComplete',
    implicit: false,
    mappingOperation: null,
    module: 'documents',
    availability: 'comingSoon',
    requirements: [],
    key: 'summary',
  },
  {
    type: 'requestSignature',
    label: 'Request signature',
    description: 'Sends the summary for the client to sign.',
    triggers: ['onSubmit', 'onComplete'],
    defaultTrigger: 'onSubmit',
    implicit: false,
    mappingOperation: null,
    module: 'signatures',
    availability: 'comingSoon',
    requirements: ['Needs a signature step in the form.', 'Needs a PDF summary first.'],
    key: 'sign',
  },
  {
    type: 'applyRetentionClass',
    label: 'Apply retention class',
    description: 'Applies a document retention class when the request is completed.',
    triggers: ['onComplete'],
    defaultTrigger: 'onComplete',
    implicit: false,
    mappingOperation: null,
    module: null,
    availability: 'comingSoon',
    requirements: [],
    key: 'retention',
  },
];

export const TRIGGER_LABELS: Readonly<Record<FormActionTrigger, string>> = {
  onSubmit: 'When the client submits',
  onComplete: 'When the request is completed',
  manual: 'Manually, by staff',
};

export function actionDescriptor(type: FormActionType): FormActionDescriptor | undefined {
  return FORM_ACTION_CATALOG.find((descriptor) => descriptor.type === type);
}

export function actionLabel(type: FormActionType): string {
  return actionDescriptor(type)?.label ?? type;
}

/** Nombre de la operación del catálogo de mapeo (`FormActionType.ToString()` en .NET). */
export function operationName(type: FormActionType): string {
  return type[0].toUpperCase() + type.slice(1);
}

const OPERATION_LABELS: Readonly<Record<string, string>> = {
  CreateCustomer: 'Create client',
  UpdateCustomerProfile: 'Update client profile',
};

export function operationLabel(operation: string): string {
  return OPERATION_LABELS[operation] ?? operation;
}

export function triggerAllowed(type: FormActionType, trigger: FormActionTrigger): boolean {
  return actionDescriptor(type)?.triggers.includes(trigger) ?? false;
}

/** Clave única que cumple `^[a-z][a-z0-9_]{1,63}$`. */
export function nextActionKey(actions: readonly FormAction[], base: string): string {
  const keys = new Set(actions.map((action) => action.key));
  if (!keys.has(base)) return base;
  let suffix = 2;
  while (keys.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

export function hasSignatureStep(definition: FormDefinition): boolean {
  return definition.pages.some((page) =>
    page.sections.some((section) =>
      section.components.some((component) => component.type === 'signatureStep'),
    ),
  );
}
