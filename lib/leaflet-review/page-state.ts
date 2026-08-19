export type LeafletPageState = {
  page_no: number;
  status: string;
};

export type LeafletPageCompletion = {
  pageCount: number;
  completedCount: number;
  isComplete: boolean;
  missingPages: number[];
  duplicatePages: number[];
  outOfRangePages: number[];
  unfinishedPages: number[];
};

export function analyzePageCompletion(states: LeafletPageState[], pageCount: number): LeafletPageCompletion {
  const normalizedPageCount = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 0;
  const seen = new Map<number, LeafletPageState[]>();
  const outOfRangePages: number[] = [];

  for (const state of states) {
    const pageNo = Number(state.page_no);
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > normalizedPageCount) {
      outOfRangePages.push(pageNo);
      continue;
    }
    const bucket = seen.get(pageNo) ?? [];
    bucket.push(state);
    seen.set(pageNo, bucket);
  }

  const missingPages: number[] = [];
  const duplicatePages: number[] = [];
  const unfinishedPages: number[] = [];
  let completedCount = 0;

  for (let pageNo = 1; pageNo <= normalizedPageCount; pageNo += 1) {
    const rows = seen.get(pageNo) ?? [];
    if (rows.length === 0) {
      missingPages.push(pageNo);
      continue;
    }
    if (rows.length !== 1) {
      duplicatePages.push(pageNo);
      continue;
    }
    if (rows[0].status === "completed") completedCount += 1;
    else unfinishedPages.push(pageNo);
  }

  const isComplete =
    normalizedPageCount > 0 &&
    states.length === normalizedPageCount &&
    missingPages.length === 0 &&
    duplicatePages.length === 0 &&
    outOfRangePages.length === 0 &&
    unfinishedPages.length === 0 &&
    completedCount === normalizedPageCount;

  return {
    pageCount: normalizedPageCount,
    completedCount,
    isComplete,
    missingPages,
    duplicatePages,
    outOfRangePages,
    unfinishedPages,
  };
}

export function firstIncompletePage(states: LeafletPageState[], pageCount: number): number | null {
  const normalizedPageCount = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 0;
  const byPage = new Map<number, LeafletPageState[]>();
  for (const state of states) {
    const pageNo = Number(state.page_no);
    const rows = byPage.get(pageNo) ?? [];
    rows.push(state);
    byPage.set(pageNo, rows);
  }

  for (let pageNo = 1; pageNo <= normalizedPageCount; pageNo += 1) {
    const rows = byPage.get(pageNo) ?? [];
    if (rows.length !== 1 || rows[0].status !== "completed") return pageNo;
  }
  return null;
}
