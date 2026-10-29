import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import type { CustomerSummary } from '@core/customers/customer-summary.model';
import { firstValueFrom } from 'rxjs';
import {
  FormSelectControlComponent,
  type FormControlOption,
} from '@shared/ui/form-controls/form-select-control.component';
import {
  dueDateToUtc,
  earliestDueDate,
  formatDueDate,
} from '@shared/ui/form-review/form-review.format';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import type {
  AssignExternalFormRequestInput,
  AssignableFormTemplate,
  ActiveConsentNotice,
} from '../../data-access/client-forms.model';
import { isValidEmail, type CustomerEmailConflict } from '../../utils/external-forms';

export interface SendExternalFormPrefill {
  email: string;
  fullName: string | null;
}

/** Envío de una plantilla a un email que no es cliente (P-14 flujo A). Solo presenta y valida. */
@Component({
  selector: 'app-send-external-form-dialog',
  imports: [FormSelectControlComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen"
      heading="Send form to external email"
      subheading="For people who aren't clients yet. They verify their email with a one-time code."
      size="lg"
      (closed)="closed.emit()"
    >
      <form class="space-y-4 p-6" novalidate (submit)="submit($event)">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block text-sm font-semibold text-gray-700" for="external-email"
            >Recipient email
            <input
              id="external-email"
              type="email"
              required
              autocomplete="off"
              maxlength="254"
              class="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm"
              [class.border-gray-300]="!emailInvalid()"
              [class.border-red-400]="emailInvalid()"
              [attr.aria-invalid]="emailInvalid()"
              [attr.aria-describedby]="emailInvalid() ? 'external-email-error' : null"
              [value]="email()"
              (input)="changeEmail(value($event))"
              (blur)="onEmailBlur()"
            />
            @if (emailInvalid()) {
              <span id="external-email-error" class="mt-1 block text-xs font-normal text-red-700"
                >Enter a valid email address.</span
              >
            }
          </label>
          <label class="block text-sm font-semibold text-gray-700"
            >Recipient name <span class="font-normal text-gray-400">Optional</span>
            <input
              class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-sm"
              maxlength="200"
              autocomplete="off"
              [value]="fullName()"
              (input)="fullName.set(value($event))"
            />
          </label>
        </div>

        <div>
          <label class="block text-sm font-semibold text-gray-700" for="external-template"
            >Template</label
          >
          <div class="mt-1">
            <app-form-select-control
              [id]="'external-template'"
              placeholder="Select a published template"
              [required]="true"
              [options]="templateOptions()"
              [value]="templateId()"
              (valueChange)="templateId.set($event)"
            />
          </div>
        </div>

        <div>
          <label class="block text-sm font-semibold text-gray-700" for="external-notice"
            >Entry notice</label
          >
          <p class="mt-0.5 text-xs text-gray-500">
            Shown above the email step before the one-time code: who is asking and why.
          </p>
          @if (noticesLoading) {
            <p class="mt-2 text-sm text-gray-500">Loading notices…</p>
          } @else if (noticesError) {
            <p role="alert" class="mt-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {{ noticesError }}
            </p>
          } @else if (noticeOptions().length === 0) {
            <p role="alert" class="mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              There's no published identity verification notice. Ask an admin to publish one in
              consent notices before sending forms to external emails.
            </p>
          } @else {
            <div class="mt-1">
              <app-form-select-control
                [id]="'external-notice'"
                placeholder="Select an entry notice"
                [required]="true"
                [options]="noticeOptions()"
                [value]="noticeKey()"
                (valueChange)="noticeKey.set($event)"
              />
            </div>
          }
        </div>

        <label class="block text-sm font-semibold text-gray-700"
          >Request title <span class="font-normal text-gray-400">Optional</span>
          <input
            class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-sm"
            maxlength="200"
            [value]="title()"
            (input)="title.set(value($event))"
          />
        </label>
        <label class="block text-sm font-semibold text-gray-700"
          >Message <span class="font-normal text-gray-400">Optional</span>
          <textarea
            class="mt-1 w-full rounded-2xl border border-gray-300 p-3 text-sm"
            rows="3"
            maxlength="1000"
            [value]="message()"
            (input)="message.set(value($event))"
          ></textarea>
        </label>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block text-sm font-semibold text-gray-700"
            >Due date
            <input
              type="date"
              class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-sm"
              [min]="minDueDate"
              [value]="dueDate()"
              (input)="dueDate.set(value($event))"
            />
            @if (dueDatePreview()) {
              <span class="mt-1 block text-xs font-normal text-gray-500"
                >Due {{ dueDatePreview() }}</span
              >
            }
          </label>
          <label class="block text-sm font-semibold text-gray-700"
            >Tax year
            <input
              type="number"
              min="1900"
              max="2200"
              class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-sm"
              [value]="taxYear()"
              (input)="taxYear.set(value($event))"
            />
          </label>
        </div>

        <!-- El backend rechaza emails de clientes (409): aquí solo se anticipa, no se puede saltar. -->
        @if (matchedClient(); as client) {
          <div
            class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
            role="status"
            data-testid="existing-client-warning"
          >
            @if (canAssignToClient) {
              <p>
                This email belongs to client <strong>{{ client.displayName }}</strong>. Assign the
                form to the client instead.
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="min-h-9 rounded-full bg-brand-bold px-4 text-sm font-bold text-white hover:bg-brand-ink"
                  (click)="assignToClient.emit({ customerId: client.id, templateId: templateId() || null })"
                >
                  Assign to client
                </button>
              </div>
            } @else {
              <p>
                This email belongs to client <strong>{{ client.displayName }}</strong>. Assign the
                form from the client's profile, or ask someone who can assign forms to clients.
              </p>
            }
          </div>
        } @else if (activeConflict(); as conflict) {
          <div
            class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
            role="alert"
            data-testid="customer-email-conflict"
          >
            <p>{{ conflict.message }}</p>
            @if (conflict.customerId && canAssignToClient) {
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="min-h-9 rounded-full bg-brand-bold px-4 text-sm font-bold text-white hover:bg-brand-ink"
                  (click)="assignToClient.emit({ customerId: conflict.customerId, templateId: templateId() || null })"
                >
                  Assign to client
                </button>
              </div>
            }
          </div>
        }
        @if (error) {
          <div role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {{ error }}
          </div>
        }
        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold"
            (click)="closed.emit()"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="min-h-10 rounded-full bg-brand-bold px-4 text-sm font-bold text-white disabled:opacity-50"
            [disabled]="!ready() || busy || checkingClient() || matchedClient() != null || activeConflict() != null"
          >
            <!-- Mientras se busca si el email ya es de un cliente el botón está apagado: que se vea por qué. -->
            {{ busy ? 'Sending…' : checkingClient() ? 'Checking email…' : 'Send form' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class SendExternalFormDialogComponent {
  @Input() set isOpen(value: boolean) {
    // Cada apertura empieza limpia: el email de otra persona no debe quedar escrito.
    if (value && !this.open) this.reset();
    this.open = value;
  }
  get isOpen(): boolean {
    return this.open;
  }
  @Input() set templates(value: readonly AssignableFormTemplate[]) {
    this._templates.set(value ?? []);
  }
  @Input() set notices(value: readonly ActiveConsentNotice[]) {
    this._notices.set(value ?? []);
    // Con un único aviso válido se preselecciona.
    if (!this.noticeKey() && value?.length === 1) this.noticeKey.set(value[0].key);
  }
  /** Datos con que abrir el diálogo (p. ej. "Send another form" desde Prospects). */
  @Input() set prefill(value: SendExternalFormPrefill | null) {
    this._prefill = value;
    if (this.open && value) this.applyPrefill(value);
  }
  /** 409 `FormParticipant.EmailBelongsToCustomer` del último envío; se oculta al cambiar el email. */
  @Input() set conflict(value: CustomerEmailConflict | null) {
    this._conflict.set(value);
    this.conflictEmail.set(value ? this.lastSentEmail : null);
  }
  /** Asignar a un cliente exige `tasks.form_requests.manage`; sin él no se ofrece el atajo. */
  @Input() canAssignToClient = false;
  @Input() noticesLoading = false;
  @Input() noticesError: string | null = null;
  @Input() busy = false;
  @Input() error: string | null = null;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly sent = new EventEmitter<AssignExternalFormRequestInput>();
  @Output() readonly assignToClient = new EventEmitter<{
    customerId: string;
    templateId: string | null;
  }>();

  private readonly customers = inject(CustomerDirectoryStore);
  // Email ya consultado contra el directorio (normalizado) y su resultado.
  private checkedEmail: string | null = null;
  readonly matchedClient = signal<CustomerSummary | null>(null);
  readonly checkingClient = signal(false);
  private readonly _conflict = signal<CustomerEmailConflict | null>(null);
  private readonly conflictEmail = signal<string | null>(null);
  private lastSentEmail: string | null = null;
  private _prefill: SendExternalFormPrefill | null = null;

  private open = false;
  private readonly _templates = signal<readonly AssignableFormTemplate[]>([]);
  private readonly _notices = signal<readonly ActiveConsentNotice[]>([]);

  readonly email = signal('');
  readonly emailTouched = signal(false);
  readonly fullName = signal('');
  readonly templateId = signal('');
  readonly noticeKey = signal('');
  readonly title = signal('');
  readonly message = signal('');
  readonly dueDate = signal('');
  readonly taxYear = signal('');
  readonly minDueDate = earliestDueDate();

  readonly templateOptions = computed<FormControlOption[]>(() =>
    this._templates().map((item) => ({
      value: item.templateId,
      label: `${item.name} · v${item.latestVersionNumber}`,
    })),
  );
  readonly noticeOptions = computed<FormControlOption[]>(() =>
    this._notices().map((item) => ({
      value: item.key,
      label: `${item.title} · v${item.versionNumber}`,
    })),
  );
  readonly activeConflict = computed(() => {
    const conflict = this._conflict();
    return conflict && this.conflictEmail() === this.email().trim().toLowerCase() ? conflict : null;
  });
  readonly emailInvalid = computed(() => this.emailTouched() && !isValidEmail(this.email()));
  readonly dueDatePreview = computed(() => formatDueDate(dueDateToUtc(this.dueDate())));
  readonly ready = computed(
    () =>
      isValidEmail(this.email()) &&
      !!this.templateId() &&
      !!this.noticeKey() &&
      this.noticeOptions().some((option) => option.value === this.noticeKey()),
  );

  onEmailBlur(): void {
    this.emailTouched.set(true);
    void this.checkExistingClient();
  }

  /**
   * Busca un cliente con ese email exacto en el directorio (mismo ABAC que la búsqueda de clientes).
   * Sin permiso o sin resultados no se avisa: el envío externo sigue siendo válido.
   */
  async checkExistingClient(): Promise<CustomerSummary | null> {
    const email = this.email().trim().toLowerCase();
    if (!isValidEmail(email)) {
      this.checkedEmail = null;
      this.matchedClient.set(null);
      return null;
    }
    if (email === this.checkedEmail) return this.matchedClient();
    this.checkingClient.set(true);
    try {
      const page = await firstValueFrom(
        this.customers.search({ term: email, status: 'NotArchived', page: 1, size: 10 }),
      );
      // El usuario pudo cambiar el email mientras se buscaba.
      if (this.email().trim().toLowerCase() !== email) return null;
      const match =
        (page.items ?? []).find((item) => item.primaryEmail?.trim().toLowerCase() === email) ??
        null;
      this.checkedEmail = email;
      this.matchedClient.set(match);
      return match;
    } catch {
      this.checkedEmail = email;
      this.matchedClient.set(null);
      return null;
    } finally {
      this.checkingClient.set(false);
    }
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.emailTouched.set(true);
    if (!this.ready() || this.busy) return;
    // Antes de enviar se comprueba el email si el blur no llegó a hacerlo.
    if (await this.checkExistingClient()) return;
    this.emit();
  }

  private emit(): void {
    if (!this.ready() || this.busy || this.activeConflict()) return;
    this.lastSentEmail = this.email().trim().toLowerCase();
    const year = Number(this.taxYear());
    this.sent.emit({
      email: this.email().trim(),
      fullName: this.fullName().trim() || null,
      templateId: this.templateId(),
      entryNoticeKey: this.noticeKey(),
      title: this.title().trim() || null,
      messageToClient: this.message().trim() || null,
      dueAtUtc: dueDateToUtc(this.dueDate()),
      taxYear: Number.isInteger(year) && year > 0 ? year : null,
    });
  }

  value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  changeEmail(value: string): void {
    this.email.set(value);
    // Otro email invalida el aviso anterior.
    if (value.trim().toLowerCase() !== this.checkedEmail) this.matchedClient.set(null);
  }

  private reset(): void {
    this.email.set('');
    this.emailTouched.set(false);
    this.checkedEmail = null;
    this.matchedClient.set(null);
    this._conflict.set(null);
    this.conflictEmail.set(null);
    this.lastSentEmail = null;
    this.fullName.set('');
    this.templateId.set('');
    this.noticeKey.set(this._notices().length === 1 ? this._notices()[0].key : '');
    this.title.set('');
    this.message.set('');
    this.dueDate.set('');
    this.taxYear.set('');
    if (this._prefill) this.applyPrefill(this._prefill);
  }

  private applyPrefill(value: SendExternalFormPrefill): void {
    this.changeEmail(value.email);
    this.fullName.set(value.fullName ?? '');
  }
}
