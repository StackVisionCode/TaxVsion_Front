import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import {
  externalErrorCode,
  externalErrorMessage,
  intakeLinkUrl,
  isEntryNotice,
} from '../utils/external-forms';
import type {
  AssignableFormTemplate,
  ActiveConsentNotice,
  CreateFormIntakeLinkInput,
  FormIntakeLink,
  FormIntakeLinkAction,
  FormIntakeLinkTokenResponse,
  FormTemplateVersionSummary,
  StaffMemberOption,
} from './client-forms.model';
import { ClientFormsAvailabilityStore } from './client-forms-availability.store';
import { FormIntakeLinksService } from './form-intake-links.service';
import { FormRequestsService } from './form-requests.service';
import { FormTemplatesService } from './form-templates.service';

/** Enlace completo visible solo en memoria: nunca va a storage (P-14.2, `TokenCipher`). */
export interface RevealedIntakeLink {
  linkId: string;
  url: string;
}

@Injectable()
export class FormIntakeLinksStore {
  private readonly service = inject(FormIntakeLinksService);
  private readonly requests = inject(FormRequestsService);
  private readonly templatesService = inject(FormTemplatesService);
  private readonly availability = inject(ClientFormsAvailabilityStore);

  private readonly _links = signal<FormIntakeLink[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _busyId = signal<string | null>(null);
  private readonly _actionError = signal<string | null>(null);
  private readonly _revealed = signal<RevealedIntakeLink | null>(null);
  private readonly _templates = signal<AssignableFormTemplate[]>([]);
  private readonly _versions = signal<Record<string, FormTemplateVersionSummary[]>>({});
  private readonly _notices = signal<ActiveConsentNotice[]>([]);
  private readonly _noticesFailed = signal(false);
  private readonly _staff = signal<StaffMemberOption[]>([]);
  private readonly _versionsForbidden = signal(false);

  readonly links = this._links.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly busyId = this._busyId.asReadonly();
  readonly actionError = this._actionError.asReadonly();
  readonly revealed = this._revealed.asReadonly();
  readonly templates = this._templates.asReadonly();
  readonly versions = this._versions.asReadonly();
  readonly noticesFailed = this._noticesFailed.asReadonly();
  readonly staff = this._staff.asReadonly();
  /** `templates/{id}/versions` exige `form_templates.read`; sin él solo se usa la última versión. */
  readonly versionsForbidden = this._versionsForbidden.asReadonly();
  readonly entryNotices = computed(() => this._notices().filter(isEntryNotice));

  async load(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const [links] = await Promise.all([
        firstValueFrom(this.service.list()),
        this.loadLookups(),
      ]);
      this._links.set(links ?? []);
      await this.loadVersionsFor(links ?? []);
    } catch (error) {
      // Backend previo: con la captación apagada la lista responde Unavailable. El banner ya lo explica.
      if (externalErrorCode(error) === 'FormIntakeLink.Unavailable') this._links.set([]);
      else this._error.set(externalErrorMessage(error));
    } finally {
      this._loading.set(false);
    }
  }

