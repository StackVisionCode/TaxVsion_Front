import { Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/models/api-error.model';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { BrandLogoComponent } from '@core/theme/brand-logo.component';
import { PublicSignatureService } from '../../data-access/public-signature.service';
import { parseUtcDate } from '../../../../shared/utils/utc-date.util';
import {
  AuditChainVerificationResponse,
  FIELD_KIND_LABEL,
  PublicSignerFieldView,
  PublicSignerView,
  SIGNATURE_CATEGORY_LABEL,
  SignerVerificationMethod,
  describeDeadLink,
  isDeadLinkCode,
  isValidPractitionerPin,
  matchesSignerFullName,
} from '../../data-access/public-signature.model';

/** Pasos posibles del recorrido. Cuáles se muestran depende de lo que exija la solicitud. */
type StepId = 'welcome' | 'consent' | 'verify' | 'verify-otp' | 'review' | 'sign' | 'done';

/** Orden canónico de los pasos: usado para reubicar el paso actual cuando un gate se cierra. */
const STEP_ORDER: readonly StepId[] = ['welcome', 'consent', 'verify', 'verify-otp', 'review', 'sign', 'done'];

/** Segundos de espera antes de poder reenviar el OTP (espejo de SignatureRequest.ChallengeResendCooldown). */
const OTP_RESEND_COOLDOWN_SECONDS = 30;

interface WizardStep {
  id: StepId;
  caption: string;
}

/** Situaciones en las que el enlace resuelve pero NO se puede firmar. */
interface BlockedState {
  icon: string;
  tone: 'success' | 'neutral' | 'warning' | 'danger';
  title: string;
  detail: string;
  /** true ⇒ se muestra el acuse (cadena de audit) debajo del mensaje. */
  showReceipt: boolean;
}

/**
 * Recorrido público del firmante (`/sign/:token`) cableado contra
 * `signature/public` (`PublicSignatureController`, `[AllowAnonymous]`).
 *
 * Los pasos NO son fijos: se derivan del contexto que devuelve el backend, porque
 * cada gate del wizard corresponde a una precondición real de
 * `SignatureRequest.MarkSignerSigned`:
 *   - `requiresConsent`         → paso Consent (POST /consent).
 *   - `requiresPractitionerPin` → paso Verify  (POST /verify-pin).
 *   - `requiresSequentialSigning` + `isSignerNextInSequence` → no es un paso, es un
 *     bloqueo: el backend rechazaría la firma si no es su turno.
 * Si la solicitud no exige un gate, ese paso simplemente no existe.
 *
 * Limitaciones del contrato público (no son simulables, se muestran como tales):
 *   - El contexto expone `originalFileId` pero CloudStorage exige JWT para emitir la
 *     URL presignada ⇒ no hay previsualización del PDF ni descargas para el firmante.
 *   - `Drawn`/`Uploaded` exigen subir la imagen a CloudStorage (endpoint autenticado)
 *     ⇒ el único método de captura disponible sin sesión es `Typed`.
 */
@Component({
  selector: 'app-sign-page',
  imports: [CommonModule, FormsModule, ModalComponent, BrandLogoComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sign-page.component.html',
  styleUrl: './sign-page.component.css',
})
export class SignPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PublicSignatureService);

  readonly fieldKindLabel = FIELD_KIND_LABEL;

  private token = '';

  // ---------- Carga del contexto ----------

  readonly loading = signal(true);
  readonly loadError = signal<ApiError | null>(null);
  readonly context = signal<PublicSignerView | null>(null);

  /** Enlace irrecuperable (token inválido/expirado/revocado): pantalla propia, sin Retry. */
  readonly deadLink = computed(() => {
    const err = this.loadError();
    return err && isDeadLinkCode(err.code) ? describeDeadLink(err.code) : null;
  });

  // ---------- Acciones en vuelo ----------

  readonly busy = signal(false);
  readonly busyLabel = signal('');
  readonly actionError = signal<string | null>(null);

  // ---------- Estado del recorrido ----------

  readonly stepId = signal<StepId>('welcome');
  /** true tras un POST /sign exitoso en esta sesión (dispara la vista de acuse). */
  readonly justSigned = signal(false);
  /** true tras un POST /reject exitoso: el token queda revocado, no se recarga nada. */
  readonly declined = signal(false);
  readonly declineReasonEcho = signal('');

  readonly consentChecked = signal(false);
  readonly pin = signal('');
  readonly typedName = signal('');

  // ---------- OTP (verificación de identidad por firmante) ----------

  readonly otpCode = signal('');
  /** true cuando ya se emitió al menos un código en esta sesión (cambia el copy y muestra el input). */
  readonly otpIssued = signal(false);
  /** Epoch ms hasta el que no se puede reenviar; null si no hay cooldown activo. */
  private readonly otpCooldownUntil = signal<number | null>(null);
  /** Reloj de 1 s para recomputar la cuenta atrás del reenvío sin timers en la vista. */
  private readonly clock = signal(Date.now());
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  readonly isRejectOpen = signal(false);
  readonly rejectReason = signal('');

  // ---------- Acuse (cadena de audit) ----------

  readonly audit = signal<AuditChainVerificationResponse | null>(null);
  readonly auditLoading = signal(false);

  // ------------------------------------------------------------------
  // Derivados
  // ------------------------------------------------------------------

  readonly firstName = computed(() => this.context()?.signerFullName.trim().split(/\s+/)[0] ?? '');

  /** Pasos vigentes: los gates opcionales desaparecen si la solicitud no los exige. */
  readonly steps = computed<WizardStep[]>(() => {
    const ctx = this.context();
    const steps: WizardStep[] = [{ id: 'welcome', caption: 'Start' }];
    if (ctx?.requiresConsent && !ctx.hasAcceptedConsent) {
      steps.push({ id: 'consent', caption: 'Consent' });
    }
    if (ctx?.requiresPractitionerPin && !ctx.isPinVerified) {
      steps.push({ id: 'verify', caption: 'Verify' });
    }
    // Gate OTP: independiente del PIN. Solo mientras no esté completado (el backend lo exige).
    if (ctx?.requiredVerificationMethod && !ctx.isVerificationCompleted) {
      steps.push({ id: 'verify-otp', caption: 'Code' });
    }
    steps.push({ id: 'review', caption: 'Review' }, { id: 'sign', caption: 'Sign' }, { id: 'done', caption: 'Done' });
    return steps;
  });

  readonly stepIndex = computed(() => {
    const index = this.steps().findIndex(s => s.id === this.stepId());
    return index < 0 ? 0 : index;
  });

  readonly stepNumber = computed(() => this.stepIndex() + 1);
  readonly stepCount = computed(() => this.steps().length);
  readonly isFirstStep = computed(() => this.stepIndex() === 0);
  readonly isDone = computed(() => this.stepId() === 'done');

  readonly nextLabel = computed(() => {
    switch (this.stepId()) {
      case 'welcome':
        return 'Continue';
      case 'consent':
        return 'Accept and continue';
      case 'verify':
        return 'Verify and continue';
      case 'verify-otp':
        return 'Confirm code';
      case 'review':
        return 'Go to sign';
      case 'sign':
        return 'Sign document';
      default:
        return '';
    }
  });

  readonly canProceed = computed(() => {
    const ctx = this.context();
    switch (this.stepId()) {
      case 'consent':
        return this.consentChecked();
      case 'verify':
        return isValidPractitionerPin(this.pin()) && !this.isPinLocked();
      case 'verify-otp':
        return this.otpIssued() && this.isOtpComplete();
      case 'sign':
        return !!ctx && matchesSignerFullName(this.typedName(), ctx.signerFullName);
      case 'done':
        return false;
      default:
        return true;
    }
  });

  /** Bloqueo temporal del PIN (5 fallos ⇒ 30 min), tal como lo reporta el contexto. */
  readonly isPinLocked = computed(() => {
    const until = this.context()?.pinLockedUntilUtc;
    return !!until && parseUtcDate(until).getTime() > Date.now();
  });

  readonly pinLockedUntilLabel = computed(() => {
    const until = this.context()?.pinLockedUntilUtc;
    return until ? formatTime(until) : '';
  });

  // ---------- OTP derivados ----------

  /** Método OTP que exige la solicitud para este firmante (null = no exige OTP). */
  readonly otpMethod = computed<SignerVerificationMethod | null>(() => this.context()?.requiredVerificationMethod ?? null);

  /** Cómo se le nombra el canal al firmante en la copy. */
  readonly otpChannelLabel = computed(() => channelLabel(this.otpMethod()));

  /** A dónde llega el código (email visible; el teléfono no se expone en el contexto público). */
  readonly otpDestinationHint = computed(() => {
    switch (this.otpMethod()) {
      case 'EmailOtp':
        return this.context()?.signerEmail ?? 'your email';
      case 'SmsOtp':
        return 'your phone by text message';
      case 'WhatsAppOtp':
        return 'your WhatsApp';
      default:
        return 'you';
    }
  });

  /** Segundos que faltan para poder reenviar (0 = ya se puede). Depende del reloj de 1 s. */
  readonly otpResendIn = computed(() => {
    const until = this.otpCooldownUntil();
    if (until === null) {
      return 0;
    }
    this.clock();
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  });

  readonly canResendOtp = computed(() => this.otpResendIn() === 0);

  /** El código viene de 6 dígitos (IssueVerificationChallengeHandler.OtpLength). */
  readonly isOtpComplete = computed(() => /^[0-9]{6}$/.test(this.otpCode().trim()));

  /**
   * Estados en los que el enlace es válido pero no se puede firmar. Se evalúa el
   * firmante antes que la solicitud: su estado individual es más específico.
   */
  readonly blocked = computed<BlockedState | null>(() => {
    const ctx = this.context();
    if (!ctx || this.declined() || this.justSigned()) {
      return null;
    }
    if (ctx.signerStatus === 'Signed') {
      return {
        icon: 'checkmark-circle-outline',
        tone: 'success',
        title: 'You already signed this document',
        detail: 'Your signature is recorded. There is nothing left for you to do.',
        showReceipt: true,
      };
    }
    if (ctx.signerStatus === 'Rejected') {
      return {
        icon: 'close-circle-outline',
        tone: 'danger',
        title: 'You declined this document',
        detail: 'The office was notified. If this was a mistake, contact them to receive a new request.',
        showReceipt: false,
      };
    }
    if (ctx.signerStatus === 'Expired' || ctx.requestStatus === 'Expired') {
      return {
        icon: 'time-outline',
        tone: 'warning',
        title: 'This request expired',
        detail: 'The signing window closed. Ask the office to send you a new request.',
        showReceipt: false,
      };
    }
    if (ctx.requestStatus === 'Completed') {
      return {
        icon: 'checkmark-done-outline',
        tone: 'success',
        title: 'This document is already complete',
        detail: 'Every signer finished, so no further action is needed from you.',
        showReceipt: true,
      };
    }
    if (ctx.requestStatus === 'Rejected') {
      return {
        icon: 'close-circle-outline',
        tone: 'danger',
        title: 'This document was declined',
        detail: 'Another signer declined it, so the request was stopped.',
        showReceipt: false,
      };
    }
    if (ctx.requestStatus === 'Canceled') {
      return {
        icon: 'ban-outline',
        tone: 'neutral',
        title: 'This request was cancelled',
        detail: 'The office cancelled it. Contact them if you still need to sign.',
        showReceipt: false,
      };
    }
    if (ctx.requestStatus === 'Draft' || ctx.requestStatus === 'Ready') {
      return {
        icon: 'hourglass-outline',
        tone: 'neutral',
        title: 'This document is not ready yet',
        detail: 'The office has not sent it out. Please try again from the email you received.',
        showReceipt: false,
      };
    }
    if (ctx.requiresSequentialSigning && !ctx.isSignerNextInSequence) {
      return {
        icon: 'people-outline',
        tone: 'neutral',
        title: 'It is not your turn yet',
        detail: `This document is signed in order and you are number ${ctx.order}. We will email you as soon as it reaches you.`,
        showReceipt: false,
      };
    }
    return null;
  });

  readonly categoryLabel = computed(() => {
    const ctx = this.context();
    return ctx ? SIGNATURE_CATEGORY_LABEL[ctx.category] : '';
  });

  readonly expiresLabel = computed(() => {
    const ctx = this.context();
    return ctx ? formatDate(ctx.expiresAtUtc) : '';
  });

  /** Campos ordenados por página: es todo lo que el firmante puede saber del documento. */
  readonly fields = computed<PublicSignerFieldView[]>(() =>
    [...(this.context()?.fields ?? [])].sort((a, b) => a.page - b.page),
  );

  readonly requiredFieldCount = computed(() => this.fields().filter(f => f.isRequired).length);

  readonly typedNameMismatch = computed(() => {
    const ctx = this.context();
    const typed = this.typedName().trim();
    return !!ctx && typed.length > 0 && !matchesSignerFullName(typed, ctx.signerFullName);
  });

  // ---------- Acuse derivado de la cadena de audit ----------

  /** Fila `DocumentSigned` de la cadena — única fuente real del sellado del firmante. */
  private readonly signedEvent = computed(
    () => [...(this.audit()?.events ?? [])].reverse().find(e => e.kind === 'DocumentSigned') ?? null,
  );

  readonly signedAtLabel = computed(() => {
    const evt = this.signedEvent();
    return evt ? formatDateTime(evt.occurredAtUtc) : '';
  });

  /** Hash encadenado (HMAC) de la última fila: lo que hace verificable el acuse. */
  readonly chainHash = computed(() => {
    const events = this.audit()?.events ?? [];
    const last = events.length > 0 ? events[events.length - 1] : null;
    return last ? shortenHash(last.chainHash) : '';
  });

  readonly auditIntact = computed(() => this.audit()?.isIntact ?? null);

  // ------------------------------------------------------------------
  // Ciclo de vida
  // ------------------------------------------------------------------

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    // Reloj de 1 s: solo alimenta la cuenta atrás del reenvío del OTP.
    this.clockTimer = setInterval(() => this.clock.set(Date.now()), 1000);
    void this.load();
  }

  ngOnDestroy(): void {
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  async load(): Promise<void> {
    if (!this.token) {
      this.loading.set(false);
      this.loadError.set({ code: 'Signature.Token.Format', message: 'Missing token.' });
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const ctx = await firstValueFrom(this.api.getContext(this.token));
      this.applyContext(ctx);
    } catch (err) {
      this.loadError.set(toApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Guarda el contexto y sincroniza el paso actual con los gates que siguen abiertos:
   * cuando un gate se supera (consent aceptado, PIN verificado) su paso desaparece de
   * `steps`, así que hay que aterrizar en el siguiente que sí existe.
   */
  private applyContext(ctx: PublicSignerView): void {
    const previous = this.stepId();
    this.context.set(ctx);
    if (ctx.hasAcceptedConsent) {
      this.consentChecked.set(true);
    }
    const steps = this.steps();
    if (!steps.some(s => s.id === previous)) {
      // El gate previo se cerró (consent aceptado, PIN u OTP verificados): aterrizar en el
      // primer paso vigente que venga en/después de la posición canónica del anterior.
      const previousRank = STEP_ORDER.indexOf(previous);
      const next = steps.find(s => STEP_ORDER.indexOf(s.id) >= previousRank);
      this.stepId.set(next?.id ?? 'review');
    }
    if (ctx.signerStatus === 'Signed' && !this.justSigned()) {
      void this.loadAudit();
    }
  }

  // ------------------------------------------------------------------
  // Navegación
  // ------------------------------------------------------------------

  next(): void {
    if (!this.canProceed() || this.busy()) {
      return;
    }
    switch (this.stepId()) {
      case 'consent':
        void this.acceptConsent();
        return;
      case 'verify':
        void this.submitPin();
        return;
      case 'verify-otp':
        void this.submitOtp();
        return;
      case 'sign':
        void this.submitSignature();
        return;
      default:
        this.goToStep(this.stepIndex() + 1);
    }
  }

  back(): void {
    if (this.busy() || this.isFirstStep()) {
      return;
    }
    this.goToStep(this.stepIndex() - 1);
  }

  private goToStep(index: number): void {
    const steps = this.steps();
    const clamped = Math.min(Math.max(index, 0), steps.length - 1);
    this.actionError.set(null);
    this.stepId.set(steps[clamped].id);
  }

  toggleConsent(): void {
    this.consentChecked.update(v => !v);
  }

  // ------------------------------------------------------------------
  // Acciones contra el backend
  // ------------------------------------------------------------------

  /**
   * POST /consent → 204. Se recarga el contexto para leer `hasAcceptedConsent`: al
   * volver true el paso Consent desaparece y `applyContext` avanza solo.
   */
  private async acceptConsent(): Promise<void> {
    const ok = await this.run('Recording your consent…', () =>
      firstValueFrom(this.api.acceptConsent(this.token)),
    );
    if (ok) {
      await this.reloadContext();
    }
  }

  /**
   * POST /verify-pin → 204. Un PIN incorrecto responde error sin detalle (el backend
   * no filtra cuántos intentos quedan), así que tras un fallo se recarga el contexto
   * para saber si el firmante quedó bloqueado.
   */
  private async submitPin(): Promise<void> {
    await this.run('Checking your PIN…', () => firstValueFrom(this.api.verifyPin(this.token, this.pin().trim())));
    this.pin.set('');
    // En ambos casos se recarga: al acertar, `isPinVerified` cierra el gate y
    // `applyContext` avanza; al fallar, el contexto trae `pinLockedUntilUtc` si el
    // quinto intento disparó el bloqueo de 30 minutos.
    await this.reloadContext();
  }

  /**
   * POST /challenge → 204. Emite (o reenvía) el OTP por el método que exige la solicitud.
   * Arranca el cooldown local de 30 s aunque el backend también lo valida — evita spam del
   * botón. Un reenvío dentro del cooldown se corta antes de llamar.
   */
  async sendOtp(): Promise<void> {
    const method = this.otpMethod();
    if (!method || this.busy() || !this.canResendOtp()) {
      return;
    }
    const ok = await this.run('Sending your code…', () => firstValueFrom(this.api.issueChallenge(this.token, method)));
    if (ok) {
      this.otpIssued.set(true);
      this.otpCode.set('');
      this.otpCooldownUntil.set(Date.now() + OTP_RESEND_COOLDOWN_SECONDS * 1000);
    }
  }

  /**
   * POST /verify-challenge → 204. Valida el código del OTP activo. Al acertar, el contexto
   * recargado trae `isVerificationCompleted = true`: el paso desaparece y `applyContext`
   * avanza solo. Un código incorrecto/expirado se muestra sin recargar.
   */
  private async submitOtp(): Promise<void> {
    const method = this.otpMethod();
    if (!method) {
      return;
    }
    const ok = await this.run('Checking your code…', () =>
      firstValueFrom(this.api.verifyChallenge(this.token, method, this.otpCode().trim())),
    );
    if (!ok) {
      return;
    }
    this.otpCode.set('');
    await this.reloadContext();
  }

  /**
   * POST /sign → 204. Método `Typed`: es el único posible sin sesión, porque
   * `Drawn`/`Uploaded` exigirían subir la imagen al CloudStorage autenticado.
   */
  private async submitSignature(): Promise<void> {
    const ctx = this.context();
    if (!ctx) {
      return;
    }
    const ok = await this.run('Applying your signature…', () =>
      firstValueFrom(
        this.api.sign(this.token, {
          method: 'Typed',
          typedName: this.typedName().trim(),
          signatureImageFileId: null,
        }),
      ),
    );
    if (!ok) {
      return;
    }
    this.justSigned.set(true);
    this.stepId.set('done');
    await this.reloadContext();
    await this.loadAudit();
  }

  openReject(): void {
    this.rejectReason.set('');
    this.isRejectOpen.set(true);
  }

  closeReject(): void {
    this.isRejectOpen.set(false);
  }

  /**
   * POST /reject → 204. El aggregate incrementa `RevocationEpoch`: el token muere en
   * el acto, así que NO se recarga el contexto (respondería `Token.Revoked`).
   */
  async confirmReject(): Promise<void> {
    const reason = this.rejectReason().trim();
    const ok = await this.run('Sending your answer…', () =>
      firstValueFrom(this.api.reject(this.token, reason || null)),
    );
    if (!ok) {
      return;
    }
    this.isRejectOpen.set(false);
    this.declineReasonEcho.set(reason);
    this.declined.set(true);
  }

  /** GET /verify-audit. Best-effort: si falla, el acuse queda vacío (no se inventa). */
  async loadAudit(): Promise<void> {
    this.auditLoading.set(true);
    try {
      this.audit.set(await firstValueFrom(this.api.verifyAudit(this.token)));
    } catch {
      this.audit.set(null);
    } finally {
      this.auditLoading.set(false);
    }
  }

  private async reloadContext(): Promise<void> {
    try {
      this.applyContext(await firstValueFrom(this.api.getContext(this.token)));
    } catch (err) {
      const error = toApiError(err);
      // Tras firmar, completar la solicitud REVOCA el token (sube RevocationEpoch): es el
      // curso normal, no un enlace muerto. Se conserva la pantalla de acuse ("done") en vez
      // de pisarla con "This link is no longer active".
      if (this.justSigned()) {
        return;
      }
      // Un enlace que muere a mitad del recorrido (antes de firmar) sí cambia la pantalla.
      if (isDeadLinkCode(error.code)) {
        this.loadError.set(error);
        this.context.set(null);
      }
    }
  }

  /**
   * Envoltorio único de las mutaciones: overlay de progreso real (no simulado),
   * normalización del error con `toApiError` y escalado a pantalla completa cuando
   * el token deja de valer.
   */
  private async run(label: string, action: () => Promise<unknown>): Promise<boolean> {
    this.busy.set(true);
    this.busyLabel.set(label);
    this.actionError.set(null);
    try {
      await action();
      return true;
    } catch (err) {
      const error = toApiError(err);
      if (isDeadLinkCode(error.code)) {
        this.loadError.set(error);
        this.context.set(null);
        this.isRejectOpen.set(false);
        return false;
      }
      this.actionError.set(friendlyMessage(error));
      return false;
    } finally {
      this.busy.set(false);
      this.busyLabel.set('');
    }
  }
}

function formatDate(iso: string): string {
  return parseUtcDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  return parseUtcDate(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string): string {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
}

/** Nombre del canal del OTP en la voz del firmante. */
function channelLabel(method: SignerVerificationMethod | null): string {
  switch (method) {
    case 'EmailOtp':
      return 'email';
    case 'SmsOtp':
      return 'text message';
    case 'WhatsAppOtp':
      return 'WhatsApp';
    default:
      return 'a code';
  }
}

/** El chainHash es un HMAC largo: se muestra abreviado, como en cualquier acuse. */
function shortenHash(hash: string): string {
  return hash.length <= 20 ? hash : `${hash.slice(0, 10)}…${hash.slice(-10)}`;
}

/** Mensajes de los errores de negocio más probables en esta pantalla. */
function friendlyMessage(error: ApiError): string {
  switch (error.code) {
    case 'Signature.PractitionerPin.Empty':
    case 'Signature.PractitionerPin.Length':
    case 'Signature.PractitionerPin.Format':
      return 'The PIN must be 4 to 10 digits.';
    case 'Signature.Signer.PinLocked':
      return 'Too many attempts. Try again in a few minutes or contact the office.';
    case 'Signature.Request.PinVerificationRequired':
      return 'Enter the PIN your preparer gave you before signing.';
    case 'Signature.Signer.ChallengeMismatch':
      return 'That code is incorrect. Check it and try again, or request a new one.';
    case 'Signature.Signer.NoActiveChallenge':
      return 'That code expired. Request a new one to continue.';
    case 'Signature.Signer.ChallengeCooldown':
      return 'Please wait a few seconds before requesting another code.';
    case 'Signature.Signer.NoDeliveryAddress':
      return 'We could not send the code. Please contact the office that sent you this document.';
    case 'Signature.Request.VerificationRequired':
      return 'Verify your identity with the code we sent before signing.';
    case 'Signature.Request.ConsentRequired':
      return 'You need to accept the electronic signature terms first.';
    case 'Signature.Request.NotYourTurn':
      return 'This document is signed in order and it is not your turn yet.';
    case 'Signature.Request.NotInProgress':
      return 'This request is no longer open for signing.';
    case 'Signature.Public.TypedNameMismatch':
    case 'Signature.Public.TypedNameEmpty':
      return 'Type your full name exactly as it appears on the document.';
    case 'Network.Unreachable':
      return 'We could not reach the server. Check your connection and try again.';
    default:
      return error.message || 'Something went wrong. Please try again.';
  }
}
