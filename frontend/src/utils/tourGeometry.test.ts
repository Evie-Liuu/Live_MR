import { describe, expect, it } from 'vitest';
import { placeBubble, visibleTarget } from './tourGeometry.ts';

const viewport = { top: 0, left: 0, right: 1280, bottom: 720 };
const sidebar = { top: 104, left: 0, right: 380, bottom: 720 };

describe('visibleTarget', () => {
  it('keeps a fully visible target as is', () => {
    expect(visibleTarget({ top: 300, left: 20, width: 300, height: 100 }, [sidebar, viewport]))
      .toEqual({ kind: 'visible', box: { top: 300, left: 20, width: 300, height: 100 } });
  });

  it('cuts the part scrolled under the top bar', () => {
    expect(visibleTarget({ top: 60, left: 20, width: 300, height: 100 }, [sidebar, viewport]))
      .toEqual({ kind: 'visible', box: { top: 104, left: 20, width: 300, height: 56 } });
  });

  it('reports a target scrolled out above, anchored to the container edge', () => {
    const v = visibleTarget({ top: -200, left: 20, width: 300, height: 100 }, [sidebar, viewport]);
    expect(v).toEqual({ kind: 'hidden', direction: 'above', anchor: { top: 104, left: 20, width: 300, height: 0 } });
  });

  it('reports a target scrolled out below', () => {
    const v = visibleTarget({ top: 900, left: 900, width: 340, height: 50 }, [{ top: 77, left: 880, right: 1280, bottom: 620 }, viewport]);
    expect(v).toMatchObject({ kind: 'hidden', direction: 'below', anchor: { top: 620 } });
  });

  it('treats a sliver as hidden', () => {
    expect(visibleTarget({ top: 100, left: 20, width: 300, height: 100 }, [{ ...sidebar, top: 195 }]).kind).toBe('hidden');
  });

  it('handles a missing target', () => {
    expect(visibleTarget(null, [viewport])).toEqual({ kind: 'none' });
  });
});

describe('placeBubble', () => {
  const vp = { width: 1280, height: 720 };
  const bubble = { width: 300, height: 120 };

  it('prefers the requested side', () => {
    expect(placeBubble({ top: 300, left: 20, width: 300, height: 100 }, bubble, 'right', vp, 104)).toEqual({ top: 290, left: 334 });
  });

  it('switches side when the preferred one does not fit', () => {
    expect(placeBubble({ top: 300, left: 1000, width: 260, height: 40 }, bubble, 'right', vp, 104).left).toBe(1000 - 14 - 300);
  });

  it('sits under the navigator when there is no target', () => {
    expect(placeBubble(null, bubble, 'below', vp, 104)).toEqual({ top: 118, left: 490 });
  });
});
