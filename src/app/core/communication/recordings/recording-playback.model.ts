import { parseUtcDate } from '@shared/utils/utc-date.util';
import type { RecordingCaptureMode, RecordingState } from '../recording-status';

/**
 * F7 — Lectura de una grabación terminada (`GET /communication/meetings/{id}/recording` y
 * `GET /communication/calls/{id}/recording`) y su transcript (JSON v2 con hablantes; TXT de respaldo).
 * Funciones puras: parseo del transcript, búsqueda y formato de tiempos.
 */

export type RecordingScope = 'meeting' | 'call';

/** URL presignada de CloudStorage (5 min, `attachment`). */
export interface PresignedUrlDto {
  url: string;
  expiresAtUtc: string;
}

export type RecordingTranscriptState = 'Processing' | 'Ready' | 'Failed';

export interface RecordingTranscriptDto {
  state: RecordingTranscriptState;
  language: string | null;
  speakerCount: number | null;
  wordCount: number | null;
  txt: PresignedUrlDto | null;
  json: PresignedUrlDto | null;
  failureReason: string | null;
}

export interface RecordingDetailsDto {
  state: RecordingState;
  captureMode: RecordingCaptureMode | null;
  startedAtUtc: string | null;
  stoppedAtUtc: string | null;
  durationSeconds: number | null;
  maxDurationSeconds: number | null;
  stopReason: string | null;
  format: string | null;
  sizeBytes: number | null;
  failureReason: string | null;
  playback: PresignedUrlDto | null;
  transcript: RecordingTranscriptDto | null;
}

/** Segmento del transcript (JSON v2 o línea del TXT). */
export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  speakerUserId: string | null;
  speakerName: string | null;
  text: string;
}

export interface TranscriptSpeaker {
  userId: string;
  displayName: string;
}

/** Archivo JSON v2 del worker (`Transcripts`, `application/json`). */
export interface TranscriptJsonV2 {
  version: number;
  language?: string | null;
  model?: string | null;
  vad?: boolean;
  durationSeconds?: number | null;
  speakers: TranscriptSpeaker[];
  segments: TranscriptSegment[];
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** Valida y normaliza el JSON v2; null si no tiene la forma esperada (se cae al TXT). */
export function parseTranscriptJson(value: unknown): TranscriptSegment[] | null {
  const doc = value as Partial<TranscriptJsonV2> | null;
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.segments)) {
    return null;
  }
  const segments: TranscriptSegment[] = [];
  for (const raw of doc.segments as Partial<TranscriptSegment>[]) {
    if (!raw || typeof raw.startMs !== 'number' || typeof raw.text !== 'string') {
      continue;
    }
    segments.push({
      startMs: raw.startMs,
      endMs: typeof raw.endMs === 'number' ? raw.endMs : raw.startMs,
      speakerUserId: raw.speakerUserId ?? null,
      speakerName: raw.speakerName ?? null,
      text: raw.text.trim(),
    });
  }
  return segments.sort((a, b) => a.startMs - b.startMs);
}

const TXT_LINE = /^\[(\d{1,2}):(\d{2}):(\d{2})\]\s?(.*)$/;
/** "Nombre: texto" (nombre corto y sin puntuación de frase). */
const TXT_SPEAKER = /^([^:.!?\n]{1,60}):\s+(.*)$/;

/**
 * TXT de respaldo: líneas `[hh:mm:ss] Nombre: texto` (o `[hh:mm:ss] texto` sin pistas). Las líneas sin
 * marca se pegan al segmento anterior. El fin de cada segmento es el inicio del siguiente.
 */
export function parseTranscriptTxt(text: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = TXT_LINE.exec(line);
    if (!match) {
      const last = segments[segments.length - 1];
      if (last) {
        last.text = `${last.text} ${line}`.trim();
      } else {
        segments.push({ startMs: 0, endMs: 0, speakerUserId: null, speakerName: null, text: line });
      }
      continue;
    }
    const [, h, m, s, rest] = match;
    const startMs = (Number(h) * SECONDS_PER_HOUR + Number(m) * SECONDS_PER_MINUTE + Number(s)) * MS_PER_SECOND;
    const speaker = TXT_SPEAKER.exec(rest);
    segments.push({
      startMs,
      endMs: startMs,
      speakerUserId: null,
      speakerName: speaker ? speaker[1].trim() : null,
      text: (speaker ? speaker[2] : rest).trim(),
    });
  }
  for (let i = 0; i < segments.length; i++) {
    const next = segments[i + 1];
    if (next && next.startMs > segments[i].startMs) {
      segments[i].endMs = next.startMs;
    }
  }
  return segments;
}

/** Segmentos cuyo texto o hablante contienen la búsqueda (sin distinguir mayúsculas ni acentos). */
export function filterTranscriptSegments(segments: readonly TranscriptSegment[], query: string): TranscriptSegment[] {
  const q = normalizeForSearch(query.trim());
  if (!q) {
    return [...segments];
  }
  return segments.filter(s => normalizeForSearch(s.text).includes(q) || normalizeForSearch(s.speakerName ?? '').includes(q));
}

function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Índice del segmento que suena en `ms` (el último que empezó); -1 si ninguno. */
export function activeSegmentIndex(segments: readonly TranscriptSegment[], ms: number): number {
  let active = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].startMs <= ms) {
      active = i;
    } else {
      break;
    }
  }
  return active;
}

/** "0:05", "12:34" o "1:02:03". */
export function formatTranscriptTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** La URL presignada vence en menos de `marginMs` (o ya venció). */
export function isPresignedUrlExpired(url: PresignedUrlDto, nowMs: number, marginMs: number): boolean {
  const expires = parseUtcDate(url.expiresAtUtc).getTime();
  return Number.isNaN(expires) ? false : expires - marginMs <= nowMs;
}

/** Copy del estado del transcript que falló. */
export function transcriptFailureMessage(reason: string | null | undefined): string {
  return reason === 'TooLong' ? 'Transcript unavailable: the recording is too long to transcribe.' : 'Transcript unavailable.';
}
