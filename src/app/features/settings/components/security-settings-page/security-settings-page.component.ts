import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toApiError } from '@core/models/api-error.model';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { MfaPolicy, MfaPolicyService, MfaPolicyUpdate } from '../../data-access/mfa-policy.service';

/** Opciones habituales de "recordar dispositivo"; el valor guardado se suma si es otro (1–90). */
const TRUSTED_DAY_OPTIONS = [7, 14, 30, 60, 90];

/**
 * Settings → Security: a quién exige la oficina el segundo factor (empleados, portal de clientes) y cuánto
 * se recuerda un dispositivo de confianza. Los administradores los fija la plataforma (solo lectura).
 * Exigirlo a los clientes no les quita la opción de activarlo por su cuenta: la amplía a todos.
 */
@Component({
  selector: 'app-security-settings-page',
  imports: [RouterLink, SwitchComponent, StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './security-settings-page.component.html',
})
export class SecuritySettingsPageComponent implements OnInit {
  private readonly service = inject(MfaPolicyService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  /** Lo guardado (para saber si hay cambios) y lo que se está editando. */
  readonly saved = signal<MfaPolicy | null>(null);
  readonly draft = signal<MfaPolicyUpdate | null>(null);

  readonly dayOptions = computed(() => {
    const current = this.draft()?.trustedDeviceDays;
    return current && !TRUSTED_DAY_OPTIONS.includes(current)
      ? [...TRUSTED_DAY_OPTIONS, current].sort((a, b) => a - b)
      : TRUSTED_DAY_OPTIONS;
  });

  readonly dirty = computed(() => {
    const saved = this.saved();
    const draft = this.draft();
    return (
      !!saved &&
      !!draft &&
      (saved.requireForEmployees !== draft.requireForEmployees ||
        saved.requireForCustomerPortal !== draft.requireForCustomerPortal ||
        saved.trustedDeviceDays !== draft.trustedDeviceDays)
    );
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.get().subscribe({
      next: policy => {
        this.saved.set(policy);
        this.draft.set(this.editable(policy));
        this.loading.set(false);
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }

  set<K extends keyof MfaPolicyUpdate>(key: K, value: MfaPolicyUpdate[K]): void {
    this.draft.update(draft => (draft ? { ...draft, [key]: value } : draft));
  }

  onDaysChange(value: string): void {
    this.set('trustedDeviceDays', Number(value));
  }

  discard(): void {
    const saved = this.saved();
    if (saved) this.draft.set(this.editable(saved));
  }

  save(): void {
    const draft = this.draft();
    if (!draft || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.service.update(draft).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.update(saved => (saved ? { ...saved, ...draft } : saved));
        this.toast.success('Security settings saved');
      },
      error: err => {
        this.saving.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  private editable(policy: MfaPolicy): MfaPolicyUpdate {
    return {
      requireForEmployees: policy.requireForEmployees,
      requireForCustomerPortal: policy.requireForCustomerPortal,
      trustedDeviceDays: policy.trustedDeviceDays,
    };
  }
}
