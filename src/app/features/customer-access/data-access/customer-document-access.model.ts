/**
 * Reglas de deny per-item para los documentos de un cliente. Espejo de los endpoints de
 * CloudStorage.Api (`/storage/customer-access/{customerId}/rules`). Enums serializados como strings.
 */

export type AccessResourceType = 'Folder' | 'File' | 'TenantScope';

/** Capacidades que el motor de autorización evalúa. El UI expone 5 "accionables"; `Visible` se
 * presenta como "Hide from client" porque remueve el recurso entero de la vista del portal. */
export type AccessCapability =
  'Visible' | 'Preview' | 'Download' | 'Upload' | 'Delete' | 'ShareExternal';

/** Fila de GET /storage/customer-access/{customerId}/rules. */
export interface CustomerAccessRuleView {
  id: string;
  customerId: string;
  resourceType: AccessResourceType;
  resourceId: string;
  capability: AccessCapability;
  setByUserId: string;
  setAtUtc: string;
  reason: string | null;
}

/** Body de POST /storage/customer-access/{customerId}/rules. */
export interface SetDenyRuleRequest {
  resourceType: AccessResourceType;
  resourceId: string;
  capability: AccessCapability;
  reason?: string | null;
}

/** Snapshot de capacidades efectivas en respuestas de files/folders cuando el flag está on. */
export interface EffectiveCapabilities {
  preview: boolean;
  download: boolean;
  upload: boolean;
  delete: boolean;
  shareExternal: boolean;
}

/** Capacidades expuestas al admin por tipo de recurso. `Upload` solo aplica a Folder. */
export function capabilitiesFor(resourceType: 'File' | 'Folder'): readonly AccessCapability[] {
  if (resourceType === 'Folder') {
    return ['Preview', 'Download', 'Upload', 'Delete', 'ShareExternal'];
  }
  return ['Preview', 'Download', 'Delete', 'ShareExternal'];
}

/** Clave estable de una regla (resourceType|resourceId|capability). */
export function ruleKey(
  resourceType: AccessResourceType,
  resourceId: string,
  capability: AccessCapability,
): string {
  return `${resourceType}|${resourceId}|${capability}`;
}

/**
 * Preset global por cliente — azúcar sintáctico sobre reglas deny `TenantScope`. El preset activo
 * se calcula del set de capabilities denegadas tenant-scope; cualquier combinación fuera de la tabla
 * se reporta como `Custom`. Los overrides per-item siguen vigentes bajo cualquier preset.
 */
export type AccessPreset = 'Full' | 'ViewUpload' | 'ReadOnly' | 'PreviewOnly' | 'Custom';

/** Capabilities denegadas a nivel tenant por cada preset (orden estable para comparaciones). */
export const PRESETS: Record<Exclude<AccessPreset, 'Custom'>, readonly AccessCapability[]> = {
  Full: [],
  ViewUpload: ['Download'],
  ReadOnly: ['Upload'],
  PreviewOnly: ['Download', 'Upload'],
};

/** Lista ordenada para pintar el pill group. */
export const SELECTABLE_PRESETS: readonly Exclude<AccessPreset, 'Custom'>[] = [
  'Full',
  'ViewUpload',
  'ReadOnly',
  'PreviewOnly',
];

/** Copy del UI por preset. */
export const PRESET_COPY: Record<AccessPreset, { label: string; description: string }> = {
  Full: {
    label: 'Full access',
    description: 'The client can preview, download, upload and share.',
  },
  ViewUpload: {
    label: 'View + Upload',
    description: 'The client can view and upload, but cannot download their documents.',
  },
  ReadOnly: {
    label: 'Read-only',
    description: 'The client can view and download, but cannot upload new documents.',
  },
  PreviewOnly: {
    label: 'Preview-only',
    description: 'The client can only preview documents in the browser.',
  },
  Custom: {
    label: 'Custom',
    description: 'The current combination does not match any of the standard presets.',
  },
};

/**
 * Detecta el preset activo a partir de las reglas tenant-scope del cliente. Si el set exacto de
 * capabilities denegadas no matchea ninguno de los 4 presets canónicos, devuelve `'Custom'`.
 */
export function detectPreset(tenantScopeRules: readonly CustomerAccessRuleView[]): AccessPreset {
  const denied = new Set<AccessCapability>(
    tenantScopeRules.filter((r) => r.resourceType === 'TenantScope').map((r) => r.capability),
  );
  for (const preset of SELECTABLE_PRESETS) {
    const target = PRESETS[preset];
    if (denied.size === target.length && target.every((cap) => denied.has(cap))) {
      return preset;
    }
  }
  return 'Custom';
}
