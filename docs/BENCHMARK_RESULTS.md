# Benchmark Results

> **Last Updated:** Feb 6, 2026 (v1.27.49)

## Mutation Performance

| Operation | File Size | Time | Threshold |
|-----------|-----------|------|-----------|
| Single mutation | 1,000 lines | 10ms | <100ms |
| Single mutation | 10,000 lines | 22ms | <500ms |
| Single mutation | 100,000 lines | 159ms | <2,000ms |
| 100 consecutive | 100 lines each | 1.7ms avg | <5ms |

**No degradation detected:** First 10 mutations avg 1.68ms, last 10 avg 1.85ms.

---

## Entity Index Performance

| Operation | Scale | Time | Threshold |
|-----------|-------|------|-----------|
| Score entities | 1,000 entities | 12ms | <50ms |
| Score entities | 5,000 entities | 17ms | <200ms |
| Suggest links | 1,200 chars | 0.4ms | <10ms |
| Heading extraction | 950 lines (50 headings) | 0.2ms | <10ms |

---

## Scale Testing

| Vault Size | Index Build | Mutation P95 | Memory | Status |
|------------|-------------|--------------|--------|--------|
| 1,000 notes | <1s | <50ms | <100MB | ✅ |
| 10,000 notes | <5s | <100ms | <300MB | ✅ |
| 50,000 notes | <15s | <100ms | <800MB | ✅ |
| 100,000 notes | <30s | <150ms | <1.5GB | ✅ |

---

## Long-Term Stability (10,000 Mutations)

| Metric | Result | Target |
|--------|--------|--------|
| Total Mutations | 10,000 | 10,000 |
| Success Rate | 99.98% | >99% |
| Corruption Detected | 0 | 0 |
| Performance Degradation | 1.12x | <2x |
| Memory Growth | +45% | <200% |
| Git Repository | Healthy | Healthy |

---

## Environment

| Component | Specification |
|-----------|---------------|
| Platform | Linux (WSL2) / GitHub Actions |
| Node.js | v20.x |
| Storage | SSD |

---

## Running Locally

```bash
# Run performance tests
cd packages/mcp-server
npm test -- test/performance/benchmarks.test.ts

# Generate test vault and run scale benchmarks
npm install @velvetmonkey/flywheel-bench
npx flywheel-bench generate --size 10k --output ./test-vault
npx flywheel-bench run --vault ./test-vault
```

---

## See Also

- [SCALE_BENCHMARKS.md](./SCALE_BENCHMARKS.md) - Methodology and reproduction steps
- [PERFORMANCE.md](./PERFORMANCE.md) - Optimization guidance
- [TOKEN_SAVINGS.md](./TOKEN_SAVINGS.md) - Token efficiency measurements
