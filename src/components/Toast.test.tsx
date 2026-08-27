// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./Toast";
import { useToasts } from "./useToasts";

function ShowProbe({
  message,
  intent,
  action,
}: {
  message: string;
  intent?: "info" | "error" | "success" | "action";
  action?: { label: string; onClick: () => void };
}) {
  const toasts = useToasts();
  return (
    <button type="button" onClick={() => toasts.show(message, { intent, action })}>
      show
    </button>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a toast on show and removes it after duration", () => {
    render(
      <ToastProvider>
        <ShowProbe message="Saved" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("show").click();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("renders error toasts with role=alert", () => {
    render(
      <ToastProvider>
        <ShowProbe message="Boom" intent="error" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("show").click();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
  });

  it("renders the action button and invokes onClick", () => {
    const onClick = vi.fn();
    render(
      <ToastProvider>
        <ShowProbe message="Cleared" intent="action" action={{ label: "Undo", onClick }} />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("show").click();
    });
    const btn = screen.getByRole("button", { name: "Undo" });
    act(() => {
      btn.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("dismisses a toast on the close button", () => {
    render(
      <ToastProvider>
        <ShowProbe message="Hi" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("show").click();
    });
    expect(screen.getByText("Hi")).toBeInTheDocument();
    act(() => {
      screen.getByRole("button", { name: "Dismiss notification" }).click();
    });
    expect(screen.queryByText("Hi")).toBeNull();
  });

  it("coalesces identical messages within the coalesce window", () => {
    render(
      <ToastProvider>
        <ShowProbe message="Coalesce" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("show").click();
    });
    act(() => {
      screen.getByText("show").click();
    });
    expect(screen.getAllByText("Coalesce")).toHaveLength(1);
  });

  it("useToasts returns a no-op when no provider is mounted", () => {
    function Naked() {
      const toasts = useToasts();
      return (
        <button
          type="button"
          onClick={() => {
            const id = toasts.show("nope");
            toasts.dismiss(id);
          }}
        >
          x
        </button>
      );
    }
    render(<Naked />);
    // Just verify it doesn't throw.
    expect(() => screen.getByText("x").click()).not.toThrow();
  });
});
