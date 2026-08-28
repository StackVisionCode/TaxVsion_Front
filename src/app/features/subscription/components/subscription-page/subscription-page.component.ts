import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { parseUtcDateOrNull } from '../../../../shared/utils/utc-date.util';
import { UserManagementService } from '../../../user-management/data-access/user-management.service';
import { UserSummary } from '../../../user-management/data-access/user-management.model';
import { SubscriptionStore } from '../../data-access/subscription.store';
import {
  AddOnResponse,
  AuditLogEntryResponse,
  SEAT_TYPES,
  SeatResponse,
  formatEntitlementValue,
  humanizeKey,
  isAssignable,
  statusTone,
} from '../../data-access/subscription.model';

export type SubscriptionTabId = 'plan' | 'seats' | 'addons' | 'audit';

interface TabDef {
  id: SubscriptionTabId;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { id: 'plan', label: 'Plan & limits', icon: 'speedometer-outline' },
  { id: 'seats', label: 'Seats', icon: 'person-outline' },
  { id: 'addons', label: 'Add-ons', icon: 'cube-outline' },
  { id: 'audit', label: 'Activity log', icon: 'time-outline' },
];

/**
 * Sección Subscription: reúne cuatro servicios del Gateway que el CRM no
 * consumía (`/entitlements`, `/seats`, `/addons`, `/audit`).
 *
 * Cada pestaña carga bajo demanda y solo la primera vez: son cuatro backends
 * distintos y pedirlos todos al entrar gastaría rate limit del que el usuario
 * quizá no mire ninguno.
 *
 * Nota de permisos: comprar/asignar asientos y add-ons exige `SeatsManage` /
 * `AddOnsManage` y actor TenantAdmin. Un empleado sin permiso ve los datos pero
 * recibe 403 al mutar; el error se muestra tal cual lo manda el backend en vez
 * de esconder los botones, porque el front no conoce los permisos del token.
 */
