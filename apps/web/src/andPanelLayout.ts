/** Bar-aligned S-AND panel: main query field left → funnel button right, clipped to the hits column. */

export function measureAndPanelWidth(
  field: Pick<DOMRect, "left">,
  funnel: Pick<DOMRect, "right">,
  clip: Pick<DOMRect, "right">,
): number {
  const right = Math.min(funnel.right, clip.right);
  return Math.max(0, right - field.left);
}
