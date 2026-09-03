import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClientProfile } from '../../models/client-profile.model';
import { CustomerLanguage, PreferredChannel } from '../../data-access/clients.model';
import { ApiTaskPriority } from '../../data-access/client-work.model';
import { ClientOverviewStore } from '../../data-access/client-overview.store';
import { CountUpDirective } from '../../../../shared/directives/count-up.directive';
import { formatPhoneForDisplay } from '../../utils/customer-form-normalizers';

const LANGUAGE_LABELS: Record<CustomerLanguage, string> = {
  En: 'English',
  Es: 'Spanish',
  Pt: 'Portuguese',
  Fr: 'French',
};

const CHANNEL_LABELS: Record<PreferredChannel, string> = {
  Email: 'Email',
  Sms: 'SMS',
  Call: 'Phone call',
};

const FILING_LABELS: Record<string, string> = {
  Single: 'Single',
  MarriedJoint: 'Married filing jointly',
  MarriedSeparate: 'Married filing separately',
  HeadOfHousehold: 'Head of household',
  QualifyingSurvivingSpouse: 'Qualifying surviving spouse',
};

const PRIORITY_LABELS: Record<ApiTaskPriority, string> = {
  Urgent: 'Urgent',
  High: 'High',
  Normal: 'Normal',
  Low: 'Low',
};

/** Chip de prioridad (mismos tonos que la tabla del tab Work). */
const PRIORITY_CHIPS: Record<ApiTaskPriority, string> = {
  Urgent: 'border-red-200 bg-red-50 text-red-600',
  High: 'border-amber-200 bg-amber-50 text-amber-600',
  Normal: 'border-gray-200 bg-gray-50 text-gray-500',
  Low: 'border-gray-200 bg-gray-50 text-gray-400',
};

/**
 * Tab "Overview" del perfil: el "360 de un vistazo". Combina lo que sale del cliente real
 * (GET /customers/{id}: antigüedad, cómo contactarlo, snapshot fiscal enmascarado) con un
 * resumen agregado de tres listados REALES por cliente vía `ClientOverviewStore` — tareas
 * abiertas, documentos e hilos de email — que alimentan las stats, "Needs attention" y
 * "Recent activity". Cada agregado tolera falta de permiso (queda en 0/vacío, no rompe la vista).
 */
@Component({
  selector: 'app-client-profile-overview',
  imports: [CommonModule, CountUpDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-overview.component.html',
})
export class ClientProfileOverviewComponent implements OnChanges {
  @Input() client!: ClientProfile;

  readonly summary = inject(ClientOverviewStore);

  ngOnChanges(): void {
    if (this.client?.id) {
      this.summary.load(this.client.id);
    }
  }

  firstName(): string {
    return this.client.displayName.trim().split(/\s+/)[0] || this.client.displayName;
  }

  // ---------- Resumen (Needs attention / Recent activity) ----------

  priorityLabel(priority: ApiTaskPriority): string {
    return PRIORITY_LABELS[priority] ?? priority;
  }

  priorityChip(priority: ApiTaskPriority): string {
    return PRIORITY_CHIPS[priority] ?? PRIORITY_CHIPS.Normal;
  }

  /** "Mar 15" a partir de YYYY-MM-DD; '' si la tarea no tiene vencimiento. */
  dueLabel(dueDate: string): string {
    if (!dueDate) {
      return '';
    }
    const date = new Date(`${dueDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  phoneDisplay(): string {
    return this.client.phone ? formatPhoneForDisplay(this.client.phone) : '—';
  }

  languageLabel(): string {
    return LANGUAGE_LABELS[this.client.language] ?? this.client.language;
  }

  channelLabel(): string {
    return CHANNEL_LABELS[this.client.preferredChannel] ?? this.client.preferredChannel;
  }

  clientSince(): string {
    const created = new Date(`${this.client.createdAt}T00:00:00`);
    const now = new Date();
    let months = (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
    if (now.getDate() < created.getDate()) {
      months -= 1;
    }
    months = Math.max(0, months);
    if (months < 1) {
      return 'This month';
    }
    if (months < 12) {
      return `${months} ${months === 1 ? 'month' : 'months'}`;
    }
    const years = Math.floor(months / 12);
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }

  // ---------- Snapshot fiscal (enmascarado) ----------

  get hasFiscal(): boolean {
    return this.client.fiscalProfile !== null;
  }

  taxIdKindLabel(): string {
    return this.client.fiscalProfile?.subjectKind === 'Business' ? 'EIN' : 'SSN/ITIN';
  }

  taxIdMasked(): string {
    const f = this.client.fiscalProfile;
    if (!f?.taxIdentifierLast4) {
      return '—';
    }
    return f.subjectKind === 'Business' ? `••-•••${f.taxIdentifierLast4}` : `•••-••-${f.taxIdentifierLast4}`;
  }

  filingLabel(): string {
    const status = this.client.fiscalProfile?.filingStatus;
    return status ? (FILING_LABELS[status] ?? status) : '—';
  }

  returningLabel(): string {
    return this.client.fiscalProfile?.isReturningCustomer ? 'Yes' : 'No';
  }
}
