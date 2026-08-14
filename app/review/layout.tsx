import { requireOperatorPage } from "@/lib/auth/page-guards";

export default async function ReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorPage("/review");
  return children;
}
