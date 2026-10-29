import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import type {
  FormPresentation,
  FormPurpose,
} from '@shared/utils/data-collection/form-definition.model';
import { FormTemplatesStore } from '../../data-access/form-templates.store';
import { FormTemplatesListComponent } from '../form-templates-list/form-templates-list.component';
import type { FormTemplateStatus, FormTemplateSummary } from '../../data-access/client-forms.model';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import {
  FilterChipsComponent,
  type FilterChipOption,
} from '@shared/ui/filter-chips/filter-chips.component';
import { FormSelectControlComponent } from '@shared/ui/form-controls/form-select-control.component';
import { FormTextControlComponent } from '@shared/ui/form-controls/form-text-control.component';
import { FormTextareaControlComponent } from '@shared/ui/form-controls/form-textarea-control.component';
import { LaunchOverlayComponent } from '@shared/ui/launch-overlay/launch-overlay.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { runWithLaunch, type LaunchPhase } from '@shared/utils/launch.util';
import { FormRequestsInboxComponent } from '../form-requests-inbox/form-requests-inbox.component';
import { FormIntakeLinksComponent } from '../form-intake-links/form-intake-links.component';
import { ClientFormsLibraryComponent } from '../client-forms-library/client-forms-library.component';
import { FormReportsComponent } from '../form-reports/form-reports.component';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';
import { FormProspectsComponent } from '../form-prospects/form-prospects.component';
import { FormInsightsComponent } from '../form-insights/form-insights.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';

type ClientFormsTab = 'requests' | 'insights' | 'prospects' | 'templates' | 'library' | 'intake' | 'reports';
type StatusFilter = 'all' | FormTemplateStatus;

