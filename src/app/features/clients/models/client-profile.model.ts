import type {
  AddressResponse,
  ContactPointResponse,
  CustomerFiscalProfileResponse,
  RelationResponse,
} from '../data-access/clients.model';

export type ClientProfileType = 'individual' | 'company';

/**
 * Todos los campos opcionales y tipados como `string`, en vez de los union
 * types fijos que usa el dropdown del formulario: GET /customers/{id} del
 * backend real no devuelve ssn/ein, dateOfBirth, maritalStatus ni
 * businessStructure (son de solo-escritura o directamente no existen en el
 * dominio), y lo poco que sí vuelve (occupationName) es texto libre, no una
 * de las opciones fijas del formulario. Debe coincidir con
 * ClientIndividualDetails/ClientCompanyDetails de client-table.component.ts
 * (mismo shape, tipos separados) para que customerToClientProfile() calce.
 */
export interface ClientProfileIndividualDetails {
  ssnOrItin?: string;
  /** ISO date string (YYYY-MM-DD). */
  dateOfBirth?: string;
  occupation?: string;
  maritalStatus?: string;
}

export interface ClientProfileCompanyDetails {
  ein?: string;
  /** ISO date string (YYYY-MM-DD). */
  formationDate?: string;
  businessStructure?: string;
  principalBusinessActivity?: string;
}

/**
 * Vista de solo-lectura derivada de `relations[]` (tab Info, resumen).
 * `ssnOrItin` NO existe en `RelationResponse` — el backend no expone perfil
 * fiscal de una relación en el detalle del cliente (solo
 * `PUT /relations/{id}/fiscal-profile`, sin GET enmascarado equivalente
 * documentado); se deja fuera del resumen en vez de inventarlo.
 */
export interface ClientDependent {
  name: string;
  relationship: string;
  /** ISO date string (YYYY-MM-DD), o '' si el backend no la trae. */
  dateOfBirth: string;
}

export interface ClientSpouse {
  name: string;
  /** ISO date string (YYYY-MM-DD), o '' si el backend no la trae. */
  dateOfBirth: string;
  phone?: string;
  email?: string;
}

export interface ClientProfile {
  id: string;
  type: ClientProfileType;
  /** firstName + lastName para individuos, o businessName para empresas. */
  displayName: string;
  email: string;
  phone: string;
  isActive: boolean;
  /** ISO date string (YYYY-MM-DD). */
  createdAt: string;
  individual?: ClientProfileIndividualDetails;
  company?: ClientProfileCompanyDetails;
  /** Direcciones reales de GET /customers/{id} (companion doc §3.2). */
  addresses: AddressResponse[];
  /** Contactos reales de GET /customers/{id}. */
  contactPoints: ContactPointResponse[];
  /** Relaciones reales (cónyuge/dependientes/etc.) — fuente de verdad de la tab Family. */
  relations: RelationResponse[];
  /** Perfil fiscal enmascarado, o null si nunca se configuró. */
  fiscalProfile: CustomerFiscalProfileResponse | null;
  /** Derivado de `relations` (relationshipKind !== 'Spouse') — solo para el resumen de la tab Info. */
  dependents: ClientDependent[];
  /** Derivado de `relations` (la única relación con relationshipKind === 'Spouse', si hay). */
  spouse?: ClientSpouse;
}
