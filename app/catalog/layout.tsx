import { requireOperatorPage } from "@/lib/auth/page-guards";

export default async function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorPage("/catalog");
  return children;
}
