import type { TaxIdentifierKind } from '@shared/utils/data-collection/formats';

export type DataCollectionRendererMode = 'fill' | 'preview' | 'readonly';

export interface DataCollectionAttachment {
  id: string;
  fileId: string;
  componentId: string;
  rowId?: string | null;
  displayName: string;
  status?: string | null;
  rejectionCode?: string | null;
}

export interface DataCollectionFieldComment {
  componentId: string;
  rowId?: string | null;
  comment: string;
}

export interface DataCollectionFileSelection {
  componentId: string;
  rowId: string | null;
  files: File[];
}

export interface DataCollectionSensitiveEntry {
  componentId: string;
  rowId: string | null;
  kind: TaxIdentifierKind;
  value: string;
}

export interface DataCollectionConsentRequest {
  componentId: string;
  rowId: string | null;
}

export interface DataCollectionValueChange {
  componentId: string;
  rowId: string | null;
  value: unknown;
}
