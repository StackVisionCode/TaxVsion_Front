import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Input,
  OnChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { LaunchOverlayComponent } from '@shared/ui/launch-overlay/launch-overlay.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { runWithLaunch, type LaunchPhase } from '@shared/utils/launch.util';
import { ClientFormsStore } from '../../data-access/client-forms.store';
import type { AssignFormDialogValue } from '../../ui/assign-form-dialog/assign-form-dialog.component';
import { AssignFormDialogComponent } from '../../ui/assign-form-dialog/assign-form-dialog.component';
import { FormRequestListComponent } from '../../ui/form-request-list/form-request-list.component';
import { ClientFormReviewDrawerComponent } from '../client-form-review-drawer/client-form-review-drawer.component';

const PAGE_SIZE = 6;

@Component({
  selector: 'app-client-profile-forms',
  imports: [
    AssignFormDialogComponent,
    ClientFormReviewDrawerComponent,
    FormRequestListComponent,
    LaunchOverlayComponent,
    PaginationComponent,
  ],
  providers: [ClientFormsStore],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canRead) {
      <section
        class="rounded-[1.5rem] border border-gray-100 bg-white p-6 shadow-sm"
        aria-labelledby="client-forms-heading"
      >
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="client-forms-heading" class="text-xl font-bold text-gray-900">Client Forms</h2>
            <p class="mt-1 text-sm text-gray-500">
              Structured forms you assigned to this client
              @if (toReview() > 0) {
                <span class="font-medium text-amber-600">· {{ toReview() }} to review</span>
              }
            </p>
          </div>
          @if (canManage) {
            <button
              type="button"
              class="flex items-center gap-2 rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              (click)="assignOpen.set(true)"
            >
              <ion-icon name="add-outline" class="text-base"></ion-icon>Assign form
            </button>
          }
        </header>
        <div class="mt-5">
          @if (opening()) {
            <!-- El drawer se abre al llegar el detalle: mientras tanto, señal de que el clic se tomó. -->
            <div class="mb-3 h-1 w-full animate-pulse rounded-full bg-brand-bold/30" role="status" aria-label="Opening form"></div>
          }
          <app-client-form-request-list
            [requests]="pagedItems()"
            [loading]="store.loading()"
            [error]="store.error()"
            (retry)="reload()"
            (opened)="open($event)"
          />
          <app-pagination
            [currentPage]="page()"
            [totalItems]="store.items().length"
            [pageSize]="pageSize"
            (pageChange)="page.set($event)"
          />
        </div>
      </section>

      <app-launch-overlay
        variant="send"
        [phase]="launch()"
        [workingCaption]="'Assigning to ' + (clientName || 'the client') + '…'"
        [doneCaption]="'Assigned to ' + (clientName || 'the client')"
      />

      <app-assign-form-dialog
        [isOpen]="assignOpen()"
        [clientName]="clientName"
        [templates]="store.templates()"
        [priorRequests]="store.items()"
        [initialTemplateId]="initialTemplateId()"
        [busy]="store.busy()"
        [error]="store.actionError()"
        (closed)="closeAssign()"
        (assigned)="assign($event)"
      />
      <app-client-form-review-drawer [clientName]="clientName" (closed)="clearDeepLink()" />
    }
  `,
})
export class ClientProfileFormsComponent implements OnChanges {
  @Input() clientId = '';
  @Input() clientName = '';
  @Input() focusRequestId = '';

  readonly store = inject(ClientFormsStore);
  private readonly access = inject(AccessStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly assignOpen = signal(false);
  readonly initialTemplateId = signal<string | null>(null);
  readonly canRead = this.access.can('tasks.form_requests.read');
  readonly canManage = this.access.can('tasks.form_requests.manage');
  readonly launch = signal<LaunchPhase>('idle');
  readonly opening = signal(false);
  private readonly toast = inject(ToastService);
  readonly pageSize = PAGE_SIZE;
  readonly page = signal(1);
  // Paginado en cliente: el diálogo de asignar necesita todos los previos para "Prefill from last year".
  readonly pagedItems = computed(() => {
    const start = (this.page() - 1) * PAGE_SIZE;
    return this.store.items().slice(start, start + PAGE_SIZE);
  });
  readonly toReview = computed(
    () => this.store.items().filter(item => item.status === 'Submitted').length,
  );
  private loadedClientId = '';
  private openedFocusId = '';

  async ngOnChanges(): Promise<void> {
    if (!this.canRead) {
      // Sin lectura de formularios el enlace de asignar no puede cumplirse: se limpia igual.
      this.clearAssignLink();
      return;
    }
    if (!this.clientId) return;
    if (this.loadedClientId !== this.clientId) {
      this.loadedClientId = this.clientId;
      this.openedFocusId = '';
      this.page.set(1);
      await this.store.load(this.clientId);
      this.openAssignFromLink();
    }
    if (this.focusRequestId && this.focusRequestId !== this.openedFocusId) {
      this.openedFocusId = this.focusRequestId;
      await this.store.open(this.focusRequestId);
    }
  }

  reload(): void {
    if (this.clientId) void this.store.load(this.clientId);
  }

  open(id: string): void {
    this.openedFocusId = id;
    void this.openDetail(id);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: 'work', formRequestId: id },
      queryParamsHandling: 'merge',
    });
  }

  // Antes un fallo al abrir iba a actionError, que solo se pinta dentro del drawer (cerrado): no se veía.
  private async openDetail(id: string): Promise<void> {
    this.opening.set(true);
    try {
      await this.store.open(id);
    } finally {
      this.opening.set(false);
    }
    const error = this.store.actionError();
    if (!this.store.detail() && error) this.toast.error(error);
  }

  async assign(value: AssignFormDialogValue): Promise<void> {
    // El diálogo se cierra debajo del overlay en cuanto aparece el sello; el drawer del nuevo
    // request queda abierto detrás y se revela al desvanecerse.
    await runWithLaunch(this.launch, () => this.store.assign(value), {
      onDone: () => {
        this.page.set(1);
        this.closeAssign();
      },
    });
  }

  closeAssign(): void {
    this.assignOpen.set(false);
    this.initialTemplateId.set(null);
  }

  // `?assignForm=1&assignTemplateId=…` abre el diálogo de asignar una sola vez y limpia la URL.
  private openAssignFromLink(): void {
    const params = this.route.snapshot.queryParamMap;
    if (params.get('assignForm') !== '1') return;
    if (this.canManage) {
      this.initialTemplateId.set(params.get('assignTemplateId'));
      this.assignOpen.set(true);
    }
    this.clearAssignLink();
  }

  private clearAssignLink(): void {
    if (!this.route.snapshot.queryParamMap.has('assignForm')) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { assignForm: null, assignTemplateId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  clearDeepLink(): void {
    this.openedFocusId = '';
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { formRequestId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
