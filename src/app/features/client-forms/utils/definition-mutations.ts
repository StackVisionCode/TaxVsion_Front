import type { Condition } from '@shared/utils/data-collection/conditions';
import { getComponentType } from '@shared/utils/data-collection/component-registry';
import type {
  FormComponent,
  FormDefinition,
  FormPage,
  FormSection,
} from '@shared/utils/data-collection/form-definition.model';
import { createDefinitionId } from './id-generator';

export interface ComponentReference {
  ownerId: string;
  ownerLabel: string;
  property: 'visibleWhen' | 'requiredWhen' | 'condition';
}

export interface RemoveComponentResult {
  definition: FormDefinition;
  blockedBy: ComponentReference[];
}

export interface DefinitionSelection {
  kind: 'page' | 'section' | 'component';
  id: string;
}

export function addPage(definition: FormDefinition): FormDefinition {
  const page: FormPage = {
    id: createDefinitionId('pg'),
    title: `Page ${definition.pages.length + 1}`,
    sections: [{ id: createDefinitionId('sc'), components: [] }],
  };
  return { ...clone(definition), pages: [...definition.pages.map(clone), page] };
}

export function addSection(definition: FormDefinition, pageId: string): FormDefinition {
  return mapPages(definition, (page) =>
    page.id === pageId
      ? { ...page, sections: [...page.sections, { id: createDefinitionId('sc'), components: [] }] }
      : page,
  );
}

export function addComponent(
  definition: FormDefinition,
  sectionId: string,
  type: string,
  index?: number,
): FormDefinition {
  if (type === 'signatureStep' && hasComponentType(definition, type)) return definition;
  const component = defaultComponent(type);
  const next = mapSections(definition, (section) => {
    if (section.id !== sectionId) return section;
    const components = [...section.components];
    components.splice(
      Math.max(0, Math.min(index ?? components.length, components.length)),
      0,
      component,
    );
    return { ...section, components };
  });
  if (
    type !== 'signatureStep' ||
    next.actions?.some((action) => action.type === 'requestSignature')
  )
    return next;
  return {
    ...next,
    actions: [
      ...(next.actions ?? []),
      { key: nextActionKey(next, 'sign'), type: 'requestSignature', trigger: 'onSubmit' },
    ],
  };
}

export function duplicateComponent(
  definition: FormDefinition,
  componentId: string,
): FormDefinition {
  if (findComponent(definition, componentId)?.type === 'signatureStep') return definition;
  return mapSections(definition, (section) => {
    const index = section.components.findIndex((component) => component.id === componentId);
    if (index < 0) return section;
    const duplicate = { ...clone(section.components[index]), id: createDefinitionId('fd') };
    const components = [...section.components];
    components.splice(index + 1, 0, duplicate);
    return { ...section, components };
  });
}

export function moveComponent(
  definition: FormDefinition,
  componentId: string,
  targetSectionId: string,
  targetIndex: number,
): FormDefinition {
  const moving = findComponent(definition, componentId);
  if (!moving) return definition;
  let next = mapSections(definition, (section) => ({
    ...section,
    components: section.components.filter((component) => component.id !== componentId),
  }));
  next = mapSections(next, (section) => {
    if (section.id !== targetSectionId) return section;
    const components = [...section.components];
    components.splice(Math.max(0, Math.min(targetIndex, components.length)), 0, clone(moving));
    return { ...section, components };
  });
  return next;
}

export function removeComponent(
  definition: FormDefinition,
  componentId: string,
): RemoveComponentResult {
  const blockedBy = componentReferences(definition, componentId);
  if (blockedBy.length > 0) return { definition, blockedBy };
  const removed = findComponent(definition, componentId);
  const next = mapSections(definition, (section) => ({
    ...section,
    components: section.components.filter((component) => component.id !== componentId),
  }));
  return {
    definition:
      removed?.type === 'signatureStep' ? withoutSignatureActions(next) : next,
    blockedBy: [],
  };
}

/** Resultado de borrar una sección o página: bloqueada por referencias externas o por ser la última. */
export interface RemoveStructureResult {
  definition: FormDefinition;
  blockedBy: ComponentReference[];
  /** Una página necesita al menos una sección y la plantilla al menos una página. */
  lastOne: boolean;
  /** Campos que se van con ella (para limpiar sus mapeos). */
  removedComponentIds: string[];
}

export function removeSection(definition: FormDefinition, sectionId: string): RemoveStructureResult {
  const page = definition.pages.find((item) => item.sections.some((section) => section.id === sectionId));
  const section = page?.sections.find((item) => item.id === sectionId);
  if (!page || !section) return { definition, blockedBy: [], lastOne: false, removedComponentIds: [] };
  if (page.sections.length <= 1) return { definition, blockedBy: [], lastOne: true, removedComponentIds: [] };
  return removeStructure(definition, [section], {
    ...definition,
    pages: definition.pages.map((item) =>
      item.id === page.id ? { ...item, sections: item.sections.filter((s) => s.id !== sectionId) } : item,
    ),
  });
}

