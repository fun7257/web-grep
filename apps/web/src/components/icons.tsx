const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function IconSun() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.6" {...stroke} />
      <path
        d="M8 2.2v1.3M8 12.5v1.3M2.2 8h1.3M12.5 8h1.3M3.9 3.9l.95.95M11.15 11.15l.95.95M3.9 12.1l.95-.95M11.15 4.85l.95-.95"
        {...stroke}
      />
    </svg>
  );
}

export function IconMoon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M9.6 2.6A5.4 5.4 0 1 0 13.2 11 4.4 4.4 0 0 1 9.6 2.6z"
        {...stroke}
      />
    </svg>
  );
}

export function IdleMark({ kind }: { kind: "hits" | "preview" | "nomatch" }) {
  if (kind === "nomatch") {
    return (
      <svg className="idle-mark" viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="24" cy="26" r="2.2" fill="currentColor" opacity="0.35" />
        <path
          d="M32 26h34"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.35"
        />
        <circle cx="24" cy="44" r="2.2" fill="currentColor" opacity="0.22" />
        <path
          d="M36 44h10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.28"
        />
        <path
          d="M52 44h10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.28"
        />
        <circle cx="24" cy="62" r="2.2" fill="currentColor" opacity="0.35" />
        <path
          d="M32 62h24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.35"
        />
      </svg>
    );
  }
  if (kind === "hits") {
    return (
      <svg className="idle-mark" viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="24" cy="26" r="2.2" fill="currentColor" opacity="0.4" />
        <path
          d="M32 26h34"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.4"
        />
        <circle className="idle-mark-hit" cx="24" cy="44" r="2.2" />
        <rect
          className="idle-mark-hit"
          x="32"
          y="41"
          width="34"
          height="6"
          rx="2"
        />
        <circle cx="24" cy="62" r="2.2" fill="currentColor" opacity="0.4" />
        <path
          d="M32 62h24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.4"
        />
      </svg>
    );
  }
  return (
    <svg className="idle-mark" viewBox="0 0 88 88" aria-hidden="true">
      <path
        d="M28 16h22l14 14v42a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6V22a6 6 0 0 1 6-6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M50 16v14h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M32 42h24M32 52h18M32 62h24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.4"
      />
      <rect
        className="idle-mark-hit"
        x="32"
        y="48"
        width="16"
        height="5"
        rx="2.5"
      />
    </svg>
  );
}

export function IconSearch() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" {...stroke} />
      <path d="M10.5 10.5 L14 14" {...stroke} />
    </svg>
  );
}

export function IconFolder({ open = false }: { open?: boolean }) {
  if (open) {
    return (
      <svg
        className="icon tree-folder is-open"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <path
          d="M1.6 13.2 3.2 7h11.2L12.8 13.2z"
          fill="currentColor"
          opacity="0.2"
          stroke="none"
        />
        <path d="M1.8 4.6h4.1l1.2 1.4h6.4V7" {...stroke} />
        <path d="M3.2 7h11.2l-1.6 6.2H1.6z" {...stroke} />
      </svg>
    );
  }
  return (
    <svg className="icon tree-folder" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 4.6h4l1.2 1.4H14v7.5H2z"
        fill="currentColor"
        opacity="0.18"
        stroke="none"
      />
      <path d="M2 4.6h4l1.2 1.4H14v7.5H2z" {...stroke} />
    </svg>
  );
}

export function IconFile() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 2.5h5l3 3V13.5h-8z" {...stroke} />
      <path d="M9.5 2.5v3h3" {...stroke} />
    </svg>
  );
}

export function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? "icon chevron open" : "icon chevron"}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M6 4l5 4-5 4" {...stroke} />
    </svg>
  );
}

export function IconNavBack() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.4 3.2 5.6 8l4.8 4.8" {...stroke} />
    </svg>
  );
}

export function IconNavForward() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.6 3.2 10.4 8l-4.8 4.8" {...stroke} />
    </svg>
  );
}

export function IconCaret({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? "icon caret open" : "icon caret"}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M3.8 6.2 8 10.4 12.2 6.2" {...stroke} />
    </svg>
  );
}

