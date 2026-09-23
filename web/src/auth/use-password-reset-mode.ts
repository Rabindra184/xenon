import { useEffect, useState } from 'react';
import { getAuthOptions, PasswordResetMode } from '../api-service/auth';

/** null while the server is being asked; then 'email' or 'admin'. */
export function usePasswordResetMode(): PasswordResetMode | null {
  const [mode, setMode] = useState<PasswordResetMode | null>(null);
  useEffect(() => {
    let live = true;
    getAuthOptions().then((o) => live && setMode(o.passwordReset));
    return () => {
      live = false;
    };
  }, []);
  return mode;
}
