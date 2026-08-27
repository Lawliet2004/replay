import { createContext } from "react";

export type ToastIntent = "info" | "success" | "error" | "action";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type Toast = {
  id: number;
  message: string;
  intent: ToastIntent;
  durationMs: number;
  action?: ToastAction;
};

export type ShowOptions = {
  intent?: ToastIntent;
  durationMs?: number;
  action?: ToastAction;
};

export type ToastApi = {
  show: (message: string, options?: ShowOptions) => number;
  dismiss: (id: number) => void;
};

export const ToastContext = createContext<ToastApi | null>(null);

export const NOOP_TOAST_API: ToastApi = {
  show: () => -1,
  dismiss: () => {},
};
