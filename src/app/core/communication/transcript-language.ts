/** Idiomas del transcript que ofrecen las pantallas; el backend acepta "auto" o cualquier código válido. */
export const TRANSCRIPT_LANGUAGE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'auto', label: 'Detect automatically' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
];

/**
 * Idiomas que se pueden fijar a una reunión (INV-T01 R-7). Sin "auto": la opción por defecto (null) ya
 * es automática y respeta el idioma que eligió cada participante.
 */
export const MEETING_TRANSCRIPT_LANGUAGE_OPTIONS = TRANSCRIPT_LANGUAGE_OPTIONS.filter(option => option.value !== 'auto');
