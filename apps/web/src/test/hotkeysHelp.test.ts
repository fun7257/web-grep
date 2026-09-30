/** @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHotkeys } from "../hooks/useHotkeys.ts";

function setup(over: { helpOpen?: boolean; modalOpen?: boolean } = {}) {
  const onToggleHelp = vi.fn();
  renderHook(() =>
    useHotkeys({
      onSearch: vi.fn(),
      onCancel: vi.fn(),
      onCopyPath: vi.fn(),
      onToggleHelp,
      running: false,
      modalOpen: over.modalOpen ?? false,
      ...(over.helpOpen !== undefined ? { helpOpen: over.helpOpen } : {}),
      queryRef: { current: null },
      listRef: { current: null },
      previewRef: { current: null },
      hitCount: 0,
      setSelectedIndex: vi.fn(),
    }),
  );
  return onToggleHelp;
}

function press(key: string, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("? shortcut", () => {
  it("opens the help when nothing else is open", () => {
    const toggle = setup();
    press("?");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("closes the help it opened", () => {
    const toggle = setup({ helpOpen: true, modalOpen: true });
    press("?");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("does nothing under another modal", () => {
    const toggle = setup({ helpOpen: false, modalOpen: true });
    press("?");
    expect(toggle).not.toHaveBeenCalled();
  });

  it("ignores ? typed into an input", () => {
    const toggle = setup({ helpOpen: true, modalOpen: true });
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("?", input);
    input.remove();
    expect(toggle).not.toHaveBeenCalled();
  });
});
