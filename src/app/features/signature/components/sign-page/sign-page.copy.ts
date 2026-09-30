/**
 * Textos del recorrido público de firma que requieren aprobación de otras áreas.
 */

// PENDIENTE DE REVISIÓN LEGAL
// 14.4 — Explicación de cómo se aplica la firma electrónica (certificado local controlado por
// TaxProffice). Es un borrador factual y deliberadamente no comprometido: el equipo legal debe aprobar
// o reemplazar este texto. Se muestra en el paso de consentimiento de /sign/:token; para cambiarlo basta
// con editar este objeto (título + párrafos), la plantilla no tiene copia propia.
export const ELECTRONIC_SIGNATURE_CERTIFICATE_NOTICE = {
  title: 'How your electronic signature is applied',
  paragraphs: [
    'Your signature is applied electronically through TaxProffice, the platform your tax office uses to request signatures.',
    'Once everyone has signed, TaxProffice seals the final document with a digital certificate that TaxProffice manages and controls. This certificate belongs to the platform; it is not issued to you personally, and you do not need to install anything.',
    'The seal is designed to make any later change to the document detectable. A record of the signing steps (such as your consent, the date and time, and any identity checks) is kept with the document.',
  ],
} as const;
