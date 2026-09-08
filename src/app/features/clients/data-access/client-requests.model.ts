/**
 * Espejo del contrato de ClientRequests (TaxVision.Tasks.Api, `/tasks/client-requests`) para la
 * sección "Requests from client" de la pestaña Work + su view-model.
 *
 * Un ClientRequest es un agregado APARTE de la tarea ("lo que la firma le pide al cliente, en el
 * idioma del cliente"). El listado por cliente para staff es el endpoint nuevo
 * `GET /tasks/client-requests?customerId=` (contraparte del listado del portal, que deriva el
 * cliente del token). Los enums viajan como STRING (el servicio los serializa por nombre).
 */

/** Espejo de ClientRequestStatus (Domain). */
export type ClientRequestStatus = 'Pending' | 'Submitted' | 'Accepted' | 'Rejected' | 'Cancelled';

/** Espejo de AttachmentStatus (Domain). */
export type ClientRequestDocumentStatus = 'Pending' | 'Available' | 'Rejected' | 'Detached';

/** Espejo de ClientRequestResolution (request de resolve). */
export type ClientRequestResolution = 'Accept' | 'Reject' | 'Cancel';

export interface ClientRequestDocumentResponse {
  id: string;
  fileId: string;
  displayName: string;
  contentType: string | null;
  sizeBytes: number;
  status: ClientRequestDocumentStatus;
  uploadedAtUtc: string;
}

/** Espejo de ClientRequestResponse (staff — sí lleva quién lo pidió). */
export interface ClientRequestResponse {
  id: string;
  customerId: string;
  taskId: string | null;
  title: string;
  details: string | null;
  status: ClientRequestStatus;
  dueAtUtc: string | null;
  requestedByUserId: string;
  createdAtUtc: string;
  submittedAtUtc: string | null;
  resolvedAtUtc: string | null;
  resolutionNote: string | null;
  documents: ClientRequestDocumentResponse[];
}

// ---------- Requests ----------

/** POST /tasks/client-requests — `customerId` obligatorio; `taskId` opcional. */
export interface CreateClientRequestRequest {
  customerId: string;
  taskId: string | null;
  title: string;
  details: string | null;
  dueAtUtc: string | null;
}

/** POST /tasks/client-requests/{id}/resolve — Reject exige `note`. */
export interface ResolveClientRequestRequest {
  resolution: ClientRequestResolution;
  note: string | null;
}

// ---------- View-model ----------

export interface ClientRequestItem {
  id: string;
  title: string;
  details: string;
  status: ClientRequestStatus;
  dueDate: string;
  createdAtUtc: string;
  submittedAtUtc: string | null;
  resolvedAtUtc: string | null;
  resolutionNote: string | null;
  documentCount: number;
  documents: ClientRequestDocumentResponse[];
  /** Solo se puede aceptar/rechazar lo que el cliente ya envió (Submitted). */
  canResolve: boolean;
  /** Cancelar solo aplica mientras está abierto (Pending/Submitted). */
  isOpen: boolean;
}

export function toClientRequestItem(response: ClientRequestResponse): ClientRequestItem {
  const isOpen = response.status === 'Pending' || response.status === 'Submitted';
  return {
    id: response.id,
    title: response.title,
    details: response.details ?? '',
    status: response.status,
    dueDate: response.dueAtUtc ? response.dueAtUtc.slice(0, 10) : '',
    createdAtUtc: response.createdAtUtc,
    submittedAtUtc: response.submittedAtUtc,
    resolvedAtUtc: response.resolvedAtUtc,
    resolutionNote: response.resolutionNote,
    documentCount: response.documents.filter(d => d.status !== 'Detached').length,
    documents: response.documents,
    canResolve: response.status === 'Submitted',
    isOpen,
  };
}

/** Clase del chip de estado (tokens de marca / semántica, sin hex hardcodeado). */
export function requestStatusChipClass(status: ClientRequestStatus): string {
  switch (status) {
    case 'Pending':
      return 'border-gray-200 bg-gray-50 text-gray-500';
    case 'Submitted':
      return 'border-amber-200 bg-amber-50 text-amber-600';
    case 'Accepted':
      return 'border-emerald-200 bg-emerald-50 text-emerald-600';
    case 'Rejected':
      return 'border-red-200 bg-red-50 text-red-500';
    case 'Cancelled':
      return 'border-gray-200 bg-gray-50 text-gray-400';
  }
}

export function requestStatusLabel(status: ClientRequestStatus): string {
  switch (status) {
    case 'Pending':
      return 'Awaiting client';
    case 'Submitted':
      return 'Submitted — review';
    case 'Accepted':
      return 'Accepted';
    case 'Rejected':
      return 'Rejected';
    case 'Cancelled':
      return 'Cancelled';
  }
}
