import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, detectViewerKind, formatViewerBytes, moveIndex, parseCsv, stepZoom } from './file-viewer.model';

describe('detectViewerKind', () => {
  it('uses the MIME type when it is specific', () => {
    expect(detectViewerKind('scan', 'application/pdf')).toBe('pdf');
    expect(detectViewerKind('photo', 'image/png')).toBe('image');
    expect(detectViewerKind('notes', 'text/plain; charset=utf-8')).toBe('text');
    expect(detectViewerKind('export', 'text/csv')).toBe('csv');
    expect(detectViewerKind('data', 'application/json')).toBe('text');
  });

  it('falls back to the extension for generic or missing types', () => {
    expect(detectViewerKind('W2.PDF', 'application/octet-stream')).toBe('pdf');
    expect(detectViewerKind('receipt.jpeg', null)).toBe('image');
    expect(detectViewerKind('clients.csv', '')).toBe('csv');
    expect(detectViewerKind('readme.txt')).toBe('text');
  });

  it('marks what the browser cannot render as unsupported', () => {
    expect(detectViewerKind('return.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('unsupported');
    expect(detectViewerKind('scan.tiff', 'image/tiff')).toBe('unsupported');
    expect(detectViewerKind('archive.zip')).toBe('unsupported');
    expect(detectViewerKind('no-extension')).toBe('unsupported');
  });
});

describe('parseCsv', () => {
  it('parses quoted fields, escaped quotes and CRLF', () => {
    const { rows, truncated } = parseCsv('name,notes\r\n"Doe, Jane","said ""hi"""\r\nBob,\n');
    expect(rows).toEqual([
      ['name', 'notes'],
      ['Doe, Jane', 'said "hi"'],
      ['Bob', ''],
    ]);
    expect(truncated).toBe(false);
  });

  it('keeps line breaks inside quotes and strips the BOM', () => {
    expect(parseCsv('﻿a,"line1\nline2"').rows).toEqual([['a', 'line1\nline2']]);
  });

  it('stops at maxRows and reports truncation', () => {
    const { rows, truncated } = parseCsv('1\n2\n3\n4\n', 2);
    expect(rows).toEqual([['1'], ['2']]);
    expect(truncated).toBe(true);
  });

  it('returns no rows for empty text', () => {
    expect(parseCsv('').rows).toEqual([]);
  });
});

describe('stepZoom', () => {
  it('zooms in and out within bounds', () => {
    expect(stepZoom(1, 'in')).toBe(1.25);
    expect(stepZoom(1, 'out')).toBe(0.8);
    expect(stepZoom(MAX_ZOOM, 'in')).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, 'out')).toBe(MIN_ZOOM);
  });
});

describe('moveIndex', () => {
  it('moves within the list and refuses to wrap', () => {
    expect(moveIndex(0, 1, 3)).toBe(1);
    expect(moveIndex(2, 1, 3)).toBeNull();
    expect(moveIndex(0, -1, 3)).toBeNull();
  });
});

describe('formatViewerBytes', () => {
  it('formats sizes and ignores invalid values', () => {
    expect(formatViewerBytes(512)).toBe('512 B');
    expect(formatViewerBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(formatViewerBytes(null)).toBe('');
  });
});
