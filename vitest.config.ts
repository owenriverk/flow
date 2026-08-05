import { configDefaults, defineConfig } from 'vitest/config';

// gstack drops throwaway checkouts under .claude/worktrees/. Vitest's default
// glob is repo-wide, so it collected those checkouts' test files too and ran a
// second, stale copy of the whole suite alongside the real one — roughly
// doubling the reported file and test counts. Harmless while a worktree tracks
// main; actively misleading once it drifts, because a failure there points at
// code that isn't on your branch.
//
// tsconfig.json is already safe (include: ["src", "test"]), so typecheck was
// never affected — only vitest, which had no config file at all.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
