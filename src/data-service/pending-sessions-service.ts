import { DeviceStoreFactory } from './device-store';

async function addNewPendingSession(capability: any) {
  const store = DeviceStoreFactory.getPendingSessionStore();
  await store.addPendingSession(capability);
}

async function removePendingSession(sessionCapabilityId: string) {
  const store = DeviceStoreFactory.getPendingSessionStore();
  await store.removePendingSession(sessionCapabilityId);
}

export { addNewPendingSession, removePendingSession };
