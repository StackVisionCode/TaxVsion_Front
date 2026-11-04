import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Injector,
  OnDestroy,
  Output,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClipboardService } from '@shared/services/clipboard.service';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { ProviderLogoComponent } from '../provider-logo/provider-logo.component';
import {
  PaymentConfig,
  PaymentProviderDescriptor,
  STATEMENT_DESCRIPTOR_MAX,
  StatementDescriptorError,
  defaultStatementDescriptor,
  statementDescriptorError,
  webhookUrl,
} from '../../data-access/billing.model';

/** Credenciales genéricas que pide el alta de un proveedor de cobro. */
export interface ProviderCredentials {
  providerCode: string;
  mode: string;
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
  statementDescriptor: string;
  apiBaseUrl: string;
}

/** Claves nuevas de un proveedor ya conectado (reemplazan las guardadas). */
export interface ProviderKeysUpdate {
  providerCode: string;
  secretKey: string;
  webhookSecret: string;
}

/** Edición de la URL de un proveedor ya configurado. */
export interface ProviderUrlEdit {
  providerCode: string;
  apiBaseUrl: string;
}

// El dato del webhook es opcional: cobrar funciona sin él; solo sincroniza reembolsos y disputas.
type RequiredField = 'publishableKey' | 'secretKey' | 'statementDescriptor';
/** Orden del formulario: el foco va al primero que falte. Los ids de los inputs coinciden. */
const REQUIRED_FIELDS: RequiredField[] = ['publishableKey', 'secretKey', 'statementDescriptor'];

const DESCRIPTOR_MESSAGES: Record<StatementDescriptorError, string> = {
  required: 'Enter the name clients will see on their bank statement (5–22 characters).',
  length: 'Use between 5 and 22 characters.',
  characters: 'Remove these characters: < > \\ \' " *',
};

/**
 * Proveedores de cobro del tenant (`/payments-client/config`). Puede haber varios activos: el cliente
 * elige en el checkout.
 *
 * Las tarjetas de proveedor y los campos salen del catálogo del backend (solo proveedores con
 * adaptador): etiquetas, ayuda, webhook y si acepta URL de API. Uno ya conectado sale deshabilitado
 * (la config es única por tenant+proveedor). El alta son tres llamadas encadenadas en el store; los
 * secretos se mandan una vez y el backend no los devuelve nunca más.
 */
