import { Injectable, computed, inject, signal } from '@angular/core';
import { EMPTY, Observable, expand, map, of, reduce, switchMap, tap, throwError } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CampaignsService } from './campaigns.service';
import {
  CampaignFormValue,
  CampaignItem,
  CampaignRecipientInput,
  CampaignTemplateSummary,
  EmailCampaignResponse,
  OutboundEmailResponse,
  parseCustomEmails,
  toCampaignItem,
} from './campaigns.model';

/** Lote por página del listado (máximo que acepta el backend). */
const LIST_PAGE_SIZE = 100;
/** Tope de páginas encadenadas al cargar (500 campañas es más que suficiente para un tenant). */
const LIST_MAX_PAGES = 5;

/**
 * Store del módulo Campaigns (EmailCampaignsController de Notification vía
 * `/notifications/email/campaigns`). Guarda los EmailCampaignResponse crudos y deriva las
 * filas con computed(): así los nombres de plantilla se re-resuelven solos cuando llega el
 * catálogo de plantillas (GET /notifications/email/templates, best-effort).
 *
 * El backend no expone búsqueda ni edición: la lista se trae completa (paginada en lotes de
 * 100 hasta un tope) y búsqueda/filtro/paginación viven en el cliente, igual que en el mock.
 */
@Injectable({ providedIn: 'root' })
export class CampaignsStore {
  private readonly service = inject(CampaignsService);

  // ---------- Estado crudo ----------
  private readonly _raw = signal<EmailCampaignResponse[]>([]);
  private readonly _totalCount = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  /** Error transitorio de una acción (cancelar, programar…): banner descartable, no rompe la lista. */
  private readonly _actionError = signal<string | null>(null);
  private initialized = false;

  // ---------- Catálogo de plantillas (réplica de EmailTemplatesController) ----------
  private readonly _templates = signal<CampaignTemplateSummary[]>([]);
  private readonly _templatesError = signal<string | null>(null);
  private readonly _templatesLoading = signal(false);

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly actionError = this._actionError.asReadonly();
  readonly totalCount = this._totalCount.asReadonly();
  readonly templatesError = this._templatesError.asReadonly();
  readonly templatesLoading = this._templatesLoading.asReadonly();

  private readonly templateById = computed<ReadonlyMap<string, CampaignTemplateSummary>>(
    () => new Map(this._templates().map(template => [template.id, template])),
  );

  /** Solo se puede programar con plantilla Active y versión publicada: el picker ofrece esas. */
  readonly publishableTemplates = computed<CampaignTemplateSummary[]>(() =>
    this._templates().filter(template => template.status === 'Active' && template.currentVersionId !== null),
  );

