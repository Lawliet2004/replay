import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FULLSCREEN_CLOSE_IDLE_MS } from "./chromeAutoHide";
import { useFullscreenClose } from "./useFullscreenClose";

describe("useFullscreenClose", () => {
  it("shows the close chip when the pointer is along the top edge", () => {
    const { result } = renderHook(() => useFullscreenClose(true));
    expect(result.current.closeVisible).toBe(false);

    act(() => {
      result.current.setPointerY(12);
    });
    expect(result.current.closeVisible).toBe(true);
  });

  it("does not hide immediately when the pointer leaves the top zone or the chip", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFullscreenClose(true));
      act(() => {
        result.current.setPointerY(8);
        result.current.setHoveringClose(true);
        result.current.setPointerY(200);
      });
      expect(result.current.closeVisible).toBe(true);

      act(() => {
        result.current.setHoveringClose(false);
      });
      expect(result.current.closeVisible).toBe(true);

      act(() => {
        vi.advanceTimersByTime(FULLSCREEN_CLOSE_IDLE_MS);
      });
      expect(result.current.closeVisible).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides immediately when leaving fullscreen", () => {
    const { result, rerender } = renderHook(({ fs }) => useFullscreenClose(fs), {
      initialProps: { fs: true },
    });
    act(() => {
      result.current.setPointerY(10);
    });
    expect(result.current.closeVisible).toBe(true);
    rerender({ fs: false });
    expect(result.current.closeVisible).toBe(false);
  });

  it("auto-hides after the idle delay and re-shows on the next top-edge move", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFullscreenClose(true));
      act(() => {
        result.current.setPointerY(10);
      });
      expect(result.current.closeVisible).toBe(true);

      act(() => {
        vi.advanceTimersByTime(FULLSCREEN_CLOSE_IDLE_MS - 1);
      });
      expect(result.current.closeVisible).toBe(true);

      // Movement resets the idle timer.
      act(() => {
        result.current.setPointerY(20);
        vi.advanceTimersByTime(FULLSCREEN_CLOSE_IDLE_MS - 1);
      });
      expect(result.current.closeVisible).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.closeVisible).toBe(false);

      act(() => {
        result.current.setPointerY(6);
      });
      expect(result.current.closeVisible).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-hides after the idle delay even while the pointer rests on the chip", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFullscreenClose(true));
      act(() => {
        result.current.setPointerY(10);
        result.current.setHoveringClose(true);
        vi.advanceTimersByTime(FULLSCREEN_CLOSE_IDLE_MS);
      });
      expect(result.current.closeVisible).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reveals again when the pointer returns to the top edge", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFullscreenClose(true));
      act(() => {
        result.current.setPointerY(10);
        vi.advanceTimersByTime(FULLSCREEN_CLOSE_IDLE_MS);
      });
      expect(result.current.closeVisible).toBe(false);
      act(() => {
        result.current.setPointerY(-2);
      });
      expect(result.current.closeVisible).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
