import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

const BUSINESS_STRUCTURES = [
  'Sole Proprietorship',
  'DBA',
  'LLC Single Member',
  'LLC Multi Member',
  'S-Corp',
  'C-Corp',
  'Partnership',
];

/**
 * Página del módulo Company Settings (estilo "Aether"): identidad legal de
 * la firma (nombre, marca, EIN, estructura de negocio, dirección), distinta
 * de Profile (usuario logueado) y de Settings (preferencias de la app). Todo
 * el estado es local: guardar solo simula persistencia con un toast
 * transitorio, sin backend real.
 */
@Component({
  selector: 'app-company-settings-page',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './company-settings-page.component.html',
})
export class CompanySettingsPageComponent {
  readonly structures = BUSINESS_STRUCTURES;

  readonly companyName = signal('Reyes Tax & Accounting');
  readonly brand = signal('TaxVision');
  readonly ein = signal('47-2913650');
  readonly phone = signal('(555) 214-7890');
  readonly businessStructure = signal('LLC Multi Member');
  readonly addressLine = signal('482 Riverside Drive, Suite 210');
  readonly city = signal('Austin');
  readonly state = signal('TX');
  readonly zip = signal('78701');
  readonly description = signal('Full-service tax preparation and bookkeeping for individuals and small businesses.');

  readonly isStructureOpen = signal(false);
  readonly toast = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="business-structure"]')) {
      this.isStructureOpen.set(false);
    }
  }

  toggleStructureDropdown(): void {
    this.isStructureOpen.update(open => !open);
  }

  selectStructure(structure: string): void {
    this.businessStructure.set(structure);
    this.isStructureOpen.set(false);
  }

  save(): void {
    this.toast.set('Company settings saved');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 2500);
  }
}
