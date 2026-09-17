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

const idleLine = {
  fill: "currentColor",
  rx: 1.25,
  height: 2.5,
} as const;

export function IdleMark({
  kind,
}: {
  kind: "hits" | "preview" | "nomatch" | "rail";
}) {
  if (kind === "rail") {
    return (
      <svg className="idle-mark" viewBox="0 0 88 88" fill="none" aria-hidden="true">
        <rect x="18" y="22" width="52" height="8" rx="4" fill="currentColor" opacity="0.22" />
        <rect x="18" y="40" width="40" height="8" rx="4" fill="currentColor" opacity="0.22" />
        <rect x="18" y="58" width="46" height="8" rx="4" fill="currentColor" opacity="0.22" />
        <circle className="idle-mark-hit" cx="68" cy="44" r="5" />
      </svg>
    );
  }
  if (kind === "preview") {
    return (
      <svg className="idle-mark" viewBox="0 0 88 88" aria-hidden="true">
        <path
          d="M27 17h21l13 13v39a5 5 0 0 1-5 5H27a5 5 0 0 1-5-5V22a5 5 0 0 1 5-5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="M48 17v13h13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <rect {...idleLine} x="30" y="40" width="22" opacity="0.28" />
        <rect className="idle-mark-hit" x="30" y="50" width="16" height="2.5" rx="1.25" />
        <rect {...idleLine} x="30" y="60" width="20" opacity="0.28" />
      </svg>
    );
  }
  if (kind === "hits") {
    return (
      <svg className="idle-mark" viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="24" cy="27" r="2" fill="currentColor" opacity="0.32" />
        <rect {...idleLine} x="32" y="25.75" width="32" opacity="0.28" />
        <circle className="idle-mark-hit" cx="24" cy="44" r="2" />
        <rect
          className="idle-mark-hit"
          x="32"
          y="42.75"
          width="32"
          height="2.5"
          rx="1.25"
        />
        <circle cx="24" cy="61" r="2" fill="currentColor" opacity="0.32" />
        <rect {...idleLine} x="32" y="59.75" width="22" opacity="0.28" />
      </svg>
    );
  }
  return (
    <svg className="idle-mark" viewBox="0 0 88 88" aria-hidden="true">
      <circle cx="24" cy="27" r="2" fill="currentColor" opacity="0.28" />
      <rect {...idleLine} x="32" y="25.75" width="32" opacity="0.24" />
      <circle cx="24" cy="44" r="2" fill="currentColor" opacity="0.18" />
      <rect {...idleLine} x="32" y="42.75" width="12" opacity="0.16" />
      <rect {...idleLine} x="50" y="42.75" width="14" opacity="0.16" />
      <circle cx="24" cy="61" r="2" fill="currentColor" opacity="0.28" />
      <rect {...idleLine} x="32" y="59.75" width="24" opacity="0.24" />
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

export function IconPlus() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.25v9.5M3.25 8h9.5" {...stroke} />
    </svg>
  );
}

export function IconAnd() {
  return (
    <svg className="icon icon-and" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.4 3.2h11.2L9.3 8.4v3.4L6.7 13.4V8.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
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

export function IconRailExpand() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6l6 6-6 6" {...stroke} />
    </svg>
  );
}

export function IconHistory() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8.2" r="5.2" {...stroke} />
      <path d="M8 5.6v3.1l2.1 1.2" {...stroke} />
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

export function IconFoldAll() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3.4h10M5.4 8.9 8 6.3 10.6 8.9M3 12.6h10" {...stroke} />
    </svg>
  );
}

export function IconUnfoldAll() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3.4h10M5.4 6.1 8 8.7 10.6 6.1M3 12.6h10" {...stroke} />
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

export function IconLock() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="7.2" width="9" height="6.4" rx="1.4" {...stroke} />
      <path d="M5.4 7.2V5.4a2.6 2.6 0 0 1 5.2 0v1.8" {...stroke} />
    </svg>
  );
}

export function IconWarn() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.6 14.2 13.4H1.8L8 2.6z" {...stroke} />
      <path d="M8 6.6v3.2M8 11.6v.2" {...stroke} />
    </svg>
  );
}

export function IconBinary() {
  return (
    <svg className="icon idle-mark" viewBox="0 0 88 88" aria-hidden="true">
      <rect
        x="24"
        y="18"
        width="40"
        height="52"
        rx="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M34 36h20M34 46h14M34 56h18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M5 7h14M5 12h10M5 17h7"
          stroke="currentColor"
          strokeWidth="2"
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

  if (ext === "tsx") {
    return <span className="ext-badge ext-tsx">TSX</span>;
  }
  if (ext === "ts") {
    return <span className="ext-badge ext-ts">TS</span>;
  }
  if (ext === "js" || ext === "jsx" || ext === "mjs") {
    return <span className="ext-badge ext-js">JS</span>;
  }
  if (ext === "yml" || ext === "yaml") {
    return <span className="ext-badge ext-yml">YML</span>;
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