export function removePage(definition: FormDefinition, pageId: string): RemoveStructureResult {
  const page = definition.pages.find((item) => item.id === pageId);
  if (!page) return { definition, blockedBy: [], lastOne: false, removedComponentIds: [] };
  if (definition.pages.length <= 1) return { definition, blockedBy: [], lastOne: true, removedComponentIds: [] };
  return removeStructure(definition, page.sections, {
    ...definition,
    pages: definition.pages.filter((item) => item.id !== pageId),
  }, page.id);
}

// Solo bloquean las referencias desde fuera de lo que se borra: lo que se va junto no queda colgando.
function removeStructure(
  definition: FormDefinition,
  sections: readonly FormSection[],
  next: FormDefinition,
  pageId?: string,
): RemoveStructureResult {
  const components = sections.flatMap((section) => section.components);
  const removedIds = new Set<string>([
    ...components.map((component) => component.id),
    ...sections.map((section) => section.id),
    ...(pageId ? [pageId] : []),
  ]);
  const blockedBy = components
    .flatMap((component) => componentReferences(definition, component.id))
    .filter((reference) => !removedIds.has(reference.ownerId))
    .filter(
      (reference, index, all) =>
        all.findIndex((item) => item.ownerId === reference.ownerId && item.property === reference.property) === index,
    );
  if (blockedBy.length > 0) return { definition, blockedBy, lastOne: false, removedComponentIds: [] };
  const hadSignature = components.some((component) => component.type === 'signatureStep');
  return {
    definition: hadSignature ? withoutSignatureActions(next) : next,
    blockedBy: [],
    lastOne: false,
    removedComponentIds: components.map((component) => component.id),
  };
}

// Sin paso de firma no hay firma que pedir ni que esperar.
function withoutSignatureActions(definition: FormDefinition): FormDefinition {
  return {
    ...definition,
    actions: definition.actions
      ?.filter((action) => action.type !== 'requestSignature')
      .map((action) =>
        action.config?.['waitFor'] === 'signatureCompleted'
          ? { ...action, config: { ...action.config, waitFor: 'none' } }
          : action,
      ),
  };
}

export function updateComponent(
  definition: FormDefinition,
  componentId: string,
  update: Partial<FormComponent>,
): FormDefinition {
  return mapSections(definition, (section) => ({
    ...section,
    components: section.components.map((component) =>
      component.id === componentId
        ? { ...component, ...clone(update), id: component.id }
        : component,
    ),
  }));
}

export function updateSection(
  definition: FormDefinition,
  sectionId: string,
  update: Partial<FormSection>,
): FormDefinition {
  return mapSections(definition, (section) =>
    section.id === sectionId ? { ...section, ...clone(update), id: section.id } : section,
  );
}

export function updatePage(
  definition: FormDefinition,
  pageId: string,
  update: Partial<FormPage>,
): FormDefinition {
  return mapPages(definition, (page) =>
    page.id === pageId ? { ...page, ...clone(update), id: page.id } : page,
  );
}

export function findPage(definition: FormDefinition, pageId: string): FormPage | null {
  return definition.pages.find((page) => page.id === pageId) ?? null;
}

export function findComponent(
  definition: FormDefinition,
  componentId: string,
): FormComponent | null {
  for (const page of definition.pages)
    for (const section of page.sections) {
      const component = section.components.find((item) => item.id === componentId);
      if (component) return component;
    }
  return null;
}

export function findSection(definition: FormDefinition, sectionId: string): FormSection | null {
  for (const page of definition.pages) {
    const section = page.sections.find((item) => item.id === sectionId);
    if (section) return section;
  }
  return null;
}

export function componentReferences(
  definition: FormDefinition,
  componentId: string,
): ComponentReference[] {
  const references: ComponentReference[] = [];
  for (const page of definition.pages) {
    collectReference(
      page.visibleWhen,
      page.id,
      page.title || 'Page',
      'visibleWhen',
      componentId,
      references,
    );
    for (const section of page.sections) {
      collectReference(
        section.visibleWhen,
        section.id,
        section.title || 'Section',
        'visibleWhen',
        componentId,
        references,
      );
      for (const component of section.components) {
        collectReference(
          component.visibleWhen,
          component.id,
          component.label || component.type,
          'visibleWhen',
          componentId,
          references,
        );
        collectReference(
          component.requiredWhen,
          component.id,
          component.label || component.type,
          'requiredWhen',
          componentId,
          references,
        );
      }
    }
  }
  for (const action of definition.actions ?? [])
    collectReference(
      action.condition,
      action.key,
      `Action ${action.key}`,
      'condition',
      componentId,
      references,
    );
  return references;
}

