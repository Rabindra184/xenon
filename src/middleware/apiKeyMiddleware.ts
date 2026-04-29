// Back-compat shim: import sites still reference `apiKeyMiddleware`. We will
// migrate them in a follow-up; until then this re-exports the new symbol so
// nothing breaks.
export { authMiddleware as apiKeyMiddleware } from './authMiddleware';
