import { init } from '@tma.js/sdk';

export function bootstrapTma() {
  if (typeof window === 'undefined') {
    return;
  }

  init();
}
