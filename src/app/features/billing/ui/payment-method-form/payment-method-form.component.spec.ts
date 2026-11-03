import { vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClipboardService } from '@shared/services/clipboard.service';
import { PaymentConfig, PaymentProviderDescriptor } from '../../data-access/billing.model';
import { PaymentMethodFormComponent, ProviderCredentials } from './payment-method-form.component';

// Forma del catálogo de PaymentClient (los campos de ayuda/webhook son opcionales).
const STRIPE: PaymentProviderDescriptor = {
  code: 'Stripe',
  displayName: 'Stripe',
  publicKeyLabel: 'Publishable key',
  secretKeyLabel: 'Secret key',
  usesWebhookSecret: true,
  webhookSecretLabel: 'Signing secret',
  acceptsApiBaseUrl: false,
  credentialsHelpUrl: 'https://dashboard.stripe.com/apikeys',
  webhookEvents: ['payment_intent.succeeded', 'charge.refunded'],
  webhookPath: '/payments-client/webhooks/t1/stripe',
};

const PAYPAL: PaymentProviderDescriptor = {
  code: 'PayPal',
  displayName: 'PayPal',
  publicKeyLabel: 'Client ID',
  secretKeyLabel: 'Client secret',
  usesWebhookSecret: true,
  webhookSecretLabel: 'Webhook ID',
  acceptsApiBaseUrl: true,
  apiBaseUrlHelp: 'Use https://api-m.sandbox.paypal.com for sandbox. Leave empty for live.',
  apiBaseUrlPlaceholder: 'https://api-m.sandbox.paypal.com',
  webhookEvents: ['PAYMENT.CAPTURE.REFUNDED', 'CUSTOMER.DISPUTE.CREATED'],
  webhookPath: '/payments-client/webhooks/t1/paypal',
};

const SQUARE: PaymentProviderDescriptor = {
  code: 'Square',
  displayName: 'Square',
  publicKeyLabel: 'Application ID',
  secretKeyLabel: 'Access token',
  usesWebhookSecret: false,
  acceptsApiBaseUrl: false,
};

function config(overrides: Partial<PaymentConfig>): PaymentConfig {
  return {
    id: overrides.providerCode ?? 'id',
    providerCode: 'Stripe',
    mode: 'DirectApiKeys',
    publishableKey: 'pk',
    hasSecretKey: true,
    hasWebhookSecret: true,
    statementDescriptor: 'OFFICE',
    isActive: true,
    apiBaseUrl: null,
    ...overrides,
  };
}

interface CreateOptions {
  configs?: PaymentConfig[];
  providersLoading?: boolean;
  providersFailed?: boolean;
  canManage?: boolean;
  officeName?: string | null;
  apiBase?: string;
}

