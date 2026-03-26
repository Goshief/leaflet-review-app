import { QuarantineClient } from "@/components/quarantine/quarantine-client";
import { LocalQuarantine } from "@/components/quarantine/local-quarantine";
import { listQuarantine } from "@/lib/quarantine/list-quarantine";

export const dynamic = "force-dynamic";

export default async function QuarantinePage() {
  const res = await listQuarantine();
  if (res.ok && res.configured) {
    return <QuarantineClient items={res.items} />;
  }
  return <LocalQuarantine />;
}