@Component({
  selector: 'app-subscription-page',
  imports: [CommonModule, FormsModule, ModalComponent, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  providers: [SubscriptionStore],
  templateUrl: './subscription-page.component.html',
  styleUrl: './subscription-page.component.css',
})
export class SubscriptionPageComponent {
  readonly store = inject(SubscriptionStore);
  private readonly users = inject(UserManagementService);

  readonly tabs = TABS;
  readonly seatTypes = SEAT_TYPES;
  readonly activeTab = signal<SubscriptionTabId>('plan');
  private readonly loadedTabs = new Set<SubscriptionTabId>();

  // Selector de usuarios para asignar/reasignar asientos.
  readonly tenantUsers = signal<UserSummary[]>([]);
  readonly usersLoading = signal(false);

  // --- Modal: comprar asientos ---
  readonly isPurchaseSeatsOpen = signal(false);
  readonly seatType = signal(SEAT_TYPES[0]);
  readonly seatQuantity = signal(1);
  readonly seatAutoRenew = signal(true);

  // --- Modal: asignar / reasignar ---
  readonly assignTarget = signal<SeatResponse | null>(null);
  readonly assignUserId = signal('');
  readonly assignReason = signal('');
  readonly isReassign = computed(() => !!this.assignTarget()?.currentUserId);

  // --- Modal: liberar asiento ---
  readonly releaseTarget = signal<SeatResponse | null>(null);
  readonly releaseReason = signal('');

  // --- Modal: comprar add-on ---
  readonly isPurchaseAddOnOpen = signal(false);
  readonly addOnCode = signal('');
  readonly addOnQuantity = signal(1);
  readonly addOnAutoRenew = signal(true);

  // --- Modal: cancelar add-on (razón obligatoria en el backend) ---
  readonly cancelTarget = signal<AddOnResponse | null>(null);
  readonly cancelReason = signal('');

  // --- Modal: detalle de auditoría ---
  readonly auditDetail = signal<AuditLogEntryResponse | null>(null);

  // --- Filtros de auditoría ---
  readonly auditType = signal('');
  readonly auditFrom = signal('');
  readonly auditTo = signal('');

  readonly canPurchaseSeats = computed(() => this.seatQuantity() > 0 && !!this.seatType());
  readonly canPurchaseAddOn = computed(() => this.addOnQuantity() > 0 && !!this.addOnCode());

  constructor() {
    this.selectTab('plan');
  }

  selectTab(tab: SubscriptionTabId): void {
    this.activeTab.set(tab);
    if (this.loadedTabs.has(tab)) {
      return;
    }
    this.loadedTabs.add(tab);
    switch (tab) {
      case 'plan':
        this.store.loadSummary();
        break;
      case 'seats':
        this.store.loadSeats(1);
        this.loadUsers();
        break;
      case 'addons':
        this.store.loadAddOns();
        break;
      case 'audit':
        this.store.loadAudit(1, this.currentAuditFilters());
        break;
    }
  }

  /** Reintento manual: permite recargar una pestaña que falló. */
  reload(tab: SubscriptionTabId): void {
    this.loadedTabs.delete(tab);
    this.selectTab(tab);
  }

  private loadUsers(): void {
    this.usersLoading.set(true);
    this.users.getUsers({ page: 1, size: 100, isActive: true }).subscribe({
      next: result => {
        this.tenantUsers.set(result.items ?? []);
        this.usersLoading.set(false);
      },
      // Sin la lista no se puede asignar por nombre; el aviso lo da la plantilla.
      error: () => {
        this.tenantUsers.set([]);
        this.usersLoading.set(false);
      },
    });
  }

  userLabel(userId: string | null): string {
    if (!userId) {
      return 'Unassigned';
    }
    const user = this.tenantUsers().find(candidate => candidate.id === userId);
    return user ? `${user.name} ${user.lastName}`.trim() || user.email : userId;
  }

  // ---------- Helpers de presentación ----------

  readonly tone = statusTone;
  readonly humanize = humanizeKey;
  readonly formatValue = formatEntitlementValue;
  readonly assignable = isAssignable;

  date(value: string | null | undefined): Date | null {
    return parseUtcDateOrNull(value);
  }

  /** Los payloads de auditoría son JSON en crudo; se re-indentan si parsean. */
  prettyJson(raw: string | null): string {
    if (!raw) {
      return '';
    }
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  // ---------- Seats ----------

  openPurchaseSeats(): void {
    this.seatType.set(SEAT_TYPES[0]);
    this.seatQuantity.set(1);
    this.seatAutoRenew.set(true);
    this.store.seatsActionError.set(null);
    this.isPurchaseSeatsOpen.set(true);
  }

  confirmPurchaseSeats(): void {
    if (!this.canPurchaseSeats()) {
      return;
    }
    this.store.purchaseSeats(this.seatType(), this.seatQuantity(), this.seatAutoRenew(), () =>
      this.isPurchaseSeatsOpen.set(false),
    );
  }

  openAssign(seat: SeatResponse): void {
    this.assignTarget.set(seat);
    this.assignUserId.set('');
    this.assignReason.set('');
    this.store.seatsActionError.set(null);
  }

  confirmAssign(): void {
    const seat = this.assignTarget();
    const userId = this.assignUserId();
    if (!seat || !userId) {
      return;
    }
    const done = () => this.assignTarget.set(null);
    if (this.isReassign()) {
      this.store.reassignSeat(seat.id, userId, this.assignReason().trim() || null, done);
    } else {
      this.store.assignSeat(seat.id, userId, done);
    }
  }

  openRelease(seat: SeatResponse): void {
    this.releaseTarget.set(seat);
    this.releaseReason.set('');
    this.store.seatsActionError.set(null);
  }

  confirmRelease(): void {
    const seat = this.releaseTarget();
    if (!seat) {
      return;
    }
    this.store.releaseSeat(seat.id, this.releaseReason().trim() || null, () => this.releaseTarget.set(null));
  }

  // ---------- Add-ons ----------

  openPurchaseAddOn(): void {
    this.addOnCode.set(this.store.addOnCatalog()[0]?.code ?? '');
    this.addOnQuantity.set(1);
    this.addOnAutoRenew.set(true);
    this.store.addOnsActionError.set(null);
    this.isPurchaseAddOnOpen.set(true);
  }

  confirmPurchaseAddOn(): void {
    if (!this.canPurchaseAddOn()) {
      return;
    }
    this.store.purchaseAddOn(this.addOnCode(), this.addOnQuantity(), this.addOnAutoRenew(), () =>
      this.isPurchaseAddOnOpen.set(false),
    );
  }

  openCancelAddOn(addOn: AddOnResponse): void {
    this.cancelTarget.set(addOn);
    this.cancelReason.set('');
    this.store.addOnsActionError.set(null);
  }

  confirmCancelAddOn(): void {
    const addOn = this.cancelTarget();
    const reason = this.cancelReason().trim();
    if (!addOn || !reason) {
      return;
    }
    this.store.cancelAddOn(addOn.id, reason, () => this.cancelTarget.set(null));
  }

  addOnName(code: string): string {
    return this.store.addOnNameByCode().get(code)?.name ?? code;
  }

  addOnDescription(code: string): string {
    return this.store.addOnNameByCode().get(code)?.description ?? '';
  }

  // ---------- Audit ----------

  private currentAuditFilters() {
    return {
      aggregateType: this.auditType().trim() || null,
      from: this.auditFrom() || null,
      to: this.auditTo() || null,
    };
  }

  applyAuditFilters(): void {
    this.store.loadAudit(1, this.currentAuditFilters());
  }

  clearAuditFilters(): void {
    this.auditType.set('');
    this.auditFrom.set('');
    this.auditTo.set('');
    this.store.loadAudit(1, this.currentAuditFilters());
  }

  changeAuditPage(page: number): void {
    this.store.loadAudit(page, this.currentAuditFilters());
  }
}
