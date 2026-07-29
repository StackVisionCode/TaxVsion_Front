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

export interface ClientDependent {
  name: string;
  relationship: string;
  /** ISO date string (YYYY-MM-DD). */
  dateOfBirth: string;
  ssnOrItin?: string;
}

export interface ClientSpouse {
  name: string;
  ssnOrItin: string;
  /** ISO date string (YYYY-MM-DD). */
  dateOfBirth: string;
  phone?: string;
  email?: string;
  /** ISO date string (YYYY-MM-DD). */
  createdAt?: string;
}

export interface ClientProfile {
  id: string;
  type: ClientProfileType;
  /** firstName + lastName para individuos, o businessName para empresas. */
  displayName: string;
  email: string;
  phone: string;
  address: string;
  isActive: boolean;
  /** ISO date string (YYYY-MM-DD). */
  createdAt: string;
  individual?: ClientProfileIndividualDetails;
  company?: ClientProfileCompanyDetails;
  dependents?: ClientDependent[];
  spouse?: ClientSpouse;
}
