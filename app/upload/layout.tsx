import { DirectIntakeUploadShim } from "@/components/intake/direct-upload-shim";
import { requireOperatorPage } from "@/lib/auth/page-guards";

export default async function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorPage("/upload");
  return (
    <>
      <DirectIntakeUploadShim />
      {children}
    </>
  );
}
