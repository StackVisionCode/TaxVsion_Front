import { componentTypes } from '@shared/utils/data-collection/component-registry';

/** Bloque de la paleta: tipo del registro, nombre visible e icono ionicons. */
export interface CatalogItem {
  type: string;
  label: string;
  icon: string;
}

export interface CatalogGroup {
  label: string;
  items: CatalogItem[];
}

const GROUPS: readonly { label: string; items: readonly (readonly [string, string, string])[] }[] = [
  {
    label: 'Layout',
    items: [
      ['heading', 'Heading', 'text-outline'],
      ['paragraph', 'Paragraph', 'reorder-two-outline'],
      ['callout', 'Callout', 'information-circle-outline'],
      ['divider', 'Divider', 'remove-outline'],
      ['spacer', 'Spacer', 'resize-outline'],
    ],
  },
  {
    label: 'Inputs',
    items: [
      ['text', 'Short text', 'create-outline'],
      ['textarea', 'Long text', 'document-text-outline'],
      ['number', 'Number', 'calculator-outline'],
      ['currency', 'Currency', 'cash-outline'],
      ['date', 'Date', 'calendar-outline'],
      ['email', 'Email', 'mail-outline'],
      ['phone', 'Phone', 'call-outline'],
      ['select', 'Dropdown', 'chevron-down-outline'],
      ['radio', 'Single choice', 'ellipse-outline'],
      ['checkboxGroup', 'Multiple choice', 'checkbox-outline'],
      ['yesNo', 'Yes / No', 'swap-horizontal-outline'],
      ['checkbox', 'Checkbox', 'checkbox-outline'],
      ['file', 'File upload', 'attach-outline'],
      ['address', 'Address', 'location-outline'],
      ['taxId', 'Tax ID', 'shield-checkmark-outline'],
    ],
  },
  {
    label: 'Structure',
    items: [
      ['consent', 'Consent', 'checkmark-circle-outline'],
      ['signatureStep', 'Signature step', 'create-outline'],
    ],
  },
];

const BY_TYPE = new Map(
  GROUPS.flatMap((group) => group.items).map(([type, label, icon]) => [type, { type, label, icon }]),
);

/** Grupos de la paleta filtrados a los tipos que el registro del engine conoce. */
export function catalogGroups(): CatalogGroup[] {
  const available = new Set(componentTypes().map((type) => type.name));
  return GROUPS.map((group) => ({
    label: group.label,
    items: group.items
      .filter(([type]) => available.has(type))
      .map(([type, label, icon]) => ({ type, label, icon })),
  }));
}

/** Nombre visible de un tipo ("taxId" → "Tax ID"); tipos fuera del catálogo se humanizan. */
export function componentTypeLabel(type: string): string {
  return (
    BY_TYPE.get(type)?.label ??
    type.replace(/([A-Z])/g, ' $1').replace(/^./, (item) => item.toUpperCase())
  );
}

export function componentTypeIcon(type: string): string {
  return BY_TYPE.get(type)?.icon ?? 'cube-outline';
}
