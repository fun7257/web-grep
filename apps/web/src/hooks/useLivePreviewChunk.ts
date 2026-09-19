import { useEffect, useState } from "react";
import {
  hasLivePreviewLimits,
  livePreviewChunk,
  subscribeLivePreviewLimits,
} from "../previewChunk.ts";

/** Latest resolved preview count after /api/meta, or null until meta is loaded. */
export function useLivePreviewChunk(): number | null {
  const [chunk, setChunk] = useState<number | null>(() =>
    hasLivePreviewLimits() ? livePreviewChunk() : null,
  );
  useEffect(() => {
    const sync = (): void => {
      setChunk(hasLivePreviewLimits() ? livePreviewChunk() : null);
    };
    sync();
    return subscribeLivePreviewLimits(sync);
  }, []);
  return chunk;
}