  async loadVersions(templateId: string): Promise<FormTemplateVersionSummary[]> {
    const cached = this._versions()[templateId];
    if (cached) return cached;
    try {
      const versions = await firstValueFrom(this.templatesService.versions(templateId));
      const sorted = [...(versions ?? [])].sort((a, b) => b.versionNumber - a.versionNumber);
      this._versions.update((current) => ({ ...current, [templateId]: sorted }));
      return sorted;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 403)
        this._versionsForbidden.set(true);
      return [];
    }
  }

  templateName(templateId: string): string {
    return this._templates().find((item) => item.templateId === templateId)?.name ?? 'Form template';
  }

  versionNumber(link: FormIntakeLink): number | null {
    return (
      this._versions()[link.formTemplateId]?.find((item) => item.id === link.formTemplateVersionId)
        ?.versionNumber ?? null
    );
  }

  responsibleName(userId: string): string {
    return this._staff().find((item) => item.userId === userId)?.name ?? 'Staff member';
  }

  noticeTitle(noticeId: string | null): string | null {
    if (!noticeId) return null;
    return this._notices().find((item) => item.id === noticeId)?.title ?? null;
  }

  async create(input: CreateFormIntakeLinkInput): Promise<boolean> {
    return this.run('new', this.service.create(input), (response) => {
      this._links.update((links) => [response.link, ...links]);
      void this.loadVersionsFor([response.link]);
    });
  }

  async change(link: FormIntakeLink, action: FormIntakeLinkAction): Promise<boolean> {
    return this.run(link.id, this.service.change(link.id, action, link.rowVersion), (response) =>
      this.replace(response.link),
    );
  }

  async pinVersion(link: FormIntakeLink, versionId: string): Promise<boolean> {
    return this.run(
      link.id,
      this.service.pinVersion(link.id, versionId, link.rowVersion),
      (response) => this.replace(response.link),
    );
  }

  /** Pide el token y deja el enlace en memoria para mostrarlo con el botón Copy. */
  async reveal(link: FormIntakeLink): Promise<string | null> {
    const ok = await this.run(link.id, this.service.token(link.id), (response) =>
      this.replace(response.link),
    );
    return ok ? (this._revealed()?.url ?? null) : null;
  }

  clearRevealed(): void {
    this._revealed.set(null);
  }

  dismissActionError(): void {
    this._actionError.set(null);
  }

  private async run(
    busyId: string,
    request: Observable<FormIntakeLinkTokenResponse>,
    apply: (response: FormIntakeLinkTokenResponse) => void,
  ): Promise<boolean> {
    if (this._busyId()) return false;
    this._busyId.set(busyId);
    this._actionError.set(null);
    try {
      const response = await firstValueFrom(request);
      apply(response);
      if (response.token)
        this._revealed.set({ linkId: response.link.id, url: intakeLinkUrl(response.token) });
      return true;
    } catch (error) {
      this._actionError.set(this.actionMessage(error));
      // Otro admin cambió el enlace: se recarga para traer el rowVersion vigente.
      if (
        error instanceof HttpErrorResponse &&
        externalErrorCode(error) === 'FormIntakeLink.ConcurrencyConflict'
      ) {
        await this.reloadLinks();
      }
      return false;
    } finally {
      this._busyId.set(null);
    }
  }

  // `FormIntakeLink.Unavailable` también es la transición inválida (p. ej. reanudar uno vencido).
  private actionMessage(error: unknown): string {
    if (
      externalErrorCode(error) === 'FormIntakeLink.Unavailable' &&
      this.availability.intakeLinksEnabled()
    )
      return "This link can't change state. It may be expired, already paused or revoked.";
    return externalErrorMessage(error);
  }

  private replace(link: FormIntakeLink): void {
    this._links.update((links) => links.map((item) => (item.id === link.id ? link : item)));
  }

  private async reloadLinks(): Promise<void> {
    try {
      this._links.set((await firstValueFrom(this.service.list())) ?? []);
    } catch {
      // La lista anterior sigue visible; el error ya está en pantalla.
    }
  }

  private async loadVersionsFor(links: readonly FormIntakeLink[]): Promise<void> {
    const templateIds = [...new Set(links.map((link) => link.formTemplateId))];
    await Promise.all(templateIds.map((id) => this.loadVersions(id)));
  }

  // Los catálogos auxiliares no bloquean la lista: si fallan, la tabla muestra textos genéricos.
  private async loadLookups(): Promise<void> {
    await Promise.all([
      this.loadTemplates(),
      firstValueFrom(this.requests.entryNotices())
        .then((notices) => {
          this._notices.set(notices ?? []);
          this._noticesFailed.set(false);
        })
        .catch(() => {
          this._notices.set([]);
          this._noticesFailed.set(true);
        }),
      firstValueFrom(this.requests.activeStaff())
        .then((staff) => this._staff.set(staff))
        .catch(() => this._staff.set([])),
    ]);
  }

  // `assignable` admite también `form_intake_links.manage`: solo plantillas activas publicadas.
  private async loadTemplates(): Promise<void> {
    try {
      this._templates.set(await firstValueFrom(this.requests.assignableTemplates()));
    } catch {
      this._templates.set([]);
    }
  }
}
