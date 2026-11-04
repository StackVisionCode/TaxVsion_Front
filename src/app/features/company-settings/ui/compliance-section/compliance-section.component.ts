import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, input, output } from '@angular/core';
import {
  ComplianceForm,
  OfficeCompliance,
  RETENTION_YEARS_MAX,
  RETENTION_YEARS_MIN,
} from '../../data-access/company-settings.model';
import { canMarkWispReviewedToday, isWispReviewDue } from '../../utils/compliance-rules';
import { FormField } from '../../utils/office-profile-rules';
import { SectionHeaderComponent } from '../section-header/section-header.component';

type Errors = Partial<Record<FormField, string>>;

/** Opción del selector de responsable de seguridad. */
export interface CoordinatorOption {
  userId: string;
  label: string;
}

/**
 * Cumplimiento (solo TenantAdmin): EFIN enmascarado con Reveal auditado, responsable de seguridad, fechas del
 * WISP, contacto ante incidentes y retención de registros.
 */
@Component({
  selector: 'app-compliance-section',
  imports: [SectionHeaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './compliance-section.component.html',
})
export class ComplianceSectionComponent {
  readonly form = input.required<ComplianceForm>();
  readonly compliance = input<OfficeCompliance | null>(null);
  readonly revealedEfin = input<string | null>(null);
  readonly revealing = input(false);
  readonly coordinators = input<CoordinatorOption[]>([]);
  /** Sin `users.view` no hay lista del equipo: el responsable no se puede cambiar. */
  readonly canListStaff = input(true);
  readonly today = input.required<string>();
  readonly disabled = input(false);
  readonly errors = input<Errors>({});
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  readonly formChange = output<ComplianceForm>();
  readonly touched = output<FormField>();
  readonly reveal = output<void>();
  readonly hide = output<void>();

  readonly retentionOptions = Array.from(
    { length: RETENTION_YEARS_MAX - RETENTION_YEARS_MIN + 1 },
    (_, i) => RETENTION_YEARS_MIN + i,
  );

  readonly reviewDue = computed(() =>
    isWispReviewDue(this.form().wispAdoptedOn, this.form().wispLastReviewedOn, this.today()),
  );

  readonly canMarkReviewedToday = computed(
    () => !this.disabled() && canMarkWispReviewedToday(this.form().wispAdoptedOn, this.form().wispLastReviewedOn, this.today()),
  );

  /** El responsable guardado aunque ya no esté en la lista (retirado o sin permiso para listar). */
  readonly coordinatorOptions = computed<CoordinatorOption[]>(() => {
    const options = this.coordinators();
    const current = this.form().securityCoordinatorUserId;
    if (!current || options.some(o => o.userId === current)) return options;
    return [...options, { userId: current, label: 'Former team member' }];
  });

  /** Queda como cambio sin guardar, igual que editar la fecha a mano. */
  markReviewedToday(): void {
    if (this.canMarkReviewedToday()) this.patch({ wispLastReviewedOn: this.today() });
  }

  set(key: keyof ComplianceForm, event: Event): void {
    this.patch({ [key]: (event.target as HTMLInputElement).value });
  }

  /** Solo dígitos, máximo 6. */
  efinInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const digits = el.value.replace(/\D/g, '').slice(0, 6);
    el.value = digits;
    this.patch({ efin: digits });
  }

  startEfinChange(): void {
    this.hide.emit();
    this.patch({ efinAction: 'change', efin: '' });
  }

  removeEfin(): void {
    this.hide.emit();
    this.patch({ efinAction: 'clear', efin: '' });
  }

  keepEfin(): void {
    this.patch({ efinAction: 'keep', efin: '' });
  }

  private patch(patch: Partial<ComplianceForm>): void {
    this.formChange.emit({ ...this.form(), ...patch });
  }
}
