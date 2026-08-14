import { requireOperatorPage } from "@/lib/auth/page-guards";

export default async function ProductTypesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorPage("/product-types");
  return children;
}
