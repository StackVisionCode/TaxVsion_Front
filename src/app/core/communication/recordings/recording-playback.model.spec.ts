import { describe, expect, it } from 'vitest';
import {
  activeSegmentIndex,
  filterTranscriptSegments,
  formatTranscriptTime,
  isPresignedUrlExpired,
  parseTranscriptJson,
  parseTranscriptTxt,
  transcriptFailureMessage,
} from './recording-playback.model';

describe('recording-playback.model (F7)', () => {
  it('parseTranscriptJson: segmentos v2 ordenados con hablante; forma inválida → null', () => {
    const segments = parseTranscriptJson({
      version: 2,
      speakers: [{ userId: 'u1', displayName: 'Ana' }],
      segments: [
        { startMs: 5000, endMs: 8000, speakerUserId: 'u1', speakerName: 'Ana', text: ' Second ' },
        { startMs: 0, endMs: 4000, speakerUserId: null, speakerName: null, text: 'First' },
        { text: 'sin tiempo' },
      ],
    });
    expect(segments).toEqual([
      { startMs: 0, endMs: 4000, speakerUserId: null, speakerName: null, text: 'First' },
      { startMs: 5000, endMs: 8000, speakerUserId: 'u1', speakerName: 'Ana', text: 'Second' },
    ]);
    expect(parseTranscriptJson({ version: 1 })).toBeNull();
    expect(parseTranscriptJson(null)).toBeNull();
  });

  it('parseTranscriptTxt: "[hh:mm:ss] Nombre: texto", sin hablante y líneas de continuación', () => {
    const segments = parseTranscriptTxt(
      ['[00:00:01] Ana Pérez: Hello there.', 'continues here', '[00:01:05] Thanks, bye.', '', '[01:00:00] Luis: Late'].join('\r\n'),
    );
    expect(segments).toEqual([
      { startMs: 1000, endMs: 65000, speakerUserId: null, speakerName: 'Ana Pérez', text: 'Hello there. continues here' },
      { startMs: 65000, endMs: 3600000, speakerUserId: null, speakerName: null, text: 'Thanks, bye.' },
      { startMs: 3600000, endMs: 3600000, speakerUserId: null, speakerName: 'Luis', text: 'Late' },
    ]);
  });

  it('búsqueda sin mayúsculas ni acentos sobre texto y hablante', () => {
    const segments = parseTranscriptTxt('[00:00:01] José: Declaración anual\n[00:00:09] Ana: W-2 form');
    expect(filterTranscriptSegments(segments, 'declaracion').map(s => s.startMs)).toEqual([1000]);
    expect(filterTranscriptSegments(segments, 'jose')).toHaveLength(1);
    expect(filterTranscriptSegments(segments, '  ')).toHaveLength(2);
    expect(filterTranscriptSegments(segments, 'nada')).toEqual([]);
  });

  it('segmento activo, formato de tiempo, vencimiento de la URL y copy de fallo', () => {
    const segments = parseTranscriptTxt('[00:00:01] a\n[00:00:10] b');
    expect(activeSegmentIndex(segments, 0)).toBe(-1);
    expect(activeSegmentIndex(segments, 5000)).toBe(0);
    expect(activeSegmentIndex(segments, 12_000)).toBe(1);

    expect(formatTranscriptTime(5_000)).toBe('0:05');
    expect(formatTranscriptTime(754_000)).toBe('12:34');
    expect(formatTranscriptTime(3_723_000)).toBe('1:02:03');

    const now = Date.parse('2026-10-30T12:00:00Z');
    expect(isPresignedUrlExpired({ url: 'x', expiresAtUtc: '2026-10-30T12:00:10' }, now, 15_000)).toBe(true);
    expect(isPresignedUrlExpired({ url: 'x', expiresAtUtc: '2026-10-30T12:05:00Z' }, now, 15_000)).toBe(false);

    expect(transcriptFailureMessage('TooLong')).toContain('too long');
    expect(transcriptFailureMessage('Whatever')).toBe('Transcript unavailable.');
  });
});
