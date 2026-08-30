import { requireOperatorPage } from "@/lib/auth/page-guards";

export default async function LetakLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorPage("/letak");
  return children;
}
