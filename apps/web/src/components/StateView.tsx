import type { ReactNode } from "react";

export function StateView({
  tone = "accent",
  icon,
  title,
  helper,
  actions,
  code,
  detail,
  tips,
  alert = false,
  className = "",
}: {
  tone?: "accent" | "warn" | "danger";
  icon: ReactNode;
  title: string;
  helper?: string | undefined;
  actions?: ReactNode;
  code?: string | undefined;
  detail?: ReactNode;
  tips?: ReactNode;
  /** Error states announce from the title so stderr stays outside the alert. */
  alert?: boolean;
  className?: string;
}) {
  return (
    <div
      className={[
        "state-view",
        "empty-state",
        "empty-idle",
        `tone-${tone}`,
        className,
      ]
        .filter((name) => name !== "")
        .join(" ")}
    >
      <div className="state-art" aria-hidden="true">
        {icon}
      </div>
      <p
        className={tone === "danger" ? "empty-title danger" : "empty-title"}
        role={alert ? "alert" : undefined}
      >
        {title}
      </p>
      {helper !== undefined && helper !== "" ? (
        <p className="empty-helper">{helper}</p>
      ) : null}
      {actions != null ? <div className="state-actions">{actions}</div> : null}
      {tips}
      {detail}
      {code !== undefined && code !== "" ? (
        <p className="empty-code">{code}</p>
      ) : null}
    </div>
  );
}

export function StateButton({
  primary = false,
  onClick,
  children,
}: {
  primary?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={primary ? "state-btn primary" : "state-btn"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
