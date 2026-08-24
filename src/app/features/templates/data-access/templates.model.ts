/**
 * Espejos del contrato HTTP de EmailTemplatesController (TaxVision.Notification.Api,
 * ruta `/notifications/email/templates` vía Gateway) + view-model de la biblioteca.
 *
 * Modelo del backend, distinto al mock que había antes:
 *  - La BD guarda SOLO metadata + storage keys. El HTML del cuerpo vive en CloudStorage
 *    y se descarga aparte con `htmlFileId` (por eso el cuerpo no viene en el listado).
 *  - Cada edición crea una VERSIÓN nueva (inmutable); publicar activa una de ellas.
 *  - Las plantillas NO se borran: se archivan (no hay DELETE en el controller).
 *  - `scope` System = plantillas de plataforma (solo lectura para el tenant);
 *    Tenant = las propias de la firma.
 * Los enums viajan como STRING (JsonStringEnumConverter).
 */

// ---------- Enums del backend ----------

/** Espejo de EmailScope. Las System son de plataforma: el tenant no las edita. */
export type EmailScope = 'System' | 'Tenant';

/** Espejo de EmailTemplateStatus. Ojo: es `Active`, no "published". */
export type ApiTemplateStatus = 'Draft' | 'Active' | 'Archived';

/** Espejo de EmailTemplateVersionStatus. */
export type ApiVersionStatus = 'Draft' | 'Published' | 'Superseded';

// ---------- Respuestas ----------

/** Espejo de EmailTemplateResponse. */
export interface EmailTemplateResponse {
  id: string;
  scope: EmailScope;
  tenantId: string | null;
  templateKey: string;
  subject: string;
  description: string | null;
  category: string | null;
  variables: string[];
  status: ApiTemplateStatus;
  currentVersionId: string | null;
  createdAtUtc: string;
  publishedAtUtc: string | null;
}

/** Espejo de EmailTemplateVersionResponse. El contenido real se baja por `htmlFileId`. */
export interface EmailTemplateVersionResponse {
  id: string;
  versionNumber: number;
  status: ApiVersionStatus;
  htmlStorageKey: string;
  htmlFileId: string;
  designStorageKey: string | null;
  previewStorageKey: string | null;
  createdAtUtc: string;
}

/** Espejo de EmailTemplateDetailResponse (GET /{id}). */
export interface EmailTemplateDetailResponse {
  template: EmailTemplateResponse;
  versions: EmailTemplateVersionResponse[];
}

// ---------- Requests ----------

export interface CreateEmailTemplateRequest {
  scope: EmailScope;
  /** Identificador estable de la plantilla (único por scope). */
  templateKey: string;
  subject: string;
  description?: string | null;
  category?: string | null;
  variables?: string[];
}

/** POST /{id}/versions — cada guardado del cuerpo crea una versión nueva. */
export interface AddVersionRequest {
  subjectTemplate: string;
  html: string;
  designJson?: string | null;
  previewPngBase64?: string | null;
}

export interface PublishRequest {
  versionId: string;
}

// ---------- View-model ----------

/** Estado de UI derivado de `status` del backend. */
export type TemplateUiStatus = 'draft' | 'published' | 'archived';

/** Tarjeta de la biblioteca. */
export interface Template {
  id: string;
  /** Se muestra como nombre: el backend no tiene "name", su identidad es templateKey. */
  name: string;
  templateKey: string;
  subject: string;
  description: string;
  /** Texto libre en el backend (el mock tenía un enum cerrado). */
  category: string;
  variables: string[];
  scope: EmailScope;
  status: TemplateUiStatus;
  apiStatus: ApiTemplateStatus;
  currentVersionId: string | null;
  /** Solo las Tenant son editables/archivables; las System son de plataforma. */
  isEditable: boolean;
  /** YYYY-MM-DD de la última publicación, o de la creación si nunca se publicó. */
  updatedAt: string;
}

/** Lo que emite el panel de crear/editar; el store lo traduce a los requests reales. */
export interface TemplateFormValue {
  templateKey: string;
  subject: string;
  description: string;
  category: string;
  /** Cuerpo HTML: si cambia (o es nuevo) se crea una versión. */
  body: string;
  /** Publicar la versión recién creada además de guardarla. */
  publish: boolean;
}

// ---------- Mapeos ----------

const STATUS_TO_UI: Record<ApiTemplateStatus, TemplateUiStatus> = {
  Draft: 'draft',
  Active: 'published',
  Archived: 'archived',
};

export function toTemplate(response: EmailTemplateResponse): Template {
  const stamp = response.publishedAtUtc ?? response.createdAtUtc;
  return {
    id: response.id,
    name: response.templateKey,
    templateKey: response.templateKey,
    subject: response.subject,
    description: response.description ?? '',
    category: response.category ?? 'Uncategorized',
    variables: response.variables ?? [],
    scope: response.scope,
    status: STATUS_TO_UI[response.status] ?? 'draft',
    apiStatus: response.status,
    currentVersionId: response.currentVersionId,
    isEditable: response.scope === 'Tenant',
    updatedAt: stamp ? stamp.slice(0, 10) : '',
  };
}

/** Versión activa de una plantilla (la publicada), o la más reciente si ninguna lo está. */
export function pickReadableVersion(
  versions: readonly EmailTemplateVersionResponse[],
  currentVersionId: string | null,
): EmailTemplateVersionResponse | null {
  if (versions.length === 0) {
    return null;
  }
  const current = currentVersionId ? versions.find(version => version.id === currentVersionId) : undefined;
  if (current) {
    return current;
  }
  return [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
}
