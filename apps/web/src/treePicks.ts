import { LIMITS } from "@web-grep/shared";
import { escapeGlobPath, matchesAnyGlob } from "./globs.ts";

export type TreePick = {
  path: string;
  dir: boolean;
  /** File or folder kept out of a truncated folder pick. */
  exclude?: boolean;
};

/** Header chip label: folder picks keep a trailing `/`; file picks do not. */
export function pickChipLabel(pick: TreePick): string {
  const base =
    pick.path.split("/").filter((part) => part !== "").pop() ?? pick.path;
  if (pick.dir) {
    return base === "" ? "/" : `${base}/`;
  }
  return base;
}

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
  return picks.some((item) => !item.exclude && item.path === path);
}

function isDirectlyExcluded(path: string, picks: TreePick[]): boolean {
  return picks.some((item) => item.exclude === true && item.path === path);
}

function hasExcludeUnder(dirPath: string, picks: TreePick[]): boolean {
  return picks.some((item) => item.exclude === true && isUnderDir(item.path, dirPath));
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
  truncated = false,
): PickMark {
  if (isDirectlyExcluded(path, picks)) {
    return "off";
  }
  if (isDirectlyPicked(path, picks)) {
    if (isDir && hasExcludeUnder(path, picks)) {
      return "partial";
    }
    return "on";
  }
  if (isCovered(path, picks)) {
    if (isDir && hasExcludeUnder(path, picks)) {
      return "partial";
    }
    return "covered";
  }
  if (!isDir) {
    return "off";
  }
  if (!picks.some((item) => isUnderDir(item.path, path))) {
    return "off";
  }
  if (
    !truncated &&
    listedChildren != null &&
    allListedSelected(listedChildren, picks)
  ) {
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
  truncated = false,
): TreePick[] {
  if (isDirectlyExcluded(next.path, picks)) {
    return picks.filter((item) => !(item.exclude && item.path === next.path));
  }
  if (isDirectlyPicked(next.path, picks)) {
    return picks.filter(
      (item) => item.path !== next.path && !isUnderDir(item.path, next.path),
    );
  }
  if (isCovered(next.path, picks)) {
    if (truncated) {
      return [
        ...picks.filter((item) => !(item.exclude && item.path === next.path)),
        { path: next.path, dir: next.dir, exclude: true },
      ];
    }
    return uncover(picks, next, listedChildren, coveringChildren);
  }
  if (
    next.dir &&
    !truncated &&
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

function globForPick(item: TreePick): string {
  const path = escapeGlobPath(item.path);
  if (!item.dir) {
    return path;
  }
  if (item.path === "") {
    return "**";
  }
  return `${path}/**`;
}

export function picksToGlobs(picks: TreePick[]): string[] {
  return picks.filter((item) => !item.exclude).map((item) => globForPick(item));
}

function pickExcludeGlobs(picks: TreePick[]): string[] {
  return picks.filter((item) => item.exclude).map((item) => globForPick(item));
}

export function removePick(picks: TreePick[], path: string): TreePick[] {
  return picks.filter(
    (item) => item.path !== path && !isUnderDir(item.path, path),
  );
}

function splitByGlobCap(globs: string[]): { kept: string[]; omitted: string[] } {
  const kept: string[] = [];
  const omitted: string[] = [];
  for (const glob of globs) {
    if (glob.length > LIMITS.globMaxChars) {
      omitted.push(glob);
    } else {
      kept.push(glob);
    }
  }
  return { kept, omitted };
}

export function pickMatchesExclude(
  pick: TreePick,
  exclude: string[],
): boolean {
  if (exclude.length === 0) {
    return false;
  }
  if (matchesAnyGlob(pick.path, exclude)) {
    return true;
  }
  if (!pick.dir) {
    return false;
  }
  const child = pick.path === "" ? "__keep__" : `${pick.path}/__keep__`;
  return matchesAnyGlob(child, exclude);
}

export function prunePicksByExclude(
  picks: TreePick[],
  exclude: string[],
): TreePick[] {
  if (exclude.length === 0 || picks.length === 0) {
    return picks;
  }
  const next = picks.filter((item) => !pickMatchesExclude(item, exclude));
  return next.length === picks.length ? picks : next;
}

export function picksToSearchGlobs(
  picks: TreePick[],
  extraInclude: string[] = [],
  manualExclude: string[] = [],
): {
  globInclude: string[];
  globExclude: string[];
  omitted: string[];
  blocked: boolean;
} {
  const rawInclude = extraInclude.length > 0 ? extraInclude : picksToGlobs(picks);
  const rawExclude = [...manualExclude, ...pickExcludeGlobs(picks)];
  const include = splitByGlobCap(rawInclude);
  const exclude = splitByGlobCap(rawExclude);
  const blocked =
    (rawInclude.length > 0 && include.kept.length === 0) ||
    exclude.omitted.length > 0;
  return {
    globInclude: include.kept,
    globExclude: exclude.kept,
    omitted: [...include.omitted, ...exclude.omitted],
    blocked,
  };
}
