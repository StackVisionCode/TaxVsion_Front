import { componentType } from './component-type';
export const CONSENT_COMPONENT = componentType('consent', 'compliance', null, [
  'noticeKey',
  'noticeVersionNumber',
  'mode',
  'timing',
  'acceptanceText',
  'blocking',
]);
