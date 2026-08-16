import { requireOperatorPage } from "@/lib/auth/page-guards";

export default async function ParsersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorPage("/parsers");
  return children;
}
