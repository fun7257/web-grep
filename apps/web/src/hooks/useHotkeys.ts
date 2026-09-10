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

export function useHotkeys(opts: {
  onSearch: () => void;
  onCancel: () => void;
  running: boolean;
  queryRef: RefObject<HTMLInputElement | null>;
  hitCount: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
}): void {
  const { onSearch, onCancel, running, queryRef, hitCount, setSelectedIndex } =
    opts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        onSearch();
        return;
      }
      if (event.key === "Escape") {
        if (running) {
          event.preventDefault();
          onCancel();
        }
        return;
      }
      if (isTypingTarget(event.target)) {
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
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(0, index - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [hitCount, onCancel, onSearch, queryRef, running, setSelectedIndex]);
}
