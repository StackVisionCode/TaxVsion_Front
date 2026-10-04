import type {
  ApiBusinessStructure,
  CustomerDetailResponse,
  CustomerLanguage,
  PreferredChannel,
  UpdateCustomerRequest,
} from '../data-access/clients.model';

/** Sección de la pestaña Info que se edita en su propio modal. */
export type ClientSectionId = 'contact' | 'personal' | 'business';

export interface ContactSectionPatch {
  section: 'contact';
  primaryEmail: string;
  /** E.164, o null para quitar el teléfono principal. */
  primaryPhone: string | null;
  language: CustomerLanguage;
  preferredChannel: PreferredChannel;
}

export interface PersonalSectionPatch {
  section: 'personal';
  firstName: string;
  middleName: string | null;
  lastName: string;
  /** yyyy-MM-dd, o null = conservar la actual (el backend no permite borrarla). */
  dateOfBirth: string | null;
  /** null = sin ocupación (el backend la limpia). */
  occupationId: string | null;
}

export interface BusinessSectionPatch {
  section: 'business';
  legalName: string;
  /** null = conservar la actual (el detalle no la devuelve, así que no se conoce). */
  businessStructure: ApiBusinessStructure | null;
  /** yyyy-MM-dd, o null = conservar la actual. */
  formationDate: string | null;
  /** null = conservar la actual (el backend fusiona con `??`). */
  principalBusinessActivityId: string | null;
}

export type ClientSectionPatch = ContactSectionPatch | PersonalSectionPatch | BusinessSectionPatch;

/**
 * Arma el PATCH /customers/{id} de UNA sección sobre el detalle recién leído.
 *
 * Por qué hace falta (UpdateCustomerHandler del backend, verificado 2026-10):
 *  - language, preferredChannel, primaryEmail, primaryPhone y occupationId se APLICAN SIEMPRE:
 *    omitirlos (o mandarlos null) borra el teléfono y la ocupación, y resetea idioma/canal.
 *  - Las partes del nombre y la identidad de la empresa sí se fusionan (`cmd.X ?? actual`), y la
 *    fecha de nacimiento solo se toca si viene con valor.
 * Así que se parte SIEMPRE del cliente actual y solo se pisa lo que edita la sección; lo demás
 * viaja con su valor vigente para que nada se borre.
 *
 * Límite conocido: `profilePictureFileId` no viene en el detalle, así que no se puede reenviar;
 * el formulario completo tiene el mismo límite (hoy la UI no maneja foto de cliente).
 */
export function buildSectionUpdateRequest(
  current: CustomerDetailResponse,
  patch: ClientSectionPatch,
): UpdateCustomerRequest {
  const base: UpdateCustomerRequest = {
    language: current.language,
    preferredChannel: current.preferredChannel,
    primaryEmail: current.primaryEmail,
    primaryPhone: current.primaryPhone ?? null,
    occupationId: current.occupationId ?? null,
  };

  if (current.kind === 'Individual') {
    base.firstName = current.firstName ?? null;
    base.middleName = current.middleName ?? null;
    base.lastName = current.lastName ?? null;
    base.dateOfBirth = current.dateOfBirth ?? null;
  } else {
    base.legalName = current.legalName ?? null;
    base.principalBusinessActivityId = current.principalBusinessActivityId ?? null;
  }

  switch (patch.section) {
    case 'contact':
      return {
        ...base,
        primaryEmail: patch.primaryEmail,
        primaryPhone: patch.primaryPhone,
        language: patch.language,
        preferredChannel: patch.preferredChannel,
      };
    case 'personal':
      return {
        ...base,
        firstName: patch.firstName,
        middleName: patch.middleName,
        lastName: patch.lastName,
        // null = "no tocar" en el backend; se conserva la vigente para no depender de eso.
        dateOfBirth: patch.dateOfBirth ?? base.dateOfBirth ?? null,
        occupationId: patch.occupationId,
      };
    case 'business':
      return {
        ...base,
        legalName: patch.legalName,
        businessStructure: patch.businessStructure,
        formationDate: patch.formationDate,
        principalBusinessActivityId: patch.principalBusinessActivityId ?? base.principalBusinessActivityId ?? null,
      };
  }
}
