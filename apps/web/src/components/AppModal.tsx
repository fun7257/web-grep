import {
  type ReactNode,
  useEffect,
} from "react";
import { useLocale } from "../hooks/useLocale.ts";

export function AppModal({
  open,
  title,
  ariaLabel,
  boxClass,
  onClose,
  headerExtra,
  children,
}: {
  open: boolean;
  title: ReactNode;
  ariaLabel?: string;
  boxClass: string;
  onClose: () => void;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLocale();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="token-overlay"
      role="dialog"
      aria-modal="true"
      {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}
      onClick={onClose}
    >
      <div
        className={boxClass}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="hotkey-header">
          <h2>{title}</h2>
          {headerExtra}
          <button
            type="button"
            className="hotkey-close"
            onClick={onClose}
            aria-label={t("close")}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
