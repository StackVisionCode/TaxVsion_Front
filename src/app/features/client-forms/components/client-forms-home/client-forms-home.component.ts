import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import type {
  FormPresentation,
  FormPurpose,
} from '@shared/utils/data-collection/form-definition.model';
import { FormTemplatesStore } from '../../data-access/form-templates.store';
import { FormTemplatesListComponent } from '../form-templates-list/form-templates-list.component';
import type { FormTemplateSummary } from '../../data-access/client-forms.model';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { FormRequestsInboxComponent } from '../form-requests-inbox/form-requests-inbox.component';
import { FormIntakeLinksComponent } from '../form-intake-links/form-intake-links.component';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';

type ClientFormsTab = 'requests' | 'templates' | 'library' | 'intake' | 'reports';

@Component({
  selector: 'app-client-forms-home',
  imports: [
    FormTemplatesListComponent,
    FormRequestsInboxComponent,
    FormIntakeLinksComponent,
    ConfirmDialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="min-h-full rounded-[1.5rem] border border-gray-100 bg-white p-6 shadow-sm">
      <div class="mx-auto max-w-7xl">
        <header
          class="flex flex-wrap items-end justify-between gap-4 lg:pr-[var(--shell-notch-width)]"
        >
          <div>
            <p class="text-xs font-semibold uppercase text-brand-bold">Tasks workspace</p>
            <h1 class="mt-1 text-3xl font-bold text-gray-900">Client Forms</h1>
            <p class="mt-2 text-sm text-gray-600">
              Build secure forms and collect structured client information.
            </p>
          </div>
          @if (activeTab() === 'templates' && canManage) {
            <button
              type="button"
              class="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-bold px-5 text-sm font-bold text-white hover:bg-brand-ink"
              (click)="createOpen.set(true)"
            >
              <ion-icon name="add-outline"></ion-icon>New template
            </button>
          }
        </header>

        @if (availabilityLoading()) {
          <div class="mt-8 rounded-2xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
            Checking availability…
          </div>
        } @else if (!available()) {
          <div class="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h2 class="font-bold text-amber-950">Client Forms is not available</h2>
            <p class="mt-1 text-sm text-amber-800">
              {{ availabilityMessage() }}
            </p>
          </div>
        } @else {
          <nav class="mt-8 flex gap-1 border-b border-gray-200" aria-label="Client Forms sections">
            @for (tab of tabs(); track tab.id) {
              <button
                type="button"
                class="border-b-2 px-4 py-3 text-sm font-semibold"
                [class.border-brand-bold]="activeTab() === tab.id"
                [class.text-brand-bold]="activeTab() === tab.id"
                [class.border-transparent]="activeTab() !== tab.id"
                [class.text-gray-600]="activeTab() !== tab.id"
                (click)="activeTab.set(tab.id)"
              >
                {{ tab.label }}
              </button>
            }
          </nav>
          @if (activeTab() === 'requests') {
            <app-form-requests-inbox />
          } @else if (activeTab() === 'intake') {
            <app-form-intake-links />
          } @else if (activeTab() === 'templates') {
            <div class="my-5 flex flex-wrap items-center gap-3">
              <label class="relative min-w-72 flex-1"
                ><span class="sr-only">Search templates</span
                ><ion-icon
                  name="search-outline"
                  class="absolute left-3 top-3 text-gray-400"
                ></ion-icon
                ><input
                  class="min-h-11 w-full rounded-full border border-gray-300 bg-white pl-10 pr-3 text-sm"
                  placeholder="Search templates"
                  (input)="search($event)" /></label
              ><select
                class="min-h-11 rounded-full border border-gray-300 bg-white px-3 text-sm"
                (change)="statusChanged($event)"
              >
                <option value="">All statuses</option>
                <option value="Active">Active</option>
                <option value="Archived">Archived</option>
              </select>
            </div>
            @if (store.error()) {
              <p class="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {{ store.error() }}
              </p>
            }
            @if (store.loading()) {
              <div class="rounded-2xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
                Loading templates…
              </div>
            } @else {
              <app-form-templates-list
                [templates]="store.items()"
                (opened)="open($event)"
                (duplicated)="duplicate($event)"
                (statusChanged)="requestStatusChange($event)"
              />
            }
          } @else {
            <div class="mt-5 rounded-2xl border border-gray-200 bg-white p-10 text-center">
              <h2 class="text-lg font-bold text-gray-900">{{ currentTabLabel() }}</h2>
              <p class="mt-2 text-sm text-gray-500">
                This workspace arrives in the next Client Forms phase.
              </p>
            </div>
          }
        }
      </div>
    </section>

    @if (createOpen()) {
      <div
        class="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-template-title"
      >
        <form class="w-full max-w-lg rounded-[1.75rem] bg-white p-6 shadow-2xl" (submit)="create($event)">
          <h2 id="new-template-title" class="text-xl font-bold text-gray-900">New form template</h2>
          <div class="mt-5 space-y-4">
            <label class="block text-sm font-semibold text-gray-700"
              >Name<input
                class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3"
                required
                maxlength="160"
                [value]="name()"
                (input)="name.set(value($event))" /></label
            ><label class="block text-sm font-semibold text-gray-700"
              >Description<textarea
                class="mt-1 w-full rounded-2xl border border-gray-300 p-3"
                rows="3"
                maxlength="500"
                [value]="description()"
                (input)="description.set(value($event))"
              ></textarea>
            </label>
            <div class="grid grid-cols-2 gap-4">
              <label class="text-sm font-semibold text-gray-700"
                >Purpose<select
                  class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3"
                  [value]="purpose()"
                  (change)="setPurpose($event)"
                >
                  @for (item of purposes; track item) {
                    <option [value]="item" [selected]="item === purpose()">{{ label(item) }}</option>
                  }
                </select></label
              ><label class="text-sm font-semibold text-gray-700"
                >Presentation<select
                  class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3"
                  [value]="presentation()"
                  (change)="setPresentation($event)"
                >
                  <option value="wizard" [selected]="presentation() === 'wizard'">Wizard</option>
                  <option value="singlePage" [selected]="presentation() === 'singlePage'">Single page</option>
                </select></label
              >
            </div>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button
              type="button"
              class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold"
              (click)="createOpen.set(false)"
            >
              Cancel</button
            ><button
              type="submit"
              class="min-h-10 rounded-full bg-brand-bold px-4 text-sm font-bold text-white"
              [disabled]="!name().trim()"
            >
              Create template
            </button>
          </div>
        </form>
      </div>
    }

    <app-confirm-dialog
      [isOpen]="statusTarget() != null"
      [heading]="statusTarget()?.status === 'Active' ? 'Archive template?' : 'Restore template?'"
      [message]="
        statusTarget()?.status === 'Active'
          ? 'Archived templates stay available in history but cannot be assigned to new requests.'
          : 'The template will become available for use again.'
      "
      [confirmLabel]="statusTarget()?.status === 'Active' ? 'Archive' : 'Restore'"
      [tone]="statusTarget()?.status === 'Active' ? 'danger' : 'primary'"
      (cancelled)="statusTarget.set(null)"
      (confirmed)="changeStatus()"
    />
  `,
})
export class ClientFormsHomeComponent implements OnInit {
  readonly store = inject(FormTemplatesStore);
  private readonly router = inject(Router);
  private readonly access = inject(AccessStore);
  private readonly availabilityStore = inject(ClientFormsAvailabilityStore);
  readonly activeTab = signal<ClientFormsTab>('requests');
  readonly availabilityLoading = signal(true);
  readonly available = signal(false);
  readonly availabilityReason = signal<string | null>(null);
  readonly createOpen = signal(false);
  readonly statusTarget = signal<FormTemplateSummary | null>(null);
  readonly name = signal('');
  readonly description = signal('');
  readonly purpose = signal<FormPurpose>('clientIntake');
  readonly presentation = signal<FormPresentation>('wizard');
  readonly canManage = this.access.can('tasks.form_templates.manage');
  readonly purposes: FormPurpose[] = [
    'general',
    'clientIntake',
    'questionnaire',
    'checklist',
    'informationRequest',
    'documentRequest',
    'assessment',
  ];

  tabs(): { id: ClientFormsTab; label: string }[] {
    const tabs: { id: ClientFormsTab; label: string }[] = [];
    if (this.access.can('tasks.form_requests.read'))
      tabs.push({ id: 'requests', label: 'Requests' });
    if (this.access.can('tasks.form_templates.read'))
      tabs.push({ id: 'templates', label: 'Templates' }, { id: 'library', label: 'Library' });
    // Solo admins (el controller admite TenantAdmin/PlatformAdmin, P-14.3 B.1). Se muestra aunque
    // el sub-flag esté apagado: pausar y revocar siguen disponibles.
    if (this.access.isAdmin() && this.access.can('tasks.form_intake_links.manage'))
      tabs.push({ id: 'intake', label: 'Intake links' });
    if (this.access.can('tasks.form_requests.export'))
      tabs.push({ id: 'reports', label: 'Reports' });
    return tabs;
  }
  /** El backend manda códigos (`ClientForms.ModuleUnavailable`): se traducen, nunca se muestran crudos. */
  availabilityMessage(): string {
    const reason = this.availabilityReason();
    if (reason && !reason.startsWith('ClientForms.')) return reason;
    return reason === 'ClientForms.ModuleUnavailable'
      ? "Client Forms isn't included in this office's plan."
      : 'This feature is not enabled for this office.';
  }
  async ngOnInit(): Promise<void> {
    const availability = await this.availabilityStore.load();
    if (!availability) {
      this.availabilityReason.set('Availability could not be verified.');
      this.availabilityLoading.set(false);
      return;
    }
    this.available.set(availability.enabled);
    this.availabilityReason.set(availability.reason);
    try {
      if (availability.enabled) {
        const first = this.tabs()[0]?.id;
        if (first) this.activeTab.set(first);
        if (this.access.can('tasks.form_templates.read')) await this.store.load();
      }
    } finally {
      this.availabilityLoading.set(false);
    }
  }
  value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }
  setPurpose(event: Event): void {
    this.purpose.set(this.value(event) as FormPurpose);
  }
  setPresentation(event: Event): void {
    this.presentation.set(this.value(event) as FormPresentation);
  }
  label(value: string): string {
    return value.replace(/([A-Z])/g, ' $1').replace(/^./, (item) => item.toUpperCase());
  }
  currentTabLabel(): string {
    return this.tabs().find((tab) => tab.id === this.activeTab())?.label ?? 'Client Forms';
  }
  search(event: Event): void {
    void this.store.load({ search: this.value(event), page: 1 });
  }
  statusChanged(event: Event): void {
    const value = this.value(event);
    void this.store.setStatus(value ? (value as 'Active' | 'Archived') : undefined);
  }
  open(id: string): void {
    void this.router.navigate(['/client-forms/templates', id]);
  }
  async duplicate(id: string): Promise<void> {
    const created = await this.store.duplicate(id);
    if (created) this.open(created);
  }
  requestStatusChange(template: FormTemplateSummary): void {
    this.statusTarget.set(template);
  }
  async changeStatus(): Promise<void> {
    const template = this.statusTarget();
    if (!template) return;
    const changed = await this.store.setArchived(template.id, template.status === 'Active');
    if (changed) this.statusTarget.set(null);
  }
  async create(event: Event): Promise<void> {
    event.preventDefault();
    const id = await this.store.create({
      name: this.name().trim(),
      description: this.description().trim() || null,
      purpose: this.purpose(),
      presentation: this.presentation(),
    });
    if (id) {
      this.createOpen.set(false);
      this.open(id);
    }
  }
}
