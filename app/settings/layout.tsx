import { requireAdminPage } from "@/lib/auth/page-guards";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage("/settings");
  return children;
}