export function IconFilter() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 3h12l-5 6v5l-2-1V9L2 3z" {...stroke} />
    </svg>
  );
}

export function IconListGroup() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 3.5h12M5 7.5h9M5 11.5h9M2 7.5h.01M2 11.5h.01" {...stroke} />
    </svg>
  );
}

export function IconListFlat() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 3.5h12M2 7.5h12M2 11.5h12" {...stroke} />
    </svg>
  );
}

export function IconPanel({ open }: { open: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2" {...stroke} />
      <path d="M6.4 2.5v11" {...stroke} />
      {open ? (
        <path d="M10.4 6.15 8.5 8l1.9 1.85" {...stroke} />
      ) : (
        <path d="M8.6 6.15 10.5 8l-1.9 1.85" {...stroke} />
      )}
    </svg>
  );
}

export function IconCheck() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.6 8.2 6.6 11.1 12.5 4.8" {...stroke} />
    </svg>
  );
}

export function IconDash() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 8h8" {...stroke} />
    </svg>
  );
}

export function IconCopy() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.2" y="5.2" width="7.3" height="8.3" rx="1.4" {...stroke} />
      <path d="M3.6 10.6V3.7A1.4 1.4 0 0 1 5 2.3h5.4" {...stroke} />
    </svg>
  );
}

export function IconExpand() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 9.5V13h3.5M13 6.5V3H9.5" {...stroke} />
      <path d="M9.7 6.3 13 3M6.3 9.7 3 13" {...stroke} />
    </svg>
  );
}

export function IconShare() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="12.25" cy="3.5" r="1.65" {...stroke} />
      <circle cx="12.25" cy="12.5" r="1.65" {...stroke} />
      <circle cx="3.75" cy="8" r="1.65" {...stroke} />
      <path d="M5.3 7.25 10.7 4.25M5.3 8.75 10.7 11.75" {...stroke} />
    </svg>
  );
}

export function IconTarget() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" {...stroke} />
      <circle cx="8" cy="8" r="1.7" {...stroke} />
    </svg>
  );
}

export function IconMinusCircle() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" {...stroke} />
      <path d="M5.4 8h5.2" {...stroke} />
    </svg>
  );
}

export function IconLogout() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6.2 3.2H4.4A1.4 1.4 0 0 0 3 4.6v6.8A1.4 1.4 0 0 0 4.4 12.8h1.8M7.2 8H13M10.8 5.7 13.2 8 10.8 10.3"
        {...stroke}
      />
    </svg>
  );
}

export function IconX() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6" {...stroke} />
    </svg>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path
          d="M4.2 8.2h5.1l1.35 1.55H19.8v8.05H4.2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <circle
          cx="13.1"
          cy="14.15"
          r="2.45"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M14.9 16 17.4 18.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function FileIcon({
  path,
  isDir,
  open,
}: {
  path: string;
  isDir?: boolean;
  open?: boolean;
}) {
  if (isDir) {
    return <IconFolder open={open === true} />;
  }
  const dot = path.lastIndexOf(".");
  const ext = dot !== -1 ? path.slice(dot + 1).toLowerCase() : "";

  if (ext === "ts" || ext === "tsx") {
    return <span className="ext-badge ext-ts">TS</span>;
  }
  if (ext === "js" || ext === "jsx" || ext === "mjs") {
    return <span className="ext-badge ext-js">JS</span>;
  }
  if (ext === "go") {
    return <span className="ext-badge ext-go">GO</span>;
  }
  if (ext === "py") {
    return <span className="ext-badge ext-py">PY</span>;
  }
  if (ext === "rs") {
    return <span className="ext-badge ext-rs">RS</span>;
  }
  if (ext === "json") {
    return <span className="ext-badge ext-json">{"{}"}</span>;
  }
  if (ext === "md" || ext === "markdown") {
    return <span className="ext-badge ext-md">MD</span>;
  }
  if (ext === "css" || ext === "scss" || ext === "less") {
    return <span className="ext-badge ext-css">#</span>;
  }
  if (ext === "html") {
    return <span className="ext-badge ext-html">&lt;&gt;</span>;
  }
  return <IconFile />;
}
