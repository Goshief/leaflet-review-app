import { requireOperatorPage } from "@/lib/auth/page-guards";

export default async function QuarantineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorPage("/quarantine");
  return children;
}
