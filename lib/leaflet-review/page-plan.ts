export type PagePlanState = { page_no: number; status: string };

export function planLeafletPages(states: PagePlanState[], pageCount: number, force = false): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) return [];
  if (force) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const statusByPage = new Map<number, string>();
  for (const state of states) {
    const pageNo = Number(state.page_no);
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > pageCount) continue;
    statusByPage.set(pageNo, state.status);
  }
  const pages: number[] = [];
  for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
    if (statusByPage.get(pageNo) !== "completed") pages.push(pageNo);
  }
  return pages;
}
