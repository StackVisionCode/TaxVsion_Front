import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { toApiError } from '@core/models/api-error.model';
import { NotificationPreferencesService } from '../../data-access/notification-preferences.service';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationPreference,
} from '../../data-access/notification-preferences.model';

/**
 * Página Settings → Notifications (FASE 8 del plan). Matriz Category × Channel
 * con toggles; cada click PUT /notifications/preferences (optimista + rollback
 * silencioso en error). Security es `locked=true` por diseño del backend — el
 * toggle sale on + icono de candado deshabilitado.
 *
 * Nota de scope: solo se pintan los canales con delivery real hoy
 * (`InApp`, `Email`, `Sms`); `Push` lo expone el backend pero FASE 9 está
 * diferida hasta pedido explícito del usuario, así que la columna no se muestra
 * para no crear expectativa de que ya funciona.
 */
const CATEGORY_LABELS: Readonly<Record<NotificationCategory, { label: string; description: string }>> = {
  AccountSecurity: {
    label: 'Account & security',
    description: 'Password changes, MFA, suspicious sign-ins — mandatory, cannot be disabled.',
  },
  DocumentsAndSignatures: {
    label: 'Documents & signatures',
    description: 'Signer completed a document, request completed, rejections, verification lockouts.',
  },
  StorageAndQuota: {
    label: 'Storage & quota',
    description: 'File blocks, legal holds, DMCA notices, storage limits, shared link activity.',
  },
  Billing: {
    label: 'Billing',
    description: 'Invoice payments, subscription changes, payment account alerts.',
  },
  Collaboration: {
    label: 'Collaboration',
    description: 'Tasks assigned to you, mentions, requests waiting on your action.',
  },
  Reminders: {
    label: 'Reminders',
    description: 'Personal reminders you scheduled for yourself.',
  },
  ClientRequests: {
    label: 'Client requests',
    description: 'What the office asked a client for and the client has not sent yet.',
  },
  Calendar: {
    label: 'Calendar',
    description: 'Appointment invitations, reschedules, cancellations and start-time reminders.',
  },
};

const DISPLAY_CHANNELS: readonly NotificationChannel[] = ['InApp', 'Email', 'Sms'];
const CHANNEL_LABELS: Readonly<Record<NotificationChannel, string>> = {
  InApp: 'In-app',
  Email: 'Email',
  Sms: 'SMS',
  Push: 'Push',
};

@Component({
  selector: 'app-notification-preferences-page',
  imports: [CommonModule, StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './notification-preferences-page.component.html',
})
export class NotificationPreferencesPageComponent implements OnInit {
  private readonly service = inject(NotificationPreferencesService);

  readonly loading = signal(true);
  readonly saving = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly preferences = signal<readonly NotificationPreference[]>([]);

  readonly channels = DISPLAY_CHANNELS;
  readonly categoryRows = computed(() => {
    const byCategory = new Map<NotificationCategory, NotificationPreference[]>();
    for (const pref of this.preferences()) {
      if (!DISPLAY_CHANNELS.includes(pref.channel)) continue;
      const list = byCategory.get(pref.category) ?? [];
      list.push(pref);
      byCategory.set(pref.category, list);
    }
    const categories = Object.keys(CATEGORY_LABELS) as NotificationCategory[];
    return categories
      .filter((category) => byCategory.has(category))
      .map((category) => ({
        category,
        label: CATEGORY_LABELS[category].label,
        description: CATEGORY_LABELS[category].description,
        locked: byCategory.get(category)![0]?.locked ?? false,
        cells: DISPLAY_CHANNELS.map((channel) =>
          byCategory.get(category)!.find((p) => p.channel === channel) ?? {
            category,
            channel,
            enabled: true,
            locked: false,
          },
        ),
      }));
  });

  ngOnInit(): void {
    this.load();
  }

  labelFor(channel: NotificationChannel): string {
    return CHANNEL_LABELS[channel];
  }

  cellKey(category: NotificationCategory, channel: NotificationChannel): string {
    return `${category}:${channel}`;
  }

  toggle(pref: NotificationPreference): void {
    if (pref.locked) return;
    const key = this.cellKey(pref.category, pref.channel);
    if (this.saving() === key) return;
    const nextEnabled = !pref.enabled;
    // Optimista: patch local + request. Rollback silencioso si falla.
    this.patchLocally(pref.category, pref.channel, nextEnabled);
    this.saving.set(key);
    this.service.set({ category: pref.category, channel: pref.channel, enabled: nextEnabled }).subscribe({
      next: () => {
        this.saving.set(null);
      },
      error: (err) => {
        this.patchLocally(pref.category, pref.channel, pref.enabled);
        this.error.set(toApiError(err).message);
        this.saving.set(null);
      },
    });
  }

  retry(): void {
    this.error.set(null);
    this.load();
  }

  isSaving(category: NotificationCategory, channel: NotificationChannel): boolean {
    return this.saving() === this.cellKey(category, channel);
  }

  private load(): void {
    this.loading.set(true);
    this.service.list().subscribe({
      next: (list) => {
        this.preferences.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }

  private patchLocally(category: NotificationCategory, channel: NotificationChannel, enabled: boolean): void {
    this.preferences.update((list) =>
      list.map((p) => (p.category === category && p.channel === channel ? { ...p, enabled } : p)),
    );
  }
}
