import { redirect } from "next/navigation";

export default async function RejectedReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const one of v) p.append(k, one);
    } else {
      p.set(k, v);
    }
  }
  p.set("tab", "rejected");
  redirect(`/review?${p.toString()}`);
}
