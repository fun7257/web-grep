export type TreePick = {
  path: string;
  dir: boolean;
};

export function togglePick(picks: TreePick[], next: TreePick): TreePick[] {
  const exists = picks.some((item) => item.path === next.path);
  if (exists) {
    return picks.filter((item) => item.path !== next.path);
  }
  return [...picks, next];
}

export function picksToGlobs(picks: TreePick[]): string[] {
  return picks.map((item) => {
    if (!item.dir) {
      return item.path;
    }
    if (item.path === "") {
      return "**";
    }
    return `${item.path}/**`;
  });
}
