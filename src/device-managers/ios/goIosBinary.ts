import path from 'path';
import { cachePath } from '../../helpers';

/**
 * The go-ios binary Xenon vendors, where src/scripts/install-go-ios.ts puts
 * it. Every go-ios command Xenon runs uses this one path: the boot and
 * shutdown reaps find go-ios processes by it.
 */
export function goIosBinaryPath(): string {
  return path.join(cachePath('goIOS'), 'ios');
}
