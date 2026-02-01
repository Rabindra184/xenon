import { DeviceStoreFactory } from './device-store';

const store = DeviceStoreFactory.getPendingSessionStore();

async function addNewPendingSession(capability: any) {
  await store.addPendingSession(capability);
}

async function removePendingSession(sessionCapabilityId: string) {
  await store.removePendingSession(sessionCapabilityId);
}

export { addNewPendingSession, removePendingSession };
