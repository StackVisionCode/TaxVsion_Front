export type ClientProfileType = 'individual' | 'company';

export type ClientOccupation =
  | 'Accountant'
  | 'Engineer'
  | 'Teacher'
  | 'Nurse'
  | 'Sales Representative'
  | 'Software Developer'
  | 'Business Owner'
  | 'Retired';

export type ClientMaritalStatus = 'Single' | 'Married' | 'Divorced' | 'Widowed';

export type ClientBusinessStructure = 'LLC' | 'S-Corp' | 'C-Corp' | 'Partnership' | 'Sole Proprietorship';

export interface ClientProfileIndividualDetails {
  ssnOrItin: string;
  /** ISO date string (YYYY-MM-DD). */
  dateOfBirth: string;
  occupation: ClientOccupation;
  maritalStatus: ClientMaritalStatus;
}

export interface ClientProfileCompanyDetails {
  ein: string;
  /** ISO date string (YYYY-MM-DD). */
  formationDate: string;
  businessStructure: ClientBusinessStructure;
  principalBusinessActivity: string;
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

/**
 * Semilla local de clientes para el perfil (prototipo visual): mismos campos
 * que ClientItem del directorio, ampliados con dependents/spouse. No
 * comparte estado con la lista del directorio todavía (sin store/backend
 * real); los ids solo se ven "compatibles" (client-1, client-2, ...).
 */
export const SEED_CLIENT_PROFILES: ClientProfile[] = [
  {
    id: 'client-1',
    type: 'individual',
    displayName: 'Maria Gonzalez',
    email: 'maria.gonzalez@example.com',
    phone: '(305) 555-0148',
    address: '482 Coral Way, Miami, FL 33145',
    isActive: true,
    createdAt: '2023-02-14',
    individual: {
      ssnOrItin: '123-45-6789',
      dateOfBirth: '1985-06-21',
      occupation: 'Accountant',
      maritalStatus: 'Married',
    },
    dependents: [
      { name: 'Sofia Gonzalez', relationship: 'Daughter', dateOfBirth: '2014-09-03', ssnOrItin: '456-78-9123' },
      { name: 'Mateo Gonzalez', relationship: 'Son', dateOfBirth: '2017-11-19', ssnOrItin: '567-89-1234' },
    ],
    spouse: {
      name: 'Carlos Gonzalez',
      ssnOrItin: '987-65-4321',
      dateOfBirth: '1983-03-11',
      phone: '(305) 555-0177',
      email: 'carlos.gonzalez@example.com',
      createdAt: '2023-02-14',
    },
  },
  {
    id: 'client-2',
    type: 'individual',
    displayName: 'James Whitfield',
    email: 'james.whitfield@example.com',
    phone: '(212) 555-0192',
    address: '77 Lexington Ave, New York, NY 10010',
    isActive: true,
    createdAt: '2024-01-05',
    individual: {
      ssnOrItin: '234-56-7891',
      dateOfBirth: '1990-01-30',
      occupation: 'Software Developer',
      maritalStatus: 'Single',
    },
    dependents: [],
  },
  {
    id: 'client-3',
    type: 'company',
    displayName: 'Blue Harbor Logistics LLC',
    email: 'accounts@blueharborlogistics.com',
    phone: '(617) 555-0173',
    address: '1200 Harborview Dr, Boston, MA 02210',
    isActive: true,
    createdAt: '2021-08-22',
    company: {
      ein: '84-1234567',
      formationDate: '2019-05-14',
      businessStructure: 'LLC',
      principalBusinessActivity: 'Freight transportation and warehousing',
    },
  },
  {
    id: 'client-4',
    type: 'individual',
    displayName: 'Angela Torres',
    email: 'angela.torres@example.com',
    phone: '(480) 555-0136',
    address: '910 Desert Willow Ln, Scottsdale, AZ 85255',
    isActive: false,
    createdAt: '2022-11-09',
    individual: {
      ssnOrItin: '345-67-8912',
      dateOfBirth: '1978-04-17',
      occupation: 'Business Owner',
      maritalStatus: 'Divorced',
    },
    dependents: [{ name: 'Lucas Torres', relationship: 'Son', dateOfBirth: '2009-07-25', ssnOrItin: '678-91-2345' }],
  },
  {
    id: 'client-5',
    type: 'company',
    displayName: 'Sunrise Bakery Co.',
    email: 'finance@sunrisebakeryco.com',
    phone: '(303) 555-0119',
    address: '350 Larimer St, Denver, CO 80202',
    isActive: true,
    createdAt: '2020-03-30',
    company: {
      ein: '91-7654321',
      formationDate: '2018-02-01',
      businessStructure: 'S-Corp',
      principalBusinessActivity: 'Retail bakery and catering services',
    },
  },
];
