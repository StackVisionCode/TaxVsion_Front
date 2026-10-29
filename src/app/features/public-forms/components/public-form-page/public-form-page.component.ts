import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { DcFormRendererComponent } from '@shared/ui/data-collection/form-renderer/dc-form-renderer.component';
import type {
  DataCollectionAttachment,
  DataCollectionConsentRequest,
  DataCollectionFileSelection,
  DataCollectionSensitiveEntry,
} from '@shared/ui/data-collection/data-collection.models';
import {
  createDefinitionConflictLabeler,
  formatDraftConflictValue,
} from '@shared/utils/data-collection/draft-conflict-display';
import {
  DraftSaveConflictPendingError,
  DraftSaveCoordinator,
  type ConflictChoice,
  type DraftConflict,
  type DraftSaveResult,
  type DraftSaveState,
  type DraftSnapshot,
} from '@shared/utils/data-collection/draft-save-coordinator';
import { FormEngine } from '@shared/utils/data-collection/form-engine';
import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';
import { PublicFormSessionStorageService } from '../../data-access/public-form-session-storage.service';
import { PublicFormsService } from '../../data-access/public-forms.service';
import type {
  PublicDirectedFormAccess,
  PublicEntryNotice,
  PublicFormConsent,
  PublicFormKind,
  PublicFormLanguage,
  PublicFormRequest,
  PublicIntakeFormAccess,
  StoredPublicFormSession,
} from '../../data-access/public-forms.model';
import { TurnstileWidgetComponent } from '../../ui/turnstile-widget/turnstile-widget.component';

interface ConflictRow {
  conflict: DraftConflict;
  label: string;
  local: string;
  remote: string;
}

/** Lo que había en memoria al expirar la sesión, para fusionarlo al volver a entrar. */
interface ResumeDraft {
  requestId: string;
  confirmed: DraftSnapshot;
  answers: FormAnswers;
}

type PageStep =
  | 'loading'
  | 'welcome'
  | 'identify'
  | 'otp'
  | 'consent'
  | 'form'
  | 'done'
  | 'alreadySubmitted'
  | 'declined'
  | 'unavailable';

