import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiConfigService } from '@core/config/api-config.service';
import { RecordingPlaybackService } from './recording-playback.service';
import { RecordingTranscriptDto } from './recording-playback.model';

function transcript(overrides: Partial<RecordingTranscriptDto> = {}): RecordingTranscriptDto {
  return {
    state: 'Ready',
    language: 'en',
    speakerCount: 1,
    wordCount: 3,
    txt: { url: 'https://minio/t.txt', expiresAtUtc: '2099-01-01T00:00:00Z' },
    json: { url: 'https://minio/t.json', expiresAtUtc: '2099-01-01T00:00:00Z' },
    failureReason: null,
    ...overrides,
  };
}

describe('RecordingPlaybackService (F7)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function setup(files: Record<string, string | Error>) {
    const get = vi.fn().mockReturnValue(of({}));
    TestBed.configureTestingModule({
      providers: [
        RecordingPlaybackService,
        { provide: HttpClient, useValue: { get } },
        { provide: ApiConfigService, useValue: { tenantUrl: (p: string) => `https://api${p}` } },
      ],
    });
    // Las URLs presignadas se leen con fetch sin credenciales.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const body = files[String(input)];
      if (body === undefined || body instanceof Error) {
        return new Response('nope', { status: 403 });
      }
      return new Response(body, { status: 200 });
    });
    return { service: TestBed.inject(RecordingPlaybackService), get, fetchMock };
  }

  it('getRecording usa la ruta de reuniones o de llamadas', () => {
    const { service, get } = setup({});
    service.getRecording('meeting', 'm1').subscribe();
    service.getRecording('call', 'c1').subscribe();
    expect(get).toHaveBeenNthCalledWith(1, 'https://api/communication/meetings/m1/recording');
    expect(get).toHaveBeenNthCalledWith(2, 'https://api/communication/calls/c1/recording');
  });

  it('lee el JSON v2 (fetch sin credenciales) y, si falla, cae al TXT', async () => {
    const json = JSON.stringify({ version: 2, speakers: [], segments: [{ startMs: 0, endMs: 1000, speakerName: 'Ana', text: 'Hi' }] });
    let { service, fetchMock } = setup({ 'https://minio/t.json': json });
    const fromJson = await service.loadTranscript(transcript());
    expect(fromJson?.source).toBe('json');
    expect(fromJson?.segments[0].speakerName).toBe('Ana');
    expect(fetchMock).toHaveBeenCalledWith('https://minio/t.json', { credentials: 'omit' });
    TestBed.resetTestingModule();
    vi.restoreAllMocks();

    ({ service } = setup({ 'https://minio/t.txt': '[00:00:02] Luis: Hello' }));
    const fromTxt = await service.loadTranscript(transcript());
    expect(fromTxt).toEqual({ source: 'txt', segments: [expect.objectContaining({ startMs: 2000, speakerName: 'Luis', text: 'Hello' })] });
  });

  it('sin transcript listo no descarga nada', async () => {
    const { service, fetchMock } = setup({});
    expect(await service.loadTranscript(transcript({ state: 'Processing' }))).toBeNull();
    expect(await service.loadTranscript(null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
