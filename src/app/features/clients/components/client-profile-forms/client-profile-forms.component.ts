import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Input,
  OnChanges,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ClientFormsStore } from '../../data-access/client-forms.store';
import type { AssignFormDialogValue } from '../../ui/assign-form-dialog/assign-form-dialog.component';
import { AssignFormDialogComponent } from '../../ui/assign-form-dialog/assign-form-dialog.component';
import { FormRequestListComponent } from '../../ui/form-request-list/form-request-list.component';
import { ClientFormReviewDrawerComponent } from '../client-form-review-drawer/client-form-review-drawer.component';

@Component({
  selector: 'app-client-profile-forms',
  imports: [AssignFormDialogComponent, ClientFormReviewDrawerComponent, FormRequestListComponent],
  providers: [ClientFormsStore],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canRead) {
      <section class="border border-gray-200 bg-white" aria-labelledby="client-forms-heading">
        <header
          class="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-5 py-4"
        >
          <div>
            <p class="text-xs font-semibold uppercase text-brand-bold">Structured collection</p>
            <h2 id="client-forms-heading" class="mt-1 text-lg font-bold text-gray-900">
              Client Forms
            </h2>
            <p class="mt-1 text-sm text-gray-500">
              Assign, track and review structured requests for this client.
            </p>
          </div>
          @if (canManage) {
            <button
              type="button"
              class="inline-flex min-h-10 items-center gap-2 bg-brand-bold px-4 text-sm font-bold text-white hover:bg-brand-ink"
              (click)="assignOpen.set(true)"
            >
              <ion-icon name="add-outline"></ion-icon>Assign form
            </button>
          }
        </header>
        <div class="p-5">
          <app-client-form-request-list
            [requests]="store.items()"
            [loading]="store.loading()"
            [error]="store.error()"
            (retry)="reload()"
            (opened)="open($event)"
          />
        </div>
      </section>

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
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly assignOpen = signal(false);
  readonly initialTemplateId = signal<string | null>(null);
  readonly canRead = this.access.can('tasks.form_requests.read');
  readonly canManage = this.access.can('tasks.form_requests.manage');
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
    void this.store.open(id);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: 'work', formRequestId: id },
      queryParamsHandling: 'merge',
    });
  }

  async assign(value: AssignFormDialogValue): Promise<void> {
    if (await this.store.assign(value)) {
      this.closeAssign();
      this.toast.success('Form assigned to client');
    }
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
