/* global firebase */
importScripts('/firebase/firebase-app-compat.js');
importScripts('/firebase/firebase-messaging-compat.js');

const rawConfig = new URL(self.location.href).searchParams.get('config');
if (rawConfig) {
  try {
    firebase.initializeApp(JSON.parse(rawConfig));
    firebase.messaging();
  } catch (error) {
    console.error('[push] Firebase worker configuration failed.', error);
  }
}
