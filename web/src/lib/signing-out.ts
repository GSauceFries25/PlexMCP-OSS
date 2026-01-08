/**
 * Global signing out state
 *
 * This module provides a GLOBAL variable to track sign-out status.
 * Unlike React state/context, this is:
 * 1. Synchronously updated (no React batching)
 * 2. Accessible from ANY component without context
 * 3. Readable without triggering re-renders
 * 4. Survives across route transitions
 *
 * This is used to prevent the "No Organization Found" flash during sign out.
 */

let globalSigningOut = false;

export function isSigningOut(): boolean {
  return globalSigningOut;
}

export function setSigningOut(value: boolean): void {
  globalSigningOut = value;
}
