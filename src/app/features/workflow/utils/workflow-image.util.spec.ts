import { describe, expect, it, vi } from 'vitest';
import { ImageTooLargeError } from './workflow-image.util';

describe('ImageTooLargeError', () => {
  it('lleva un mensaje que el usuario puede accionar, no un código', () => {
    const error = new ImageTooLargeError();
    expect(error.name).toBe('ImageTooLargeError');
    // El toast enseña esto tal cual: tiene que decir qué pasó y qué hacer.
    expect(error.message).toMatch(/too large/i);
    expect(error.message).toMatch(/2 MB/);
  });
});
