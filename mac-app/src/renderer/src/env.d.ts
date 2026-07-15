/// <reference types="vite/client" />
import type { XenonApi } from '../../preload';

declare global {
  interface Window {
    xenon: XenonApi;
  }
}

export {};
