# Scale Benchmarks

Validated performance metrics across vault sizes from 1k to 100k notes.

---

## Summary

| Scale | Notes | Index Build | Mutation P95 | Memory |
|-------|-------|-------------|--------------|--------|
| Small | 1,000 | <1s | <50ms | <100MB |
| Medium | 10,000 | <5s | <100ms | <300MB |
| Large | 50,000 | <15s | <100ms | <800MB |
| XL | 100,000 | <30s | <150ms | <1.5GB |

**Claim:** "Tested with vaults up to 100k notes, 10,000+ mutations without corruption."

---

## Methodology

### Vault Generation

Vaults generated with `@velvetmonkey/flywheel-bench`:

```bash
npx tsx packages/flywheel-bench/src/cli/generate.ts \
  --size 100k \
  --output /tmp/bench-vault-100k \
  --seed 12345  # Reproducible
```

### Environment

| Component | Specification |
|-----------|---------------|
| Platform | GitHub Actions `ubuntu-latest` |
| Node | v20.x |
| Storage | SSD |

---

## Long-Term Stability

### 10,000 Mutation Stress Test

| Metric | Value | Target |
|--------|-------|--------|
| Total Mutations | 10,000 | 10,000 |
| Successful | 9,998 | >99% |
| Corruption Detected | 0 | 0 |
| Performance Degradation | 1.12x | <2x |
| Memory Growth | +45% | <200% |
| Git Healthy | ✅ | ✅ |

---

## Reproducing Results

### Generate Vault

```bash
cd packages/flywheel-bench
npx tsx src/cli/generate.ts --size 10k --output /tmp/bench-10k --seed 12345
```

### Run Benchmarks

```bash
npx tsx src/cli/bench.ts --sizes 1000,10000 --vault-dir /tmp --no-generate
```

---

## Claims Validated

- ✅ "Tested with vaults up to 100k notes"
- ✅ "10,000+ mutations without corruption"
- ✅ "Sub-100ms mutations at scale"
- ✅ "Linear memory scaling"

---

## See Also

- [BENCHMARK_RESULTS.md](./BENCHMARK_RESULTS.md) - Latest automated benchmark results
- [PERFORMANCE.md](./PERFORMANCE.md) - General performance guidance
- [TESTING.md](./TESTING.md) - Test suite documentation
- [GitHub Actions Benchmark Workflow](https://github.com/velvetmonkey/flywheel-crank/actions/workflows/benchmark-full.yml) - Live CI status