@Component({
  selector: 'app-payment-method-form',
  imports: [
    FormsModule,
    ConfirmDialogComponent,
    DropdownMenuComponent,
    MenuItemDirective,
    InfinityLoaderComponent,
    StateBlockComponent,
    StatusPillComponent,
    SwitchComponent,
    ProviderLogoComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './payment-method-form.component.html',
})
export class PaymentMethodFormComponent implements OnDestroy {
  private readonly clipboard = inject(ClipboardService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly configs = input<PaymentConfig[]>([]);
  readonly loading = input(false);
  readonly saving = input(false);
  /** B6 — configurar proveedores es `payment_client.config.manage`; sin él solo se mira. */
  readonly canManage = input(true);
  /** Catálogo de proveedores disponibles. */
  readonly providers = input<PaymentProviderDescriptor[]>([]);
  readonly providersLoading = input(false);
  readonly providersFailed = input(false);
  /** Nombre de la oficina de la sesión: de él sale el statement descriptor inicial. */
  readonly officeName = input<string | null | undefined>(null);
  /** Base pública de la API (la de las llamadas) para armar la URL del webhook. */
  readonly apiBase = input('');
  /** Proveedor cuyo switch está guardando. */
  readonly togglingCode = input<string | null>(null);

  @Output() providerSaveRequested = new EventEmitter<ProviderCredentials>();
  @Output() providerToggleRequested = new EventEmitter<PaymentConfig>();
  @Output() providerDeleteRequested = new EventEmitter<PaymentConfig>();
  @Output() providerKeysSaveRequested = new EventEmitter<ProviderKeysUpdate>();
  @Output() urlSaveRequested = new EventEmitter<ProviderUrlEdit>();
  @Output() providersRetryRequested = new EventEmitter<void>();

  readonly descriptorMax = STATEMENT_DESCRIPTOR_MAX;

  /** Códigos ya conectados: no se pueden volver a crear. */
  readonly connectedCodes = computed(() => new Set(this.configs().map(c => c.providerCode)));
  readonly available = computed(() => this.providers().filter(p => !this.connectedCodes().has(p.code)));
  readonly allConnected = computed(() => this.providers().length > 0 && this.available().length === 0);

  readonly providerCode = signal('');

  /**
   * Proveedor conectado cuyas claves se están rehaciendo (p. ej. falta su webhook): el formulario pide solo
   * la clave secreta y el dato del webhook, porque la clave pública y el nombre ya quedaron guardados.
   */
  readonly updatingCode = signal<string | null>(null);

  /** Proveedor elegido; sin elección válida, el primero libre del catálogo. */
  readonly selected = computed<PaymentProviderDescriptor | null>(() => {
    const updating = this.updatingCode();
    if (updating) {
      return this.descriptorFor(updating);
    }
    const chosen = this.available().find(p => p.code === this.providerCode());
    return chosen ?? this.available()[0] ?? null;
  });

  // Al cambiar de proveedor se vacían las claves (las de uno no sirven para otro) y se vuelven a ocultar.
  private readonly selectedCode = computed(() => this.selected()?.code ?? '');
  readonly publishableKey = linkedSignal({ source: this.selectedCode, computation: () => '' });
  readonly secretKey = linkedSignal({ source: this.selectedCode, computation: () => '' });
  readonly webhookSecret = linkedSignal({ source: this.selectedCode, computation: () => '' });
  readonly apiBaseUrl = linkedSignal({ source: this.selectedCode, computation: () => '' });
  readonly showSecretKey = linkedSignal({ source: this.selectedCode, computation: () => false });
  readonly showWebhookSecret = linkedSignal({ source: this.selectedCode, computation: () => false });
  /** Con configuración automática la guía manual queda plegada; la oficina puede abrirla si prefiere. */
  readonly manualWebhook = linkedSignal({ source: this.selectedCode, computation: () => false });
  readonly autoWebhook = computed(() => !!this.selected()?.webhookAutoSetup && !this.manualWebhook());

  /** Valor inicial desde el nombre de la oficina; editable (si la sesión llega después, se recalcula). */
  readonly statementDescriptor = linkedSignal(() => defaultStatementDescriptor(this.officeName()));
  readonly descriptorTouched = signal(false);
  readonly descriptorLength = computed(() => this.statementDescriptor().trim().length);
  readonly descriptorError = computed(() => statementDescriptorError(this.statementDescriptor()));
  /** El "vacío" se avisa solo tras tocar el campo; el resto, en vivo. */
  readonly descriptorMessage = computed(() => {
    const error = this.descriptorError();
    if (!error || (error === 'required' && !this.descriptorTouched())) {
      return null;
    }
    return DESCRIPTOR_MESSAGES[error];
  });

  readonly webhookUrl = computed(() => webhookUrl(this.apiBase(), this.selected()?.webhookPath));
  readonly webhookEvents = computed(() => this.selected()?.webhookEvents ?? []);
  /** Feedback de los botones Copy: qué se copió (o falló) hace un momento. */
  readonly copied = signal<{ what: 'link' | 'events'; ok: boolean } | null>(null);
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  /** Edición inline de la URL: providerCode en edición + valor tipeado. */
  readonly editingUrlFor = signal<string | null>(null);
  readonly editingUrlValue = signal('');

  /** Proveedor pendiente de confirmar borrado. */
  readonly pendingDelete = signal<PaymentConfig | null>(null);

  /** Se intentó guardar: desde ahí cada campo que falta muestra su error. Se reinicia al cambiar de proveedor. */
  readonly submitted = linkedSignal({ source: this.selectedCode, computation: () => false });

  /** Error de cada campo requerido (aunque todavía no se muestre); null = bien. */
  readonly fieldErrors = computed<Record<RequiredField, string | null>>(() => {
    const provider = this.selected();
    const updating = this.updatingCode() !== null;
    const descriptor = updating ? null : this.descriptorError();
    return {
      publishableKey:
        provider && !updating && !this.publishableKey().trim() ? `Enter your ${provider.publicKeyLabel}.` : null,
      secretKey: provider && !this.secretKey().trim() ? `Enter your ${provider.secretKeyLabel}.` : null,
      statementDescriptor: descriptor ? DESCRIPTOR_MESSAGES[descriptor] : null,
    };
  });

  /** Nombres visibles de lo que falta, para la línea junto al botón. */
  readonly missing = computed(() => {
    const provider = this.selected();
    const errors = this.fieldErrors();
    if (!provider) {
      return [];
    }
    const names: Record<RequiredField, string> = {
      publishableKey: provider.publicKeyLabel,
      secretKey: provider.secretKeyLabel,
      statementDescriptor: 'Name on card statements',
    };
    return REQUIRED_FIELDS.filter(field => errors[field]).map(field => names[field]);
  });

  /** Etiqueta del dato del webhook según el proveedor elegido; dentro de una frase va en minúscula. */
  readonly webhookSecretLabel = computed(() => this.webhookSecretLabelFor(this.selected()?.code));
  readonly webhookSecretLabelInSentence = computed(() => inSentence(this.webhookSecretLabel()));

  /** Error a la vista de un campo de clave: solo tras intentar guardar. */
  shownError(field: Exclude<RequiredField, 'statementDescriptor'>): string | null {
    return this.submitted() ? this.fieldErrors()[field] : null;
  }

  get canSave(): boolean {
    return !this.saving() && this.selected() !== null && this.missing().length === 0;
  }

  selectProvider(code: string): void {
    if (!this.connectedCodes().has(code)) {
      this.providerCode.set(code);
    }
  }

  /** Abre el formulario para volver a pegar las claves de un proveedor conectado. */
  startUpdateKeys(config: PaymentConfig): void {
    this.updatingCode.set(config.providerCode);
    afterNextRender(
      () => {
        const field = this.host.nativeElement.querySelector<HTMLInputElement>('#secretKey');
        field?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        field?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** Vuelve a la configuración automática y suelta lo que se haya pegado a mano. */
  useAutomaticWebhook(): void {
    this.manualWebhook.set(false);
    this.webhookSecret.set('');
    this.showWebhookSecret.set(false);
  }

  cancelUpdateKeys(): void {
    this.updatingCode.set(null);
    this.clearSecrets();
  }

  /** Radiogroup: flechas/Home/End mueven y eligen saltando los ya conectados; el foco sigue a la elección. */
  onProviderKeydown(event: KeyboardEvent, group: HTMLElement): void {
    const list = this.available();
    const current = list.findIndex(p => p.code === this.selected()?.code);
    if (current < 0) {
      return;
    }
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % list.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + list.length) % list.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = list.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const code = list[next].code;
    this.selectProvider(code);
    group.querySelector<HTMLElement>(`[data-provider-option="${code}"]`)?.focus();
  }

  save(): void {
    const provider = this.selected();
    if (!provider || this.saving()) {
      return;
    }
    if (!this.canSave) {
      // Patrón estándar: se marcan los que faltan y el foco va al primero.
      this.submitted.set(true);
      this.descriptorTouched.set(true);
      const errors = this.fieldErrors();
      const first = REQUIRED_FIELDS.find(field => errors[field]);
      if (first) {
        this.host.nativeElement.querySelector<HTMLInputElement>(`#${first}`)?.focus();
      }
      return;
    }
    // Con configuración automática no se manda nada: el backend crea el webhook y guarda su dato.
    const webhookSecret = provider.usesWebhookSecret && !this.autoWebhook() ? this.webhookSecret() : '';
    if (this.updatingCode()) {
      this.providerKeysSaveRequested.emit({ providerCode: provider.code, secretKey: this.secretKey(), webhookSecret });
      return;
    }
    this.providerSaveRequested.emit({
      providerCode: provider.code,
      mode: 'DirectApiKeys',
      publishableKey: this.publishableKey(),
      secretKey: this.secretKey(),
      // Solo se manda lo que el proveedor usa.
      webhookSecret,
      statementDescriptor: this.statementDescriptor(),
      apiBaseUrl: provider.acceptsApiBaseUrl ? this.apiBaseUrl() : '',
    });
  }

  /** Tras un alta correcta: fuera claves y secretos de la vista (el proveedor pasa a "Connected"). */
  resetAfterSave(): void {
    this.submitted.set(false);
    this.updatingCode.set(null);
    this.providerCode.set('');
    this.publishableKey.set('');
    this.apiBaseUrl.set('');
    this.clearSecrets();
  }

  clearSecrets(): void {
    this.secretKey.set('');
    this.webhookSecret.set('');
    this.showSecretKey.set(false);
    this.showWebhookSecret.set(false);
  }

  /** Copia el enlace del webhook o la lista de eventos (separados por comas); no se muestran en pantalla. */
  async copy(what: 'link' | 'events'): Promise<void> {
    const text = what === 'link' ? this.webhookUrl() : this.webhookEvents().join(', ');
    if (!text) {
      return;
    }
    const ok = await this.clipboard.copy(text);
    this.copied.set({ what, ok });
    if (this.copyTimer) {
      clearTimeout(this.copyTimer);
    }
    this.copyTimer = setTimeout(() => this.copied.set(null), 2000);
  }

  copyLabel(what: 'link' | 'events', idle: string): string {
    const state = this.copied();
    if (state?.what !== what) {
      return idle;
    }
    return state.ok ? 'Copied' : "Couldn't copy";
  }

  descriptorFor(code: string): PaymentProviderDescriptor | null {
    return this.providers().find(p => p.code === code) ?? null;
  }

  providerName(code: string): string {
    return this.descriptorFor(code)?.displayName ?? code;
  }

  webhookSecretLabelFor(code: string | null | undefined): string {
    return (code && this.descriptorFor(code)?.webhookSecretLabel) || 'Signing secret';
  }

  /** El webhook secret falta solo si el proveedor lo usa y no se está creando solo. */
  webhookSecretMissing(config: PaymentConfig): boolean {
    return (
      config.hasSecretKey &&
      !config.hasWebhookSecret &&
      config.webhookSetup !== 'Pending' &&
      !!this.descriptorFor(config.providerCode)?.usesWebhookSecret
    );
  }

  startEditUrl(config: PaymentConfig): void {
    this.editingUrlFor.set(config.providerCode);
    this.editingUrlValue.set(config.apiBaseUrl ?? '');
    // El ítem del menú desaparece al cerrarse: el foco pasa al campo recién abierto.
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLInputElement>(`[id="editApiBaseUrl-${config.providerCode}"]`)?.focus(),
      { injector: this.injector },
    );
  }

  cancelEditUrl(): void {
    this.editingUrlFor.set(null);
    this.editingUrlValue.set('');
  }

  saveEditUrl(config: PaymentConfig): void {
    this.urlSaveRequested.emit({ providerCode: config.providerCode, apiBaseUrl: this.editingUrlValue() });
    this.cancelEditUrl();
  }

  askDelete(config: PaymentConfig): void {
    this.pendingDelete.set(config);
  }

  confirmDelete(): void {
    const config = this.pendingDelete();
    this.pendingDelete.set(null);
    if (config) {
      this.providerDeleteRequested.emit(config);
    }
  }

  ngOnDestroy(): void {
    if (this.copyTimer) {
      clearTimeout(this.copyTimer);
    }
  }
}

/** "Signing secret" → "signing secret"; respeta siglas ("Webhook ID" → "webhook ID", "API key" queda igual). */
function inSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}
