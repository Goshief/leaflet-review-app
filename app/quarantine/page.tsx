import { QuarantineClient } from "@/components/quarantine/quarantine-client";
import { QuarantineListError } from "@/components/quarantine/quarantine-list-error";
import { QuarantineDbEmpty } from "@/components/quarantine/quarantine-db-empty";
import { QuarantineDbNotConfigured } from "@/components/quarantine/quarantine-db-not-configured";
import { listQuarantine } from "@/lib/quarantine/list-quarantine";
import { isQuarantineRowOpenInDefaultList } from "@/lib/quarantine/quarantine-list-open";

export const dynamic = "force-dynamic";

export default async function QuarantinePage() {
  const res = await listQuarantine();

  if (!res.ok && res.configured) {
    return <QuarantineListError message={res.error} />;
  }

  if (res.ok && res.configured) {
    if (res.items.length === 0) {
      return <QuarantineDbEmpty />;
    }

    const dbCounts = {
      total: res.items.length,
      open: res.items.filter((item) =>
        isQuarantineRowOpenInDefaultList(item.quarantine_reason)
      ).length,
    };
    return <QuarantineClient items={res.items} dbCounts={dbCounts} />;
  }

  return <QuarantineDbNotConfigured message={res.message} />;
}
