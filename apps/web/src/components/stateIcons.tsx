const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Idle and no-results mark: list lines plus a magnifier. */
export function IconStateSearch() {
  return (
    <svg className="state-ico" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M6 10h14M6 17h10M6 24h8" {...stroke} />
      <circle cx="26" cy="24" r="6.5" {...stroke} />
      <path d="m31 29 5 5" {...stroke} />
    </svg>
  );
}

export function IconStateBan() {
  return (
    <svg className="state-ico" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" {...stroke} />
      <path d="M4.2 11.8 11.8 4.2" {...stroke} />
    </svg>
  );
}

export function IconStateClock() {
  return (
    <svg className="state-ico" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" {...stroke} />
      <path d="M8 5v3.2l2 1.3" {...stroke} />
    </svg>
  );
}

export function IconStateServer() {
  return (
    <svg className="state-ico" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="4" rx="1.2" {...stroke} />
      <rect x="2.5" y="9" width="11" height="4" rx="1.2" {...stroke} />
      <path d="M5 5h.01M5 11h.01" {...stroke} />
    </svg>
  );
}

export function IconStateWarn() {
  return (
    <svg className="state-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5 14 13H2z" {...stroke} />
      <path d="M8 6.5v3M8 11.3v.01" {...stroke} />
    </svg>
  );
}

export function IconStatePanel() {
  return (
    <svg className="state-ico" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="2" {...stroke} />
      <path d="M6.5 3v10" {...stroke} />
    </svg>
  );
}
