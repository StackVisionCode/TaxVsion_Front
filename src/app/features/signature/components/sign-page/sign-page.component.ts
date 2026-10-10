import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/models/api-error.model';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { BrandLogoComponent } from '@core/theme/brand-logo.component';
import { PlatformBrandLogoComponent } from '@core/theme/platform-brand-logo.component';
import { SignaturePadComponent } from '@shared/ui/signature-pad/signature-pad.component';
import { SignDocumentViewComponent } from '../../ui/sign-document-view/sign-document-view.component';
import { renderPdfPages } from '../../utils/pdf-render.util';
import { maskEmail } from '../../utils/mask-email.util';
import { UsedLinkRecord, markLinkUsed, readUsedLink } from '../../utils/used-link.util';
import { PublicSignatureService } from '../../data-access/public-signature.service';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import {
  AuditChainVerificationResponse,
  PublicSignerDocumentView,
  PublicSignerFieldView,
  PublicSignerView,
  FIELD_KIND_LABEL,
  SIGNATURE_CATEGORY_LABEL,
  SignatureCaptureMethod,
  SignerVerificationMethod,
  describeDeadLink,
  isDeadLinkCode,
  isValidPractitionerPin,
  matchesSignerFullName,
} from '../../data-access/public-signature.model';

/** Pasos posibles del recorrido. Cuáles se muestran depende de lo que exija la solicitud. */
type StepId = 'welcome' | 'consent' | 'verify' | 'verify-otp' | 'review' | 'sign' | 'done';

/** Orden canónico de los pasos: usado para reubicar el paso actual cuando un gate se cierra. */
const STEP_ORDER: readonly StepId[] = [
  'welcome',
  'consent',
  'verify',
  'verify-otp',
  'review',
  'sign',
  'done',
];

/** Segundos de espera antes de poder reenviar el OTP (espejo de SignatureRequest.ChallengeResendCooldown). */
const OTP_RESEND_COOLDOWN_SECONDS = 30;

interface WizardStep {
  id: StepId;
  caption: string;
  detail: string;
}

