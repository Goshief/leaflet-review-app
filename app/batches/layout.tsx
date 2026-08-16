import { requireOperatorPage } from "@/lib/auth/page-guards";

export default async function BatchesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorPage("/batches");
  return children;
}
