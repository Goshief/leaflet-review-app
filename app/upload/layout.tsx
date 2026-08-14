import { requireOperatorPage } from "@/lib/auth/page-guards";

export default async function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorPage("/upload");
  return children;
}