interface StageCopy {
  title: string;
  subtitle: string;
  badge: string;
  badgeIcon: string;
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
 * Captura de firma: el firmante dibuja, teclea o sube una imagen en el pad compartido; el
 * PNG resultante se sube por el endpoint anónimo por token (`POST /signature-image`) y luego
 * se firma referenciando ese `fileId`. El backend escanea la imagen con ClamAV de forma
 * asíncrona y el sellado espera a que esté lista (no hay que hacer nada en el cliente).
 *
 * Limitación del contrato público (no simulable, se muestra como tal):
 *   - F5 (2026-10-03): GET /signature/public/{token}/document/{documentId} devuelve
 *     cada PDF original tras validar la verificación completa. El visor lo renderiza
 *     en la ceremonia y superpone los campos en sus coordenadas normalizadas.
 */
@Component({
  selector: 'app-sign-page',
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    BrandLogoComponent,
    PlatformBrandLogoComponent,
    SignaturePadComponent,
    SignDocumentViewComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sign-page.component.html',
  styleUrl: './sign-page.component.css',
})
export class SignPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PublicSignatureService);

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
  /** Hora local de la firma: respaldo del acuse si la cadena de audit ya no es legible (token revocado). */
  private readonly signedAtLocal = signal<string | null>(null);

  /**
   * El enlace ya se usó en este dispositivo (firmado o rechazado): la página queda expirada
   * aunque el backend todavía lo resuelva (varios firmantes pendientes). Ver `used-link.util`.
   */
  readonly usedLink = signal<UsedLinkRecord | null>(null);
  /** true tras un POST /reject exitoso: el token queda revocado, no se recarga nada. */
  readonly declined = signal(false);
  readonly declineReasonEcho = signal('');

  readonly consentChecked = signal(false);
  readonly pin = signal('');
  /** El PIN se escribe oculto (password) por privacidad; la lupa lo revela como en un login. */
  readonly pinRevealed = signal(false);

  /** Pad de firma compartido (Draw/Type/Upload); montado siempre, visible solo en el paso 'sign'. */
  private readonly pad = viewChild(SignaturePadComponent);
  private readonly documentView = viewChild(SignDocumentViewComponent);

  /** Texto que el firmante escribe en cada campo `Text`, indexado por `fieldId` (P4). */
  readonly fieldValues = signal<Record<string, string>>({});

  // ---------- OTP (verificación de identidad por firmante) ----------

  readonly otpCode = signal('');
  /** true cuando ya se emitió al menos un código en esta sesión (cambia el copy y muestra el input). */
  readonly otpIssued = signal(false);
  /** Epoch ms hasta el que no se puede reenviar; null si no hay cooldown activo. */
  private readonly otpCooldownUntil = signal<number | null>(null);
  /** Reloj de 1 s para recomputar la cuenta atrás del reenvío sin timers en la vista. */
  private readonly clock = signal(Date.now());
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  // Cuenta atrás del paso 'done'. Null mientras no se arranca; el timer vive aparte del clock general.
  private static readonly DONE_REDIRECT_SECONDS = 10;
  readonly doneRedirectSecondsLeft = signal<number | null>(null);
  private doneTimer: ReturnType<typeof setInterval> | null = null;

  readonly isRejectOpen = signal(false);
  readonly rejectReason = signal('');
  readonly helpOpen = signal(false);

  // F5 — Documento como fondo del Review step: bajamos los bytes del PDF por el endpoint F5 (que
  // ya hard-failea 403 si la verificación no está completa) y lo rendearmos con pdf.js a dataURLs.
  // El componente `app-sign-document-view` ya acepta `[pageImages]` para pintarlos de fondo bajo
  // los campos — así los canvas del preparador se ven en su posición real sobre el documento.
  readonly pageImages = signal<Record<number, string> | null>(null);
  readonly pageAspectRatios = signal<Record<number, number> | null>(null);
  readonly loadingDocument = signal(false);
  readonly documentError = signal<string | null>(null);
  readonly documentZoom = signal(100);
  readonly selectedFieldId = signal<string | null>(null);
  readonly activeDocumentIndex = signal(0);
  readonly highestReviewedDocumentIndex = signal(0);
  private readonly pageImagesByDocument = new Map<string, Record<number, string>>();
  private readonly pageAspectRatiosByDocument = new Map<string, Record<number, number>>();
  private documentLoadSequence = 0;

  private async loadDocument(): Promise<void> {
    const document = this.activeDocument();
    const sequence = ++this.documentLoadSequence;
    if (!document) {
      this.pageImages.set(null);
      this.pageAspectRatios.set(null);
      this.loadingDocument.set(false);
      return;
    }
    const cached = this.pageImagesByDocument.get(document.documentId);
    if (cached) {
      this.pageImages.set(cached);
      this.pageAspectRatios.set(this.pageAspectRatiosByDocument.get(document.documentId) ?? null);
      this.documentError.set(null);
      this.loadingDocument.set(false);
      return;
    }
    this.loadingDocument.set(true);
    this.documentError.set(null);
    this.pageImages.set(null);
    this.pageAspectRatios.set(null);
    try {
      const bytes = await firstValueFrom(
        this.api.getDocumentBytes(this.token, document.documentId),
      );
      const pages = await renderPdfPages({ data: bytes });
      const map: Record<number, string> = {};
      const ratios: Record<number, number> = {};
      for (const p of pages) {
        if (p.src) {
          map[p.page] = p.src;
          ratios[p.page] = p.width / p.height;
        }
      }
      if (
        sequence !== this.documentLoadSequence ||
        this.activeDocument()?.documentId !== document.documentId
      ) {
        return;
      }
      this.pageImagesByDocument.set(document.documentId, map);
      this.pageAspectRatiosByDocument.set(document.documentId, ratios);
      this.pageImages.set(map);
      this.pageAspectRatios.set(ratios);
    } catch (err) {
      if (sequence !== this.documentLoadSequence) {
        return;
      }
      // El error queda visible y permite reintentar. Nunca simulamos el PDF con una hoja vacia.
      this.documentError.set(toApiError(err).message);
    } finally {
      if (sequence === this.documentLoadSequence) {
        this.loadingDocument.set(false);
      }
    }
  }

  // Host al que vuelve el firmante cuando termina.
  //  - Prod: si el tenant tiene subdominio proyectado y el host es multi-tenant
  //    (ej. foo.taxproffice.com) volvemos a `<sub>.<basedomain>/`.
  //  - Si el backend no sembro `tenantSubDomain` (tenants viejos, pre F1.C) pero el
  //    firmante llego por un subdominio evidente (3+ segmentos, no `www`), lo tomamos
  //    del hostname mismo: es el mismo tenant por el que entro.
  //  - Si no se puede inferir: null → se muestra la pantalla "close window".
  //    (NO cae al Landing: Landing es Manage Subscription, el firmante externo no pinta ahí).
  readonly tenantReturnUrl = computed(() => {
    const host = window.location.hostname;
    const parts = host.split('.');
    const sub =
      this.context()?.tenantSubDomain?.trim().toLowerCase() || inferSubdomainFromParts(parts);
    const dot = host.indexOf('.');
    if (sub && dot >= 0) {
      const parent = host.slice(dot + 1);
      return `${window.location.protocol}//${sub}.${parent}/`;
    }
    return null;
  });

  // ---------- Acuse (cadena de audit) ----------

  readonly audit = signal<AuditChainVerificationResponse | null>(null);
  readonly auditLoading = signal(false);

  // ------------------------------------------------------------------
  // Derivados
  // ------------------------------------------------------------------

  readonly firstName = computed(() => this.context()?.signerFullName.trim().split(/\s+/)[0] ?? '');

  readonly signerInitials = computed(() =>
    (this.context()?.signerFullName ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join(''),
  );

  /** El email del cliente nunca se muestra completo: cualquiera con el enlace vería esta página. */
  readonly maskedEmail = computed(() => maskEmail(this.context()?.signerEmail));

  /** Pasos vigentes: los gates opcionales desaparecen si la solicitud no los exige. */
  readonly steps = computed<WizardStep[]>(() => {
    const ctx = this.context();
    const steps: WizardStep[] = [
      { id: 'welcome', caption: 'Welcome', detail: 'Your signing overview' },
    ];
    if (ctx?.requiresConsent && !ctx.hasAcceptedConsent) {
      steps.push({ id: 'consent', caption: 'Consent', detail: 'Review and agree' });
    }
    if (ctx?.requiresPractitionerPin && !ctx.isPinVerified) {
      steps.push({ id: 'verify', caption: 'Verify identity', detail: 'Confirm your PIN' });
    }
    // Gate OTP: independiente del PIN. Solo mientras no esté completado (el backend lo exige).
    if (ctx?.requiredVerificationMethod && !ctx.isVerificationCompleted) {
      steps.push({ id: 'verify-otp', caption: 'Security code', detail: 'Confirm it is you' });
    }
    steps.push(
      { id: 'review', caption: 'Review document', detail: 'Read your documents' },
      { id: 'sign', caption: 'Sign document', detail: 'Add your signature' },
      { id: 'done', caption: 'All set', detail: 'Signing complete' },
    );
    return steps;
  });

  readonly stepIndex = computed(() => {
    const index = this.steps().findIndex((s) => s.id === this.stepId());
    return index < 0 ? 0 : index;
  });

  readonly stepNumber = computed(() => this.stepIndex() + 1);
  readonly stepCount = computed(() => this.steps().length);
  readonly isFirstStep = computed(() => this.stepIndex() === 0);
  readonly isDone = computed(() => this.stepId() === 'done');

  readonly stageCopy = computed<StageCopy>(() => {
    switch (this.stepId()) {
      case 'welcome':
        return {
          title: 'A few steps. One secure signature.',
          subtitle: 'Everything you need to review and sign your documents, in one place.',
          badge: 'Ready to sign',
          badgeIcon: 'time-outline',
        };
      case 'consent':
        return {
          title: 'Your signature. Your consent.',
          subtitle: 'Take a moment to review how electronic signing works before you continue.',
          badge: 'Consent required',
          badgeIcon: 'shield-checkmark-outline',
        };
      case 'verify':
        return {
          title: "Let's confirm it is you.",
          subtitle: 'Your practitioner PIN helps keep this document in the right hands.',
          badge: 'Identity verification',
          badgeIcon: 'lock-closed-outline',
        };
      case 'verify-otp':
        return {
          title: "Let's confirm it is you.",
          subtitle: 'A quick security code protects your document before it opens.',
          badge: 'Identity verification',
          badgeIcon: 'lock-closed-outline',
        };
      case 'review':
        return {
          title: 'Take a moment to review.',
          subtitle: 'Read each document and find the highlighted fields that need your attention.',
          badge: 'Ready for review',
          badgeIcon: 'shield-checkmark-outline',
        };
      case 'sign':
        return {
          title: 'Make it yours. Add your signature.',
          subtitle: 'Complete the required fields and add one signature for this request.',
          badge: `${this.completedActiveFieldCount()} of ${this.fields().length} fields ready`,
          badgeIcon: 'shield-checkmark-outline',
        };
      default:
        return {
          title: 'Signed. Sealed. All set.',
          subtitle: 'Your part of this signing request is complete.',
          badge: 'Signing complete',
          badgeIcon: 'checkmark-circle-outline',
        };
    }
  });

  /** Revisión y firma muestran las hojas del documento: la tarjeta se ensancha en pantallas grandes. */
  readonly wideLayout = computed(
    () =>
      !!this.context() &&
      !this.blocked() &&
      !this.declined() &&
      (this.stepId() === 'review' || (this.stepId() === 'sign' && this.textFields().length > 0)),
  );

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
        return this.isLastDocument() ? 'Continue to signing' : 'Next document';
      case 'sign':
        return this.isLastDocument() ? 'Finish & submit' : 'Next document';
      default:
        return '';
    }
  });

  readonly canProceed = computed(() => {
    switch (this.stepId()) {
      case 'consent':
        return this.consentChecked();
      case 'verify':
        return isValidPractitionerPin(this.pin()) && !this.isPinLocked();
      case 'verify-otp':
        return this.otpIssued() && this.isOtpComplete();
      case 'sign':
        return this.isLastDocument() ? this.signReady() : this.currentRequiredTextComplete();
      case 'done':
        return false;
      default:
        return true;
    }
  });

  /**
   * Lista para firmar: el pad tiene contenido guardable y, si el firmante eligió teclear su
   * firma, el texto coincide con el nombre legal (el backend valida esa igualdad en Typed).
   */
  readonly signReady = computed(() => {
    const pad = this.pad();
    if (!pad || !pad.canSave() || !this.requiredTextComplete()) {
      return false;
    }
    if (pad.method() === 'type') {
      const ctx = this.context();
      return !!ctx && matchesSignerFullName(pad.typedText(), ctx.signerFullName);
    }
    return true;
  });

  /** true si en el pad se teclea la firma pero el texto aún no coincide con el nombre del documento. */
  readonly padTypedMismatch = computed(() => {
    const pad = this.pad();
    const ctx = this.context();
    if (!pad || pad.method() !== 'type') {
      return false;
    }
    const typed = pad.typedText().trim();
    return !!ctx && typed.length > 0 && !matchesSignerFullName(typed, ctx.signerFullName);
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
  readonly otpMethod = computed<SignerVerificationMethod | null>(
    () => this.context()?.requiredVerificationMethod ?? null,
  );

  /** Cómo se le nombra el canal al firmante en la copy. */
  readonly otpChannelLabel = computed(() => channelLabel(this.otpMethod()));

  /** A dónde llega el código (email enmascarado; el teléfono no se expone en el contexto público). */
  readonly otpDestinationHint = computed(() => {
    switch (this.otpMethod()) {
      case 'EmailOtp':
        return this.context()?.signerEmail ? this.maskedEmail() : 'your email';
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
        title: 'This link has expired',
        detail:
          'You already signed this document. Your signature is recorded and there is nothing left for you to do.',
        showReceipt: true,
      };
    }
    if (ctx.signerStatus === 'Rejected') {
      return {
        icon: 'close-circle-outline',
        tone: 'danger',
        title: 'You declined this document',
        detail:
          'The office was notified. If this was a mistake, contact them to receive a new request.',
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

  // F7 — expiresAtUtc es nullable: cuando null, el header no pinta "Due …".
  readonly expiresLabel = computed(() => {
    const iso = this.context()?.expiresAtUtc;
    return iso ? formatDate(iso) : '';
  });

  /** Campos ordenados por página: es todo lo que el firmante puede saber del documento. */
  readonly signingDocuments = computed(() =>
    [...(this.context()?.documents ?? [])]
      .filter((document) => document.hasFieldsToSign && document.signedAtUtc === null)
      .sort((left, right) => left.order - right.order),
  );

  readonly activeDocument = computed<PublicSignerDocumentView | null>(
    () => this.signingDocuments()[this.activeDocumentIndex()] ?? null,
  );
  readonly isLastDocument = computed(
    () =>
      this.signingDocuments().length > 0 &&
      this.activeDocumentIndex() === this.signingDocuments().length - 1,
  );
  readonly documentProgress = computed(() => {
    const document = this.activeDocument();
    return document
      ? `Document ${this.activeDocumentIndex() + 1} of ${this.signingDocuments().length} — ${document.title}`
      : '';
  });

  readonly fields = computed<PublicSignerFieldView[]>(() => {
    const documentId = this.activeDocument()?.documentId;
    return [...(this.context()?.fields ?? [])]
      .filter((field) => field.documentId === documentId)
      .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  });

  readonly captureField = computed<PublicSignerFieldView | null>(() => {
    const fields = this.fields();
    const selected = fields.find((field) => field.id === this.selectedFieldId());
    if (selected?.kind === 'Signature' || selected?.kind === 'Initials') {
      return selected;
    }
    return fields.find((field) => field.kind === 'Initials' || field.kind === 'Signature') ?? null;
  });

  readonly captureTitle = computed(() =>
    this.captureField()?.kind === 'Initials' ? 'Add your initials' : 'Add your signature',
  );

  readonly requiredFieldCount = computed(() => this.fields().filter((f) => f.isRequired).length);

  readonly totalFieldCount = computed(() => {
    const documentIds = new Set(this.signingDocuments().map((document) => document.documentId));
    return (this.context()?.fields ?? []).filter((field) => documentIds.has(field.documentId))
      .length;
  });

  readonly totalRequiredFieldCount = computed(() => {
    const documentIds = new Set(this.signingDocuments().map((document) => document.documentId));
    return (this.context()?.fields ?? []).filter(
      (field) => documentIds.has(field.documentId) && field.isRequired,
    ).length;
  });

  readonly activePageCount = computed(() => {
    const renderedPages = Object.keys(this.pageImages() ?? {})
      .map(Number)
      .filter(Number.isFinite);
    const fieldPages = this.fields().map((field) => field.page);
    return Math.max(0, ...renderedPages, ...fieldPages);
  });

  readonly completedActiveFieldCount = computed(
    () => this.fields().filter((field) => this.isFieldReady(field)).length,
  );

  /** Páginas distintas donde el preparador puso campos para este firmante. */
  readonly fieldPageCount = computed(() => new Set(this.fields().map((f) => f.page)).size);

  /** La descripción del preparador puede ser larga: se muestra recortada con "Show more". */
  readonly descriptionExpanded = signal(false);

  /** Campos de texto rellenables por el firmante (P4), ordenados por página. */
  readonly textFields = computed<PublicSignerFieldView[]>(() =>
    this.fields().filter((f) => f.kind === 'Text'),
  );

  readonly allTextFields = computed<PublicSignerFieldView[]>(() => {
    const documentIds = new Set(this.signingDocuments().map((document) => document.documentId));
    return (this.context()?.fields ?? []).filter(
      (field) => documentIds.has(field.documentId) && field.kind === 'Text',
    );
  });

  /**
   * Al firmar solo interesan las páginas donde hay algo que escribir (en el teléfono, las
   * demás solo alargarían el scroll hasta el pad). La revisión muestra todas.
   */
  readonly fieldsOnTextPages = computed<PublicSignerFieldView[]>(() => {
    const pages = new Set(this.textFields().map((f) => f.page));
    return this.fields().filter((f) => pages.has(f.page));
  });

  /** true si todos los campos de texto REQUERIDOS tienen valor (gate de la firma). */
  readonly currentRequiredTextComplete = computed(() =>
    this.textFields().every(
      (f) => !f.isRequired || (this.fieldValues()[f.id]?.trim().length ?? 0) > 0,
    ),
  );

  readonly requiredTextComplete = computed(() =>
    this.allTextFields().every(
      (f) => !f.isRequired || (this.fieldValues()[f.id]?.trim().length ?? 0) > 0,
    ),
  );

  // ---------- Acuse derivado de la cadena de audit ----------

  /** Fila `DocumentSigned` de la cadena — única fuente real del sellado del firmante. */
  private readonly signedEvent = computed(
    () =>
      [...(this.audit()?.events ?? [])].reverse().find((e) => e.kind === 'DocumentSigned') ?? null,
  );

  readonly signedAtLabel = computed(() => {
    const evt = this.signedEvent();
    const at = evt?.occurredAtUtc ?? this.signedAtLocal();
    return at ? formatDateTime(at) : '';
  });

  /** Cuándo se usó el enlace en este dispositivo (pantalla de enlace expirado). */
  readonly usedLinkAtLabel = computed(() => {
    const at = this.usedLink()?.atUtc;
    return at ? formatDateTime(at) : '';
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
    this.stopDoneCountdown();
  }

  // Arranca la cuenta atrás una vez por entrada a 'done'. Si ya hay timer activo, no reinicia.
  private startDoneCountdown(): void {
    if (this.doneTimer !== null || this.tenantReturnUrl() === null) return;
    this.doneRedirectSecondsLeft.set(SignPageComponent.DONE_REDIRECT_SECONDS);
    this.doneTimer = setInterval(() => {
      const left = (this.doneRedirectSecondsLeft() ?? 0) - 1;
      if (left <= 0) {
        this.exitToTenant();
        return;
      }
      this.doneRedirectSecondsLeft.set(left);
    }, 1000);
  }

  // Salida inmediata (botón o fin de cuenta atrás). Hace cleanup y navega una sola vez.
  exitToTenant(): void {
    const url = this.tenantReturnUrl();
    this.stopDoneCountdown();
    if (url) window.location.assign(url);
  }

  private stopDoneCountdown(): void {
    if (this.doneTimer !== null) {
      clearInterval(this.doneTimer);
      this.doneTimer = null;
    }
    this.doneRedirectSecondsLeft.set(null);
  }

  async load(): Promise<void> {
    if (!this.token) {
      this.loading.set(false);
      this.loadError.set({ code: 'Signature.Token.Format', message: 'Missing token.' });
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    const used = await readUsedLink(this.token);
    if (used) {
      this.usedLink.set(used);
      this.loading.set(false);
      return;
    }
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
    const previousDocumentId = this.activeDocument()?.documentId;
    this.context.set(ctx);
    const documents = this.signingDocuments();
    const documentIndex = previousDocumentId
      ? documents.findIndex((document) => document.documentId === previousDocumentId)
      : 0;
    this.activeDocumentIndex.set(documentIndex >= 0 ? documentIndex : 0);
    this.highestReviewedDocumentIndex.update((current) =>
      Math.max(current, documentIndex >= 0 ? documentIndex : 0),
    );
    if (ctx.hasAcceptedConsent) {
      this.consentChecked.set(true);
    }
    const steps = this.steps();
    if (!steps.some((s) => s.id === previous)) {
      // El gate previo se cerró (consent aceptado, PIN u OTP verificados): aterrizar en el
      // primer paso vigente que venga en/después de la posición canónica del anterior.
      const previousRank = STEP_ORDER.indexOf(previous);
      const next = steps.find((s) => STEP_ORDER.indexOf(s.id) >= previousRank);
      this.stepId.set(next?.id ?? 'review');
    }
    if (ctx.signerStatus === 'Signed' && !this.justSigned()) {
      void this.loadAudit();
    }

    // Al completar un gate (consent, PIN u OTP), applyContext puede mover el recorrido
    // directamente a review sin pasar por goToStep(). Ese salto tambien debe iniciar el visor;
    // de lo contrario el PDF solo aparecia despues de avanzar a firma y volver atras.
    if (this.stepId() === 'review' || this.stepId() === 'sign') {
      void this.loadDocument();
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
      case 'review':
        if (this.isLastDocument()) {
          this.activeDocumentIndex.set(0);
          this.goToStep(this.stepIndex() + 1);
        } else {
          this.moveDocument(1);
        }
        return;
      case 'sign':
        if (this.isLastDocument()) {
          void this.submitSignature();
        } else {
          this.moveDocument(1);
        }
        return;
      default:
        this.goToStep(this.stepIndex() + 1);
    }
  }

  back(): void {
    if (this.busy() || this.isFirstStep()) {
      return;
    }
    if (
      (this.stepId() === 'review' || this.stepId() === 'sign') &&
      this.activeDocumentIndex() > 0
    ) {
      this.moveDocument(-1);
      return;
    }
    this.goToStep(this.stepIndex() - 1);
  }

  goToJourneyStep(index: number): void {
    if (this.busy() || this.isDone() || index > this.stepIndex()) {
      return;
    }
    this.goToStep(index);
  }

  openDocument(index: number): void {
    if (
      this.busy() ||
      index < 0 ||
      index >= this.signingDocuments().length ||
      index === this.activeDocumentIndex() ||
      (this.stepId() === 'review' && index > this.highestReviewedDocumentIndex())
    ) {
      return;
    }
    this.activeDocumentIndex.set(index);
    this.selectedFieldId.set(this.fields()[0]?.id ?? null);
    this.documentZoom.set(100);
    this.highestReviewedDocumentIndex.update((current) => Math.max(current, index));
    this.actionError.set(null);
    void this.loadDocument();
  }

  private moveDocument(delta: -1 | 1): void {
    const next = Math.min(
      Math.max(this.activeDocumentIndex() + delta, 0),
      Math.max(this.signingDocuments().length - 1, 0),
    );
    if (next === this.activeDocumentIndex()) {
      return;
    }
    this.activeDocumentIndex.set(next);
    this.selectedFieldId.set(this.fields()[0]?.id ?? null);
    this.documentZoom.set(100);
    this.highestReviewedDocumentIndex.update((current) => Math.max(current, next));
    this.actionError.set(null);
    void this.loadDocument();
  }

  private goToStep(index: number): void {
    const steps = this.steps();
    const clamped = Math.min(Math.max(index, 0), steps.length - 1);
    this.actionError.set(null);
    const nextId = steps[clamped].id;
    this.stepId.set(nextId);
    if (nextId === 'sign') {
      this.activeDocumentIndex.set(0);
      this.selectedFieldId.set(this.fields()[0]?.id ?? null);
    }
    // F5: en cuanto el firmante llega a review/sign ya pasó por consent + PIN + OTP si tocaban,
    // así que el endpoint /document ya no responderá 403. Se dispara una sola vez (loadDocument
    // es idempotente: si `pageImages` ya está, retorna).
    if (nextId === 'review' || nextId === 'sign') {
      void this.loadDocument();
    }
  }

  toggleConsent(): void {
    this.consentChecked.update((v) => !v);
  }

  /** Guarda el texto de un campo `Text` (P4) por su `fieldId`. */
  setFieldValue(fieldId: string, value: string): void {
    this.fieldValues.update((current) => ({ ...current, [fieldId]: value }));
  }

  selectField(fieldId: string): void {
    this.selectedFieldId.set(fieldId);
    queueMicrotask(() => this.documentView()?.scrollToField(fieldId));
  }

  adjustDocumentZoom(delta: -25 | 25): void {
    this.documentZoom.update((current) => Math.min(150, Math.max(75, current + delta)));
  }

  retryDocument(): void {
    if (this.loadingDocument()) {
      return;
    }
    const documentId = this.activeDocument()?.documentId;
    if (documentId) {
      this.pageImagesByDocument.delete(documentId);
      this.pageAspectRatiosByDocument.delete(documentId);
    }
    void this.loadDocument();
  }

  fieldLabel(field: PublicSignerFieldView): string {
    return field.label?.trim() || FIELD_KIND_LABEL[field.kind];
  }

  fieldMeta(field: PublicSignerFieldView): string {
    return `Page ${field.page} - ${FIELD_KIND_LABEL[field.kind]}`;
  }

  fieldStatus(field: PublicSignerFieldView): string {
    if (field.kind === 'Date') {
      return 'Automatic';
    }
    return this.isFieldReady(field) ? 'Ready' : field.isRequired ? 'Required' : 'Optional';
  }

  isFieldReady(field: PublicSignerFieldView): boolean {
    if (field.kind === 'Text') {
      return (this.fieldValues()[field.id]?.trim().length ?? 0) > 0 || !field.isRequired;
    }
    if (field.kind === 'Date') {
      return true;
    }
    return this.pad()?.canSave() ?? false;
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
    await this.run('Checking your PIN…', () =>
      firstValueFrom(this.api.verifyPin(this.token, this.pin().trim())),
    );
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
    const ok = await this.run('Sending your code…', () =>
      firstValueFrom(this.api.issueChallenge(this.token, method)),
    );
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
   * Captura del pad → firma. Dos llamadas encadenadas: primero se sube el PNG de la firma
   * (`POST /signature-image`, endpoint anónimo por token que devuelve el `fileId`) y luego
   * se firma (`POST /sign`) referenciando ese archivo. El método del pad mapea al del backend:
   * draw→Drawn, upload→Uploaded, type→Typed (rasterizado como imagen; además exige que el
   * texto coincida con el nombre legal, que es lo que valida `SubmitSignatureHandler`).
   */
  private async submitSignature(): Promise<void> {
    const ctx = this.context();
    const pad = this.pad();
    if (!ctx || !pad) {
      return;
    }

    const dataUrl = pad.getDataUrl();
    if (!dataUrl) {
      this.actionError.set('Add your signature first.');
      return;
    }

    const padMethod = pad.method();
    const method: SignatureCaptureMethod =
      padMethod === 'draw' ? 'Drawn' : padMethod === 'upload' ? 'Uploaded' : 'Typed';
    const typedName = padMethod === 'type' ? pad.typedText().trim() : null;
    if (
      method === 'Typed' &&
      (!typedName || !matchesSignerFullName(typedName, ctx.signerFullName))
    ) {
      this.actionError.set('Type your full name exactly as it appears on the document.');
      return;
    }

    const documentIds = this.signingDocuments().map((document) => document.documentId);
    const fieldValues = this.allTextFields().map((f) => ({
      fieldId: f.id,
      value: this.fieldValues()[f.id]?.trim() || null,
    }));

    const ok = await this.run('Applying your signature…', async () => {
      const image = await dataUrlToTrimmedPngBlob(dataUrl);
      const { fileId } = await firstValueFrom(this.api.attachSignatureImage(this.token, image));
      await firstValueFrom(
        this.api.sign(this.token, {
          method,
          typedName,
          signatureImageFileId: fileId,
          fieldValues,
          documentIds,
        }),
      );
    });
    if (!ok) {
      return;
    }
    // La página expira: se marca el enlace como usado (recargar muestra "expired") y NO se
    // redirige a la raíz del host, que para un firmante externo es el login del staff.
    this.signedAtLocal.set(new Date().toISOString());
    this.justSigned.set(true);
    this.stepId.set('done');
    this.startDoneCountdown();
    await markLinkUsed(this.token, 'signed');
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
    await markLinkUsed(this.token, 'declined');
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

/**
 * Deriva el subdominio del tenant del hostname cuando el backend NO lo pobla en el context
 * (tenants viejos pre-F1.C sin `SubDomain` en `TenantBrandingRef`). Requiere 3+ segmentos
 * (`sub.domain.tld`), descarta `www`, y el host nunca es una IP ni localhost (`.` del
 * dominio ya se exigió aguas arriba). Devuelve '' si no se puede inferir con confianza.
 */
function inferSubdomainFromParts(parts: readonly string[]): string {
  if (parts.length < 3) return '';
  const first = parts[0]?.trim().toLowerCase() ?? '';
  if (!first || first === 'www') return '';
  return first;
}

function formatDate(iso: string): string {
  return parseUtcDate(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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

/**
 * Normaliza cualquier data-URL de firma (dibujada, tecleada-rasterizada o una imagen subida
 * en otro formato) a un PNG recortado a su contenido visible. Recortar el margen vacío evita
 * que el motor de sellado ajuste una firma diminuta dentro de un lienzo mayormente vacío. Si no
 * se detecta contenido (o el navegador no deja leer el píxel), cae al PNG completo sin romper.
 */
async function dataUrlToTrimmedPngBlob(dataUrl: string): Promise<Blob> {
  const image = await loadImage(dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) {
    return blobFromCanvas(source);
  }
  sourceCtx.drawImage(image, 0, 0, width, height);

  const bounds = inkBounds(sourceCtx, width, height);
  if (!bounds) {
    return blobFromCanvas(source);
  }

  // Pequeño margen para que el trazo no quede pegado al borde del recorte.
  const padding = 8;
  const cropX = Math.max(0, bounds.minX - padding);
  const cropY = Math.max(0, bounds.minY - padding);
  const cropW = Math.min(width, bounds.maxX + padding) - cropX;
  const cropH = Math.min(height, bounds.maxY + padding) - cropY;

  const trimmed = document.createElement('canvas');
  trimmed.width = cropW;
  trimmed.height = cropH;
  trimmed.getContext('2d')?.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return blobFromCanvas(trimmed);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The signature image could not be read.'));
    img.src = src;
  });
}

/**
 * Caja delimitadora de la "tinta": píxeles visibles que no son (casi) blancos. El pad
 * entrega la firma aplanada sobre blanco opaco (PdfSharp pinta el alfa como negro), así
 * que recortar solo por transparencia no recortaba nada. Null si no hay tinta o no es legible.
 */
function inkBounds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const visible = data[i + 3] > 8;
      const nearWhite = data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240;
      if (visible && !nearWhite) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return found ? { minX, minY, maxX: maxX + 1, maxY: maxY + 1 } : null;
}

function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('The signature image could not be encoded.')),
      'image/png',
    );
  });
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
    case 'Signature.Image.NotPng':
    case 'Signature.Image.BadDimensions':
    case 'Signature.Image.Empty':
      return 'That signature image is not valid. Draw again, or upload a clear PNG or photo.';
    case 'Signature.Image.TooLarge':
      return 'That image is too large. Please use a smaller signature image.';
    case 'Signature.FieldValue.RequiredMissing':
      return 'Please fill in every required field before signing.';
    case 'Signature.FieldValue.Length':
      return 'One of your entries is too long. Please shorten it.';
    case 'Signature.FieldValue.NotText':
    case 'Signature.FieldValue.FieldMissing':
    case 'Signature.FieldValue.Duplicate':
      return 'We could not save one of your entries. Please review the fields and try again.';
    case 'Network.Unreachable':
      return 'We could not reach the server. Check your connection and try again.';
    default:
      return error.message || 'Something went wrong. Please try again.';
  }
}
