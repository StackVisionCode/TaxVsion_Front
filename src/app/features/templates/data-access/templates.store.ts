import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { TemplatesService } from './templates.service';
import {
  EmailTemplateResponse,
  Template,
  TemplateFormValue,
  pickReadableVersion,
  toTemplate,
} from './templates.model';

/**
 * Store del módulo Templates (Notification vía `/notifications/email/templates`).
 * providedIn: 'root', mismo patrón que task/campaigns.
 *
 * Particularidad del contrato: el cuerpo HTML NO está en la BD del servicio — vive en
 * CloudStorage. Para leerlo hay que pedir el detalle (que trae las versiones), quedarse
 * con la versión publicada y bajar su `htmlFileId` por URL presignada. Se cachea por
 * plantilla para no repetir dos saltos de red cada vez que se abre la vista previa.
 */
@Injectable({ providedIn: 'root' })
export class TemplatesStore {
  private readonly service = inject(TemplatesService);
  private readonly storage = inject(CloudStorageUploadService);
  private readonly http = inject(HttpClient);

  // ---------- Listado ----------
  private readonly _raw = signal<EmailTemplateResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  /** Error transitorio de una acción (archivar, publicar…): banner descartable. */
  private readonly _actionError = signal<string | null>(null);
  private initialized = false;

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly actionError = this._actionError.asReadonly();

  readonly templates = computed<Template[]>(() => this._raw().map(toTemplate));

  /** Categorías reales presentes en las plantillas (el backend las guarda como texto libre). */
  readonly categories = computed<string[]>(() =>
    [...new Set(this.templates().map(template => template.category))].sort(),
  );

  // ---------- Cuerpos (CloudStorage) ----------
  private readonly _bodies = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _bodyLoading = signal(false);
  private readonly _bodyError = signal<string | null>(null);

  readonly bodyLoading = this._bodyLoading.asReadonly();
  readonly bodyError = this._bodyError.asReadonly();

  bodyFor(templateId: string): string | null {
    return this._bodies().get(templateId) ?? null;
  }

  // ---------- Carga ----------

  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.refresh();
  }

  refresh(): void {
    this._loading.set(true);
    this._error.set(null);
    this.service.list().subscribe({
      next: items => {
        this._raw.set(items);
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

  /**
   * Carga el cuerpo de una plantilla: GET /{id} para conocer sus versiones → versión
   * publicada (o la más reciente) → download-url de CloudStorage → texto del HTML.
   * Cachea por id; con `force` re-baja tras guardar una versión nueva.
   */
  loadBody(templateId: string, force = false): void {
    if (!force && this._bodies().has(templateId)) {
      return;
    }
    this._bodyLoading.set(true);
    this._bodyError.set(null);
    this.fetchBody(templateId).subscribe({
      next: html => {
        this._bodies.update(current => new Map(current).set(templateId, html));
        this._bodyLoading.set(false);
      },
      error: err => {
        this._bodyError.set(toApiError(err).message);
        this._bodyLoading.set(false);
      },
    });
  }

  private fetchBody(templateId: string): Observable<string> {
    return this.service.getById(templateId).pipe(
      switchMap(detail => {
        const version = pickReadableVersion(detail.versions, detail.template.currentVersionId);
        if (!version) {
          // Plantilla creada sin cuerpo todavía: no es un error, simplemente está vacía.
          return of('');
        }
        return this.storage
          .getDownloadUrl(version.htmlFileId)
          .pipe(
            switchMap(result => this.http.get(result.downloadUrl, { responseType: 'text' })),
          );
      }),
    );
  }

  // ---------- Crear / editar ----------

  /**
   * Alta: POST (metadata) → POST /versions con el cuerpo → POST /publish si se pidió.
   * El backend separa metadata y contenido, así que una plantilla nueva siempre son al
   * menos dos llamadas encadenadas.
   */
  createTemplate(form: TemplateFormValue): Observable<void> {
    return this.service
      .create({
        scope: 'Tenant',
        templateKey: form.templateKey.trim(),
        subject: form.subject.trim(),
        description: form.description.trim() || null,
        category: form.category.trim() || null,
      })
      .pipe(
        switchMap(created =>
          this.service
            .addVersion(created.id, { subjectTemplate: form.subject.trim(), html: form.body })
            .pipe(
              switchMap(version =>
                form.publish
                  ? this.service.publish(created.id, version.id).pipe(map(() => undefined))
                  : of(undefined),
              ),
            ),
        ),
        tap(() => this.refresh()),
        map(() => undefined),
      );
  }

  /**
   * Edición: el backend NO tiene PUT de metadata — lo único versionable es el cuerpo.
   * Así que guardar una edición crea una versión nueva (y la publica si se pidió).
   */
  updateTemplate(template: Template, form: TemplateFormValue): Observable<void> {
    return this.service
      .addVersion(template.id, { subjectTemplate: form.subject.trim(), html: form.body })
      .pipe(
        switchMap(version =>
          form.publish
            ? this.service.publish(template.id, version.id).pipe(map(() => undefined))
            : of(undefined),
        ),
        tap(() => {
          this._bodies.update(current => new Map(current).set(template.id, form.body));
          this.refresh();
        }),
        map(() => undefined),
      );
  }

  /** POST /{id}/archive — reemplaza al "delete" del mock: el backend no borra plantillas. */
  archiveTemplate(id: string): void {
    this.service.archive(id).subscribe({
      next: () => this.refresh(),
      error: err => this._actionError.set(toApiError(err).message),
    });
  }

  /** Publica la versión vigente de una plantilla que quedó en Draft. */
  publishCurrent(template: Template): void {
    this.service
      .getById(template.id)
      .pipe(
        switchMap(detail => {
          const version = pickReadableVersion(detail.versions, detail.template.currentVersionId);
          if (!version) {
            throw new Error('This template has no content yet — edit it and save a body first.');
          }
          return this.service.publish(template.id, version.id);
        }),
        catchError(err => {
          this._actionError.set(err instanceof Error ? err.message : toApiError(err).message);
          return of(null);
        }),
      )
      .subscribe(result => {
        if (result !== null) {
          this.refresh();
        }
      });
  }
}
