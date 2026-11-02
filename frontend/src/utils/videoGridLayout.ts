/** 影像畫面的目標比例（鏡頭 4:3）；格子實際比例會隨區域伸縮，影像以 object-fit: cover 填滿 */
const TARGET_VIDEO_ASPECT = 4 / 3;
/** 每格底下固定的名字列高度（.tile-footer-bar） */
export const TILE_FOOTER_HEIGHT = 48;
/** 每格最小寬度：人多到放不下時改為捲動，不再縮小 */
export const MIN_TILE_WIDTH = 200;
/** 格子上限為 2×2 的一格：人再少也至少排 2 欄 2 列，不會放得更大 */
const MIN_GRID_SIZE = 2;

export interface VideoGridInput {
  count: number;
  width: number;
  height: number;
  gap: number;
}

export interface VideoGridLayout {
  cols: number;
  rows: number;
  /** null = 每列平均分配高度、填滿區域；數字 = 放不下，每列固定此高度（px）並捲動 */
  rowHeight: number | null;
}

/**
 * 依人數與可用區域決定欄列數，讓每個人分到一樣大的格子，且影像盡可能大。
 * 逐一試欄數，比較「格子內能放下多大的 4:3 影像」；一樣大時選空格較少的排法。
 */
export function computeVideoGridLayout({ count, width, height, gap }: VideoGridInput): VideoGridLayout {
  if (count <= 0 || width <= 0 || height <= 0) return { cols: 1, rows: 1, rowHeight: null };

  let best: VideoGridLayout = { cols: 1, rows: count, rowHeight: null };
  let bestVideoWidth = -1;
  let bestEmpty = Infinity;

  for (let cols = MIN_GRID_SIZE; cols <= Math.max(count, MIN_GRID_SIZE); cols += 1) {
    const rows = Math.max(MIN_GRID_SIZE, Math.ceil(count / cols));
    const cellWidth = (width - gap * (cols - 1)) / cols;
    const cellHeight = (height - gap * (rows - 1)) / rows;
    const videoHeight = cellHeight - TILE_FOOTER_HEIGHT;
    const videoWidth = Math.min(cellWidth, videoHeight * TARGET_VIDEO_ASPECT);
    const empty = cols * rows - count;
    if (videoWidth > bestVideoWidth || (videoWidth === bestVideoWidth && empty < bestEmpty)) {
      best = { cols, rows, rowHeight: null };
      bestVideoWidth = videoWidth;
      bestEmpty = empty;
    }
  }

  if (bestVideoWidth >= MIN_TILE_WIDTH) return best;

  // 放不下：維持最小格子寬度，排滿一列後往下捲動
  const cols = Math.max(1, Math.floor((width + gap) / (MIN_TILE_WIDTH + gap)));
  const cellWidth = (width - gap * (cols - 1)) / cols;
  return {
    cols,
    rows: Math.ceil(count / cols),
    rowHeight: Math.round(cellWidth / TARGET_VIDEO_ASPECT + TILE_FOOTER_HEIGHT),
  };
}
