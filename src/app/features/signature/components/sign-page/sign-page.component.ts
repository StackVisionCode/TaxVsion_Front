import { Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SignatureLinkService, SigningContext } from '../../data-access/signature-link.service';
import { VerificationChannel } from '../../ui/signature-request-panel/signature-wizard.model';
import { ALL_CHANNELS, CHANNEL_META } from '../../ui/signature-request-panel/signature-wizard.mock';
import { RenderedPage, blankPages, renderPdfPages } from '../../utils/pdf-render.util';
import { SignaturePadComponent } from '../../../../shared/ui/signature-pad/signature-pad.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';

const RESEND_SECONDS = 28;
const OTP_LENGTH = 6;

/**
 * Recorrido público del firmante (/sign/:token), adaptado de la propuesta UX
 * (6 pasos guiados, mobile-first) a la plantilla visual de la casa. Pasos:
 * Welcome → Consent (gate) → Code (canal + OTP, gate) → Review (documento +
 * target pulsante) → Sign (pad compartido, gate) → Done (certificado), con
 * rechazo (modal con motivo) y overlay de procesamiento. Todo simulado en el
 * navegador: el token se resuelve en SignatureLinkService (fallback demo).
 */
@Component({
  selector: 'app-sign-page',
  imports: [CommonModule, FormsModule, SignaturePadComponent, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sign-page.component.html',
  styleUrl: './sign-page.component.css',
})
export class SignPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly linkService = inject(SignatureLinkService);

  readonly channelMeta = CHANNEL_META;

  readonly context = signal<SigningContext | null>(null);

  readonly step = signal(1);
  readonly rejected = signal(false);
  readonly stepCaptions = ['Start', 'Consent', 'Code', 'Review', 'Sign', 'Done'];
  readonly steps = [1, 2, 3, 4, 5, 6];
  /** Texto-acción del botón principal por paso (propuesta: el botón dice la acción). */
  private readonly nextLabels = [
    'Continue',
    'Accept and continue',
    'Verify and open document',
    'Go to sign',
    'Apply my signature',
    '',
  ];

  // Paso 2 — consentimiento
  readonly consentChecked = signal(false);

  // Paso 3 — canal + OTP
  readonly channel = signal<VerificationChannel>('email');
  readonly otpDigits = signal<string[]>(Array.from({ length: OTP_LENGTH }, () => ''));
  readonly otpComplete = computed(() => this.otpDigits().every(d => d.length === 1));
  readonly resendSeconds = signal(0);
  private resendTimer: ReturnType<typeof setInterval> | null = null;

  // Paso 4 — revisión del documento
  readonly pages = signal<RenderedPage[]>([]);
  readonly pageIndex = signal(0);
  readonly loadingDoc = signal(false);

  // Paso 5 — firma
  readonly signedDataUrl = signal<string | null>(null);

  // Procesamiento (5 → 6)
  readonly processing = signal(false);
  readonly procStep = signal(1);

  // Paso 6 — certificado
  readonly certTime = signal('');
  readonly certHash = signal('');

  // Rechazo
  readonly isRejectOpen = signal(false);
  readonly rejectReason = signal('');
  readonly rejectReasonEcho = signal('');

  readonly firstName = computed(() => this.context()?.signer.name.split(' ')[0] ?? '');

  /** Canales que ofrece la solicitud (reglas del preparador; fallback: todos). */
  readonly availableChannels = computed<VerificationChannel[]>(
    () => this.context()?.request.rules?.channels ?? ALL_CHANNELS,
  );

  /** Otros firmantes que siguen pendientes (nota del paso 6). */
  readonly pendingOthers = computed(() => {
    const ctx = this.context();
    if (!ctx) {
      return [];
    }
    return ctx.request.signers.filter(s => s.email !== ctx.signer.email && s.status === 'pending');
  });

  readonly nextLabel = computed(() => this.nextLabels[this.step() - 1]);

  readonly canProceed = computed(() => {
    switch (this.step()) {
      case 2:
        return this.consentChecked();
      case 3:
        return this.otpComplete();
      case 5:
        return this.signedDataUrl() !== null;
      default:
        return true;
    }
  });

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token') ?? 'demo';
    const ctx = this.linkService.resolve(token);
    this.context.set(ctx);
    const channels = this.availableChannels();
    const preferred = ctx.signer.channel;
    this.channel.set(preferred && channels.includes(preferred) ? preferred : channels[0]);
    void this.loadDocument();
  }

  ngOnDestroy(): void {
    this.clearResendTimer();
  }

  // ---------- navegación ----------

  next(): void {
    if (!this.canProceed() || this.processing()) {
      return;
    }
    if (this.step() === 5) {
      this.startProcessing();
      return;
    }
    if (this.step() < 6) {
      this.step.update(s => s + 1);
      this.onStepEntered();
    }
  }

  back(): void {
    if (this.step() > 1) {
      this.step.update(s => s - 1);
    }
  }

  private onStepEntered(): void {
    if (this.step() === 3 && this.resendSeconds() === 0) {
      this.startResendCountdown();
    }
  }

  // ---------- consentimiento ----------

  toggleConsent(): void {
    this.consentChecked.update(v => !v);
  }

  // ---------- canal + OTP ----------

  selectChannel(channel: VerificationChannel): void {
    this.channel.set(channel);
  }

  /** Destino enmascarado por canal (mock, como en la propuesta). */
  maskedTarget(): string {
    const email = this.context()?.signer.email ?? '';
    switch (this.channel()) {
      case 'email': {
        const [user, domain] = email.split('@');
        const visible = user.slice(0, 1);
        return `${visible}•••${user.slice(-1)}@${domain}`;
      }
      case 'sms':
      case 'whatsapp':
        return '+1 (•••) •••-2481';
      case 'app':
        return 'Authenticator app';
    }
  }

  onOtpInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/[^0-9]/g, '').slice(-1);
    input.value = value;
    this.otpDigits.update(digits => digits.map((d, i) => (i === index ? value : d)));
    if (value && index < OTP_LENGTH - 1) {
      const next = input.parentElement?.children.item(index + 1) as HTMLInputElement | null;
      next?.focus();
    }
  }

  onOtpKeydown(index: number, event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Backspace' && !input.value && index > 0) {
      const prev = input.parentElement?.children.item(index - 1) as HTMLInputElement | null;
      prev?.focus();
    }
  }

  resendCode(): void {
    if (this.resendSeconds() > 0) {
      return;
    }
    this.startResendCountdown();
  }

  private startResendCountdown(): void {
    this.clearResendTimer();
    this.resendSeconds.set(RESEND_SECONDS);
    this.resendTimer = setInterval(() => {
      this.resendSeconds.update(s => {
        if (s <= 1) {
          this.clearResendTimer();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  private clearResendTimer(): void {
    if (this.resendTimer) {
      clearInterval(this.resendTimer);
      this.resendTimer = null;
    }
  }

  // ---------- revisión ----------

  currentPage(): RenderedPage | null {
    return this.pages()[this.pageIndex()] ?? null;
  }

  prevPage(): void {
    this.pageIndex.update(i => Math.max(0, i - 1));
  }

  nextPage(): void {
    this.pageIndex.update(i => Math.min(this.pages().length - 1, i + 1));
  }

  todayLabel(): string {
    return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  goToSign(): void {
    this.step.set(5);
  }

  private async loadDocument(): Promise<void> {
    this.loadingDoc.set(true);
    try {
      this.pages.set(await renderPdfPages({ url: '/assets/sample-document.pdf' }, 0.9));
    } catch {
      this.pages.set(blankPages(2, 0.9));
    } finally {
      this.loadingDoc.set(false);
    }
  }

  // ---------- firma ----------

  applySignature(pad: SignaturePadComponent): void {
    const dataUrl = pad.getDataUrl();
    if (!dataUrl) {
      return;
    }
    this.signedDataUrl.set(dataUrl);
    this.startProcessing();
  }

  /** Overlay "Firma capturada → Sellando → Generando certificado" (~2s) y pasa al paso 6. */
  private startProcessing(): void {
    this.processing.set(true);
    this.procStep.set(2);
    setTimeout(() => this.procStep.set(3), 1100);
    setTimeout(() => {
      this.processing.set(false);
      this.stampCertificate();
      this.step.set(6);
    }, 2100);
  }

  private stampCertificate(): void {
    const now = new Date();
    this.certTime.set(
      `${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ` +
        now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    );
    const hex = () => Math.random().toString(16).slice(2, 6);
    this.certHash.set(`${hex()}…${hex()}`);
  }

  readonly toastMessage = signal<string | null>(null);

  downloadToast(kind: 'document' | 'certificate'): void {
    // Mock: sin backend no hay PDF sellado real que descargar; se simula con un toast.
    const message =
      kind === 'document' ? 'Downloading signed document (sealed PDF)…' : 'Downloading signature certificate…';
    this.toastMessage.set(message);
    setTimeout(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set(null);
      }
    }, 2500);
  }

  // ---------- rechazo ----------

  openReject(): void {
    this.rejectReason.set('');
    this.isRejectOpen.set(true);
  }

  closeReject(): void {
    this.isRejectOpen.set(false);
  }

  confirmReject(): void {
    this.rejectReasonEcho.set(this.rejectReason().trim() || 'No reason given');
    this.isRejectOpen.set(false);
    this.rejected.set(true);
  }

  restart(): void {
    this.rejected.set(false);
    this.step.set(1);
    this.consentChecked.set(false);
    this.otpDigits.set(Array.from({ length: OTP_LENGTH }, () => ''));
    this.signedDataUrl.set(null);
    this.pageIndex.set(0);
    this.clearResendTimer();
    this.resendSeconds.set(0);
  }

  goHome(): void {
    void this.router.navigateByUrl('/signature');
  }
}