export function earlierInputComponents(
  definition: FormDefinition,
  selection: DefinitionSelection,
): FormComponent[] {
  const result: FormComponent[] = [];
  for (const page of definition.pages) {
    if (selection.kind === 'page' && page.id === selection.id) return result;
    for (const section of page.sections) {
      if (selection.kind === 'section' && section.id === selection.id) return result;
      for (const component of section.components) {
        if (selection.kind === 'component' && component.id === selection.id) return result;
        if (getComponentType(component.type)?.kind === 'input' && component.type !== 'file')
          result.push(component);
      }
    }
  }
  return [];
}

export function normalizeLegacyEmptyDefinition(definition: FormDefinition): FormDefinition {
  const empty = definition.pages.every((page) =>
    page.sections.every((section) => section.components.length === 0),
  );
  if (!empty) return definition;
  return {
    ...clone(definition),
    pages: definition.pages.map((page) => ({
      ...clone(page),
      id: /^pg_[a-z0-9]{8,16}$/.test(page.id) ? page.id : createDefinitionId('pg'),
      sections: page.sections.map((section) => ({
        ...clone(section),
        id: /^sc_[a-z0-9]{8,16}$/.test(section.id) ? section.id : createDefinitionId('sc'),
      })),
    })),
  };
}

function defaultComponent(type: string): FormComponent {
  const descriptor = getComponentType(type);
  if (!descriptor) throw new Error(`Unknown component type: ${type}`);
  // Solo los inputs llevan label/dataClass/required; layout y compliance (consent, signatureStep) no.
  const input = descriptor.kind === 'input';
  return {
    id: createDefinitionId('fd'),
    type,
    ...(input
      ? { label: humanize(type), dataClass: descriptor.minimumDataClass, required: false }
      : {}),
    props: defaultProps(type),
  };
}

function hasComponentType(definition: FormDefinition, type: string): boolean {
  return definition.pages.some((page) =>
    page.sections.some((section) =>
      section.components.some((component) => component.type === type),
    ),
  );
}

function nextActionKey(definition: FormDefinition, base: string): string {
  const keys = new Set((definition.actions ?? []).map((action) => action.key));
  if (!keys.has(base)) return base;
  let suffix = 2;
  while (keys.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

function defaultProps(type: string): Record<string, unknown> {
  if (type === 'radio')
    return {
      options: [
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2' },
      ],
    };
  if (['select', 'checkboxGroup'].includes(type))
    return { options: [{ value: 'option1', label: 'Option 1' }] };
  if (type === 'heading') return { text: 'Section heading', level: 2 };
  if (type === 'paragraph') return { text: richText('Add helpful instructions here.') };
  if (type === 'callout')
    return { tone: 'info', title: 'Important', text: richText('Add a note here.') };
  if (type === 'checkbox') return { text: richText('I confirm this information.') };
  if (type === 'yesNo') return { yesLabel: 'Yes', noLabel: 'No' };
  if (type === 'file') return { maxFiles: 1, maxFileBytes: 10_485_760, allowedTypes: ['pdf'] };
  if (type === 'taxId') return { kinds: ['ssn', 'ein', 'itin'] };
  if (type === 'spacer') return { size: '4' };
  if (type === 'consent')
    return { noticeKey: 'privacy', noticeVersionNumber: 1, mode: 'noticeOnly', blocking: false };
  if (type === 'signatureStep')
    return { documentSource: 'submissionSummary', verification: 'emailOtp' };
  return {};
}

function richText(text: string): object {
  return { type: 'doc', blocks: [{ type: 'paragraph', children: [{ type: 'text', text }] }] };
}

function collectReference(
  condition: Condition | null | undefined,
  ownerId: string,
  ownerLabel: string,
  property: ComponentReference['property'],
  targetId: string,
  references: ComponentReference[],
): void {
  if (!condition) return;
  if (condition.field === targetId) references.push({ ownerId, ownerLabel, property });
  for (const child of [...(condition.all ?? []), ...(condition.any ?? [])])
    collectReference(child, ownerId, ownerLabel, property, targetId, references);
  if (condition.not)
    collectReference(condition.not, ownerId, ownerLabel, property, targetId, references);
}

function mapPages(definition: FormDefinition, map: (page: FormPage) => FormPage): FormDefinition {
  return { ...clone(definition), pages: definition.pages.map((page) => map(clone(page))) };
}

function mapSections(
  definition: FormDefinition,
  map: (section: FormSection) => FormSection,
): FormDefinition {
  return mapPages(definition, (page) => ({
    ...page,
    sections: page.sections.map((section) => map(clone(section))),
  }));
}

function humanize(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (character) => character.toUpperCase());
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