describe('PaymentMethodFormComponent', () => {
  let fixture: ComponentFixture<PaymentMethodFormComponent>;
  let host: HTMLElement;
  let clipboard: { copy: ReturnType<typeof vi.fn> };

  function create(providers: PaymentProviderDescriptor[] = [STRIPE, PAYPAL], extra: CreateOptions = {}) {
    clipboard = { copy: vi.fn(() => Promise.resolve(true)) };
    TestBed.configureTestingModule({
      imports: [PaymentMethodFormComponent],
      providers: [{ provide: ClipboardService, useValue: clipboard }],
    });
    fixture = TestBed.createComponent(PaymentMethodFormComponent);
    fixture.componentRef.setInput('providers', providers);
    fixture.componentRef.setInput('configs', extra.configs ?? []);
    fixture.componentRef.setInput('providersLoading', extra.providersLoading ?? false);
    fixture.componentRef.setInput('providersFailed', extra.providersFailed ?? false);
    fixture.componentRef.setInput('canManage', extra.canManage ?? true);
    fixture.componentRef.setInput('officeName', extra.officeName === undefined ? 'Acme Tax Group' : extra.officeName);
    fixture.componentRef.setInput('apiBase', extra.apiBase ?? 'https://acme.taxoffix.io');
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  }

  function input(id: string): HTMLInputElement | null {
    return host.querySelector<HTMLInputElement>(`#${id}`);
  }

  function label(forId: string): string {
    return host.querySelector(`label[for="${forId}"]`)?.textContent?.trim() ?? '';
  }

  function radio(code: string): HTMLButtonElement {
    return host.querySelector<HTMLButtonElement>(`[role="radio"][data-provider-option="${code}"]`)!;
  }

  function chooseProvider(code: string) {
    radio(code).click();
    fixture.detectChanges();
  }

  function type(id: string, value: string) {
    const el = input(id)!;
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  // ngModel escribe el valor del <input> de forma asíncrona.
  async function settle() {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function key(target: HTMLElement, k: string) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
  });

  // ---------- Proveedores para conectar ----------

  it('las tarjetas de proveedor salen del catálogo, como radiogroup', () => {
    create();

    expect(host.querySelector('[role="radiogroup"]')?.getAttribute('aria-labelledby')).toBe('provider-choice-label');
    const radios = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios.map(r => r.dataset['providerOption'])).toEqual(['Stripe', 'PayPal']);
    expect(radios.map(r => r.textContent?.trim())).toEqual(['Stripe', 'PayPal']);
    expect(host.querySelector('select')).toBeNull();
    // El primero queda elegido y es el único tabulable (roving tabindex).
    expect(radio('Stripe').getAttribute('aria-checked')).toBe('true');
    expect(radio('Stripe').getAttribute('tabindex')).toBe('0');
    expect(radio('PayPal').getAttribute('aria-checked')).toBe('false');
    expect(radio('PayPal').getAttribute('tabindex')).toBe('-1');
  });

  it('flechas, Home y End mueven la elección y el foco, saltando los conectados', () => {
    create([STRIPE, PAYPAL, SQUARE], { configs: [config({ providerCode: 'PayPal' })] });
    const group = host.querySelector<HTMLElement>('[role="radiogroup"]')!;

    radio('Stripe').focus();
    key(radio('Stripe'), 'ArrowRight');
    expect(fixture.componentInstance.selected()?.code).toBe('Square');
    expect(radio('Square').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio('Square'));

    key(group, 'ArrowDown');
    expect(fixture.componentInstance.selected()?.code).toBe('Stripe');

    key(group, 'ArrowLeft');
    expect(fixture.componentInstance.selected()?.code).toBe('Square');

    key(group, 'Home');
    expect(fixture.componentInstance.selected()?.code).toBe('Stripe');
    key(group, 'End');
    expect(fixture.componentInstance.selected()?.code).toBe('Square');
  });

  it('un proveedor ya conectado sale deshabilitado con "Connected" y se elige el siguiente libre', () => {
    create([STRIPE, PAYPAL], { configs: [config({ providerCode: 'Stripe' })] });

    expect(radio('Stripe').disabled).toBe(true);
    expect(radio('Stripe').textContent).toContain('Connected');
    expect(radio('Stripe').getAttribute('aria-checked')).toBe('false');
    expect(radio('PayPal').getAttribute('aria-checked')).toBe('true');
    expect(label('publishableKey')).toBe('Client ID');

    fixture.componentInstance.selectProvider('Stripe');
    expect(fixture.componentInstance.selected()?.code).toBe('PayPal');
  });

  it('logos de marca (Simple Icons) en tarjetas y lista; monograma para un proveedor sin logo', () => {
    create([STRIPE, PAYPAL, SQUARE], { configs: [config({ providerCode: 'Stripe' })] });

    const fill = (el: Element) => el.querySelector('app-provider-logo svg path')?.getAttribute('fill');
    expect(fill(radio('PayPal'))).toBe('#003087');
    expect(fill(radio('Stripe'))).toBe('#635BFF');
    expect(fill(host.querySelector('[data-provider="Stripe"]')!)).toBe('#635BFF');
    expect(radio('Square').querySelector('app-provider-logo svg')).toBeNull();
    expect(radio('Square').querySelector('app-provider-logo .pf-icon-tile')?.textContent?.trim()).toBe('S');
  });

  it('si todos están conectados lo dice y no muestra campos', () => {
    create([STRIPE, PAYPAL], {
      configs: [config({ providerCode: 'Stripe' }), config({ providerCode: 'PayPal' })],
    });

    expect(host.querySelector('[data-testid="all-connected"]')?.textContent).toContain('already connected');
    expect(input('publishableKey')).toBeNull();
    expect(host.querySelector('[data-testid="save-provider"]')).toBeNull();
  });

  it('Stripe: Publishable key / Secret key / Webhook secret, sin URL', () => {
    create();

    expect(label('publishableKey')).toBe('Publishable key');
    expect(label('secretKey')).toBe('Secret key');
    expect(input('webhookSecret')).not.toBeNull();
    expect(input('apiBaseUrl')).toBeNull();
  });

  it('PayPal: Client ID / Client secret, Webhook ID con su guía, con URL y la ayuda del catálogo', () => {
    create();
    chooseProvider('PayPal');

    expect(label('publishableKey')).toBe('Client ID');
    expect(label('secretKey')).toBe('Client secret');
    expect(label('webhookSecret')).toBe('Webhook ID (optional)');
    const setup = host.querySelector('[data-testid="webhook-setup"]')!;
    expect(setup.textContent).toContain('refunds and disputes made in PayPal');
    expect(setup.textContent).toContain('Paste the webhook ID PayPal shows you below.');
    expect(host.querySelector('[data-reveal="webhookSecret"]')?.getAttribute('aria-label')).toBe('Show webhook ID');
    expect(input('apiBaseUrl')?.getAttribute('placeholder')).toBe(PAYPAL.apiBaseUrlPlaceholder);
    expect(label('apiBaseUrl')).toBe('PayPal environment');
    expect(host.querySelector('#apiBaseUrlHelp')?.textContent).toContain('Leave empty for live payments');
  });

  it('el enlace de ayuda abre la página del catálogo en otra pestaña (y no sale si no viene)', () => {
    create();
    const link = host.querySelector<HTMLAnchorElement>('[data-testid="credentials-help"]')!;
    expect(link.textContent).toContain('Where do I find these?');
    expect(link.getAttribute('href')).toBe(STRIPE.credentialsHelpUrl);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');

    chooseProvider('PayPal');
    expect(host.querySelector('[data-testid="credentials-help"]')).toBeNull();
  });

  it('guía del webhook: botones Copy para el enlace y los eventos, sin mostrarlos', async () => {
    create();
    const setup = host.querySelector('[data-testid="webhook-setup"]')!;
    const url = 'https://acme.taxoffix.io/payments-client/webhooks/t1/stripe';

    expect(setup.textContent).toContain('Sync refunds and disputes');
    expect(setup.querySelector('[data-testid="webhook-optional"]')?.textContent?.trim()).toBe('Recommended');
    expect(setup.textContent).toContain('open the webhook settings');
    expect(setup.textContent).toContain('Paste the signing secret Stripe shows you below.');
    expect(setup.querySelectorAll('ol > li').length).toBe(4);
    // Nada técnico a la vista: ni la URL, ni el id de la oficina, ni los eventos.
    expect(setup.textContent).not.toContain(url);
    expect(setup.textContent).not.toContain('t1');
    expect(setup.textContent).not.toContain('payment_intent.succeeded');
    expect(label('webhookSecret')).toBe('Signing secret (optional)');

    const link = host.querySelector<HTMLButtonElement>('[data-testid="copy-webhook-link"]')!;
    const events = host.querySelector<HTMLButtonElement>('[data-testid="copy-webhook-events"]')!;
    expect(link.textContent?.trim()).toBe('Copy webhook link');
    expect(events.textContent?.trim()).toBe('Copy events');

    await fixture.componentInstance.copy('link');
    fixture.detectChanges();
    expect(clipboard.copy).toHaveBeenLastCalledWith(url);
    expect(link.textContent?.trim()).toBe('Copied');
    expect(events.textContent?.trim()).toBe('Copy events');
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain('Webhook link copied');

    await fixture.componentInstance.copy('events');
    fixture.detectChanges();
    expect(clipboard.copy).toHaveBeenLastCalledWith('payment_intent.succeeded, charge.refunded');
    expect(events.textContent?.trim()).toBe('Copied');
    expect(link.textContent?.trim()).toBe('Copy webhook link');
  });

  it('si el portapapeles falla lo dice', async () => {
    create();
    clipboard.copy.mockResolvedValue(false);
    await fixture.componentInstance.copy('link');
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="copy-webhook-link"]')?.textContent?.trim()).toBe("Couldn't copy");
  });

  it('webhook sin ruta ni eventos en el catálogo: sin botones Copy, pero con el campo del secreto', () => {
    create([{ ...STRIPE, webhookPath: null, webhookEvents: [] }]);

    expect(host.querySelector('[data-testid="webhook-setup"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="copy-webhook-link"]')).toBeNull();
    expect(host.querySelector('[data-testid="copy-webhook-events"]')).toBeNull();
    expect(input('webhookSecret')).not.toBeNull();
  });

  it('los secretos se muestran y ocultan con un botón aria-pressed', () => {
    create();
    const toggle = host.querySelector<HTMLButtonElement>('[data-reveal="secretKey"]')!;
    expect(input('secretKey')?.type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Show Secret key');

    toggle.click();
    fixture.detectChanges();
    expect(input('secretKey')?.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    host.querySelector<HTMLButtonElement>('[data-reveal="webhookSecret"]')!.click();
    fixture.detectChanges();
    expect(input('webhookSecret')?.type).toBe('text');
  });

  it('Stripe se puede guardar sin webhook secret (es opcional)', () => {
    create();
    type('publishableKey', 'pk_test');
    expect(fixture.componentInstance.canSave).toBe(false);

    type('secretKey', 'sk_test');
    expect(fixture.componentInstance.canSave).toBe(true);
  });

  it('PayPal guarda con el Webhook ID y manda la URL', () => {
    create();
    const emitted: ProviderCredentials[] = [];
    fixture.componentInstance.providerSaveRequested.subscribe(c => emitted.push(c));

    chooseProvider('PayPal');
    type('publishableKey', 'client-id');
    type('secretKey', 'client-secret');
    type('webhookSecret', 'WH-123');
    type('apiBaseUrl', 'https://api-m.sandbox.paypal.com');
    host.querySelector<HTMLButtonElement>('[data-testid="save-provider"]')!.click();

    expect(emitted).toEqual([
      {
        providerCode: 'PayPal',
        mode: 'DirectApiKeys',
        publishableKey: 'client-id',
        secretKey: 'client-secret',
        webhookSecret: 'WH-123',
        statementDescriptor: 'Acme Tax Group',
        apiBaseUrl: 'https://api-m.sandbox.paypal.com',
      },
    ]);
  });

  it('un proveedor sin webhook no muestra la guía y guarda sin webhook secret', () => {
    create([STRIPE, SQUARE]);
    const emitted: ProviderCredentials[] = [];
    fixture.componentInstance.providerSaveRequested.subscribe(c => emitted.push(c));

    chooseProvider('Square');
    expect(input('webhookSecret')).toBeNull();
    expect(host.querySelector('[data-testid="webhook-setup"]')).toBeNull();
    type('publishableKey', 'app-id');
    type('secretKey', 'token');
    host.querySelector<HTMLButtonElement>('[data-testid="save-provider"]')!.click();

    expect(emitted.map(c => c.webhookSecret)).toEqual(['']);
  });

  it('al cambiar de proveedor se vacían las claves tipeadas', async () => {
    create();
    type('publishableKey', 'pk_test');
    type('secretKey', 'sk_test');

    chooseProvider('PayPal');

    expect(fixture.componentInstance.publishableKey()).toBe('');
    expect(fixture.componentInstance.secretKey()).toBe('');
    await settle();
    expect(input('publishableKey')?.value).toBe('');
  });

  it('tras guardar, resetAfterSave limpia claves y secretos', () => {
    create();
    type('publishableKey', 'pk_test');
    type('secretKey', 'sk_test');
    type('webhookSecret', 'whsec_test');

    fixture.componentInstance.resetAfterSave();

    expect(fixture.componentInstance.publishableKey()).toBe('');
    expect(fixture.componentInstance.secretKey()).toBe('');
    expect(fixture.componentInstance.webhookSecret()).toBe('');
  });

  it('los campos de credenciales no aceptan el autocompletado del login', () => {
    create();
    expect(input('publishableKey')?.getAttribute('autocomplete')).toBe('off');
    expect(input('publishableKey')?.getAttribute('name')).toBe('providerPublicKey');
    expect(input('secretKey')?.getAttribute('autocomplete')).toBe('new-password');
    expect(input('secretKey')?.getAttribute('name')).toBe('providerSecretKey');
    expect(input('webhookSecret')?.getAttribute('autocomplete')).toBe('new-password');
    expect(input('webhookSecret')?.getAttribute('name')).toBe('providerWebhookSecret');
    expect(input('statementDescriptor')?.getAttribute('autocomplete')).toBe('off');
    expect(input('statementDescriptor')?.getAttribute('name')).toBe('providerStatementDescriptor');

    chooseProvider('PayPal');
    expect(input('apiBaseUrl')?.getAttribute('autocomplete')).toBe('off');
    expect(input('apiBaseUrl')?.getAttribute('name')).toBe('providerApiBaseUrl');
  });

  // ---------- Statement descriptor ----------

  it('el descriptor inicial sale del nombre de la oficina: sin caracteres prohibidos y recortado a 22', async () => {
    create([STRIPE], { officeName: 'Acme "Tax" <Services> & Accounting Group LLC' });
    await settle();

    expect(label('statementDescriptor')).toBe('Name on card statements');
    expect(input('statementDescriptor')?.value).toBe('Acme Tax Services & Ac');
    expect(host.querySelector('[data-testid="descriptor-count"]')?.textContent?.trim()).toBe('22/22');
    expect(fixture.componentInstance.descriptorError()).toBeNull();
  });

  it('nombre de oficina corto (o sin sesión): campo vacío, nunca la marca vieja', () => {
    create([STRIPE], { officeName: 'A*B' });
    expect(fixture.componentInstance.statementDescriptor()).toBe('');

    TestBed.resetTestingModule();
    create([STRIPE], { officeName: null });
    expect(fixture.componentInstance.statementDescriptor()).toBe('');
    expect(host.textContent).not.toContain('TAXVISION');
  });

  it('valida el descriptor en vivo con el rango del backend (5–22, sin < > \\ \' " *)', () => {
    create();
    type('publishableKey', 'pk');
    type('secretKey', 'sk');
    type('webhookSecret', 'wh');
    expect(fixture.componentInstance.canSave).toBe(true);

    type('statementDescriptor', 'Bad*Name');
    expect(host.querySelector('#statementDescriptorError')?.textContent).toContain('Remove these characters');
    expect(input('statementDescriptor')?.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.componentInstance.canSave).toBe(false);

    type('statementDescriptor', 'Abc');
    expect(host.querySelector('#statementDescriptorError')?.textContent).toContain('between 5 and 22');

    type('statementDescriptor', 'A'.repeat(23));
    expect(host.querySelector('[data-testid="descriptor-count"]')?.textContent?.trim()).toBe('23/22');
    expect(fixture.componentInstance.canSave).toBe(false);

    type('statementDescriptor', 'Acme Tax');
    expect(host.querySelector('#statementDescriptorError')).toBeNull();
    expect(input('statementDescriptor')?.getAttribute('aria-invalid')).toBeNull();
    expect(fixture.componentInstance.canSave).toBe(true);
  });

  it('el descriptor vacío solo avisa después de tocar el campo', () => {
    create([STRIPE], { officeName: null });
    expect(host.querySelector('#statementDescriptorError')).toBeNull();

    input('statementDescriptor')!.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(host.querySelector('#statementDescriptorError')?.textContent).toContain('5–22');
  });

  // ---------- Guardar con datos incompletos ----------

  function save() {
    host.querySelector<HTMLButtonElement>('[data-testid="save-provider"]')!.click();
    fixture.detectChanges();
  }

  it('Stripe sin signing secret se guarda igual (es opcional) y manda el secreto vacío', () => {
    create();
    const emitted: ProviderCredentials[] = [];
    fixture.componentInstance.providerSaveRequested.subscribe(c => emitted.push(c));
    type('publishableKey', 'pk_test');
    type('secretKey', 'sk_test');

    expect(host.querySelector('[data-testid="provider-missing"]')).toBeNull();
    expect(input('webhookSecret')?.getAttribute('aria-describedby')).toBe('webhookSecretHelp');

    save();

    expect(emitted.map(c => c.webhookSecret)).toEqual(['']);
    expect(host.querySelector('#webhookSecretError')).toBeNull();
  });

  it('Stripe con signing secret lo manda', () => {
    create();
    const emitted: ProviderCredentials[] = [];
    fixture.componentInstance.providerSaveRequested.subscribe(c => emitted.push(c));
    type('publishableKey', 'pk_test');
    type('secretKey', 'sk_test');
    type('webhookSecret', 'whsec_test');

    save();

    expect(emitted.map(c => c.webhookSecret)).toEqual(['whsec_test']);
  });

  it('PayPal vacío: marca Client ID, Client secret y el nombre (el Webhook ID es opcional), y enfoca el primero', () => {
    create([STRIPE, PAYPAL], { officeName: null });
    chooseProvider('PayPal');
    const emitted: ProviderCredentials[] = [];
    fixture.componentInstance.providerSaveRequested.subscribe(c => emitted.push(c));

    expect(host.querySelector('[data-testid="provider-missing"]')?.textContent?.trim()).toBe(
      'Missing: Client ID, Client secret, Name on card statements',
    );
    save();

    expect(emitted).toEqual([]);
    expect(host.querySelector('#publishableKeyError')?.textContent?.trim()).toBe('Enter your Client ID.');
    expect(host.querySelector('#secretKeyError')?.textContent?.trim()).toBe('Enter your Client secret.');
    expect(host.querySelector('#statementDescriptorError')?.textContent).toContain('5–22');
    // El Webhook ID es opcional: no se marca como faltante.
    expect(host.querySelector('#webhookSecretError')).toBeNull();
    expect(input('publishableKey')?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input('publishableKey'));

    // Al cambiar de proveedor se vuelve a empezar sin errores.
    chooseProvider('Stripe');
    expect(host.querySelector('#publishableKeyError')).toBeNull();
  });

  it('mientras guarda el botón queda deshabilitado', () => {
    create();
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();
    const button = host.querySelector<HTMLButtonElement>('[data-testid="save-provider"]')!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Connecting');
    expect(host.querySelector('[data-testid="provider-missing"]')).toBeNull();
  });

  // ---------- Proveedores conectados ----------

  it('la lista muestra estado, detalle y avisos de cada proveedor', () => {
    create([STRIPE, PAYPAL], {
      configs: [
        config({ providerCode: 'Stripe', isActive: true, hasWebhookSecret: false }),
        config({ providerCode: 'PayPal', isActive: false, hasWebhookSecret: false, hasSecretKey: false }),
      ],
    });

    const row = (code: string) => host.querySelector(`[data-provider="${code}"]`)!;
    const status = (code: string) => row(code).querySelector('[data-testid="provider-status"]')?.textContent?.trim();
    expect(status('Stripe')).toBe('Active');
    expect(status('PayPal')).toBe('Inactive');

    expect(row('Stripe').querySelector('[data-warning="webhook-secret"]')?.textContent).toContain("Refunds won't sync");
    // Sin clave secreta todavía no se marca el webhook; sí la clave secreta y la URL.
    expect(row('PayPal').querySelector('[data-warning="webhook-secret"]')).toBeNull();
    expect(row('PayPal').querySelector('[data-warning="secret-key"]')?.textContent).toContain('Secret key missing');
    expect(row('PayPal').textContent).toContain('Environment: Live');
    expect(row('Stripe').textContent).not.toContain('Environment');
    expect(row('Stripe').textContent).toContain('OFFICE');
  });

  it('sin proveedores conectados muestra el estado vacío', () => {
    create();
    expect(host.textContent).toContain('No providers connected yet');
  });

  it('el switch activa/desactiva el proveedor y lleva aria-label', () => {
    const stripe = config({ providerCode: 'Stripe', isActive: true });
    create([STRIPE], { configs: [stripe] });
    const toggled: PaymentConfig[] = [];
    fixture.componentInstance.providerToggleRequested.subscribe(c => toggled.push(c));

    const sw = host.querySelector<HTMLButtonElement>('[data-provider="Stripe"] [role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-label')).toBe('Accept payments with Stripe');
    sw.click();
    expect(toggled).toEqual([stripe]);

    fixture.componentRef.setInput('togglingCode', 'Stripe');
    fixture.detectChanges();
    expect(sw.getAttribute('aria-busy')).toBe('true');
  });

  it('sin permiso: switch deshabilitado, sin menú y sin formulario de alta', () => {
    create([STRIPE, PAYPAL], { configs: [config({ providerCode: 'Stripe' })], canManage: false });

    expect(host.querySelector<HTMLButtonElement>('[data-provider="Stripe"] [role="switch"]')!.disabled).toBe(true);
    expect(host.querySelector('[data-provider="Stripe"] app-dropdown-menu')).toBeNull();
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
    expect(host.textContent).toContain('Only someone who manages payment providers');
  });

  it('menú "…": Change environment solo si el proveedor acepta URL, y edita en línea', async () => {
    create([STRIPE, PAYPAL], {
      configs: [config({ providerCode: 'Stripe' }), config({ providerCode: 'PayPal', apiBaseUrl: 'https://old' })],
    });
    const edits: unknown[] = [];
    fixture.componentInstance.urlSaveRequested.subscribe(e => edits.push(e));

    const trigger = (code: string) =>
      host.querySelector<HTMLButtonElement>(`[data-provider="${code}"] app-dropdown-menu button[aria-haspopup="menu"]`)!;

    trigger('Stripe').click();
    fixture.detectChanges();
    expect(trigger('Stripe').getAttribute('aria-label')).toBe('More actions for Stripe');
    expect(document.body.querySelector('[data-action="edit-url"]')).toBeNull();
    expect(document.body.querySelector('[data-action="delete"]')).not.toBeNull();
    trigger('Stripe').click();
    fixture.detectChanges();

    trigger('PayPal').click();
    fixture.detectChanges();
    document.body.querySelector<HTMLButtonElement>('[data-action="edit-url"]')!.click();
    fixture.detectChanges();

    await settle();
    const field = host.querySelector<HTMLInputElement>('[id="editApiBaseUrl-PayPal"]')!;
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('https://old');
    fixture.componentInstance.editingUrlValue.set('https://api-m.sandbox.paypal.com');
    fixture.componentInstance.saveEditUrl(config({ providerCode: 'PayPal' }));
    expect(edits).toEqual([{ providerCode: 'PayPal', apiBaseUrl: 'https://api-m.sandbox.paypal.com' }]);
  });

  it('PayPal con clave pero sin Webhook ID lo avisa con la etiqueta del catálogo', () => {
    create([STRIPE, PAYPAL], { configs: [config({ providerCode: 'PayPal', hasWebhookSecret: false })] });

    const warning = host.querySelector('[data-provider="PayPal"] [data-warning="webhook-secret"]');
    expect(warning?.textContent).toContain("Refunds won't sync");
    expect(warning?.getAttribute('title')).toContain('Add the Webhook ID with Update keys');
  });

  it('menú "…" → Update keys pide solo la clave secreta y el Webhook ID, y los manda', async () => {
    create([STRIPE, PAYPAL], {
      configs: [config({ providerCode: 'Stripe' }), config({ providerCode: 'PayPal', hasWebhookSecret: false })],
    });
    const updates: unknown[] = [];
    const created: unknown[] = [];
    fixture.componentInstance.providerKeysSaveRequested.subscribe(u => updates.push(u));
    fixture.componentInstance.providerSaveRequested.subscribe(c => created.push(c));
    expect(host.querySelector('[data-testid="all-connected"]')).not.toBeNull();

    host.querySelector<HTMLButtonElement>('[data-provider="PayPal"] app-dropdown-menu button[aria-haspopup="menu"]')!.click();
    fixture.detectChanges();
    document.body.querySelector<HTMLButtonElement>('[data-action="update-keys"]')!.click();
    fixture.detectChanges();
    await settle();

    const section = host.querySelector('[data-testid="provider-connect"]')!;
    expect(section.querySelector('h2')?.textContent?.trim()).toBe('Update PayPal keys');
    expect(host.querySelector('[data-testid="all-connected"]')).toBeNull();
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
    expect(input('publishableKey')).toBeNull();
    expect(input('statementDescriptor')).toBeNull();
    expect(input('apiBaseUrl')).toBeNull();
    expect(document.activeElement).toBe(input('secretKey'));
    expect(host.querySelector('[data-testid="provider-missing"]')?.textContent?.trim()).toBe(
      'Missing: Client secret',
    );

    type('secretKey', 'client-secret');
    type('webhookSecret', 'WH-9');
    host.querySelector<HTMLButtonElement>('[data-testid="save-provider"]')!.click();

    expect(updates).toEqual([{ providerCode: 'PayPal', secretKey: 'client-secret', webhookSecret: 'WH-9' }]);
    expect(created).toEqual([]);

    fixture.componentInstance.resetAfterSave();
    fixture.detectChanges();
    expect(section.querySelector('h2')?.textContent?.trim()).toBe('Connect a provider');
  });

  it('Update keys → Cancel vuelve al alta y suelta lo tipeado', () => {
    create([STRIPE, PAYPAL], { configs: [config({ providerCode: 'Stripe' })] });
    fixture.componentInstance.startUpdateKeys(config({ providerCode: 'Stripe' }));
    fixture.detectChanges();
    type('secretKey', 'sk_new');

    host.querySelector<HTMLButtonElement>('[data-testid="cancel-update-keys"]')!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.updatingCode()).toBeNull();
    expect(fixture.componentInstance.secretKey()).toBe('');
    expect(fixture.componentInstance.selected()?.code).toBe('PayPal');
    expect(input('publishableKey')).not.toBeNull();
  });

  it('con configuración automática la guía queda plegada y al guardar no se manda dato del webhook', () => {
    create([{ ...STRIPE, webhookAutoSetup: true }, PAYPAL]);
    const emitted: ProviderCredentials[] = [];
    fixture.componentInstance.providerSaveRequested.subscribe(c => emitted.push(c));

    expect(host.querySelector('[data-testid="webhook-auto-setup"]')?.textContent).toContain(
      'After you save, we connect Stripe for you',
    );
    expect(host.querySelector('[data-testid="webhook-setup"]')).toBeNull();
    expect(input('webhookSecret')).toBeNull();

    type('publishableKey', 'pk_test');
    type('secretKey', 'sk_test');
    save();

    expect(emitted.map(c => c.webhookSecret)).toEqual(['']);
  });

  it('"Set it up manually instead" abre la guía; "Let us set it up for you" la vuelve a plegar y suelta lo pegado', () => {
    create([{ ...STRIPE, webhookAutoSetup: true }, PAYPAL]);
    const emitted: ProviderCredentials[] = [];
    fixture.componentInstance.providerSaveRequested.subscribe(c => emitted.push(c));

    host.querySelector<HTMLButtonElement>('[data-testid="webhook-manual"]')!.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="webhook-setup"]')).not.toBeNull();
    type('webhookSecret', 'whsec_manual');
    type('publishableKey', 'pk_test');
    type('secretKey', 'sk_test');
    save();
    expect(emitted.map(c => c.webhookSecret)).toEqual(['whsec_manual']);

    host.querySelector<HTMLButtonElement>('[data-testid="webhook-automatic"]')!.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="webhook-auto-setup"]')).not.toBeNull();
    expect(fixture.componentInstance.webhookSecret()).toBe('');
  });

  it('la fila dice si el webhook se creó solo o se está creando (sin el aviso de "Refunds won\'t sync")', () => {
    create([STRIPE, PAYPAL], {
      configs: [
        config({ providerCode: 'Stripe', hasWebhookSecret: true, webhookSetup: 'Automatic' }),
        config({ providerCode: 'PayPal', hasWebhookSecret: false, webhookSetup: 'Pending' }),
      ],
    });
    const row = (code: string) => host.querySelector(`[data-provider="${code}"]`)!;

    expect(row('Stripe').querySelector('[data-testid="webhook-auto"]')?.textContent).toContain(
      'Refunds and disputes sync automatically',
    );
    expect(row('PayPal').querySelector('[data-testid="webhook-pending"]')?.textContent).toContain('Setting up refund sync');
    expect(row('PayPal').querySelector('[data-warning="webhook-secret"]')).toBeNull();
  });

  it('si el registro automático falló vuelve el aviso para cargarlo a mano', () => {
    create([STRIPE, PAYPAL], {
      configs: [config({ providerCode: 'PayPal', hasWebhookSecret: false, webhookSetup: 'Failed' })],
    });

    expect(host.querySelector('[data-provider="PayPal"] [data-warning="webhook-secret"]')?.textContent).toContain(
      "Refunds won't sync",
    );
  });

  it('menú "…" → Delete pide confirmación antes de borrar', () => {
    const paypal = config({ providerCode: 'PayPal' });
    create([STRIPE, PAYPAL], { configs: [paypal] });
    const deleted: PaymentConfig[] = [];
    fixture.componentInstance.providerDeleteRequested.subscribe(c => deleted.push(c));

    host.querySelector<HTMLButtonElement>('[data-provider="PayPal"] app-dropdown-menu button[aria-haspopup="menu"]')!.click();
    fixture.detectChanges();
    document.body.querySelector<HTMLButtonElement>('[data-action="delete"]')!.click();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(deleted).toEqual([]);
    expect(document.body.textContent).toContain('Remove PayPal?');

    const confirm = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.trim() === 'Remove',
    )!;
    confirm.click();
    fixture.detectChanges();

    expect(deleted).toEqual([paypal]);
    expect(fixture.componentInstance.pendingDelete()).toBeNull();
  });

  it('con pagos, "Delete" sale deshabilitado y explica que se apague', () => {
    create([STRIPE, PAYPAL], { configs: [config({ providerCode: 'Stripe', hasPayments: true })] });
    let asked = 0;
    fixture.componentInstance.providerDeleteRequested.subscribe(() => asked++);

    host.querySelector<HTMLButtonElement>('[data-provider="Stripe"] app-dropdown-menu button[aria-haspopup="menu"]')!.click();
    fixture.detectChanges();
    const del = document.body.querySelector<HTMLButtonElement>('[data-action="delete"]')!;
    expect(del.disabled).toBe(true);
    expect(del.textContent).toContain('Has payments — turn it off instead');
    del.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.pendingDelete()).toBeNull();
    expect(asked).toBe(0);
  });

  // ---------- Estados del catálogo ----------

  it('si el catálogo falla avisa y permite reintentar', () => {
    create([], { providersFailed: true });
    let retried = 0;
    fixture.componentInstance.providersRetryRequested.subscribe(() => retried++);

    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("couldn't load");
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();

    const retry = alert.querySelector<HTMLButtonElement>('button')!;
    expect(retry.textContent?.trim()).toBe('Try again');
    retry.click();
    expect(retried).toBe(1);
  });

  it('mientras carga el catálogo muestra el esqueleto y ninguna tarjeta', () => {
    create([], { providersLoading: true });

    const loading = host.querySelector('[data-testid="providers-loading"]')!;
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.textContent).toContain('Loading providers');
    expect(host.querySelector('[role="radio"]')).toBeNull();
  });
});
