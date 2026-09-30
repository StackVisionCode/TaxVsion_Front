import {
  ApiBusinessStructure,
  CustomerDetailResponse,
  CustomerLanguage,
  PreferredChannel,
  UpdateCustomerRequest,
} from './clients.model';

/**
 * Edición por sección de la pestaña Info (Contact / Personal / Business).
 *
 * Contrato real de `PATCH /customers/{id}` (UpdateCustomerHandler, verificado en origin/Develop):
 * NO es un PATCH puro. Idioma, canal preferido, ocupación, email y teléfono se aplican SIEMPRE
 * (un null en `occupationId` o `primaryPhone` los BORRA). Las partes de identidad (nombre,
 * razón social, estructura, formación, actividad) y la fecha de nacimiento sí se fusionan: null
 * conserva el valor actual.
 *
 * Por eso cada modal edita solo sus campos, pero lo que se envía es el detalle ACTUAL del cliente
 * (recién leído) con la sección superpuesta: así editar el nombre no borra el teléfono ni la
 * ocupación. `profilePictureFileId` no se puede preservar: el detalle no lo devuelve (limitación
 * previa, igual que el formulario completo).
 */
export type ClientEditSection = 'contact' | 'personal' | 'business';

export interface ContactSectionDraft {
  section: 'contact';
  email: string;
  /** E.164 o '' (sin teléfono). */
  phone: string;
  language: CustomerLanguage;
  preferredChannel: PreferredChannel;
}

export interface PersonalSectionDraft {
  section: 'personal';
  firstName: string;
  middleName: string;
  lastName: string;
  /** yyyy-MM-dd o '' (vacío = conservar la actual; el backend no permite borrarla). */
  dateOfBirth: string;
  occupationId: string | null;
  /** Solo para pintar el picker; no viaja al backend. */
  occupationName: string | null;
}

export interface BusinessSectionDraft {
  section: 'business';
  legalName: string;
  /** null = conservar la estructura actual (el detalle no la devuelve, así que no se conoce). */
  businessStructure: ApiBusinessStructure | null;
  /** yyyy-MM-dd o '' (vacío = conservar la actual). */
  formationDate: string;
  principalBusinessActivityId: string | null;
  /** Solo para pintar el picker; no viaja al backend. */
  principalBusinessActivityName: string | null;
}

export type ClientSectionDraft = ContactSectionDraft | PersonalSectionDraft | BusinessSectionDraft;

/** Título del modal por sección (copy en inglés). */
export const SECTION_HEADINGS: Record<ClientEditSection, { heading: string; subheading: string }> = {
  contact: { heading: 'Edit contact information', subheading: 'Email, phone and how this client prefers to be reached' },
  personal: { heading: 'Edit personal details', subheading: 'Name, date of birth and occupation' },
  business: { heading: 'Edit business details', subheading: 'Legal name, structure, formation date and activity' },
};

/** Borrador inicial de una sección a partir del detalle real (GET /customers/{id}). */
export function sectionDraftFromDetail(detail: CustomerDetailResponse, section: ClientEditSection): ClientSectionDraft {
  switch (section) {
    case 'contact':
      return {
        section,
        email: detail.primaryEmail ?? '',
        phone: detail.primaryPhone ?? '',
        language: detail.language,
        preferredChannel: detail.preferredChannel,
      };
    case 'personal':
      return {
        section,
        firstName: detail.firstName ?? '',
        middleName: detail.middleName ?? '',
        lastName: detail.lastName ?? '',
        dateOfBirth: detail.dateOfBirth ?? '',
        occupationId: detail.occupationId,
        occupationName: detail.occupationName,
      };
    case 'business':
      return {
        section,
        legalName: detail.legalName ?? detail.displayName ?? '',
        businessStructure: null,
        formationDate: '',
        principalBusinessActivityId: detail.principalBusinessActivityId,
        principalBusinessActivityName: detail.principalBusinessActivityName,
      };
  }
}

/**
 * Lo que el PATCH aplica siempre, tomado tal cual del detalle actual. Los campos de identidad
 * van en null (= conservar), así una sección que no los toca no los cambia.
 */
export function baseUpdateFromDetail(detail: CustomerDetailResponse): UpdateCustomerRequest {
  return {
    language: detail.language,
    preferredChannel: detail.preferredChannel,
    occupationId: detail.occupationId ?? null,
    primaryEmail: detail.primaryEmail,
    primaryPhone: detail.primaryPhone ?? null,
    firstName: null,
    middleName: null,
    lastName: null,
    dateOfBirth: null,
    legalName: null,
    businessStructure: null,
    formationDate: null,
    principalBusinessActivityId: null,
  };
}

/** Detalle actual + la sección editada → body completo y seguro del PATCH. */
export function buildSectionUpdate(detail: CustomerDetailResponse, draft: ClientSectionDraft): UpdateCustomerRequest {
  const base = baseUpdateFromDetail(detail);
  switch (draft.section) {
    case 'contact':
      return {
        ...base,
        primaryEmail: draft.email.trim(),
        primaryPhone: draft.phone.trim() || null,
        language: draft.language,
        preferredChannel: draft.preferredChannel,
      };
    case 'personal':
      return {
        ...base,
        firstName: draft.firstName.trim(),
        // '' (no null) para poder BORRAR el segundo nombre: el backend fusiona con `??`, y el VO
        // normaliza el vacío a null.
        middleName: draft.middleName.trim(),
        lastName: draft.lastName.trim(),
        dateOfBirth: draft.dateOfBirth || null,
        occupationId: draft.occupationId,
      };
    case 'business':
      return {
        ...base,
        legalName: draft.legalName.trim(),
        businessStructure: draft.businessStructure,
        formationDate: draft.formationDate || null,
        principalBusinessActivityId: draft.principalBusinessActivityId,
      };
  }
}
