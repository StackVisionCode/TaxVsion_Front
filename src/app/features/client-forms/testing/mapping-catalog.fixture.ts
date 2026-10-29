import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import type {
  FormMappingCatalogResponse,
  FormMappingTargetResponse,
} from '../data-access/mapping-catalog.model';
import { toMappingCatalog } from '../data-access/mapping-catalog.service';

// Solo para specs: respuesta de GET tasks/forms/mapping-catalog tal como la arma el backend
// (CustomerDataCollectionTargets v1 + FormMappingTargetResponse), para un usuario sin admin.

const TEXT = ['text', 'textarea'];

function target(
  targetKey: string,
  entity: string,
  displayName: string,
  dataType: string,
  extra: Partial<FormMappingTargetResponse> = {},
): FormMappingTargetResponse {
  const compatible: Record<string, string[]> = {
    String: TEXT,
    Email: ['email'],
    Phone: ['phone'],
    Date: ['date'],
    Enum: ['select', 'radio'],
    Boolean: ['yesNo', 'checkbox'],
    Address: ['address'],
    TaxId: ['taxId'],
    Collection: [],
  };
  return {
    targetKey,
    domain: 'Customer',
    entity,
    displayName,
    dataType,
    sensitivity: 'Personal',
    status: 'Active',
    operations: ['CreateCustomer', 'UpdateCustomerProfile'],
    requiredFor: [],
    maxLength: null,
    enumValues: [],
    pastOnly: false,
    fields: [],
    compatibleComponentTypes: compatible[dataType],
    ...extra,
  };
}

export function catalogResponse(): FormMappingCatalogResponse {
  return {
    catalogVersion: 1,
    operations: [
      {
        name: 'CreateCustomer',
        discriminatorTargetKey: 'customer.kind',
        configTargets: { kind: 'customer.kind', language: 'customer.language' },
      },
      { name: 'UpdateCustomerProfile', discriminatorTargetKey: null, configTargets: {} },
    ],
    targets: [
      target('customer.kind', 'Customer', 'Customer kind', 'Enum', {
        sensitivity: 'General',
        enumValues: ['Individual', 'Business'],
        requiredFor: [{ operation: 'CreateCustomer', kind: null }],
      }),
      target('customer.person.first_name', 'Customer', 'First name', 'String', {
        maxLength: 80,
        requiredFor: [{ operation: 'CreateCustomer', kind: 'Individual' }],
      }),
      target('customer.person.last_name', 'Customer', 'Last name', 'String', {
        maxLength: 80,
        requiredFor: [{ operation: 'CreateCustomer', kind: 'Individual' }],
      }),
      target('customer.business.legal_name', 'Customer', 'Legal business name', 'String', {
        maxLength: 200,
        requiredFor: [{ operation: 'CreateCustomer', kind: 'Business' }],
      }),
      target('customer.business.formation_date', 'Customer', 'Business formation date', 'Date', {
        pastOnly: true,
      }),
      target('customer.primary_email', 'Customer', 'Primary email', 'Email', {
        maxLength: 254,
        requiredFor: [{ operation: 'CreateCustomer', kind: null }],
      }),
      target('customer.primary_phone', 'Customer', 'Primary phone', 'Phone'),
      target('customer.language', 'Customer', 'Preferred language', 'Enum', {
        sensitivity: 'General',
        enumValues: ['Es', 'En', 'Pt', 'Fr'],
        requiredFor: [{ operation: 'CreateCustomer', kind: null }],
      }),
      target('customer.contact.sms_enabled', 'Customer', 'SMS enabled', 'Boolean', { sensitivity: 'General' }),
      target('customer.address.home', 'Address', 'Home address', 'Address'),
      target('customer.relation.dependents', 'Relation', 'Dependents', 'Collection', {
        operations: ['UpdateCustomerProfile'],
        fields: [
          { name: 'first_name', dataType: 'String', maxLength: 80, required: true, compatibleComponentTypes: TEXT },
          { name: 'middle_name', dataType: 'String', maxLength: 80, required: false, compatibleComponentTypes: TEXT },
          { name: 'last_name', dataType: 'String', maxLength: 80, required: true, compatibleComponentTypes: TEXT },
          { name: 'date_of_birth', dataType: 'Date', maxLength: null, required: false, compatibleComponentTypes: ['date'] },
        ],
      }),
    ],
  };
}

export function testCatalog() {
  return toMappingCatalog(catalogResponse());
}

/** Formulario de onboarding con nombre, apellido, email, idioma y un repeater. */
export function onboardingDefinition(overrides: Partial<FormDefinition> = {}): FormDefinition {
  return {
    schemaVersion: 1,
    title: 'Onboarding',
    purpose: 'clientIntake',
    presentation: 'singlePage',
    pages: [
      {
        id: 'pg_main00001',
        sections: [
          {
            id: 'sc_main00001',
            components: [
              { id: 'fd_first0001', type: 'text', label: 'First name', required: true, props: { maxLength: 80 } },
              { id: 'fd_last00001', type: 'text', label: 'Last name', required: true, props: { maxLength: 80 } },
              { id: 'fd_email0001', type: 'email', label: 'Email', required: true },
              {
                id: 'fd_lang00001',
                type: 'select',
                label: 'Language',
                required: true,
                props: {
                  options: [
                    { value: 'spanish', label: 'Spanish' },
                    { value: 'en', label: 'English' },
                  ],
                },
              },
              { id: 'fd_notes0001', type: 'textarea', label: 'Notes' },
              { id: 'fd_file00001', type: 'file', label: 'ID document' },
              { id: 'fd_ssn000001', type: 'taxId', label: 'SSN', required: true },
            ],
          },
          {
            id: 'sc_deps00001',
            repeat: { minRows: 0, maxRows: 5, addLabel: 'Add', rowLabel: 'Dependent' },
            title: 'Dependents',
            components: [
              { id: 'fd_depname1', type: 'text', label: 'First name', props: { maxLength: 80 } },
              { id: 'fd_deplast01', type: 'text', label: 'Last name' },
              { id: 'fd_depdob001', type: 'date', label: 'Date of birth' },
            ],
          },
        ],
      },
    ],
    mappings: [],
    actions: [],
    ...overrides,
  };
}
