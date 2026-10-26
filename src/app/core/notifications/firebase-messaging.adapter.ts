import { InjectionToken } from '@angular/core';
import type { FirebaseOptions } from 'firebase/app';

export interface FirebaseMessagingAdapter {
  isSupported(): Promise<boolean>;
  getToken(
    config: FirebaseOptions,
    vapidKey: string,
    serviceWorkerRegistration: ServiceWorkerRegistration,
  ): Promise<string>;
  deleteToken(config: FirebaseOptions): Promise<boolean>;
}

class BrowserFirebaseMessagingAdapter implements FirebaseMessagingAdapter {
  async isSupported(): Promise<boolean> {
    const { isSupported } = await import('firebase/messaging');
    return isSupported();
  }

  async getToken(
    config: FirebaseOptions,
    vapidKey: string,
    serviceWorkerRegistration: ServiceWorkerRegistration,
  ): Promise<string> {
    const [{ getApp, getApps, initializeApp }, { getMessaging, getToken }] = await Promise.all([
      import('firebase/app'),
      import('firebase/messaging'),
    ]);
    const app = getApps().find(candidate => candidate.name === APP_NAME) ?? initializeApp(config, APP_NAME);
    return getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration });
  }

  async deleteToken(config: FirebaseOptions): Promise<boolean> {
    const [{ getApp, getApps, initializeApp }, { deleteToken, getMessaging }] = await Promise.all([
      import('firebase/app'),
      import('firebase/messaging'),
    ]);
    const app = getApps().find(candidate => candidate.name === APP_NAME) ?? initializeApp(config, APP_NAME);
    return deleteToken(getMessaging(app));
  }
}

const APP_NAME = 'taxproffice-web-push';

export const FIREBASE_MESSAGING_ADAPTER = new InjectionToken<FirebaseMessagingAdapter>(
  'FirebaseMessagingAdapter',
  { factory: () => new BrowserFirebaseMessagingAdapter() },
);
