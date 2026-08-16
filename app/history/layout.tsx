import { requireOperatorPage } from "@/lib/auth/page-guards";

export default async function HistoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorPage("/history");
  return children;
}
