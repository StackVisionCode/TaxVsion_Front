import type { FormComponent, FormStyle } from '@shared/utils/data-collection/form-definition.model';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type { RichTextDocument } from '@shared/utils/data-collection/rich-text';
import { isRecord, richTextProp, stringProp } from '@shared/utils/data-collection/properties';
import { evaluateCondition } from '@shared/utils/data-collection/conditions';
import { createDefinitionIndex } from '@shared/utils/data-collection/definition-index';
import type { VisibilityMap } from '@shared/utils/data-collection/visibility';

export interface DataCollectionOption {
  value: string;
  label: string;
}

export function fieldDomId(componentId: string, rowId: string | null): string {
  return `dc-field-${componentId}-${rowId ?? 'root'}`;
}

export function fieldErrorId(componentId: string, rowId: string | null): string {
  return `${fieldDomId(componentId, rowId)}-error`;
}

export function fieldHelpId(componentId: string, rowId: string | null): string {
  return `${fieldDomId(componentId, rowId)}-help`;
}

export function optionsOf(component: FormComponent): DataCollectionOption[] {
  const options = component.props?.['options'];
  if (!Array.isArray(options)) return [];
  return options.filter(isRecord).flatMap((option) => {
    const value = option['value'];
    const label = option['label'];
    return typeof value === 'string' && typeof label === 'string' ? [{ value, label }] : [];
  });
}

export function richProp(component: FormComponent, name: string): RichTextDocument | null {
  return richTextProp(component.props, name);
}

export function textProp(component: FormComponent, name: string, fallback = ''): string {
  return stringProp(component.props, name) ?? fallback;
}

export function createRowId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `rw_${[...bytes].map((value) => alphabet[value % alphabet.length]).join('')}`;
}

export function createPreviewId(): string {
  return crypto.randomUUID();
}

export function isComponentRequired(
  component: FormComponent,
  definition: FormDefinition,
  answers: FormAnswers,
  visibility: VisibilityMap,
  rowId: string | null = null,
  rowValues: Record<string, unknown> | null = null,
): boolean {
  return (
    component.required === true ||
    (component.requiredWhen != null &&
      evaluateCondition(
        component.requiredWhen,
        answers,
        createDefinitionIndex(definition),
        visibility,
        rowId,
        rowValues,
      ))
  );
}

export function styleClasses(style: FormStyle | null | undefined): string[] {
  if (style == null) return [];
  return [
    widthClass(style.width),
    alignClass(style.align),
    textSizeClass(style.textSize),
    textColorClass(style.textColor),
    backgroundClass(style.background),
    spacingTopClass(style.spacingTop),
    spacingBottomClass(style.spacingBottom),
  ].filter(Boolean);
}

function widthClass(value: string | null | undefined): string {
  return (
    (
      {
        full: 'w-full',
        half: 'w-full md:w-1/2',
        third: 'w-full md:w-1/3',
        twoThirds: 'w-full md:w-2/3',
      } as Record<
        string,
        string
      >
    )[value ?? ''] ?? ''
  );
}

function alignClass(value: string | null | undefined): string {
  return (
    ({ left: 'text-left', center: 'text-center', right: 'text-right' } as Record<string, string>)[
      value ?? ''
    ] ?? ''
  );
}

function textSizeClass(value: string | null | undefined): string {
  return (
    (
      {
        caption: 'text-xs',
        ui: 'text-sm',
        body: 'text-base',
        h3: 'text-lg',
        h2: 'text-2xl',
        h1: 'text-3xl',
      } as Record<string, string>
    )[value ?? ''] ?? ''
  );
}

function textColorClass(value: string | null | undefined): string {
  return (
    (
      {
        ink: 'text-gray-900',
        secondary: 'text-gray-700',
        muted: 'text-gray-600',
        brand: 'text-brand-bold',
        accent: 'text-orange-700',
        success: 'text-emerald-700',
        warning: 'text-amber-700',
        danger: 'text-red-700',
        info: 'text-sky-700',
      } as Record<string, string>
    )[value ?? ''] ?? ''
  );
}

function backgroundClass(value: string | null | undefined): string {
  return (
    (
      {
        none: '',
        surface: 'rounded-2xl bg-white',
        sunken: 'rounded-2xl bg-gray-50',
        brandSubtle: 'rounded-2xl bg-brand-surface',
        accentSubtle: 'rounded-2xl bg-orange-50',
        sand: 'rounded-2xl bg-sand-100',
        sage: 'rounded-2xl bg-sage-100',
      } as Record<string, string>
    )[value ?? ''] ?? ''
  );
}

function spacingTopClass(value: number | null | undefined): string {
  return (
    ({ 0: 'mt-0', 2: 'mt-2', 4: 'mt-4', 6: 'mt-6', 8: 'mt-8' } as Record<number, string>)[
      value ?? -1
    ] ?? ''
  );
}

function spacingBottomClass(value: number | null | undefined): string {
  return (
    ({ 0: 'mb-0', 2: 'mb-2', 4: 'mb-4', 6: 'mb-6', 8: 'mb-8' } as Record<number, string>)[
      value ?? -1
    ] ?? ''
  );
}
