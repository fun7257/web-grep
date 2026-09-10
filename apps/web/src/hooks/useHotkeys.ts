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
  running: boolean;
  modalOpen: boolean;
  queryRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLElement | null>;
  previewRef: RefObject<HTMLElement | null>;
  hitCount: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
}): void {
  const {
    onSearch,
    onCancel,
    onCopyPath,
    running,
    modalOpen,
    queryRef,
    listRef,
    previewRef,
    hitCount,
    setSelectedIndex,
  } = opts;

  useEffect(() => {
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
      if (isTypingTarget(event.target) || modalOpen) {
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        queryRef.current?.focus();
        return;
      }
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) =>
          hitCount === 0 ? 0 : Math.min(hitCount - 1, index + 1),
        );
        listRef.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(0, index - 1));
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
    listRef,
    modalOpen,
    onCancel,
    onCopyPath,
    onSearch,
    previewRef,
    queryRef,
    running,
    setSelectedIndex,
  ]);
}
