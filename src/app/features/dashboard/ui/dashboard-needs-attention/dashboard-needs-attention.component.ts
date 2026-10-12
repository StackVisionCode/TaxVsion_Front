import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { CountUpDirective } from '@shared/directives/count-up.directive';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import { TaskStore } from '../../../task/data-access/task.store';
import { ChatStore } from '../../../chat/data-access/chat.store';
import { WalletStore } from '../../../wallet/data-access/wallet.store';
import { formatMicros } from '../../../wallet/data-access/wallet.model';
import { StorageStore } from '../../../storage/data-access/storage.store';
import { SignatureService } from '../../../signature/data-access/signature.service';
import {
  Insight,
  InsightTone,
  buildInsights,
  daysUntil,
  localDateIso,
  overdueTasks,
  upcomingDeadlines,
} from '../../utils/dashboard-insights.util';

const TASKS: AccessRequirement = { module: 'planner', anyOf: ['tasks.read'] };
const SIGNATURES: AccessRequirement = { module: 'signatures', anyOf: ['signature.request.read'] };
const WALLET: AccessRequirement = { module: null, anyOf: ['wallet.view'] };
const CHAT: AccessRequirement = { module: 'comms', anyOf: ['communication.chat.start', 'communication.chat.reply'] };
const STORAGE: AccessRequirement = { module: 'documents', anyOf: ['cloudstorage.settings.manage'] };

/** Firmas en curso que se revisan para "por vencer" (una sola página; el resto no entra en el conteo). */
const SIGNATURES_SCAN_SIZE = 100;
const EXPIRY_WINDOW_DAYS = 7;

const TONE_CLASSES: Record<InsightTone, { card: string; circle: string }> = {
  danger: { card: 'bg-red-50 ring-red-100', circle: 'bg-red-500 text-white' },
  warn: { card: 'bg-sand-100 ring-sand-500/25', circle: 'bg-sand-600 text-white' },
  info: { card: 'bg-orange-100 ring-orange-200', circle: 'bg-brand-bold text-white' },
};

/**
 * Widget "Needs attention": alertas accionables al estilo del Assistant de Salesforce o los insights de
 * HubSpot. Cada tarjeta es un número real con enlace a donde se resuelve; si el dato no se sabe (sin
 * acceso, cargando, error) la tarjeta no aparece — nunca un 0 inventado.
 *
 * Casi todo sale de stores que ya están cargados por la shell o por otros widgets (cero peticiones
 * extra): tareas, chats sin leer, wallet. Solo las firmas por vencer piden su propia página, sin pasar
 * por `SignatureStore.refresh()` (que haría N+1 pidiendo el detalle de cada una).
 */
@Component({
  selector: 'app-dashboard-needs-attention',
  imports: [CommonModule, RouterLink, CountUpDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-needs-attention.component.html',
})
export class DashboardNeedsAttentionComponent implements OnInit {
  private readonly access = inject(AccessStore);
  private readonly tasks = inject(TaskStore);
  private readonly chat = inject(ChatStore);
  private readonly wallet = inject(WalletStore);
  private readonly storage = inject(StorageStore);
  private readonly signatures = inject(SignatureService);

  private readonly useTasks = this.access.canUse(TASKS);
  private readonly useSignatures = this.access.canUse(SIGNATURES);
  private readonly useWallet = this.access.canUse(WALLET);
  private readonly useChat = this.access.canUse(CHAT);
  private readonly useStorage = this.access.canUse(STORAGE);

  private readonly signaturesExpiring = signal<number | null>(null);

  private readonly tasksReady = computed(
    () => this.useTasks && !this.tasks.loading() && !this.tasks.error() && !this.tasks.isSearching(),
  );

  readonly insights = computed<Insight[]>(() => {
    const now = new Date();
    const tasks = this.tasksReady() ? this.tasks.tasks() : null;
    const usage = this.useStorage ? this.storage.usage() : null;
    const wallet = this.useWallet ? this.wallet.wallet() : null;

    return buildInsights({
      overdueTasks: tasks ? overdueTasks(tasks, now).length : null,
      statutoryNext7Days: tasks
        ? upcomingDeadlines(tasks, now, 7).filter(row => row.days >= 0).length
        : null,
      signaturesExpiring: this.signaturesExpiring(),
      storageUsedRatio:
        usage && usage.maxBytes > 0 ? (usage.usedBytes + usage.reservedBytes) / usage.maxBytes : null,
      // `lowBalance` es true con el wallet aún sin cargar (0 < $5): solo cuenta con datos reales.
      walletLowLabel:
        wallet && this.wallet.lowBalance()
          ? `Wallet balance low · ${formatMicros(wallet.availableMicros, wallet.currency)}`
          : null,
      unreadChats: this.useChat ? this.chat.totalUnread() : null,
    });
  });

  /** Se puede afirmar "todo en orden" solo si al menos una fuente respondió. */
  readonly allClear = computed(
    () =>
      this.insights().length === 0 &&
      (this.tasksReady() ||
        this.signaturesExpiring() !== null ||
        (this.useWallet && this.wallet.wallet() !== null) ||
        (this.useStorage && this.storage.usage() !== null) ||
        this.useChat),
  );

  ngOnInit(): void {
    if (this.useTasks) {
      this.tasks.init();
    }
    if (this.useWallet) {
      this.wallet.init();
    }
    if (this.useStorage) {
      this.storage.loadUsage();
    }
    if (this.useSignatures) {
      this.loadExpiringSignatures();
    }
  }

  toneClasses(tone: InsightTone): { card: string; circle: string } {
    return TONE_CLASSES[tone];
  }

  private loadExpiringSignatures(): void {
    this.signatures.list({ status: 'InProgress', page: 1, size: SIGNATURES_SCAN_SIZE }).subscribe({
      next: result => {
        const now = new Date();
        const expiring = result.items.filter(item => {
          const expires = parseUtcDateOrNull(item.expiresAtUtc);
          if (!expires) {
            return false;
          }
          const days = daysUntil(localDateIso(expires), now);
          return days >= 0 && days <= EXPIRY_WINDOW_DAYS;
        });
        this.signaturesExpiring.set(expiring.length);
      },
      error: () => undefined,
    });
  }
}
