import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { CheckRingComponent } from '@shared/ui/check-ring/check-ring.component';
import { observeActiveSection, scrollToSection } from '@shared/utils/scroll-spy.util';
import { buildTimeZoneGroups } from '@shared/utils/time-zone.util';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AuthService } from '@core/auth/auth.service';
import { AccessStore } from '@core/access/access.store';
import { AdminCapabilities } from '@core/access/admin-capabilities';
import { StaffDirectoryStore } from '@core/staff/staff-directory.store';
import {
  CompanyProfile,
  ComplianceForm,
  InvoiceSettings,
  UpdateOfficeIdentityRequest,
} from '../../data-access/company-settings.model';
import { CompanySettingsStore, SettingsChanges, SettingsPart } from '../../data-access/company-settings.store';
import { CompanyBrandStore } from '../../data-access/company-brand.store';
import { EMPTY_OFFICE_PROFILE, profileChanged, toCompanyProfile } from '../../data-access/office-profile.mapper';
import {
  COMPLIANCE_KEY_FIELD,
  complianceDirty,
  complianceErrors,
  toComplianceForm,
  toComplianceRequest,
  todayIsoIn,
} from '../../utils/compliance-rules';
import {
  invoiceErrors,
  invoiceSettingsChanged,
  normalizeInvoiceSettings,
  paymentTermsLabel,
} from '../../utils/invoice-settings-rules';
import {
  FormField,
  isUsCountry,
  normalizeEin,
  normalizePhone,
  normalizeWebsite,
  normalizeZip,
} from '../../utils/office-profile-rules';
import { PROFILE_KEY_FIELDS, invoiceReadiness, profileErrors } from '../../utils/profile-form';
import { OFFICE_NAME_MAX, OfficeSectionComponent } from '../../ui/office-section/office-section.component';
import { IdentitySectionComponent } from '../../ui/identity-section/identity-section.component';
import { AddressSectionComponent } from '../../ui/address-section/address-section.component';
import { ClientExperienceSectionComponent } from '../../ui/client-experience-section/client-experience-section.component';
import { InvoicingSectionComponent } from '../../ui/invoicing-section/invoicing-section.component';
import { InvoicePreviewComponent } from '../../ui/invoice-preview/invoice-preview.component';
import { ComplianceSectionComponent, CoordinatorOption } from '../../ui/compliance-section/compliance-section.component';
import { BrandSectionComponent } from '../brand-section/brand-section.component';

type Errors = Partial<Record<FormField, string>>;

interface SettingsSection {
  id: string;
  label: string;
  icon: string;
}

/** Listar el equipo (`GET /auth/users`) para elegir el responsable de seguridad. */
const USERS_VIEW = 'users.view';

const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = { paymentTerms: 'DueOnReceipt', paymentInstructions: null, invoiceFooter: null };

/** Sección del índice a la que lleva el error de cada parte. */
const PART_SECTION: Record<SettingsPart, string> = {
  office: 'office',
  profile: 'identity',
  invoice: 'invoicing',
  compliance: 'compliance',
};

/**
 * Office Settings: oficina, identidad, direcciones, experiencia del cliente, factura, cumplimiento y marca.
 * La página tiene los borradores y la validación; el store carga y guarda cada parte; las secciones de `ui/`
 * solo pintan y emiten cambios.
 *
 * Permisos reales de cada backend, para no disparar nunca una llamada que dé 403:
 * - Oficina (`/tenants/current`): leer y guardar con `settings.manage`.
 * - Perfil: lo lee cualquiera; editarlo pide `settings.manage`.
 * - Factura (Billing): leer con `invoicing.view`, guardar con `invoicing.issuer.manage`.
 * - Cumplimiento: actor TenantAdmin + `settings.manage`; para el resto ni se carga ni se muestra.
 * - Marca: la lee cualquiera; la cambia `branding.manage` (se guarda al subir, fuera de la barra).
 * Una sola barra de guardado: guarda en paralelo solo las partes que cambiaron.
 */
