/** Bar-aligned filter panel: main query field left → funnel button right, clipped to the hits column. */

export function measureFilterPanelWidth(
  field: Pick<DOMRect, "left">,
  funnel: Pick<DOMRect, "right">,
  clip: Pick<DOMRect, "right">,
): number {
  const right = Math.min(funnel.right, clip.right);
  return Math.max(0, right - field.left);
}
