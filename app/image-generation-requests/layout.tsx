import { requireOperatorPage } from "@/lib/auth/page-guards";

export default async function ImageGenerationRequestsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorPage("/image-generation-requests");
  return children;
}
