import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ToastContext,
  type ShowOptions,
  type Toast,
  type ToastApi,
  type ToastIntent,
} from "./toasts";
import { Icon, type IconName } from "./icons";

const MAX_VISIBLE = 3;
/** Coalesce identical info/success messages within this window. */
const COALESCE_MS = 1000;

const DEFAULT_DURATION_BY_INTENT: Record<ToastIntent, number> = {
  info: 4000,
  success: 4000,
  error: 9000,
  action: 9000,
};

const INTENT_ICON: Record<ToastIntent, IconName> = {
  info: "info",
  success: "info",
  error: "error",
  action: "info",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(1);
  /** Map of normalized message → last shown timestamp for coalescing. */
  const recentRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: string, options: ShowOptions = {}): number => {
    const intent: ToastIntent = options.intent ?? "info";
    const durationMs = options.durationMs ?? DEFAULT_DURATION_BY_INTENT[intent];
    const key = `${intent}::${message}`;
    const now = performance.now();
    const last = recentRef.current.get(key);
    if (last != null && now - last < COALESCE_MS) {
      // Coalesce: refresh the existing toast's timer rather than adding a new one.
      setToasts((prev) => {
        const idx = prev.findIndex((t) => `${t.intent}::${t.message}` === key);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = { ...next[idx], durationMs };
          return next;
        }
        return prev;
      });
      return -1;
    }
    recentRef.current.set(key, now);
    // Trim map so it doesn't grow unbounded.
    if (recentRef.current.size > 32) {
      const cutoff = now - 30_000;
      for (const [k, ts] of recentRef.current) {
        if (ts < cutoff) recentRef.current.delete(k);
      }
    }
    const id = nextIdRef.current++;
    const toast: Toast = {
      id,
      message,
      intent,
      durationMs,
      action: options.action,
    };
    setToasts((prev) => {
      const next = [...prev, toast];
      // Cap visible: drop oldest non-action toasts first; if the queue is all
      // action toasts, drop the oldest action toast.
      if (next.length > MAX_VISIBLE) {
        const dropIdx = next.findIndex((t) => t.intent !== "action");
        const idx = dropIdx >= 0 ? dropIdx : 0;
        next.splice(idx, 1);
      }
      return next;
    });
    return id;
  }, []);

  // Sweep stale coalesce entries periodically.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now();
      for (const [k, ts] of recentRef.current) {
        if (now - ts > 30_000) recentRef.current.delete(k);
      }
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [exiting, setExiting] = useState(false);
  /** Pause-on-hover: while hovered the countdown freezes, then resumes. */
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(toast.durationMs);
  const startedAtRef = useRef(performance.now());
  const exitTimerRef = useRef(0);
  const removeTimerRef = useRef(0);

  const clearTimers = () => {
    window.clearTimeout(exitTimerRef.current);
    window.clearTimeout(removeTimerRef.current);
  };

  const runTimers = (remaining: number) => {
    clearTimers();
    exitTimerRef.current = window.setTimeout(() => setExiting(true), Math.max(remaining - 200, 0));
    removeTimerRef.current = window.setTimeout(() => onDismiss(toast.id), remaining);
  };

  useEffect(() => {
    if (paused) {
      // Freeze: bank the remaining time.
      remainingRef.current -= performance.now() - startedAtRef.current;
      remainingRef.current = Math.max(remainingRef.current, 0);
      clearTimers();
      return;
    }
    startedAtRef.current = performance.now();
    runTimers(remainingRef.current);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, toast.id, toast.durationMs, onDismiss]);

  const role = toast.intent === "error" ? "alert" : "status";
  return (
    <div
      className={`toast toast-${toast.intent}${exiting ? " is-exiting" : ""}`}
      role={role}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Icon name={INTENT_ICON[toast.intent]} size="sm" className="toast-intent-icon" />
      <span className="toast-message">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}
