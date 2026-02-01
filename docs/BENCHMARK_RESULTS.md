# Benchmark Results

> **Auto-generated**: This file is updated automatically by CI on each release.

## Latest Results

See [GitHub Actions workflow](https://github.com/velvetmonkey/flywheel-crank/actions/workflows/benchmark-full.yml) for live status.

## Scale Testing

| Vault Size | Notes | Mutation Time (P95) | Status |
|------------|-------|---------------------|--------|
| 1,000      | TBD   | TBD                 | -      |
| 10,000     | TBD   | TBD                 | -      |
| 50,000     | TBD   | TBD                 | -      |
| 100,000    | TBD   | TBD                 | -      |

## Running Locally

```bash
npm install @velvetmonkey/flywheel-bench
npx flywheel-bench generate --size 10k --output ./test-vault
npx flywheel-bench run --vault ./test-vault
```

See [SCALE_BENCHMARKS.md](./SCALE_BENCHMARKS.md) for methodology.
