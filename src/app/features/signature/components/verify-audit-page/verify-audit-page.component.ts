import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/models/api-error.model';
import { PublicSignatureService } from '../../data-access/public-signature.service';
import { parseUtcDate } from '../../../../shared/utils/utc-date.util';
import {
  AUDIT_EVENT_KIND_ICON,
  AUDIT_EVENT_KIND_LABEL,
  AUDIT_FAILURE_KINDS,
  AuditChainVerificationResponse,
  SignatureAuditEventKind,
  describeDeadLink,
  isDeadLinkCode,
} from '../../data-access/public-signature.model';

/** Una fila de la cadena ya preparada para pintar (nada se calcula en la plantilla). */
export interface ChainRow {
  sequence: number;
  kind: SignatureAuditEventKind;
  label: string;
  icon: string;
  /** true ⇒ la fila registra un intento fallido/negativo. NO significa cadena rota. */
  isFailure: boolean;
  dateLabel: string;
  timeLabel: string;
  /** HMAC completo, tal cual lo devuelve el backend. */
  chainHash: string;
  chainHashShort: string;
  /** `payloadJson` re-indentado si es JSON válido; el crudo si no lo es. */
  payload: string;
  /** true ⇒ es la fila donde el verificador encontró el defecto. */
  isDefect: boolean;
}

/**
 * Pantalla PÚBLICA de verificación de la cadena de audit
 * (`GET /signature/public/{token}/verify-audit`, `[AllowAnonymous]`).
 *
 * Qué es lo que se enseña, y por qué solo eso: la respuesta
 * (`AuditChainVerificationResponse`) trae exactamente seis datos —
 * `signatureRequestId`, `isIntact`, `eventCount`, `lastSequence`, `defect` y
 * `events[]` (cada uno con `sequence`, `kind`, `occurredAtUtc`, `payloadJson` y
 * `chainHash`)—. No hay título del documento, ni nombre del firmante, ni estado de la
 * solicitud: eso vive en `GET /signature/public/{token}`, que además SELLA la apertura
 * del enlace en el propio audit trail (es un Command en el backend). Llamarlo desde una
 * pantalla de verificación contaminaría la cadena que se está verificando, así que esta
 * página se queda con lo que devuelve su endpoint y nada más.
 *
 * El veredicto tampoco se recalcula aquí: el HMAC se computa con el `TenantAuditSecret`
 * del tenant, que jamás sale del backend. El cliente muestra `isIntact` y el material
 * (`chainHash` por fila) para que un tercero pueda contrastarlo.
 */
