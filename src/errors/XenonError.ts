export enum XenonErrorCode {
  SESSION_CREATION_FAILED = 'SESSION_CREATION_FAILED',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  DEVICE_NOT_FOUND = 'DEVICE_NOT_FOUND',
  DEVICE_UNAVAILABLE = 'DEVICE_UNAVAILABLE',
  CONFIG_INVALID = 'CONFIG_INVALID',
  AI_VISION_FAILED = 'AI_VISION_FAILED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export class XenonError extends Error {
  constructor(
    public readonly message: string,
    public readonly code: XenonErrorCode = XenonErrorCode.UNKNOWN_ERROR,
    public readonly metadata?: Record<string, any>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SessionError extends XenonError {
  constructor(
    message: string,
    code: XenonErrorCode = XenonErrorCode.SESSION_CREATION_FAILED,
    metadata?: Record<string, any>,
  ) {
    super(message, code, metadata);
  }
}

export class DeviceError extends XenonError {
  constructor(
    message: string,
    code: XenonErrorCode = XenonErrorCode.DEVICE_NOT_FOUND,
    metadata?: Record<string, any>,
  ) {
    super(message, code, metadata);
  }
}

export class ConfigError extends XenonError {
  constructor(message: string, metadata?: Record<string, any>) {
    super(message, XenonErrorCode.CONFIG_INVALID, metadata);
  }
}

export class AIError extends XenonError {
  constructor(message: string, metadata?: Record<string, any>) {
    super(message, XenonErrorCode.AI_VISION_FAILED, metadata);
  }
}
