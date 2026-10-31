import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RecordingClock,
  isRecordingBusy,
  isRecordingProcessing,
  recordingFailureMessage,
  recordingLimitWarningMessage,
  recordingStartErrorMessage,
  recordingStateNotice,
  usesClientCapture,
} from './recording-status';

describe('recording-status (F7)', () => {
  it('la captura local solo corre con captureMode Client o sin el campo (backend previo)', () => {
    expect(usesClientCapture({ captureMode: 'Server' })).toBe(false);
    expect(usesClientCapture({ captureMode: 'Client' })).toBe(true);
    expect(usesClientCapture({})).toBe(true);
  });

  it('Composing y Processing son "procesando"; Requesting/Stopping también deshabilitan el botón', () => {
    expect(isRecordingProcessing('Composing')).toBe(true);
    expect(isRecordingProcessing('Processing')).toBe(true);
    expect(isRecordingProcessing('Ready')).toBe(false);
    expect(isRecordingBusy('Requesting')).toBe(true);
    expect(isRecordingBusy('Stopping')).toBe(true);
    expect(isRecordingBusy('Recording')).toBe(false);
  });

  it('aviso de tope en minutos redondeados (mínimo 1)', () => {
    expect(recordingLimitWarningMessage(300)).toBe('Recording stops in 5 min.');
    expect(recordingLimitWarningMessage(20)).toBe('Recording stops in 1 min.');
  });

  it('copy por código de fallo y de error de inicio', () => {
    expect(recordingFailureMessage('RecorderUnavailable')).toBe('The recording service is unavailable. Try again later.');
    expect(recordingFailureMessage('StorageRejected')).toBe('The recording could not be saved (storage limit).');
    expect(recordingFailureMessage('Whatever')).toBe('The recording failed.');
    expect(recordingStartErrorMessage('Plan.RecordingDisabled')).toBe("Recording isn't included in your plan.");
    expect(recordingStartErrorMessage('Meeting.RecordingRequiresSfu')).toBe("This meeting can't be recorded. Start a new meeting to record.");
    expect(recordingStartErrorMessage('Other')).toBeNull();
  });

  it('Stopping por límite avisa; el stop manual y el fin de la reunión son silenciosos; Failed es error', () => {
    expect(recordingStateNotice({ state: 'Stopping', reason: 'LimitReached' })).toEqual({
      tone: 'info',
      message: 'Recording stopped (time limit reached).',
    });
    expect(recordingStateNotice({ state: 'Stopping', reason: 'User' })).toBeNull();
    expect(recordingStateNotice({ state: 'Stopping', reason: 'MeetingEnded' })).toBeNull();
    expect(recordingStateNotice({ state: 'Failed', reason: 'StorageRejected' })?.tone).toBe('error');
    expect(recordingStateNotice({ state: 'Composing' })).toBeNull();
  });

  describe('RecordingClock', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('cuenta contra el reloj del servidor (startedAtUtc + desfase) y da el restante con tope', () => {
      // El servidor va 2 s adelantado respecto del navegador.
      const clock = new RecordingClock(() => 2000, 250);
      clock.start('2026-10-30T11:59:00Z', 600);
      expect(clock.elapsedLabel()).toBe('1:02');
      expect(clock.remainingLabel()).toBe('8:58');

      vi.advanceTimersByTime(10_000);
      expect(clock.elapsedLabel()).toBe('1:12');
      expect(clock.remainingSeconds()).toBe(528);

      clock.stop();
      expect(clock.elapsedMs()).toBe(0);
      expect(clock.remainingLabel()).toBeNull();
    });

    it('sin startedAtUtc cuenta desde que llegó el Recording; sin tope no hay restante', () => {
      const clock = new RecordingClock(() => 0, 250);
      clock.start(undefined, undefined);
      vi.advanceTimersByTime(5_000);
      expect(clock.elapsedLabel()).toBe('0:05');
      expect(clock.remainingLabel()).toBeNull();
      // Reentrada del evento Recording: no reinicia el cronómetro.
      clock.start(undefined, undefined);
      vi.advanceTimersByTime(1_000);
      expect(clock.elapsedLabel()).toBe('0:06');
      clock.stop();
    });
  });
});