@Component({
  selector: 'app-verify-audit-page',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './verify-audit-page.component.html',
  styleUrl: './verify-audit-page.component.css',
})
export class VerifyAuditPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PublicSignatureService);

  private token = '';

  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly result = signal<AuditChainVerificationResponse | null>(null);

  /** Secuencias con el detalle (payload + hash completo) desplegado. */
  private readonly expanded = signal<ReadonlySet<number>>(new Set<number>());
  /** Secuencia cuyo hash se acaba de copiar (feedback efímero del botón). */
  readonly copiedSequence = signal<number | null>(null);

  // ------------------------------------------------------------------
  // Derivados
  // ------------------------------------------------------------------

  /**
   * Token inválido/expirado/revocado: no hay reintento que sirva, así que se muestra
   * una pantalla propia sin botón de Retry (mismo criterio que `/sign/:token`).
   */
  readonly deadLink = computed(() => {
    const err = this.error();
    return err && isDeadLinkCode(err.code) ? describeDeadLink(err.code) : null;
  });

  readonly isIntact = computed(() => this.result()?.isIntact ?? null);
  readonly eventCount = computed(() => this.result()?.eventCount ?? 0);
  readonly lastSequence = computed(() => this.result()?.lastSequence ?? 0);
  readonly defect = computed(() => this.result()?.defect ?? null);
  readonly requestId = computed(() => this.result()?.signatureRequestId ?? '');

  /**
   * Cadena todavía sin filas. El backend responde `isIntact: true, eventCount: 0` a una
   * cadena vacía (`HmacAuditChainVerifier`), lo que leído a secas diría "verificada"
   * sobre cero evidencia. Se separa como estado propio para no dar esa impresión.
   */
  readonly isEmptyChain = computed(() => !!this.result() && this.result()!.events.length === 0);

  readonly rows = computed<ChainRow[]>(() => {
    const data = this.result();
    if (!data) {
      return [];
    }
    const defectSequence = data.defect?.sequence ?? null;
    return [...data.events]
      .sort((a, b) => a.sequence - b.sequence)
      .map(evt => ({
        sequence: evt.sequence,
        kind: evt.kind,
        label: AUDIT_EVENT_KIND_LABEL[evt.kind] ?? evt.kind,
        icon: AUDIT_EVENT_KIND_ICON[evt.kind] ?? 'ellipse-outline',
        isFailure: AUDIT_FAILURE_KINDS.has(evt.kind),
        dateLabel: formatDate(evt.occurredAtUtc),
        timeLabel: formatTime(evt.occurredAtUtc),
        chainHash: evt.chainHash,
        chainHashShort: shortenHash(evt.chainHash),
        payload: prettyJson(evt.payloadJson),
        isDefect: defectSequence !== null && evt.sequence === defectSequence,
      }));
  });

  /**
   * `eventCount` sale del verificador y `events.length` de la misma lectura, así que
   * coinciden siempre; se comparan igual para no afirmar un número que la lista no
   * respalda si algún día el backend paginara los eventos.
   */
  readonly countMatchesRows = computed(() => this.eventCount() === this.rows().length);

  isExpanded(sequence: number): boolean {
    return this.expanded().has(sequence);
  }

  // ------------------------------------------------------------------
  // Ciclo de vida
  // ------------------------------------------------------------------

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    void this.load();
  }

  async load(): Promise<void> {
    if (!this.token) {
      this.loading.set(false);
      this.result.set(null);
      this.error.set({ code: 'Signature.Token.Format', message: 'Missing token.' });
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.result.set(await firstValueFrom(this.api.verifyAudit(this.token)));
    } catch (err) {
      this.result.set(null);
      this.error.set(toApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  // ------------------------------------------------------------------
  // Interacción
  // ------------------------------------------------------------------

  toggle(sequence: number): void {
    this.expanded.update(current => {
      const next = new Set(current);
      if (!next.delete(sequence)) {
        next.add(sequence);
      }
      return next;
    });
  }

  expandAll(): void {
    this.expanded.set(new Set(this.rows().map(r => r.sequence)));
  }

  collapseAll(): void {
    this.expanded.set(new Set<number>());
  }

  /**
   * Copia el HMAC de una fila. `navigator.clipboard` no existe en contextos no seguros
   * (http:// que no sea localhost) y puede rechazar sin permiso: el fallo se traga
   * porque el hash sigue visible y seleccionable en pantalla.
   */
  async copyHash(row: ChainRow): Promise<void> {
    try {
      await navigator.clipboard.writeText(row.chainHash);
      this.copiedSequence.set(row.sequence);
      setTimeout(() => {
        if (this.copiedSequence() === row.sequence) {
          this.copiedSequence.set(null);
        }
      }, 1600);
    } catch {
      this.copiedSequence.set(null);
    }
  }
}

function formatDate(iso: string): string {
  return parseUtcDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  return parseUtcDate(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** El chainHash es un HMAC-SHA256 en hex (64 chars): se abrevia para la fila. */
function shortenHash(hash: string): string {
  return hash.length <= 20 ? hash : `${hash.slice(0, 10)}…${hash.slice(-10)}`;
}

/**
 * `payloadJson` es el snapshot canónico que entró al HMAC — viaja compactado. Se
 * re-indenta solo para leerlo; si no parsea se muestra tal cual, sin inventar nada.
 */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
