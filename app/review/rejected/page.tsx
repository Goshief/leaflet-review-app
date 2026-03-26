import { redirect } from "next/navigation";

export default function RejectedReviewPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams ?? {})) {
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

