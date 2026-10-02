import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
} from "react";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function isWithin(
  root: HTMLElement | null,
  target: EventTarget | null,
): boolean {
  return root !== null && target instanceof Node && root.contains(target);
}

export function useHotkeys(opts: {
  onSearch: () => void;
  onCancel: () => void;
  onCopyPath: () => void;
  onToggleHelp?: () => void;
  running: boolean;
  modalOpen: boolean;
  /** True while the shortcut help is open; `?` then closes it. */
  helpOpen?: boolean;
  queryRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLElement | null>;
  previewRef: RefObject<HTMLElement | null>;
  hitCount: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  /** Latest selected index. With `onListNav`, j/k read it instead of a stale closure. */
  selectedIndexRef?: RefObject<number>;
  /** Called with the index j/k/ArrowUp/ArrowDown landed on. Does not change that move. */
  onListNav?: (index: number) => void;
}): void {
  const {
    onSearch,
    onCancel,
    onCopyPath,
    onToggleHelp,
    running,
    modalOpen,
    helpOpen = false,
    queryRef,
    listRef,
    previewRef,
    hitCount,
    setSelectedIndex,
    selectedIndexRef,
    onListNav,
  } = opts;

  useEffect(() => {
    const moveList = (delta: 1 | -1): void => {
      if (selectedIndexRef === undefined) {
        setSelectedIndex((index) =>
          delta > 0
            ? hitCount === 0
              ? 0
              : Math.min(hitCount - 1, index + delta)
            : Math.max(0, index + delta),
        );
        return;
      }
      const current = selectedIndexRef.current;
      const next =
        delta > 0
          ? hitCount === 0
            ? 0
            : Math.min(hitCount - 1, current + delta)
          : Math.max(0, current + delta);
      setSelectedIndex(next);
      onListNav?.(next);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        if (modalOpen) {
          return;
        }
        event.preventDefault();
        onSearch();
        return;
      }
      if (event.key === "Escape") {
        if (running) {
          event.preventDefault();
          onCancel();
          return;
        }
        const active = document.activeElement;
        if (active instanceof HTMLElement && isTypingTarget(active)) {
          event.preventDefault();
          active.blur();
        }
        return;
      }
      if (event.key === "?" && helpOpen && !isTypingTarget(event.target)) {
        event.preventDefault();
        onToggleHelp?.();
        return;
      }
      if (isTypingTarget(event.target) || modalOpen) {
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        queryRef.current?.focus();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        onToggleHelp?.();
        return;
      }
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveList(1);
        listRef.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveList(-1);
        listRef.current?.focus({ preventScroll: true });
        return;
      }
      const listFocused =
        isWithin(listRef.current, event.target) ||
        isWithin(listRef.current, document.activeElement);
      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
        if (listFocused && hitCount > 0) {
          event.preventDefault();
          previewRef.current?.focus();
        }
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "c" &&
        !event.shiftKey &&
        !event.altKey
      ) {
        if (listFocused && hitCount > 0) {
          event.preventDefault();
          onCopyPath();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    hitCount,
    helpOpen,
    listRef,
    modalOpen,
    onCancel,
    onCopyPath,
    onSearch,
    onToggleHelp,
    previewRef,
    queryRef,
    onListNav,
    running,
    selectedIndexRef,
    setSelectedIndex,
  ]);
}
