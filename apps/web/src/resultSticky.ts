export type StickyHeader = {
  index: number;
  start: number;
  path: string;
  count: number;
};

export type StickyIdentity = {
  path: string;
  count: number;
};

export type StickyPick = {
  path: string;
  count: number;
  shift: number;
  pushing: boolean;
  enteringIndex: number | null;
};

export function pickSticky(
  headers: StickyHeader[],
  scrollTop: number,
  stickyH: number,
  findPrev: (index: number) => StickyIdentity | null = (index) => {
    for (let i = headers.length - 1; i >= 0; i--) {
      const header = headers[i];
      if (header !== undefined && header.index < index) {
        return header;
      }
    }
    return null;
  },
  settled: StickyIdentity | null = null,
): StickyPick | null {
  const pin = scrollTop + stickyH;
  const crossing = headers.find(
    (header) => header.start > scrollTop && header.start < pin,
  );
  if (crossing !== undefined) {
    const prev = findPrev(crossing.index);
    const shown = prev ?? crossing;
    return {
      path: shown.path,
      count: shown.count,
      shift: crossing.start - pin,
      pushing: prev !== null,
      enteringIndex: crossing.index,
    };
  }
  const current =
    settled ??
    headers.reduce<StickyHeader | null>((last, header) => {
      return header.start < pin ? header : last;
    }, null) ??
    headers[0];
  if (current === undefined || current === null) {
    return null;
  }
  return {
    path: current.path,
    count: current.count,
    shift: 0,
    pushing: false,
    enteringIndex: null,
  };
}
