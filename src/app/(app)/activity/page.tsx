"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { useCollection, useItemsById } from "@/lib/store/provider";
import { useAgent } from "@/components/agent/AgentProvider";
import { matches } from "@/lib/utils";
import { Button, EmptyState, Page, SearchField, Segmented } from "@/components/ui";
import { ACTIVITY_FILTERS, ActivityFeed, activityCategory, groupByDay, type ActivityFilter } from "@/components/workspace/activity";

const PAGE_SIZE = 60;

export default function ActivityPage() {
  const activity = useCollection("activity");
  const members = useCollection("members");
  const itemsById = useItemsById();
  const { setPageContext } = useAgent();

  const [filter, setFilterState] = useState<ActivityFilter>("all");
  const [query, setQueryState] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    setPageContext({ page: "Activity" });
  }, [setPageContext]);

  // Changing the filter or search restarts paging from the top.
  const setFilter = (f: ActivityFilter) => {
    setFilterState(f);
    setLimit(PAGE_SIZE);
  };
  const setQuery = (q: string) => {
    setQueryState(q);
    setLimit(PAGE_SIZE);
  };

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const sorted = useMemo(() => [...activity].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [activity]);

  const counts = useMemo(() => {
    const out: Record<ActivityFilter, number> = { all: 0, stock: 0, items: 0, orders: 0, returns: 0, builds: 0, agent: 0, team: 0 };
    for (const e of sorted) {
      if (!matches(query, e.message, e.actorName)) continue;
      out.all += 1;
      const cat = activityCategory(e.type);
      if (cat) out[cat] += 1;
    }
    return out;
  }, [sorted, query]);

  const filtered = useMemo(
    () => sorted.filter((e) => (filter === "all" || activityCategory(e.type) === filter) && matches(query, e.message, e.actorName)),
    [sorted, filter, query],
  );

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
  const groups = useMemo(() => groupByDay(visible), [visible]);
  const remaining = filtered.length - visible.length;

  const emptyState =
    activity.length === 0 ? (
      <EmptyState icon={<ClipboardList />} title="No activity yet" description="Receiving, builds, orders, returns, edits and agent actions will show up here with who did them and when." />
    ) : (
      <EmptyState icon={<ClipboardList />} title="No matching activity" description="Try another filter or search term." action={<Button onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</Button>} />
    );

  return (
    <Page title="Activity" subtitle="Everything that changed, by whom, and when">
      <div className="flex flex-col gap-4">
        <div className="card flex flex-wrap items-center gap-2 px-3 py-2.5">
          <SearchField value={query} onChange={setQuery} placeholder="Search messages or people" className="w-full sm:w-72" />
          <div className="max-w-full overflow-x-auto">
            <Segmented value={filter} onChange={setFilter} options={ACTIVITY_FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))} />
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="card">{emptyState}</div>
        ) : (
          <>
            <ActivityFeed groups={groups} membersById={membersById} itemsById={itemsById} />
            <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-[12.5px] text-text-tertiary">
              <span>
                Showing {visible.length} of {filtered.length} {filtered.length === 1 ? "event" : "events"}
              </span>
              {remaining > 0 && (
                <Button size="sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                  Show more ({Math.min(remaining, PAGE_SIZE)})
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
