export async function copyText(text: string): Promise<boolean> {
  const write = navigator.clipboard?.writeText;
  if (typeof write === "function") {
    try {
      await write.call(navigator.clipboard, text);
      return true;
    } catch {
      // HTTP / permission: fall through to execCommand.
    }
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.top = "0";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.focus();
  el.select();
  let ok = false;
  try {
    ok =
      typeof document.execCommand === "function" &&
      document.execCommand("copy");
  } finally {
    document.body.removeChild(el);
  }
  return ok;
}