@Component({
  selector: 'app-company-settings-page',
  imports: [
    NgClass,
    CheckRingComponent,
    OfficeSectionComponent,
    IdentitySectionComponent,
    AddressSectionComponent,
    ClientExperienceSectionComponent,
    InvoicingSectionComponent,
    InvoicePreviewComponent,
    ComplianceSectionComponent,
    BrandSectionComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './company-settings-page.component.html',
  styleUrl: './company-settings-page.component.css',
})
export class CompanySettingsPageComponent {
  protected readonly can = inject(AdminCapabilities);
  private readonly access = inject(AccessStore);
  readonly store = inject(CompanySettingsStore);
  readonly brand = inject(CompanyBrandStore);
  private readonly staff = inject(StaffDirectoryStore);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  /** Hoy en la zona de la oficina (la guardada); sin oficina cargada, la del navegador. */
  readonly today = computed(() => todayIsoIn(this.store.office()?.defaultTimeZoneId));

  // --- Qué ve y qué edita este usuario ---
  readonly showOffice = computed(() => this.can.canManageSettings());
  readonly showInvoicing = computed(() => this.can.canViewInvoices());
  readonly showCompliance = computed(() => this.can.canManageCompliance());
  readonly canListStaff = computed(() => this.access.can(USERS_VIEW));
  /** Sin perfil cargado no se edita: el PUT es de estado completo y vaciaría lo que no se muestra. */
  readonly canEditProfile = computed(
    () => this.can.canManageOfficeProfile() && !!this.store.officeProfile() && !this.store.profileLoading(),
  );
  readonly canEditOffice = computed(() => this.showOffice() && !!this.store.office() && !this.store.officeLoading());
  readonly canEditInvoice = computed(
    () => this.can.canManageInvoiceSettings() && !!this.store.invoiceSettings() && !this.store.invoiceLoading(),
  );
  readonly canEditCompliance = computed(
    () => this.showCompliance() && !!this.store.compliance() && !this.store.complianceLoading(),
  );

  // --- Borradores (espejo editable de lo cargado) ---
  readonly officeDraft = signal<UpdateOfficeIdentityRequest | null>(null);
  readonly profileDraft = signal<CompanyProfile>(toCompanyProfile(EMPTY_OFFICE_PROFILE));
  readonly invoiceDraft = signal<InvoiceSettings>(DEFAULT_INVOICE_SETTINGS);
  readonly complianceDraft = signal<ComplianceForm>(toComplianceForm(null));

  readonly timeZoneGroups = computed(() => buildTimeZoneGroups(this.store.office()?.defaultTimeZoneId));

  /** Responsable de seguridad: el equipo activo (nombre y correo para distinguir homónimos). */
  readonly coordinatorOptions = computed<CoordinatorOption[]>(() =>
    this.staff.assignable().map(m => ({ userId: m.userId, label: `${m.name} · ${m.email}` })),
  );

  /** Cabecera: nombre visible de la oficina; si no se cargó, el de la sesión, el DBA o el legal. */
  readonly officeName = computed(() => {
    const saved = this.store.officeProfile();
    return (
      this.store.office()?.name ||
      this.auth.currentUser()?.tenant?.name ||
      saved?.displayName ||
      saved?.legalName ||
      'Office settings'
    );
  });

  // ---------------------------------------------------------------------------
  // Índice lateral (solo las secciones que este usuario ve)
  // ---------------------------------------------------------------------------
  readonly sections = computed<SettingsSection[]>(() => [
    { id: 'office', label: 'Office', icon: 'globe-outline' },
    { id: 'identity', label: 'Business identity', icon: 'business-outline' },
    { id: 'address', label: 'Addresses', icon: 'location-outline' },
    { id: 'experience', label: 'Client experience', icon: 'time-outline' },
    ...(this.showInvoicing() ? [{ id: 'invoicing', label: 'Invoicing', icon: 'card-outline' }] : []),
    { id: 'preview', label: 'Invoice preview', icon: 'receipt-outline' },
    ...(this.showCompliance() ? [{ id: 'compliance', label: 'Compliance', icon: 'shield-checkmark-outline' }] : []),
    { id: 'brand', label: 'Logo & favicon', icon: 'color-palette-outline' },
  ]);
  readonly activeSection = signal('office');

  constructor() {
    this.store.loadAll({ office: this.showOffice(), invoice: this.showInvoicing(), compliance: this.showCompliance() });
    this.brand.loadBrand();
    if (this.showCompliance() && this.canListStaff()) {
      this.staff.ensureLoaded();
    }

    // Al llegar cada parte del backend (o tras guardarla) se vuelca a su borrador.
    effect(() => {
      const office = this.store.office();
      untracked(() =>
        this.officeDraft.set(office ? { name: office.name ?? '', defaultTimeZoneId: office.defaultTimeZoneId ?? '' } : null),
      );
    });
    effect(() => {
      const profile = this.store.officeProfile();
      if (profile) untracked(() => this.profileDraft.set(toCompanyProfile(profile)));
    });
    effect(() => {
      const settings = this.store.invoiceSettings();
      if (settings) untracked(() => this.invoiceDraft.set({ ...settings }));
    });
    effect(() => {
      const compliance = this.store.compliance();
      untracked(() => this.complianceDraft.set(toComplianceForm(compliance)));
    });

    afterNextRender(() => {
      const stop = observeActiveSection(
        this.host.nativeElement as HTMLElement,
        this.sections().map(s => s.id),
        id => this.activeSection.set(id),
      );
      this.destroyRef.onDestroy(stop);
      // Enlaces a una sección (p. ej. /company/settings#compliance desde Signature o un aviso).
      const fragment = this.host.nativeElement.ownerDocument.defaultView?.location.hash.slice(1);
      if (fragment && this.sections().some(s => s.id === fragment)) this.scrollTo(fragment);
    });
    // El EFIN revelado no sobrevive a la página.
    this.destroyRef.onDestroy(() => this.store.hideEfin());
  }

  scrollTo(sectionId: string): void {
    scrollToSection(this.host.nativeElement as HTMLElement, sectionId);
    this.activeSection.set(sectionId);
  }

  // ---------------------------------------------------------------------------
  // Validación (mismas reglas y mensajes que los backends)
  // ---------------------------------------------------------------------------
  private readonly officeErrors = computed<Errors>(() => {
    const draft = this.officeDraft();
    if (!draft) return {};
    const name = draft.name.trim();
    if (!name) return { officeName: 'The office name is required.' };
    return name.length > OFFICE_NAME_MAX
      ? { officeName: `The office name cannot exceed ${OFFICE_NAME_MAX} characters.` }
      : {};
  });
  private readonly partErrors = computed<Record<SettingsPart, Errors>>(() => ({
    office: this.officeErrors(),
    profile: profileErrors(this.profileDraft()),
    invoice: invoiceErrors(this.invoiceDraft()),
    compliance: complianceErrors(this.complianceDraft(), this.today()),
  }));

  /** Campos que el usuario ya dejó (blur): recién ahí se muestra su error de formato. */
  private readonly touched = signal<ReadonlySet<FormField>>(new Set());
  /** Se intentó guardar con errores: se muestran todos. */
  readonly submitAttempted = signal(false);

  /** Lo que se pinta junto a cada campo: el error local ya visible o, si no, el 400 del backend. */
  readonly errors = computed<Errors>(() => {
    const shown: Errors = { ...this.store.fieldErrors() };
    for (const part of Object.values(this.partErrors())) {
      for (const [field, message] of Object.entries(part) as [FormField, string][]) {
        // El nombre de la oficina solo puede faltar si el usuario lo borró: se avisa enseguida.
        if (field === 'officeName' || this.submitAttempted() || this.touched().has(field)) {
          shown[field] = message;
        }
      }
    }
    return shown;
  });

  // ---------------------------------------------------------------------------
  // Cambios sin guardar
  // ---------------------------------------------------------------------------
  readonly officeDirty = computed(() => {
    const office = this.store.office();
    const draft = this.officeDraft();
    return (
      !!office &&
      !!draft &&
      (draft.name.trim() !== (office.name ?? '').trim() || draft.defaultTimeZoneId !== office.defaultTimeZoneId)
    );
  });
  readonly profileDirty = computed(() => {
    const loaded = this.store.officeProfile();
    return !!loaded && profileChanged(loaded, this.profileDraft());
  });
  readonly invoiceDirty = computed(() => {
    const loaded = this.store.invoiceSettings();
    return !!loaded && invoiceSettingsChanged(this.invoiceDraft(), loaded);
  });
  readonly complianceDirty = computed(
    () => !!this.store.compliance() && complianceDirty(this.complianceDraft(), this.store.compliance()),
  );

  /** Partes con cambios que este usuario puede guardar. */
  readonly pendingParts = computed<SettingsPart[]>(() => {
    const parts: SettingsPart[] = [];
    if (this.officeDirty() && this.canEditOffice()) parts.push('office');
    if (this.profileDirty() && this.canEditProfile()) parts.push('profile');
    if (this.invoiceDirty() && this.canEditInvoice()) parts.push('invoice');
    if (this.complianceDirty() && this.canEditCompliance()) parts.push('compliance');
    return parts;
  });

  private readonly pendingHasErrors = computed(() =>
    this.pendingParts().some(part => Object.keys(this.partErrors()[part]).length > 0),
  );

  readonly showSaveBar = computed(() => this.pendingParts().length > 0);
  readonly saving = computed(() => this.store.saving());
  private readonly officeNameMissing = computed(
    () => this.pendingParts().includes('office') && !!this.officeErrors().officeName,
  );

  readonly saveBlockedReason = computed<string | null>(() => {
    if (this.officeNameMissing()) return 'Add the office name to save';
    if (this.submitAttempted() && this.pendingHasErrors()) return 'Fix the highlighted fields to save';
    return null;
  });

  readonly canSave = computed(() => this.showSaveBar() && !this.saving() && !this.officeNameMissing());

  // ---------------------------------------------------------------------------
  // Edición
  // ---------------------------------------------------------------------------
  patchOffice(value: UpdateOfficeIdentityRequest): void {
    this.officeDraft.set(value);
  }

  patchProfile(patch: Partial<CompanyProfile>): void {
    const before = this.profileDraft();
    this.profileDraft.set({ ...before, ...patch });
    for (const key of Object.keys(patch) as (keyof CompanyProfile)[]) {
      // Solo lo que cambió de verdad (normalizar al salir no borra el 400 del backend).
      if (JSON.stringify(patch[key]) !== JSON.stringify(before[key])) {
        PROFILE_KEY_FIELDS[key]?.forEach(field => this.store.clearFieldError(field));
      }
    }
  }

  patchInvoice(value: InvoiceSettings): void {
    const before = this.invoiceDraft();
    this.invoiceDraft.set(value);
    for (const key of Object.keys(value) as (keyof InvoiceSettings)[]) {
      if (value[key] !== before[key]) this.store.clearFieldError(key);
    }
  }

  patchCompliance(value: ComplianceForm): void {
    const before = this.complianceDraft();
    this.complianceDraft.set(value);
    for (const key of Object.keys(value) as (keyof ComplianceForm)[]) {
      if (value[key] !== before[key]) this.store.clearFieldError(COMPLIANCE_KEY_FIELD[key]);
    }
  }

  /** Al salir del campo: se marca tocado y, si es válido, se deja en el formato que guarda el backend. */
  onBlur(field: FormField): void {
    this.touched.update(set => new Set(set).add(field));
    const parts = this.partErrors();
    if (parts.profile[field] || parts.compliance[field]) {
      return;
    }
    const p = this.profileDraft();
    const upper = (state: string, country: string) => (isUsCountry(country) ? state.trim().toUpperCase() : state.trim());
    switch (field) {
      case 'taxId':
        return this.patchProfile({ taxId: normalizeEin(p.taxId) });
      case 'phone':
        return this.patchProfile({ phone: normalizePhone(p.phone) });
      case 'website':
        return this.patchProfile({ website: normalizeWebsite(p.website) });
      case 'bookingUrl':
        return this.patchProfile({ bookingUrl: normalizeWebsite(p.bookingUrl) });
      case 'reviewUrl':
        return this.patchProfile({ reviewUrl: normalizeWebsite(p.reviewUrl) });
      case 'state':
        return this.patchProfile({ physical: { ...p.physical, state: upper(p.physical.state, p.physical.country) } });
      case 'zip':
        return this.patchProfile({ physical: { ...p.physical, zip: normalizeZip(p.physical.zip, p.physical.country) } });
      case 'mailingState':
        return this.patchProfile({ mailing: { ...p.mailing, state: upper(p.mailing.state, p.mailing.country) } });
      case 'mailingZip':
        return this.patchProfile({ mailing: { ...p.mailing, zip: normalizeZip(p.mailing.zip, p.mailing.country) } });
      case 'incidentPhone': {
        const c = this.complianceDraft();
        return this.patchCompliance({ ...c, incidentContactPhone: normalizePhone(c.incidentContactPhone) });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Guardado conjunto
  // ---------------------------------------------------------------------------
  saveAll(): void {
    if (!this.canSave()) {
      return;
    }
    if (this.pendingHasErrors()) {
      // Con errores no se llama al backend: se muestran todos junto a su campo.
      this.submitAttempted.set(true);
      return;
    }
    const parts = this.pendingParts();
    const office = this.officeDraft();
    const changes: SettingsChanges = {
      office:
        parts.includes('office') && office
          ? { name: office.name.trim(), defaultTimeZoneId: office.defaultTimeZoneId }
          : undefined,
      profile: parts.includes('profile') ? this.profileDraft() : undefined,
      invoice: parts.includes('invoice') ? normalizeInvoiceSettings(this.invoiceDraft()) : undefined,
      compliance: parts.includes('compliance') ? toComplianceRequest(this.complianceDraft()) : undefined,
    };
    this.store.saveChanges(changes).subscribe(({ saved, failed }) => {
      if (failed.length === 0) {
        this.submitAttempted.set(false);
        this.touched.set(new Set());
        this.toast.success('Office details saved');
        return;
      }
      this.toast.error(
        saved.length
          ? 'Some changes were saved. Fix the highlighted fields and try again.'
          : 'Changes not saved. Fix the highlighted fields and try again.',
      );
      this.scrollTo(PART_SECTION[failed[0]]);
    });
  }

  discardAll(): void {
    const office = this.store.office();
    this.officeDraft.set(office ? { name: office.name ?? '', defaultTimeZoneId: office.defaultTimeZoneId ?? '' } : null);
    this.profileDraft.set(toCompanyProfile(this.store.officeProfile() ?? EMPTY_OFFICE_PROFILE));
    this.invoiceDraft.set({ ...(this.store.invoiceSettings() ?? DEFAULT_INVOICE_SETTINGS) });
    this.complianceDraft.set(toComplianceForm(this.store.compliance()));
    this.touched.set(new Set());
    this.submitAttempted.set(false);
    this.store.clearSaveErrors();
  }

  // ---------------------------------------------------------------------------
  // Cabecera y vista previa
  // ---------------------------------------------------------------------------
  /** Chequeo "Invoice details": lo guardado, no lo que se está escribiendo. */
  readonly readinessChecks = computed(() => {
    const saved = this.store.officeProfile();
    return invoiceReadiness(saved ? toCompanyProfile(saved) : null);
  });
  readonly readinessScore = computed(() => {
    const checks = this.readinessChecks();
    return Math.round((checks.filter(c => c.done).length / checks.length) * 100);
  });
  readonly readinessTone = computed<'strong' | 'good' | 'weak'>(() => {
    const score = this.readinessScore();
    return score === 100 ? 'strong' : score >= 50 ? 'good' : 'weak';
  });
  readonly readinessLabel = computed(() =>
    this.readinessTone() === 'strong'
      ? 'Ready for invoices'
      : this.readinessTone() === 'good'
        ? 'Almost ready'
        : 'Missing key details',
  );

  /** Plazo de la vista previa; null si este usuario no ve los ajustes de factura. */
  readonly previewTerms = computed(() =>
    this.showInvoicing() && this.store.invoiceSettings() ? paymentTermsLabel(this.invoiceDraft().paymentTerms) : null,
  );
}