@Component({
  selector: 'app-client-forms-home',
  imports: [
    FormTemplatesListComponent,
    FormRequestsInboxComponent,
    FormIntakeLinksComponent,
    ClientFormsLibraryComponent,
    FormReportsComponent,
    // Solo dentro de @defer: quedan en su propio chunk.
    FormProspectsComponent,
    FormInsightsComponent,
    SkeletonComponent,
    ConfirmDialogComponent,
    FilterChipsComponent,
    FormSelectControlComponent,
    FormTextControlComponent,
    FormTextareaControlComponent,
    LaunchOverlayComponent,
    ModalComponent,
    PaginationComponent,
    SearchInputComponent,
    StateBlockComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* Entrada suave de cada pestaña (mismo idioma que el step-in del wizard de Signature). */
    .tab-panel {
      animation: tab-in 240ms cubic-bezier(0.2, 0, 0, 1) both;
    }
    @keyframes tab-in {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
      to {
        opacity: 1;
        /* "none" y no translateY(0): un transform activo encerraría los fixed de los hijos. */
        transform: none;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .tab-panel {
        animation: none;
      }
    }
  `,
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
              class="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-bold px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-ink"
              (click)="openCreate()"
            >
              <ion-icon name="add-outline" class="text-base"></ion-icon>New template
            </button>
          }
        </header>

        @if (availabilityLoading()) {
          <div class="mt-8">
            <app-state-block [loading]="true" loadingText="Checking availability…" minHeight="12rem" />
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
          <!-- Un solo elemento con track por pestaña: se recrea en cada cambio y la entrada vuelve a correr. -->
          @for (current of [activeTab()]; track current) {
          <div class="tab-panel">
            @switch (current) {
              @case ('requests') {
                <app-form-requests-inbox />
              }
              @case ('insights') {
                @defer {
                  <app-form-insights (openRequests)="activeTab.set('requests')" />
                } @placeholder (minimum 200ms) {
                  <div class="grid grid-cols-2 gap-4 py-5 lg:grid-cols-4">
                    @for (item of [1, 2, 3, 4]; track item) {
                      <app-skeleton variant="block" minHeight="8rem" />
                    }
                  </div>
                }
              }
              @case ('prospects') {
                @defer {
                  <app-form-prospects />
                } @placeholder (minimum 200ms) {
                  <div class="py-5"><app-skeleton variant="rows" [rows]="6" minHeight="18rem" /></div>
                }
              }
              @case ('intake') {
                <app-form-intake-links />
              }
              @case ('library') {
                <app-client-forms-library />
              }
              @case ('reports') {
                <app-form-reports />
              }
              @case ('templates') {
                <div class="my-5 flex flex-wrap items-center justify-between gap-3">
                  <app-search-input
                    class="min-w-64 flex-1"
                    widthClass="w-full"
                    placeholder="Search templates"
                    ariaLabel="Search templates"
                    [debounceMs]="250"
                    (valueChange)="search($event)"
                  />
                  <app-filter-chips
                    ariaLabel="Template status"
                    [options]="statusOptions"
                    [value]="statusFilter()"
                    (valueChange)="statusChanged($event)"
                  />
                </div>
                @if (store.items().length === 0 || store.error()) {
                  <app-state-block
                    [loading]="store.loading()"
                    loadingText="Loading templates…"
                    [error]="store.error() || null"
                    [empty]="store.items().length === 0"
                    icon="document-text-outline"
                    [emptyTitle]="hasFilters() ? 'No templates match' : 'No templates yet'"
                    [emptyMessage]="
                      hasFilters()
                        ? 'Try another search or status.'
                        : 'Create your first form template to start collecting client information.'
                    "
                    minHeight="16rem"
                    (retry)="store.load()"
                  />
                } @else {
                  <!-- Recargas posteriores (página, filtro) atenúan la tabla en vez de reemplazarla. -->
                  <div class="transition-opacity" [class.opacity-60]="store.loading()">
                    <app-form-templates-list
                      [templates]="store.items()"
                      [highlightId]="publishedId()"
                      (opened)="open($event)"
                      (duplicated)="duplicate($event)"
                      (statusChanged)="requestStatusChange($event)"
                    />
                  </div>
                  <app-pagination
                    [currentPage]="store.page()"
                    [totalItems]="store.totalCount()"
                    [pageSize]="store.pageSize"
                    (pageChange)="store.goToPage($event)"
                  />
                }
              }
            }
          </div>
          }
        }
      </div>
    </section>

    <app-modal
      [isOpen]="createOpen()"
      heading="New form template"
      subheading="Name it and pick how clients will move through it. You can change everything later."
      size="md"
      (closed)="closeCreate()"
    >
      <form class="mt-6 space-y-5" (submit)="create($event)">
        <label class="block text-sm font-semibold text-gray-700" for="new-template-name">Name</label>
        <app-form-text-control
          id="new-template-name"
          class="-mt-3 block"
          [value]="name()"
          [required]="true"
          [maxLength]="160"
          (valueChange)="name.set($event)"
        />
        <label class="block text-sm font-semibold text-gray-700" for="new-template-description">
          Description <span class="font-normal text-gray-400">Optional</span>
        </label>
        <app-form-textarea-control
          id="new-template-description"
          class="-mt-3 block"
          [rows]="3"
          [maxLength]="500"
          [value]="description()"
          (valueChange)="description.set($event)"
        />
        <label class="block text-sm font-semibold text-gray-700" for="new-template-purpose">Purpose</label>
        <app-form-select-control
          id="new-template-purpose"
          class="-mt-3 block"
          [options]="purposeOptions"
          [value]="purpose()"
          (valueChange)="purpose.set($any($event))"
        />
        <fieldset>
          <legend class="text-sm font-semibold text-gray-700">Presentation</legend>
          <div class="mt-2 grid gap-3 sm:grid-cols-2">
            @for (option of presentationOptions; track option.id) {
              <button
                type="button"
                class="flex items-start gap-3 rounded-2xl border p-4 text-left transition-all"
                [class]="presentation() === option.id ? cardSelected : cardIdle"
                [attr.aria-pressed]="presentation() === option.id"
                (click)="presentation.set(option.id)"
              >
                <span
                  class="grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors"
                  [class]="presentation() === option.id ? iconSelected : iconIdle"
                >
                  <ion-icon [name]="option.icon" class="text-lg"></ion-icon>
                </span>
                <span>
                  <span class="block text-sm font-semibold text-gray-900">{{ option.label }}</span>
                  <span class="mt-0.5 block text-xs text-gray-500">{{ option.hint }}</span>
                </span>
              </button>
            }
          </div>
        </fieldset>

        @if (createError()) {
          <p class="rounded-2xl border border-red-100 bg-red-50 p-3 text-sm text-red-700" role="alert">
            {{ createError() }}
          </p>
        }

        <div class="flex justify-end gap-3 pt-1">
          <button
            type="button"
            class="min-h-10 rounded-full border border-gray-300 px-5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            (click)="closeCreate()"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="inline-flex min-h-10 items-center gap-2 rounded-full bg-brand-bold px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-ink disabled:opacity-50"
            [disabled]="!name().trim() || launch() !== 'idle'"
          >
            <ion-icon name="sparkles-outline" class="text-base"></ion-icon>Create template
          </button>
        </div>
      </form>
    </app-modal>

    <app-launch-overlay
      variant="create"
      exit="hold"
      [phase]="launch()"
      [workingCaption]="'Creating ' + (name().trim() || 'your template') + '…'"
      doneCaption="Opening the builder…"
    />

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
      [busy]="changingStatus()"
      (cancelled)="statusTarget.set(null)"
      (confirmed)="changeStatus()"
    />
  `,
})
export class ClientFormsHomeComponent implements OnInit {
  readonly store = inject(FormTemplatesStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly access = inject(AccessStore);
  private readonly availabilityStore = inject(ClientFormsAvailabilityStore);
  readonly activeTab = signal<ClientFormsTab>('requests');
  readonly availabilityLoading = signal(true);
  readonly available = signal(false);
  readonly availabilityReason = signal<string | null>(null);
  readonly createOpen = signal(false);
  readonly createError = signal<string | null>(null);
  readonly launch = signal<LaunchPhase>('idle');
  /** Plantilla recién publicada desde el builder: su fila destella una vez. */
  readonly publishedId = signal<string | null>(null);
  readonly statusTarget = signal<FormTemplateSummary | null>(null);
  readonly changingStatus = signal(false);
  readonly statusFilter = signal<StatusFilter>('all');
  readonly searchTerm = signal('');
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
  readonly purposeOptions = this.purposes.map(value => ({ value, label: this.label(value) }));
  readonly presentationOptions: readonly {
    id: FormPresentation;
    label: string;
    hint: string;
    icon: string;
  }[] = [
    { id: 'wizard', label: 'Wizard', hint: 'One step at a time, with progress.', icon: 'layers-outline' },
    { id: 'singlePage', label: 'Single page', hint: 'Every question on one screen.', icon: 'reader-outline' },
  ];
  readonly statusOptions: readonly FilterChipOption<StatusFilter>[] = [
    { id: 'all', label: 'All' },
    { id: 'Active', label: 'Active' },
    { id: 'Archived', label: 'Archived' },
  ];
  // Tarjetas de "Presentation": clases enteras (llevan "/" y ":" que no valen en [class.x]).
  readonly cardSelected = 'border-brand-bold bg-brand-bold/5 ring-2 ring-brand-bold/15';
  readonly cardIdle = 'border-gray-200 hover:border-gray-300 hover:bg-gray-50';
  readonly iconSelected = 'bg-brand-bold text-white';
  readonly iconIdle = 'bg-gray-100 text-gray-500';

  tabs(): { id: ClientFormsTab; label: string }[] {
    const tabs: { id: ClientFormsTab; label: string }[] = [];
    if (this.access.can('tasks.form_requests.read'))
      tabs.push(
        { id: 'requests', label: 'Requests' },
        { id: 'insights', label: 'Insights' },
        { id: 'prospects', label: 'Prospects' },
      );
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
        const requested = this.takeTabLink();
        const tab = this.tabs().some(item => item.id === requested) ? requested : first;
        if (tab) this.activeTab.set(tab);
        if (this.access.can('tasks.form_templates.read')) await this.store.load();
      }
    } finally {
      this.availabilityLoading.set(false);
    }
  }
  // `?tab=templates&published=<id>` (al publicar desde el builder) se consume una vez y se limpia.
  private takeTabLink(): ClientFormsTab | null {
    const params = this.route.snapshot.queryParamMap;
    if (!params.has('tab') && !params.has('published')) return null;
    this.publishedId.set(params.get('published'));
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: null, published: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    return params.get('tab') as ClientFormsTab | null;
  }
  label(value: string): string {
    return value.replace(/([A-Z])/g, ' $1').replace(/^./, (item) => item.toUpperCase());
  }
  hasFilters(): boolean {
    return this.searchTerm().trim() !== '' || this.statusFilter() !== 'all';
  }
  search(term: string): void {
    this.searchTerm.set(term);
    void this.store.load({ search: term, page: 1 });
  }
  statusChanged(value: StatusFilter): void {
    this.statusFilter.set(value);
    void this.store.setStatus(value === 'all' ? undefined : value);
  }
  open(id: string): Promise<boolean> {
    return this.router.navigate(['/client-forms/templates', id]);
  }
  openCreate(): void {
    this.name.set('');
    this.description.set('');
    this.purpose.set('clientIntake');
    this.presentation.set('wizard');
    this.createError.set(null);
    this.createOpen.set(true);
  }
  closeCreate(): void {
    if (this.launch() !== 'idle') return;
    this.createOpen.set(false);
  }
  async duplicate(id: string): Promise<void> {
    const created = await this.store.duplicate(id);
    if (created) void this.open(created);
  }
  requestStatusChange(template: FormTemplateSummary): void {
    this.statusTarget.set(template);
  }
  async changeStatus(): Promise<void> {
    const template = this.statusTarget();
    if (!template || this.changingStatus()) return;
    this.changingStatus.set(true);
    try {
      const changed = await this.store.setArchived(template.id, template.status === 'Active');
      if (changed) this.statusTarget.set(null);
    } finally {
      this.changingStatus.set(false);
    }
  }
  async create(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.name().trim() || this.launch() !== 'idle') return;
    this.createError.set(null);
    // La hoja se arma, el modal se cierra por debajo al sellar y se navega con la pantalla cubierta:
    // el builder hace su propia entrada y reemplaza al overlay sin parpadeo.
    const id = await runWithLaunch(
      this.launch,
      () =>
        this.store.create({
          name: this.name().trim(),
          description: this.description().trim() || null,
          purpose: this.purpose(),
          presentation: this.presentation(),
        }),
      { onDone: () => this.createOpen.set(false), keepOnDone: true },
    );
    if (!id) {
      this.createError.set(this.store.error() || 'The template could not be created.');
      return;
    }
    if (!(await this.open(id))) this.launch.set('idle');
  }
}
