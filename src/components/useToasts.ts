import { useContext } from "react";
import { NOOP_TOAST_API, ToastContext, type ToastApi } from "./toasts";

/**
 * Read the toast API from the nearest {@link ToastProvider}. If no provider is
 * mounted (e.g. in a unit test), returns a no-op API so callers don't crash.
 */
export function useToasts(): ToastApi {
  const ctx = useContext(ToastContext);
  return ctx ?? NOOP_TOAST_API;
}
