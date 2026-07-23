import re

with open('packages/app-core/src/workspace-sidebars.tsx', 'r') as f:
    content = f.read()

# We will just hoist the hook logic to the top of RightContent, before `if (!activeDocument)`
# The safest and easiest way is to rewrite the file string by moving the block of hooks.

hooks_block = """
  const activeTitle = activeDocument?.path ?? activeDocument?.title ?? "Untitled";

  const groupMentions = useCallback((mentions: DocumentMention[]) => {
    const grouped = new Map<string, DocumentMention[]>();
    for (const mention of mentions) {
      const matchesFilter = `${mention.source} ${mention.excerpt}`
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
"""

# Now remove these lines from the `if (pane === "backlinks")` block.
remove_regex = re.compile(r'    const activeTitle = activeDocument\?\.path \?\? activeDocument\?\.title \?\? "Untitled";.*?const unlinked = useMemo\(\(\) => \{\n      return groupMentions\(rawUnlinkedMentions\);\n    \}, \[rawUnlinkedMentions, filter, descending, sortByCount\]\);\n', re.DOTALL)

if not remove_regex.search(content):
    print("Could not find the hook block to remove.")
    exit(1)

content_without_hooks = remove_regex.sub('', content)

# Now insert the hooks_block right before `if (!activeDocument) {`
insert_pos = content_without_hooks.find('  if (!activeDocument) {')
if insert_pos == -1:
    print("Could not find insertion point.")
    exit(1)

new_content = content_without_hooks[:insert_pos] + hooks_block + "\n" + content_without_hooks[insert_pos:]

# Wait, `useCallback` is not imported if it wasn't used before.
if 'useCallback' not in new_content[:500]:
    new_content = new_content.replace('useState,', 'useState, useCallback,')

with open('packages/app-core/src/workspace-sidebars.tsx', 'w') as f:
    f.write(new_content)

print("Done")
