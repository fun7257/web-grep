export type TreePick = {
  path: string;
  dir: boolean;
};

export type PickMark = "off" | "on" | "covered" | "partial";

export type ListedChild = {
  path: string;
  dir: boolean;
};

function isUnderDir(path: string, dirPath: string): boolean {
  if (dirPath === "") {
    return path !== "";
  }
  return path.startsWith(`${dirPath}/`);
}

function isDirectlyPicked(path: string, picks: TreePick[]): boolean {
  return picks.some((item) => item.path === path);
}

function isCovered(path: string, picks: TreePick[]): boolean {
  return picks.some((item) => item.dir && isUnderDir(path, item.path));
}

export function allListedSelected(
  children: ListedChild[],
  picks: TreePick[],
): boolean {
  if (children.length === 0) {
    return false;
  }
  return children.every(
    (child) => isDirectlyPicked(child.path, picks) || isCovered(child.path, picks),
  );
}

export function pickMark(
  path: string,
  isDir: boolean,
  picks: TreePick[],
  listedChildren?: ListedChild[] | null,
): PickMark {
  if (isDirectlyPicked(path, picks)) {
    return "on";
  }
  if (isCovered(path, picks)) {
    return "covered";
  }
  if (!isDir) {
    return "off";
  }
  if (!picks.some((item) => isUnderDir(item.path, path))) {
    return "off";
  }
  if (listedChildren != null && allListedSelected(listedChildren, picks)) {
    return "on";
  }
  return "partial";
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) {
    return "";
  }
  return path.slice(0, index);
}

function nearestCovering(path: string, picks: TreePick[]): TreePick | undefined {
  return picks
    .filter((item) => item.dir && isUnderDir(path, item.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

function uncover(
  picks: TreePick[],
  next: TreePick,
  listedChildren?: ListedChild[] | null,
  coveringChildren?: ListedChild[] | null,
): TreePick[] {
  const covering = nearestCovering(next.path, picks);
  if (covering === undefined) {
    return picks;
  }
  const rest = picks.filter((item) => item.path !== covering.path);
  const coverKids = coveringChildren ?? listedChildren ?? [];
  const siblingKids = listedChildren ?? [];
  const parent = parentPath(next.path);
  const added: TreePick[] = [];
  for (const child of coverKids) {
    if (child.path === next.path) {
      continue;
    }
    if (isUnderDir(next.path, child.path)) {
      if (parent === child.path) {
        for (const sib of siblingKids) {
          if (sib.path !== next.path) {
            added.push({ path: sib.path, dir: sib.dir });
          }
        }
      } else {
        added.push({ path: child.path, dir: child.dir });
      }
    } else {
      added.push({ path: child.path, dir: child.dir });
    }
  }
  return [...rest, ...added];
}

export function togglePick(
  picks: TreePick[],
  next: TreePick,
  listedChildren?: ListedChild[] | null,
  coveringChildren?: ListedChild[] | null,
): TreePick[] {
  if (isDirectlyPicked(next.path, picks)) {
    return picks.filter(
      (item) => item.path !== next.path && !isUnderDir(item.path, next.path),
    );
  }
  if (isCovered(next.path, picks)) {
    return uncover(picks, next, listedChildren, coveringChildren);
  }
  if (
    next.dir &&
    listedChildren != null &&
    allListedSelected(listedChildren, picks)
  ) {
    return picks.filter((item) => !isUnderDir(item.path, next.path));
  }
  if (next.dir) {
    return [
      ...picks.filter((item) => !isUnderDir(item.path, next.path)),
      next,
    ];
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

export function picksToSearchGlobs(
  picks: TreePick[],
  scope: "all" | "include" | "exclude",
  extraInclude: string[] = [],
  manualInclude: string[] = [],
  manualExclude: string[] = [],
): { globInclude: string[]; globAnd: string[]; globExclude: string[] } {
  if (extraInclude.length > 0) {
    return {
      globInclude: extraInclude,
      globAnd: [...manualInclude],
      globExclude: [...manualExclude],
    };
  }
  const pickGlobs = picksToGlobs(picks);
  if (picks.length === 0) {
    return {
      globInclude: [...manualInclude],
      globAnd: [],
      globExclude: [...manualExclude],
    };
  }
  if (scope === "exclude") {
    return {
      globInclude: [...manualInclude],
      globAnd: [],
      globExclude: [...pickGlobs, ...manualExclude],
    };
  }
  return {
    globInclude: pickGlobs,
    globAnd: [...manualInclude],
    globExclude: [...manualExclude],
  };
}
