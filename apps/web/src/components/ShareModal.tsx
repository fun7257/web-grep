import { useEffect, useState } from "react";
import { copyText } from "../copyText.ts";
import { useLocale } from "../hooks/useLocale.ts";
import { AppModal } from "./AppModal.tsx";
import { IconCheck, IconCopy } from "./icons.tsx";

export function ShareModal({
  open,
  rgCommand,
  webUrl,
  onClose,
  onCopyNotice,
}: {
  open: boolean;
  rgCommand: string | null;
  webUrl: string | null;
  onClose: () => void;
  onCopyNotice?: (msg: string) => void;
}) {
  const { t } = useLocale();
  const [copied, setCopied] = useState<"rg" | "link" | null>(null);

  useEffect(() => {
    if (!open) {
      setCopied(null);
    }
  }, [open]);

  const copy = (kind: "rg" | "link", value: string, notice: string): void => {
    void copyText(value);
    setCopied(kind);
    onCopyNotice?.(notice);
  };

  return (
    <AppModal
      open={open}
      title={t("shareTitle")}
      ariaLabel={t("shareTitle")}
      boxClass="share-modal"
      onClose={onClose}
    >
      {rgCommand !== null ? (
        <ShareRow
          label={t("shareRgLabel")}
          value={rgCommand}
          copied={copied === "rg"}
          copyLabel={t("shareRg")}
          onCopy={() => {
            copy("rg", rgCommand, t("copiedRg"));
          }}
        />
      ) : null}
      {webUrl !== null ? (
        <ShareRow
          label={t("shareLinkLabel")}
          value={webUrl}
          copied={copied === "link"}
          copyLabel={t("shareLink")}
          onCopy={() => {
            copy("link", webUrl, t("copiedLink"));
          }}
        />
      ) : null}
    </AppModal>
  );
}

function ShareRow({
  label,
  value,
  copied,
  copyLabel,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  copyLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="share-row">
      <div className="share-row-label">{label}</div>
      <div className="share-row-body">
        <input
          className="share-input"
          readOnly
          value={value}
          title={value}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
        />
        <button
          type="button"
          className={copied ? "share-copy is-copied" : "share-copy"}
          title={copyLabel}
          aria-label={copyLabel}
          onClick={onCopy}
        >
          {copied ? <IconCheck /> : <IconCopy />}
        </button>
      </div>
    </div>
  );
}
