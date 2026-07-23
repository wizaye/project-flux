const fs = require('fs');
const content = fs.readFileSync('packages/app-core/src/workspace-sidebars.tsx', 'utf-8');

// We need to fix RightContent to not call hooks conditionally.
// The easiest way is to extract BacklinksPane into its own component.

const replacement = `function BacklinksPane({
  activeDocument,
  filter,
  descending,
  sortByCount,
  filterVisible,
  setFilterVisible,
  refreshTrigger,
  setRefreshTrigger,
  setSortByCount,
  setDescending
}: {
  activeDocument: DemoDocument | null;
  filter: string;
  descending: boolean;
  sortByCount: boolean;
  filterVisible: boolean;
  setFilterVisible: React.Dispatch<React.SetStateAction<boolean>>;
  refreshTrigger: number;
  setRefreshTrigger: React.Dispatch<React.SetStateAction<number>>;
  setSortByCount: React.Dispatch<React.SetStateAction<boolean>>;
  setDescending: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const activeTitle = activeDocument?.path ?? activeDocument?.title ?? "Untitled";

  const groupMentions = useCallback((mentions: DocumentMention[]) => {
    const grouped = new Map<string, DocumentMention[]>();
    for (const mention of mentions) {
      const matchesFilter = \`\${mention.source} \${mention.excerpt}\`
        .toLocaleLowerCase()
        .includes(filter.toLocaleLowerCase());
      if (!matchesFilter) continue;
      const group = grouped.get(mention.source) ?? [];
      group.push(mention);
      grouped.set(mention.source, group);
    }
    return [...grouped].sort(([left, leftMentions], [right, rightMentions]) => {
      if (sortByCount) {
        const compareCounts = rightMentions.length - leftMentions.length;
        return descending ? -compareCounts : compareCounts;
      }
      return descending ? right.localeCompare(left) : left.localeCompare(right);
    });
  }, [filter, descending, sortByCount]);

  const storeVersion = useSyncExternalStore(
    (onStoreChange) => globalBacklinkStore.subscribe(onStoreChange),
    () => globalBacklinkStore.getCacheVersion()
  );

  const rawLinkedMentions = useMemo(() => {
    return globalBacklinkStore.getLinkedMentions(activeTitle);
  }, [activeTitle, refreshTrigger, storeVersion]);

  const rawUnlinkedMentions = useMemo(() => {
    if (!activeDocument) return [];
    return globalBacklinkStore.getUnlinkedMentions(activeDocument.title);
  }, [activeDocument?.title, refreshTrigger, storeVersion]);

  const linked = useMemo(() => {
    return groupMentions(rawLinkedMentions);
  }, [rawLinkedMentions, groupMentions]);

  const unlinked = useMemo(() => {
    return groupMentions(rawUnlinkedMentions);
  }, [rawUnlinkedMentions, groupMentions]);

  const totalLinkedCount = linked.reduce((sum, [, ms]) => sum + ms.length, 0);
  const totalUnlinkedCount = unlinked.reduce((sum, [, ms]) => sum + ms.length, 0);

  const handleCollapseAll = () => {
    const next: Record<string, boolean> = {};
    for (const [source] of linked) next[source] = false;
    for (const [source] of unlinked) next[source] = false;
    setExpandedGroups(next);
  };

  const handleExpandAll = () => {
    const next: Record<string, boolean> = {};
    for (const [source] of linked) next[source] = true;
    for (const [source] of unlinked) next[source] = true;
    setExpandedGroups(next);
  };
  
  const filterField = filterVisible ? (
    <div className="bg-sidebar px-2 pb-2">
      <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 [border-color:var(--layout-separator)]">
        <Search className="size-3.5 text-muted-foreground" />
        <input
          aria-label={\`Filter backlinks\`}
          value={filter}
          onChange={(event) => setFilterVisible(event.target.value as any)}
          placeholder="Filter..."
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </label>
    </div>
  ) : null;
`;

// we should just run eslint fix or manually patch the hook violation.
