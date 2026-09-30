import { describe, expect, it } from 'vitest';
import { FileResponse, FileStatus } from '@core/cloud-storage/cloud-storage.model';
import { docDisplayStatus, docKind, toClientDocumentItem } from './client-documents.model';

function makeFile(overrides: Partial<FileResponse> = {}): FileResponse {
  return {
    id: 'f1',
    ownerType: 'Customer',
    ownerId: 'c1',
    folderType: 'Documents',
    taxYear: null,
    originalName: 'return.pdf',
    declaredContentType: 'application/pdf',
    detectedContentType: null,
    sizeBytes: 2048,
    checksumSha256: null,
    status: 'Available',
    scanReport: null,
    createdAtUtc: '2026-02-01T00:00:00Z',
    scannedAtUtc: null,
    ...overrides,
  };
}

describe('docDisplayStatus', () => {
  it('maps the technical FileStatus to a friendly status', () => {
    expect(docDisplayStatus('Available')).toBe('ready');
    expect(docDisplayStatus('PendingUpload')).toBe('uploading');
    expect(docDisplayStatus('Scanning')).toBe('processing');
    expect(docDisplayStatus('PendingScan')).toBe('processing');
  });

  it('treats infected and policy-blocked as blocked', () => {
    for (const status of ['Infected', 'BlockedByPolicy'] as FileStatus[]) {
      expect(docDisplayStatus(status)).toBe('blocked');
    }
  });
});

describe('docKind', () => {
  it('classifies by extension', () => {
    expect(docKind('taxes.xlsx')).toBe('xlsx');
    expect(docKind('id.PNG')).toBe('img');
    expect(docKind('letter.docx')).toBe('doc');
    expect(docKind('return.pdf')).toBe('pdf');
    expect(docKind('noext')).toBe('pdf');
  });
});

describe('toClientDocumentItem', () => {
  it('marks an Available file as ready and downloadable', () => {
    const item = toClientDocumentItem(makeFile({ status: 'Available' }));
    expect(item.isReady).toBe(true);
    expect(item.isBlocked).toBe(false);
    expect(item.status).toBe('ready');
  });

  it('marks a scanning file as pending (not ready)', () => {
    const item = toClientDocumentItem(makeFile({ status: 'Scanning' }));
    expect(item.isReady).toBe(false);
    expect(item.isPending).toBe(true);
  });

  it('formats the size label', () => {
    expect(toClientDocumentItem(makeFile({ sizeBytes: 2048 })).sizeLabel).toBe('2 KB');
  });

  it('prefers the scanned date over the created date when present', () => {
    const item = toClientDocumentItem(makeFile({ createdAtUtc: '2026-01-01T00:00:00Z', scannedAtUtc: '2026-06-15T00:00:00Z' }));
    expect(item.dateLabel).toContain('2026');
    expect(item.dateLabel).toContain('Jun');
  });
});
