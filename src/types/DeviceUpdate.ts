export type DeviceUpdate = {
  udid: string;
  host: string;
  state?: string;
  /** The node that reported the phone: the hub removes only that node's rows. */
  nodeId?: string;
};
