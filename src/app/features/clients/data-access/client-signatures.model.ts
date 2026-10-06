import { StatusTone } from '@shared/ui/status-pill/status-pill.component';

/**
 * Contrato de `GET /signature/requests?customerId=` (servicio Signature) para la pestaña
 * "Signatures" del perfil. Replicado aquí a propósito: la feature clients no importa de
 * `features/signature` (regla de features autocontenidas).
 */
export type ApiSignatureStatus =
  | 'Draft'
  | 'Ready'
  | 'Scheduled'
  | 'InProgress'
  | 'Completed'
  | 'Rejected'
  | 'Canceled'
  | 'Expired';

export interface SignatureRequestSummaryResponse {
  id: string;
  title: string;
  category: string;
  status: ApiSignatureStatus;
  originalFileId: string;
  signerCount: number;
  expiresAtUtc: string;
  createdAtUtc: string;
  sentAtUtc: string | null;
  completedAtUtc: string | null;
}

export interface SignatureRequestListResponse {
  items: SignatureRequestSummaryResponse[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/** Fila lista para pintar en la pestaña. */
export interface ClientSignatureItem {
  id: string;
  title: string;
  category: string;
  status: ApiSignatureStatus;
  statusLabel: string;
  tone: StatusTone;
  originalFileId: string;
  signerCount: number;
  createdAtUtc: string;
  sentAtUtc: string | null;
  completedAtUtc: string | null;
  expiresAtUtc: string;
  /** El dominio solo permite cancelar mientras la solicitud no es terminal. */
  isCancelable: boolean;
}

/** Estado → etiqueta y tono de `app-status-pill` (mismos tonos que el módulo Signature). */
const STATUS_VIEW: Record<ApiSignatureStatus, { label: string; tone: StatusTone }> = {
  Draft: { label: 'Draft', tone: 'neutral' },
  Ready: { label: 'Ready', tone: 'info' },
  Scheduled: { label: 'Scheduled', tone: 'info' },
  InProgress: { label: 'In Progress', tone: 'brand' },
  Completed: { label: 'Completed', tone: 'success' },
  Rejected: { label: 'Rejected', tone: 'danger' },
  Canceled: { label: 'Canceled', tone: 'muted' },
  Expired: { label: 'Expired', tone: 'warning' },
};

const TERMINAL: ReadonlySet<ApiSignatureStatus> = new Set(['Completed', 'Rejected', 'Canceled', 'Expired']);

export function toClientSignatureItem(r: SignatureRequestSummaryResponse): ClientSignatureItem {
  const view = STATUS_VIEW[r.status] ?? { label: r.status, tone: 'neutral' as StatusTone };
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    status: r.status,
    statusLabel: view.label,
    tone: view.tone,
    originalFileId: r.originalFileId,
    signerCount: r.signerCount,
    createdAtUtc: r.createdAtUtc,
    sentAtUtc: r.sentAtUtc,
    completedAtUtc: r.completedAtUtc,
    expiresAtUtc: r.expiresAtUtc,
    isCancelable: !TERMINAL.has(r.status),
  };
}
