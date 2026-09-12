import { useEffect } from "react";

export function Toast({
  message,
  onClose,
  duration = 2200,
}: {
  message: string | null;
  onClose: () => void;
  duration?: number;
}) {
  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [duration, message, onClose]);

  if (!message) {
    return null;
  }

  return (
    <div className="toast-overlay" role="status" aria-live="polite">
      <div className="toast-pill">
        <span className="toast-dot" />
        <span className="toast-text">{message}</span>
      </div>
    </div>
  );
}
