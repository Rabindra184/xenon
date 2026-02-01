import { DeviceStoreFactory } from './device-store';

const store = DeviceStoreFactory.getCLIArgsStore();

async function addCLIArgs(args: any) {
  await store.addCLIArgs(args);
}

async function getCLIArgs() {
  return await store.getCLIArgs();
}

export { addCLIArgs, getCLIArgs };
