export type ISessionCapability = {
  // W3C lets clients omit firstMatch (defaults to [{}]). Optional here so the
  // compiler forces every consumer to either guard the read or normalize the value
  // — preventing a class of "Cannot read properties of undefined" crashes.
  firstMatch?: any[];
  alwaysMatch: any;
};

export type ISessionResponseWithValidSession = {
  sessionId: string;
  capabilities: ISessionCapability;
};

export type ISessionResponseValueWithError = {
  error: string;
};

export type ISessionResponse<T> = {
  protocol: string;
  value: T;
};

export type ISessionResponseAny = ISessionResponse<
  ISessionResponseWithValidSession | ISessionResponseValueWithError
>;
export type ISessionResponseError = ISessionResponse<ISessionResponseValueWithError>;
export type ISessionResponseOK = ISessionResponse<ISessionResponseWithValidSession>;

// returned by appium endpoint /wd/hub/session
export interface CreateSessionResponseSuccessExternal {
  value: {
    sessionId: string;
    capabilities: ISessionCapability;
    error?: string;
  };
}

export interface CreateSessionResponseErrorExternal {
  protocol: string;
  value: {
    error: string;
  };
}

export type CreateSessionResponseInternal = {
  protocol?: string;
  value: [
    // session id
    string,
    // capabilities
    ISessionCapability,
    // protocol
    string?,
  ];
};

export type W3CNewSessionResponse = {
  value: {
    sessionId: string;
    capabilities: ISessionCapability;
  };
};

export type W3CNewSessionResponseError = {
  protocol: string;
  error: any;
};
