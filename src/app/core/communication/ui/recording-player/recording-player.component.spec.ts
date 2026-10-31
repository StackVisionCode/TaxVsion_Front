import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingPlayerComponent } from './recording-player.component';
import { LoadedTranscript, RecordingPlaybackService } from '../../recordings/recording-playback.service';
import { RecordingDetailsDto } from '../../recordings/recording-playback.model';

function details(overrides: Partial<RecordingDetailsDto> = {}): RecordingDetailsDto {
  return {
    state: 'Ready',
    captureMode: 'Server',
    startedAtUtc: '2026-10-30T10:00:00Z',
    stoppedAtUtc: '2026-10-30T10:10:00Z',
    durationSeconds: 600,
    maxDurationSeconds: 3600,
    stopReason: 'User',
    format: 'mp4',
    sizeBytes: 2048,
    failureReason: null,
    playback: { url: 'https://minio/rec.mp4?sig=1', expiresAtUtc: '2099-01-01T00:00:00Z' },
    transcript: {
      state: 'Ready',
      language: 'en',
      speakerCount: 2,
      wordCount: 10,
      txt: { url: 'https://minio/t.txt', expiresAtUtc: '2099-01-01T00:00:00Z' },
      json: { url: 'https://minio/t.json', expiresAtUtc: '2099-01-01T00:00:00Z' },
      failureReason: null,
    },
    ...overrides,
  };
}

const TRANSCRIPT: LoadedTranscript = {
  source: 'json',
  segments: [
    { startMs: 0, endMs: 4000, speakerUserId: 'u1', speakerName: 'Ana', text: 'Welcome to the review.' },
    { startMs: 4000, endMs: 9000, speakerUserId: 'u2', speakerName: 'Luis', text: 'I uploaded the W-2.' },
  ],
};

describe('RecordingPlayerComponent (F7)', () => {
  let getRecording: ReturnType<typeof vi.fn<(scope: string, id: string) => Observable<RecordingDetailsDto>>>;
  let loadTranscript: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getRecording = vi.fn<(scope: string, id: string) => Observable<RecordingDetailsDto>>(() => of(details()));
    loadTranscript = vi.fn().mockResolvedValue(TRANSCRIPT);
    TestBed.configureTestingModule({
      providers: [{ provide: RecordingPlaybackService, useValue: { getRecording, loadTranscript } }],
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  async function render(scope: 'meeting' | 'call' = 'meeting') {
    const fixture = TestBed.createComponent(RecordingPlayerComponent);
    fixture.componentRef.setInput('scope', scope);
    fixture.componentRef.setInput('targetId', 'm1');
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0)); // transcript (promesa del servicio)
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, video: () => el.querySelector('video') as HTMLVideoElement | null };
  }

  it('Ready: video con la URL presignada, descarga y transcript con hablante y tiempo', async () => {
    const { el, video } = await render();
    expect(getRecording).toHaveBeenCalledWith('meeting', 'm1');
    expect(video()?.getAttribute('src')).toBe('https://minio/rec.mp4?sig=1');
    expect(el.querySelector('[data-role="recording-download"]')).not.toBeNull();
    const rows = el.querySelectorAll('[data-role="transcript-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain('Luis');
    expect(rows[1].textContent).toContain('0:04');
    expect(rows[1].textContent).toContain('I uploaded the W-2.');
  });

  it('clic en una fila salta el video a ese punto; la búsqueda filtra segmentos', async () => {
    const { fixture, el, video } = await render();
    (el.querySelectorAll('[data-role="transcript-row"]')[1] as HTMLButtonElement).click();
    expect(video()!.currentTime).toBe(4);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

    fixture.componentInstance.query.set('w-2');
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-role="transcript-row"]')).toHaveLength(1);
    expect(el.querySelector('[data-role="transcript-match-count"]')?.textContent).toContain('1 match');

    fixture.componentInstance.query.set('nothing');
    fixture.detectChanges();
    expect(el.querySelector('[data-role="transcript-no-matches"]')).not.toBeNull();
  });

  it('si la URL vence en plena reproducción pide otra y retoma en el mismo currentTime', async () => {
    const { fixture, video } = await render();
    const player = video()!;
    player.dispatchEvent(new Event('play'));
    player.currentTime = 42;
    getRecording.mockReturnValueOnce(of(details({ playback: { url: 'https://minio/rec.mp4?sig=2', expiresAtUtc: '2099-01-01T00:00:00Z' } })));

    player.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(getRecording).toHaveBeenCalledTimes(2);
    expect(player.getAttribute('src')).toBe('https://minio/rec.mp4?sig=2');

    player.currentTime = 0; // la URL nueva arranca de cero
    player.dispatchEvent(new Event('loadedmetadata'));
    expect(player.currentTime).toBe(42);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('tras varios fallos seguidos deja de reintentar y lo dice', async () => {
    const { fixture, el, video } = await render();
    for (let i = 0; i < 4; i++) {
      video()!.dispatchEvent(new Event('error'));
    }
    fixture.detectChanges();
    expect(getRecording).toHaveBeenCalledTimes(4); // carga inicial + 3 renovaciones
    expect(el.querySelector('[data-role="playback-error"]')?.textContent).toContain('could not be played');
  });

  it('Processing / Failed / transcript en curso se pintan con su estado', async () => {
    getRecording.mockReturnValue(of(details({ state: 'Processing', playback: null, transcript: null })));
    let view = await render('call');
    expect(view.el.querySelector('[data-role="recording-processing"]')?.textContent).toContain('Processing recording');
    expect(view.video()).toBeNull();
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({ providers: [{ provide: RecordingPlaybackService, useValue: { getRecording, loadTranscript } }] });
    getRecording.mockReturnValue(of(details({ state: 'Failed', failureReason: 'RecorderUnavailable', playback: null, transcript: null })));
    view = await render();
    expect(view.el.querySelector('[data-role="recording-failed"]')?.textContent).toContain('recording service is unavailable');
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({ providers: [{ provide: RecordingPlaybackService, useValue: { getRecording, loadTranscript } }] });
    getRecording.mockReturnValue(
      of(details({ transcript: { ...details().transcript!, state: 'Processing', txt: null, json: null } })),
    );
    view = await render();
    expect(view.el.querySelector('[data-role="transcript-processing"]')?.textContent).toContain('Transcribing');
  });

  it('404 → "no hay grabación" con Retry', async () => {
    getRecording.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    const { el } = await render();
    expect(el.querySelector('[data-role="recording-error"]')?.textContent).toContain('There is no recording for this meeting.');
  });
});