@Component({
  selector: 'app-public-form-page',
  imports: [DcFormRendererComponent, ModalComponent, TurnstileWidgetComponent],
  templateUrl: './public-form-page.component.html',
  styleUrls: ['./public-form-page.component.css', './public-form-controls.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicFormPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(PublicFormsService);
  private readonly sessions = inject(PublicFormSessionStorageService);
  private readonly branding = inject(TenantBrandingService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly engine = new FormEngine();
  private coordinator: DraftSaveCoordinator | null = null;
  private unsubscribeCoordinator: (() => void) | null = null;
  private resendTimer: ReturnType<typeof setInterval> | null = null;
  @ViewChildren('otpDigit') private otpDigits?: QueryList<ElementRef<HTMLInputElement>>;
  @ViewChild(TurnstileWidgetComponent) private turnstile?: TurnstileWidgetComponent;

  readonly kind = this.route.snapshot.data['kind'] as PublicFormKind;
  readonly accessToken = this.route.snapshot.paramMap.get('token') ?? '';
  readonly officeLogoUrl = this.branding.logoUrl;
  readonly step = signal<PageStep>('loading');
  readonly access = signal<PublicDirectedFormAccess | PublicIntakeFormAccess | null>(null);
  readonly request = signal<PublicFormRequest | null>(null);
  readonly answers = signal<FormAnswers>({ schemaVersion: 1, values: {} });
  readonly issues = signal<readonly ValidationIssue[]>([]);
  readonly saveState = signal<DraftSaveState | null>(null);
  readonly busy = signal(false);
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly email = signal('');
  readonly code = signal('');
  readonly captchaToken = signal<string | null>(null);
  readonly captchaUnavailable = signal(false);
  readonly resendSeconds = signal(0);
  /** Tope de códigos por hora que informa el challenge; null hasta pedir el primero. */
  readonly codeLimitPerHour = signal<number | null>(null);
  readonly activeConsent = signal<PublicFormConsent | null>(null);
  readonly resumeDraft = signal<ResumeDraft | null>(null);
  readonly conflictChoices = signal<Readonly<Record<string, ConflictChoice>>>({});
  readonly conflictDialogOpen = signal(false);
  readonly resolvingConflicts = signal(false);
  /** Idioma de los avisos por email (P-21.5); viaja en el challenge de captación y en el verify. */
  readonly language = signal<PublicFormLanguage>('En');
  /** P-14.8: la sesión expiró con el formulario abierto; se renueva en un modal sin perder lo escrito. */
  readonly sessionExpired = signal(false);
  readonly reauthDialogOpen = signal(false);
  readonly reauthStage = signal<'start' | 'code'>('start');
  /** El sondeo del antivirus venció sin veredicto: se puede volver a consultar. */
  readonly scanStalled = signal(false);
  readonly scanPending = computed(() =>
    (this.request()?.attachments ?? []).some((item) => item.status === 'Pending'),
  );
  // Escrituras que llegaron sin poder editar (otra pestaña o conflicto); se aplican al recuperar.
  private deferredWrites: Array<() => void> = [];
  private scanPoll: { token: number; deadline: number; running: boolean } = {
    token: 0,
    deadline: 0,
    running: false,
  };

  readonly title = computed(() => this.access()?.title ?? this.request()?.title ?? 'Secure form');
  readonly entryNotice = computed(() => this.access()?.entryNotice ?? null);
  readonly directedAccess = computed(() =>
    this.kind === 'directed' ? (this.access() as PublicDirectedFormAccess | null) : null,
  );
  readonly intakeAccess = computed(() =>
    this.kind === 'intake' ? (this.access() as PublicIntakeFormAccess | null) : null,
  );
  readonly attachments = computed<Readonly<Record<string, DataCollectionAttachment>>>(() =>
    Object.fromEntries(
      (this.request()?.attachments ?? []).map((item) => [
        item.fileId,
        {
          id: item.id,
          fileId: item.fileId,
          componentId: item.componentId,
          rowId: item.rowId,
          displayName: item.displayName,
          status: attachmentStatus(item.status),
          rejectionCode: item.rejectionCode,
        },
      ]),
    ),
  );
  readonly fieldComments = computed(() => this.request()?.review?.fieldComments ?? []);
  readonly noticeParagraphs = computed(() => extractTextBlocks(this.entryNotice()?.body));
  readonly consentParagraphs = computed(() => extractTextBlocks(this.activeConsent()?.body));
  readonly officeName = computed(() => officeLabel(this.access()?.tenantBrandingKey));
  readonly otpValues = computed(() =>
    Array.from({ length: 6 }, (_, index) => this.code()[index] ?? ''),
  );
  readonly conflicts = computed(() => this.saveState()?.conflicts ?? []);
  readonly conflictRows = computed<ConflictRow[]>(() => {
    const definition = this.request()?.definition;
    if (!definition) return [];
    const fileName = (fileId: string) => this.attachments()[fileId]?.displayName ?? null;
    return this.conflicts().map((conflict) => ({
      conflict,
      label: conflict.label,
      local: formatDraftConflictValue(definition, conflict, 'local', { fileName }),
      remote: formatDraftConflictValue(definition, conflict, 'remote', { fileName }),
    }));
  });
  readonly allConflictsChosen = computed(() => {
    const choices = this.conflictChoices();
    return this.conflicts().every((conflict) => choices[conflict.id] != null);
  });
  /** El renderer solo edita con el control de la pestaña y sin conflictos pendientes. */
  readonly rendererMode = computed<'fill' | 'readonly'>(() => {
    const request = this.request();
    const state = this.saveState();
    if (!request || request.readOnly || state == null) return 'readonly';
    return state.readOnly || state.conflicts.length > 0 ? 'readonly' : 'fill';
  });
  /** Se pasa al renderer: Next y Back esperan el guardado (regla 4 de P-5.3-bis). */
  readonly saveBeforePageChange = (): Promise<boolean> => this.saveBeforeNavigation();
  /** El error visible es del email (para aria-invalid del campo). */
  readonly emailInvalid = computed(() => this.error() === INVALID_EMAIL_MESSAGE);
  private previousStep: PageStep | null = null;

  constructor() {
    // WCAG 2.4.3/2.4.2: al cambiar de paso el foco va al h1 nuevo y la pestaña dice dónde está.
    effect(() => {
      const step = this.step();
      untracked(() => this.onStepChanged(step));
    });
  }

  async ngOnInit(): Promise<void> {
    if (!this.accessToken) {
      this.step.set('unavailable');
      return;
    }
    await this.loadAccess();
    const stored = this.sessions.read(this.kind, this.accessToken);
    if (stored) await this.openSession(stored);
  }

  ngOnDestroy(): void {
    this.stopScanPolling();
    this.clearCoordinator(true);
    this.clearResendTimer();
  }

  /** "Check again" tras vencer el plazo del sondeo: el archivo no se rechaza por tardar. */
  checkScansAgain(): void {
    this.ensureScanPolling();
  }

  async continueFromNotice(): Promise<void> {
    if (this.kind === 'intake') {
      this.step.set('identify');
      return;
    }
    await this.requestCode();
  }

  async requestCode(): Promise<void> {
    if (await this.sendChallenge()) {
      this.code.set('');
      this.step.set('otp');
      this.startResendCooldown();
    }
  }

  /** Pide un código nuevo desde el modal de sesión expirada, sin salir del formulario. */
  async requestReauthCode(): Promise<void> {
    if (await this.sendChallenge()) {
      this.code.set('');
      this.reauthStage.set('code');
      this.startResendCooldown();
    }
  }

  setLanguage(value: string): void {
    this.language.set(value === 'Es' ? 'Es' : 'En');
  }

  private async sendChallenge(): Promise<boolean> {
    const email = this.email().trim();
    // Un mensaje por causa: antes uno solo mezclaba el email con el check de seguridad.
    if (this.kind === 'intake' && !isEmail(email)) {
      this.error.set(INVALID_EMAIL_MESSAGE);
      return false;
    }
    if (this.kind === 'intake' && !this.captchaToken()) {
      this.error.set('Wait for the security check below to finish, then try again.');
      return false;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.service.requestChallenge(
          this.kind,
          this.accessToken,
          this.kind === 'intake' ? email : undefined,
          this.kind === 'intake' ? this.captchaToken()! : undefined,
          this.language(),
        ),
      );
      const limit = response?.codeLimitPerHour;
      this.codeLimitPerHour.set(
        typeof limit === 'number' && limit > 0 ? limit : DEFAULT_CODE_LIMIT_PER_HOUR,
      );
      return true;
    } catch {
      this.error.set('We could not send a verification code. Please try again.');
      // El token de Turnstile es de un solo uso: hace falta otro para reintentar.
      if (this.kind === 'intake') this.resetCaptcha();
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async resendCode(): Promise<void> {
    if (this.resendSeconds() > 0) return;
    if (this.kind === 'intake') {
      this.captchaToken.set(null);
      this.step.set('identify');
      return;
    }
    await this.requestCode();
  }

  async verifyCode(): Promise<void> {
    const code = this.code().replace(/\D/g, '');
    if (code.length !== 6) {
      this.error.set('Enter the 6-digit verification code.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const grant = await firstValueFrom(
        this.service.verify(
          this.kind,
          this.accessToken,
          code,
          this.kind === 'intake' ? this.email().trim() : undefined,
          this.language(),
        ),
      );
      const session: StoredPublicFormSession = {
        sessionToken: grant.sessionToken,
        expiresAtUtc: grant.expiresAtUtc,
        requestId: grant.requestId ?? null,
      };
      this.sessions.write(this.kind, this.accessToken, session);
      await this.openSession(session, this.resumeDraft());
      this.resumeDraft.set(null);
      this.sessionExpired.set(false);
      this.reauthDialogOpen.set(false);
      this.reauthStage.set('start');
    } catch (error) {
      if (isAlreadySubmitted(error)) this.showAlreadySubmitted();
      else this.error.set('The verification code is invalid or expired.');
    } finally {
      this.busy.set(false);
    }
  }

  setCode(value: string): void {
    this.code.set(value.replace(/\D/g, '').slice(0, 6));
  }

  setOtpDigit(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '');
    // Autocompletado del código (one-time-code): llega entero en una casilla y se reparte.
    if (digits.length > 2) {
      const values = this.otpValues();
      digits
        .slice(0, 6 - index)
        .split('')
        .forEach((digit, offset) => (values[index + offset] = digit));
      this.code.set(values.join(''));
      input.value = values[index];
      const last = Math.min(index + digits.length, 6) - 1;
      queueMicrotask(() => this.otpDigits?.get(last)?.nativeElement.focus());
      return;
    }
    const digit = digits.slice(-1);
    const values = this.otpValues();
    values[index] = digit;
    this.code.set(values.join(''));
    input.value = digit;
    if (digit && index < 5) this.otpDigits?.get(index + 1)?.nativeElement.focus();
  }

  handleOtpKey(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.otpValues()[index] && index > 0) {
      this.otpDigits?.get(index - 1)?.nativeElement.focus();
    }
  }

  pasteOtp(event: ClipboardEvent): void {
    const value = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6) ?? '';
    if (!value) return;
    event.preventDefault();
    this.code.set(value);
    queueMicrotask(() => this.otpDigits?.get(Math.min(value.length, 6) - 1)?.nativeElement.focus());
  }

  setEmail(value: string): void {
    this.email.set(value);
  }

  updateAnswers(next: FormAnswers): void {
    const coordinator = this.coordinator;
    if (!coordinator) return;
    const current = coordinator.snapshot.answers;
    const keys = new Set([...Object.keys(current.values), ...Object.keys(next.values)]);
    let rejected = false;
    for (const key of keys) {
      if (JSON.stringify(current.values[key]) === JSON.stringify(next.values[key])) continue;
      try {
        rejected = !coordinator.notifyChange(`/values/${escapePointer(key)}`, next.values[key]) || rejected;
      } catch {
        rejected = true;
      }
    }
    // Lo que el coordinador no acepta (solo lectura, conflicto) no debe quedar en pantalla como guardado.
    if (rejected) this.answers.set(coordinator.snapshot.answers);
  }

  saveOnBlur(): void {
    void this.coordinator?.handleBlur();
  }

  onPageIndexChange(): void {
    // §56: al cambiar de paso el foco va al encabezado de la página nueva.
    setTimeout(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>('app-dc-form-renderer [data-dc-page-heading]')
        ?.focus(),
    );
  }

  private onStepChanged(step: PageStep): void {
    const previous = this.previousStep;
    this.previousStep = step;
    // Tras el render: así el título no lo pisa el renderer al destruirse; en 'form' lo pone él.
    setTimeout(() => {
      if (this.step() !== step) return;
      if (step !== 'form')
        this.document.title = `${STEP_TITLES[step] ?? this.title()} - ${this.officeName()}`;
      if (previous == null || previous === 'loading' || previous === step) return;
      this.host.nativeElement.querySelector<HTMLElement>('.public-form-content h1')?.focus();
    });
  }

  chooseConflict(conflictId: string, choice: ConflictChoice): void {
    this.conflictChoices.update((current) => ({ ...current, [conflictId]: choice }));
  }

  /** Aplica la elección de cada conflicto; sin elegir todos no se guarda nada. */
  async resolveConflicts(): Promise<void> {
    const coordinator = this.coordinator;
    if (!coordinator || !this.allConflictsChosen()) return;
    const choices = this.conflictChoices();
    const resolutions = Object.fromEntries(
      this.conflicts().map((conflict) => [conflict.id, choices[conflict.id]]),
    );
    this.resolvingConflicts.set(true);
    this.error.set(null);
    try {
      await coordinator.resolveConflicts(resolutions);
    } catch (error) {
      // Un 409 durante la resolución abre otro ciclo: el diálogo muestra los conflictos nuevos.
      if (!(error instanceof DraftSaveConflictPendingError))
        this.handleSessionActionError(error, 'We could not save your choices. Please try again.');
    } finally {
      this.resolvingConflicts.set(false);
    }
  }

  openConflictDialog(): void {
    this.conflictDialogOpen.set(true);
  }

  closeConflictDialog(): void {
    this.conflictDialogOpen.set(false);
  }

  takeControl(): void {
    this.coordinator?.takeControl();
  }

  async acceptConsent(): Promise<void> {
    const consent = this.activeConsent();
    const session = this.session();
    const coordinator = this.coordinator;
    if (!consent || !session || !coordinator) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await coordinator.flush();
      await coordinator.runExclusive(async () => ({
        value: await firstValueFrom(this.service.acceptConsent(session.sessionToken, consent.componentId)),
      }));
      this.activeConsent.set(null);
      await this.refreshRequest(session, coordinator);
      this.step.set('form');
    } catch (error) {
      this.handleSessionActionError(error, 'We could not record your consent. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  async declineConsent(): Promise<void> {
    const consent = this.activeConsent();
    const session = this.session();
    if (!consent || !session) return;
    this.busy.set(true);
    try {
      await this.coordinator?.flush();
      await firstValueFrom(this.service.declineConsent(session.sessionToken, consent.componentId));
      await firstValueFrom(this.service.logout(session.sessionToken));
    } catch {
      // La salida local no depende de que el servidor responda.
    } finally {
      this.sessions.clear(this.kind, this.accessToken);
      this.clearCoordinator();
      this.activeConsent.set(null);
      this.step.set('declined');
      this.busy.set(false);
    }
  }

  dismissConsent(): void {
    if (this.step() === 'form') this.activeConsent.set(null);
  }

  showConsent(request: DataCollectionConsentRequest): void {
    const consent = this.request()?.consents.find(
      (item) => item.componentId === request.componentId,
    );
    if (consent) this.activeConsent.set(consent);
  }

  async uploadFiles(selection: DataCollectionFileSelection): Promise<void> {
    const session = this.session();
    const coordinator = this.coordinator;
    if (!session || !coordinator || selection.files.length === 0) return;
    this.uploading.set(true);
    this.error.set(null);
    try {
      for (const file of selection.files) await this.uploadOne(session, coordinator, selection, file);
      await this.saveSoon(coordinator);
      await this.refreshRequest(session, coordinator);
      this.ensureScanPolling();
    } catch (error) {
      this.handleSessionActionError(error, 'The file could not be uploaded. Please try again.');
    } finally {
      this.uploading.set(false);
    }
  }

  async removeFile(attachmentId: string): Promise<void> {
    const session = this.session();
    const coordinator = this.coordinator;
    const attachment = this.request()?.attachments.find((item) => item.id === attachmentId);
    if (!session || !coordinator || !attachment) return;
    this.uploading.set(true);
    this.error.set(null);
    try {
      await coordinator.runExclusive(async () => {
        const result = await firstValueFrom(
          this.service.removeAttachment(session.sessionToken, attachmentId),
        );
        return { value: result, rowVersion: result.rowVersion };
      });
      this.writeFileAnswer(coordinator, attachment, false);
      await this.saveSoon(coordinator);
      await this.refreshRequest(session, coordinator);
    } catch (error) {
      this.handleSessionActionError(error, 'The file could not be removed. Please try again.');
    } finally {
      this.uploading.set(false);
    }
  }

  async captureSensitive(entry: DataCollectionSensitiveEntry): Promise<void> {
    const session = this.session();
    const coordinator = this.coordinator;
    if (!session || !coordinator) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const captured = await coordinator.runExclusive(async () => {
        const result = await firstValueFrom(this.service.captureSensitive(session.sessionToken, entry));
        return { value: result, rowVersion: result.rowVersion };
      });
      const value = { sensitiveRef: captured.sensitiveRef, last4: captured.last4, kind: entry.kind };
      this.mutateAnswer(coordinator, entry.componentId, entry.rowId, () => value);
      await this.saveSoon(coordinator);
    } catch (error) {
      this.handleSessionActionError(
        error,
        'The identifier could not be saved. Please check it and try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  async submit(): Promise<void> {
    const session = this.session();
    const request = this.request();
    if (!session || !request || request.readOnly) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.flushDraft();
      const report = this.engine.validateAnswers(request.definition, this.answers(), 'submit');
      if (!report.isValid) {
        this.issues.set(report.issues);
        return;
      }
      const pending = request.consents.find(
        (item) =>
          item.blocking &&
          item.mode === 'acceptance' &&
          item.evidence?.outcome !== 'Accepted' &&
          this.isConsentShown(request, item.componentId),
      );
      if (pending) {
        this.activeConsent.set(pending);
        return;
      }
      const coordinator = this.coordinator!;
      const result = await coordinator.runExclusive(async (rowVersion) => ({
        value: await firstValueFrom(this.service.submit(session.sessionToken, rowVersion)),
      }));
      if (!result.submitted) {
        this.issues.set(result.issues);
        return;
      }
      this.sessions.clear(this.kind, this.accessToken);
      this.clearCoordinator();
      this.step.set('done');
    } catch (error) {
      const issues = validationIssues(error);
      if (issues.length > 0) this.issues.set(issues);
      else this.handleSessionActionError(error, 'Your form could not be sent. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  async saveAndExit(): Promise<void> {
    const session = this.session();
    if (!session) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      // Regla 4: no se sale hasta confirmar el guardado; si falla, el usuario lo ve y sigue aquí.
      await this.flushDraft();
    } catch (error) {
      this.busy.set(false);
      if (error instanceof DraftSaveConflictPendingError) this.conflictDialogOpen.set(true);
      else this.handleSessionActionError(error, 'We could not save your changes. Please try again.');
      return;
    }
    try {
      await firstValueFrom(this.service.logout(session.sessionToken));
    } catch {
      // La sesion local se limpia aunque el logout remoto falle.
    } finally {
      this.sessions.clear(this.kind, this.accessToken);
      this.clearCoordinator();
      this.step.set('welcome');
      this.busy.set(false);
    }
  }

  private async loadAccess(): Promise<void> {
    this.step.set('loading');
    try {
      const access =
        this.kind === 'directed'
          ? await firstValueFrom(this.service.getAccess('directed', this.accessToken))
          : await firstValueFrom(this.service.getIntakeAccess(this.accessToken));
      this.access.set(access);
      this.branding.applyForPublicBrandingKey(access.tenantBrandingKey, 'Crm');
      this.step.set('welcome');
    } catch {
      this.step.set('unavailable');
    }
  }

  private async openSession(
    session: StoredPublicFormSession,
    resume: ResumeDraft | null = null,
  ): Promise<void> {
    try {
      const request = await firstValueFrom(this.service.getRequest(session.sessionToken));
      this.request.set(request);
      this.issues.set([]);
      // Misma request: se parte de lo último confirmado y lo escrito se fusiona en tres vías al guardar.
      const sameRequest = resume != null && resume.requestId === request.id;
      this.createCoordinator(session, request, sameRequest ? resume.confirmed : null);
      if (resume) {
        this.updateAnswers(resume.answers);
        void this.coordinator?.handleBlur();
      }
      if (request.readOnly && ['Submitted', 'Completed'].includes(request.status)) {
        this.step.set('done');
        return;
      }
      const beforeCollection = request.consents.find(
        (item) =>
          item.blocking &&
          item.mode === 'acceptance' &&
          item.timing === 'beforeCollection' &&
          item.evidence?.outcome !== 'Accepted' &&
          this.isConsentShown(request, item.componentId),
      );
      this.ensureScanPolling();
      this.activeConsent.set(beforeCollection ?? null);
      this.step.set(beforeCollection ? 'consent' : 'form');
    } catch (error) {
      if (isAlreadySubmitted(error)) {
        this.showAlreadySubmitted();
      } else if (isUnauthorized(error)) {
        this.sessions.clear(this.kind, this.accessToken);
        this.step.set('welcome');
      } else {
        this.error.set('We could not open this form. Please try again.');
        this.step.set('unavailable');
      }
    }
  }

  // Intake ya enviado desde este enlace (409): estado final, sin sesión que reanudar.
  private showAlreadySubmitted(): void {
    this.sessions.clear(this.kind, this.accessToken);
    this.clearResendTimer();
    this.error.set(null);
    this.sessionExpired.set(false);
    this.reauthDialogOpen.set(false);
    this.step.set('alreadySubmitted');
  }

  private createCoordinator(
    session: StoredPublicFormSession,
    request: PublicFormRequest,
    initial: DraftSnapshot | null = null,
  ): void {
    this.clearCoordinator();
    const start = initial ?? { answers: request.answers, rowVersion: request.rowVersion };
    this.answers.set(start.answers);
    this.coordinator = new DraftSaveCoordinator({
      initial: start,
      requestId: request.id,
      labelFor: createDefinitionConflictLabeler(request.definition),
      save: (answers, rowVersion) => this.saveWithCoordinator(session, answers, rowVersion),
      load: async () => {
        const fresh = await firstValueFrom(this.service.getRequest(session.sessionToken));
        this.request.set(fresh);
        return { answers: fresh.answers, rowVersion: fresh.rowVersion };
      },
      saveKeepalive: ({ answers, rowVersion }) =>
        this.service.saveDraftKeepalive(session.sessionToken, answers, rowVersion),
    });
    this.unsubscribeCoordinator = this.coordinator.state$.subscribe((state) => {
      const previous = this.saveState()?.conflicts ?? [];
      this.saveState.set(state);
      this.answers.set(state.answers);
      if (!sameConflicts(previous, state.conflicts)) {
        this.conflictChoices.set({});
        this.conflictDialogOpen.set(state.conflicts.length > 0);
      }
      if (state.status === 'error' && isUnauthorized(state.error)) queueMicrotask(() => this.expireSession());
      if (!state.readOnly && state.conflicts.length === 0 && this.deferredWrites.length > 0)
        queueMicrotask(() => this.applyDeferredWrites());
    });
  }

  private async saveWithCoordinator(
    session: StoredPublicFormSession,
    answers: FormAnswers,
    rowVersion: string,
  ): Promise<DraftSaveResult> {
    try {
      const result = await firstValueFrom(
        this.service.saveDraft(session.sessionToken, answers, rowVersion),
      );
      if (!result.saved || !result.rowVersion) return { outcome: 'error', error: result.issues };
      return { outcome: 'saved', rowVersion: result.rowVersion };
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409)
        return { outcome: 'conflict' };
      return { outcome: 'error', error };
    }
  }

  private async uploadOne(
    session: StoredPublicFormSession,
    coordinator: DraftSaveCoordinator,
    selection: DataCollectionFileSelection,
    file: File,
  ): Promise<void> {
    const upload = await coordinator.runExclusive(async () => {
      const result = await firstValueFrom(
        this.service.initiateAttachment(session.sessionToken, selection, file),
      );
      return { value: result, rowVersion: result.rowVersion };
    });
    try {
      // La subida va al almacenamiento, no a la API del formulario: no bloquea el autosave.
      await firstValueFrom(this.service.uploadToStorage(upload, file));
      await coordinator.runExclusive(async () => ({
        value: await firstValueFrom(
          this.service.completeAttachment(session.sessionToken, upload.fileId),
        ),
      }));
      this.writeFileAnswer(
        coordinator,
        { fileId: upload.fileId, componentId: selection.componentId, rowId: selection.rowId },
        true,
      );
    } catch (error) {
      try {
        await coordinator.runExclusive(async () => {
          const result = await firstValueFrom(
            this.service.removeAttachment(session.sessionToken, upload.attachmentId),
          );
          return { value: result, rowVersion: result.rowVersion };
        });
      } catch {
        // La reconciliacion del backend limpia uploads incompletos.
      }
      throw error;
    }
  }

  /** Actualiza adjuntos y consentimientos sin recrear el coordinador ni perder lo escrito. */
  private async refreshRequest(
    session: StoredPublicFormSession,
    coordinator: DraftSaveCoordinator,
  ): Promise<void> {
    if (!coordinator.canEdit) {
      // Sin poder editar (otra pestaña o conflicto) solo se refrescan adjuntos y consentimientos.
      this.request.set(await firstValueFrom(this.service.getRequest(session.sessionToken)));
      return;
    }
    await coordinator.runExclusive(async () => {
      const fresh = await firstValueFrom(this.service.getRequest(session.sessionToken));
      this.request.set(fresh);
      // Se adopta lo del servidor sin recrear el coordinador; lo pendiente se fusiona en tres vías.
      return { value: fresh, snapshot: { answers: fresh.answers, rowVersion: fresh.rowVersion } };
    });
  }

  private writeFileAnswer(
    coordinator: DraftSaveCoordinator,
    attachment: { fileId: string; componentId: string; rowId: string | null },
    add: boolean,
  ): void {
    this.mutateAnswer(coordinator, attachment.componentId, attachment.rowId, (current) => {
      const files = Array.isArray(current)
        ? current.filter((item) => item != null && typeof item === 'object' && 'fileId' in item)
        : [];
      if (!add) return files.filter((item) => item['fileId'] !== attachment.fileId);
      return files.some((item) => item['fileId'] === attachment.fileId)
        ? files
        : [...files, { fileId: attachment.fileId }];
    });
  }

  /**
   * Escribe una respuesta derivada del valor actual. Si ahora no se puede editar (otra pestaña o un
   * conflicto), queda en cola y se aplica sobre el valor de ese momento al recuperar la edición.
   */
  private mutateAnswer(
    coordinator: DraftSaveCoordinator,
    componentId: string,
    rowId: string | null,
    update: (current: unknown) => unknown,
  ): void {
    if (!coordinator.canEdit) {
      this.deferredWrites.push(() => this.mutateAnswer(coordinator, componentId, rowId, update));
      return;
    }
    const answers = coordinator.snapshot.answers;
    const path = contextPath(answers, componentId, rowId);
    if (path == null || !coordinator.notifyChange(path, update(readContextValue(answers, componentId, rowId))))
      throw new Error('The answer could not be updated in this tab.');
  }

  private applyDeferredWrites(): void {
    const coordinator = this.coordinator;
    if (!coordinator?.canEdit || this.deferredWrites.length === 0) return;
    const pending = this.deferredWrites;
    this.deferredWrites = [];
    for (const write of pending) write();
    void coordinator.handleBlur();
  }

  /** Guarda ya; un conflicto no es un error de la acción: abre el diálogo y lo escrito sigue en cola. */
  private async saveSoon(coordinator: DraftSaveCoordinator): Promise<void> {
    try {
      await coordinator.flush();
    } catch (error) {
      if (!(error instanceof DraftSaveConflictPendingError)) throw error;
      this.conflictDialogOpen.set(true);
    }
  }

  /** Un consentimiento oculto por condición no se exige: el servidor solo exige los visibles. */
  private isConsentShown(request: PublicFormRequest, componentId: string): boolean {
    const known = request.definition.pages.some((page) =>
      page.sections.some((section) => section.components.some((item) => item.id === componentId)),
    );
    if (!known) return true;
    return this.engine.evaluateVisibility(request.definition, this.answers()).isVisible(componentId);
  }

  /**
   * Sondeo del veredicto del antivirus (como P-8.2): cada 3 s mientras haya adjuntos Pending, como
   * mucho 2 min. El GET va en la cola del coordinador para no leer una versión vieja durante un PUT.
   * Vencer el plazo no rechaza el archivo; destruir la página lo cancela.
   */
  private ensureScanPolling(): void {
    if (!this.scanPending()) return;
    this.scanPoll.deadline = Date.now() + SCAN_POLL_TIMEOUT_MS;
    this.scanStalled.set(false);
    if (this.scanPoll.running) return;
    this.scanPoll.running = true;
    const token = this.scanPoll.token;
    const tick = async (): Promise<void> => {
      if (token !== this.scanPoll.token) return;
      if (!this.scanPending()) {
        this.scanPoll.running = false;
        return;
      }
      if (Date.now() >= this.scanPoll.deadline) {
        this.scanPoll.running = false;
        this.scanStalled.set(true);
        return;
      }
      await this.readScanVerdicts().catch(() => undefined);
      if (token === this.scanPoll.token) setTimeout(() => void tick(), SCAN_POLL_INTERVAL_MS);
    };
    setTimeout(() => void tick(), SCAN_POLL_INTERVAL_MS);
  }

  private async readScanVerdicts(): Promise<void> {
    const session = this.session();
    const coordinator = this.coordinator;
    if (session && coordinator) await this.refreshRequest(session, coordinator);
  }

  private stopScanPolling(): void {
    this.scanPoll = { token: this.scanPoll.token + 1, deadline: 0, running: false };
  }

  private async saveBeforeNavigation(): Promise<boolean> {
    if (!this.coordinator || this.rendererMode() === 'readonly') return true;
    try {
      await this.coordinator.flush();
      return true;
    } catch (error) {
      if (error instanceof DraftSaveConflictPendingError) this.conflictDialogOpen.set(true);
      else this.handleSessionActionError(error, 'We could not save your changes. Please try again.');
      return false;
    }
  }

  private async flushDraft(): Promise<void> {
    if (this.coordinator) await this.coordinator.flush();
  }

  private session(): StoredPublicFormSession | null {
    return this.sessions.read(this.kind, this.accessToken);
  }

  private expireSession(): void {
    const coordinator = this.coordinator;
    const request = this.request();
    if (coordinator && request) {
      // Lo escrito queda en memoria (P-14.8) junto con lo último confirmado, para fusionarlo al volver.
      this.resumeDraft.set({
        requestId: request.id,
        confirmed: coordinator.confirmed,
        answers: coordinator.snapshot.answers,
      });
    }
    this.sessions.clear(this.kind, this.accessToken);
    this.clearCoordinator();
    this.error.set(null);
    this.captchaToken.set(null);
    this.code.set('');
    if (this.step() === 'form' && this.resumeDraft() != null) {
      // P-14.8: el formulario sigue a la vista (solo lectura) y el OTP se pide en un modal.
      this.sessionExpired.set(true);
      this.reauthStage.set('start');
      this.reauthDialogOpen.set(true);
      return;
    }
    this.error.set('Your secure session expired. Verify your email again to keep working.');
    this.step.set(this.kind === 'intake' ? 'identify' : 'welcome');
  }

  private handleSessionActionError(
    error: unknown,
    message = 'We could not save your changes. Please try again.',
  ): void {
    if (isUnauthorized(error)) this.expireSession();
    else this.error.set(message);
  }

  private clearCoordinator(flushFirst = false): void {
    this.deferredWrites = [];
    this.unsubscribeCoordinator?.();
    this.unsubscribeCoordinator = null;
    if (flushFirst) void this.coordinator?.flushAndDispose();
    else this.coordinator?.dispose();
    this.coordinator = null;
    this.saveState.set(null);
  }

  private resetCaptcha(): void {
    this.captchaToken.set(null);
    this.turnstile?.reset();
  }

  private startResendCooldown(): void {
    this.clearResendTimer();
    this.resendSeconds.set(30);
    this.resendTimer = setInterval(() => {
      this.resendSeconds.update((value) => Math.max(0, value - 1));
      if (this.resendSeconds() === 0) this.clearResendTimer();
    }, 1_000);
  }

  private clearResendTimer(): void {
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.resendTimer = null;
  }
}

const SCAN_POLL_INTERVAL_MS = 3_000;
const INVALID_EMAIL_MESSAGE = 'Enter a valid email address.';
// Título de la pestaña por paso; el del formulario lo pone el renderer ("Step N of M").
const STEP_TITLES: Partial<Record<PageStep, string>> = {
  loading: 'Opening your secure form',
  identify: 'Verify your email',
  otp: 'Enter your verification code',
  consent: 'Review and consent',
  done: 'Information sent',
  alreadySubmitted: 'Form already sent',
  declined: 'Form closed',
  unavailable: 'Form unavailable',
};
// Tope por defecto del backend cuando el 202 no lo informa.
const DEFAULT_CODE_LIMIT_PER_HOUR = 5;
const SCAN_POLL_TIMEOUT_MS = 120_000;

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isAlreadySubmitted(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 409 &&
    (error.error as { code?: string } | null)?.code === 'PublicForm.AlreadySubmitted'
  );
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 401;
}

function validationIssues(error: unknown): ValidationIssue[] {
  if (!(error instanceof HttpErrorResponse) || !Array.isArray(error.error)) return [];
  return error.error.filter(
    (item): item is ValidationIssue =>
      item != null && typeof item === 'object' && typeof item.code === 'string',
  );
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function attachmentStatus(status: string): string {
  if (status === 'Pending') return 'Security scan in progress';
  if (status === 'Available') return 'Ready';
  if (status === 'Rejected') return 'Rejected by security scan';
  return status;
}

function readContextValue(
  answers: FormAnswers,
  componentId: string,
  rowId: string | null,
): unknown {
  if (rowId == null) return answers.values[componentId];
  for (const value of Object.values(answers.values)) {
    if (!isRepeater(value)) continue;
    const row = value.rows.find((item) => item.rowId === rowId);
    if (row) return row.values[componentId];
  }
  return undefined;
}

/** Ruta del coordinador para un campo, dentro de su fila si `rowId` no es null. */
function contextPath(answers: FormAnswers, componentId: string, rowId: string | null): string | null {
  if (rowId == null) return `/values/${escapePointer(componentId)}`;
  for (const [sectionId, value] of Object.entries(answers.values)) {
    if (!isRepeater(value) || !value.rows.some((row) => row.rowId === rowId)) continue;
    return `/values/${escapePointer(sectionId)}/rows/${escapePointer(rowId)}/values/${escapePointer(componentId)}`;
  }
  return null;
}

function sameConflicts(left: readonly DraftConflict[], right: readonly DraftConflict[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (conflict, index) =>
        conflict.id === right[index].id &&
        JSON.stringify(conflict.remoteValue) === JSON.stringify(right[index].remoteValue),
    )
  );
}

function isRepeater(
  value: unknown,
): value is { rows: { rowId: string; values: Record<string, unknown> }[] } {
  return value != null && typeof value === 'object' && 'rows' in value && Array.isArray(value.rows);
}

function extractTextBlocks(value: unknown): string[] {
  if (value == null || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const children = Array.isArray(record['content'])
    ? record['content']
    : Array.isArray(record['blocks'])
      ? record['blocks']
      : [];
  const blocks = children.map((child) => collectText(child).trim()).filter(Boolean);
  return blocks.length > 0 ? blocks : [collectText(value).trim()].filter(Boolean);
}

function collectText(value: unknown): string {
  if (value == null || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const own = typeof record['text'] === 'string' ? record['text'] : '';
  const content = Array.isArray(record['content']) ? record['content'] : [];
  const children = Array.isArray(record['children']) ? record['children'] : [];
  const items = Array.isArray(record['items']) ? record['items'].flat() : [];
  return `${own}${[...content, ...children, ...items].map(collectText).join('')}`;
}

function officeLabel(brandingKey: string | undefined): string {
  const slug = brandingKey?.trim().split('.')[0].replaceAll('-', ' ') ?? '';
  if (!slug) return 'your office';
  return slug.replace(/\b\w/g, (character) => character.toUpperCase());
}