  /** Filas de la tabla, más recientes primero (el backend no garantiza orden entre páginas). */
  readonly campaigns = computed<CampaignItem[]>(() => {
    const templates = this.templateById();
    return [...this._raw()]
      .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc))
      .map(response => toCampaignItem(response, templates));
  });

  // ---------- Carga ----------

  /** Carga inicial idempotente: listado + catálogo de plantillas. */
  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.loadTemplates();
    this.refresh();
  }

  refresh(): void {
    this._loading.set(true);
    this._error.set(null);
    this.fetchAllPages().subscribe({
      next: ({ items, total }) => {
        this._raw.set(items);
        this._totalCount.set(total);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  clearActionError(): void {
    this._actionError.set(null);
  }

  /** Encadena GET /notifications/email/campaigns página a página mientras hasMore (con tope). */
  private fetchAllPages(): Observable<{ items: EmailCampaignResponse[]; total: number }> {
    return this.service.list({ page: 1, size: LIST_PAGE_SIZE }).pipe(
      expand(result =>
        result.hasMore && result.page < LIST_MAX_PAGES
          ? this.service.list({ page: result.page + 1, size: LIST_PAGE_SIZE })
          : EMPTY,
      ),
      reduce(
        (acc, result) => ({ items: [...acc.items, ...result.items], total: result.totalCount }),
        { items: [] as EmailCampaignResponse[], total: 0 },
      ),
    );
  }

  /** Plantillas para el picker y los nombres de la tabla. Reintentable desde el panel. */
  loadTemplates(): void {
    this._templatesLoading.set(true);
    this._templatesError.set(null);
    this.service.listTemplates().subscribe({
      next: templates => {
        this._templates.set(templates);
        this._templatesLoading.set(false);
      },
      error: err => {
        // Best-effort para los nombres de la tabla, pero el panel sí necesita avisar:
        // sin catálogo no se puede elegir plantilla y crear queda bloqueado.
        this._templatesError.set(toApiError(err).message);
        this._templatesLoading.set(false);
      },
    });
  }

  // ---------- Crear / programar / cancelar ----------

  /**
   * Crea el Draft (resolviendo primero los destinatarios según la audiencia elegida) y, si el
   * formulario trae fecha, lo programa de inmediato con POST {id}/schedule.
   */
  createCampaign(form: CampaignFormValue): Observable<void> {
    return this.resolveRecipients(form).pipe(
      switchMap(recipients =>
        this.service.create({
          name: form.name.trim(),
          type: form.type,
          templateId: form.templateId,
          recipients,
        }),
      ),
      switchMap(created =>
        form.scheduledDate
          ? this.service.schedule(created.id, { scheduledAtUtc: `${form.scheduledDate}T00:00:00Z` })
          : of(created),
      ),
      tap(final => {
        this._raw.update(list => [final, ...list]);
        this._totalCount.update(total => total + 1);
      }),
      map(() => undefined),
    );
  }

  /**
   * Programa un Draft existente. `dateYmd` vacío = lanzar ahora (el backend usa UtcNow cuando
   * scheduledAtUtc llega null).
   */
  scheduleCampaign(id: string, dateYmd: string): Observable<void> {
    const scheduledAtUtc = dateYmd ? `${dateYmd}T00:00:00Z` : null;
    return this.service.schedule(id, { scheduledAtUtc }).pipe(
      tap(final => this.replaceRaw(final)),
      map(() => undefined),
    );
  }

  /**
   * Cancela una campaña (única transición manual del backend; inválida en Completed/Cancelled).
   * El endpoint devuelve 204, así que la fila se refresca con GET {id}. Si algo falla se muestra
   * el banner de acción y se re-sincroniza la fila por si el cancel sí llegó a aplicarse.
   */
  cancelCampaign(id: string): void {
    this.service
      .cancel(id)
      .pipe(switchMap(() => this.service.getById(id)))
      .subscribe({
        next: final => this.replaceRaw(final),
        error: err => {
          this._actionError.set(toApiError(err).message);
          // Re-sync best-effort: el cancel pudo aplicarse y fallar solo el GET de refresco.
          this.service.getById(id).subscribe({
            next: final => this.replaceRaw(final),
            error: () => undefined,
          });
        },
      });
  }

  /** POST {id}/send-test — correo de prueba a una dirección (202, se encola). */
  sendTest(id: string, toEmail: string): Observable<OutboundEmailResponse> {
    return this.service.sendTest(id, { toEmail: toEmail.trim() });
  }

  // ---------- Helpers ----------

  /** Audiencia → destinatarios reales: clientes activos (GET /customers) o correos manuales. */
  private resolveRecipients(form: CampaignFormValue): Observable<CampaignRecipientInput[]> {
    if (form.audience === 'custom') {
      const emails = parseCustomEmails(form.customEmails);
      return emails.length > 0
        ? of(emails.map(address => ({ address })))
        : throwError(() => new RecipientsError('Add at least one valid email address for the custom list.'));
    }
    return this.service.listClients().pipe(
      map(result => {
        const seen = new Set<string>();
        const recipients: CampaignRecipientInput[] = [];
        for (const client of result.items) {
          const email = client.primaryEmail?.trim();
          if (client.status !== 'Active' || !email || !email.includes('@')) {
            continue;
          }
          const key = email.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            recipients.push({ address: email, name: client.displayName });
          }
        }
        if (recipients.length === 0) {
          throw new RecipientsError('Your office has no active clients with an email address yet.');
        }
        return recipients;
      }),
    );
  }

  private replaceRaw(final: EmailCampaignResponse): void {
    this._raw.update(list => list.map(response => (response.id === final.id ? final : response)));
  }
}

/** Error con mensaje ya apto para UI (no pasa por toApiError). */
export class RecipientsError extends Error {}
