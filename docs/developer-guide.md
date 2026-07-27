# Developer Onboarding Guide — Stellar RWA Tokenization Suite

> Last updated: 2026-07-27  
> Target audience: New contributors and developers joining the project

---

## 1. Welcome! 👋

Welcome to the Stellar Real-World Asset (RWA) Tokenization Suite! This guide will walk you through setting up your local development environment, understanding the project architecture, and making your first contribution.

---

## 2. Prerequisites Checklist

Before you begin, ensure you have the following installed:

| Tool | Minimum Version | How to Verify | Install Link |
|------|----------------|---------------|--------------|
| **Rust** | 1.70+ | `rustc --version` | [rustup.rs](https://rustup.rs) |
| **Node.js** | 18+ | `node --version` | [nodejs.org](https://nodejs.org) |
| **npm** | 9+ | `npm --version` | (comes with Node.js) |
| **Git** | 2.30+ | `git --version` | [git-scm.com](https://git-scm.com) |
| **Soroban CLI** | 22.0.0+ | `soroban --version` | `cargo install soroban-cli` |
| **wasm32 target** | — | `rustup target list \| grep wasm32` | `rustup target add wasm32-unknown-unknown` |

### Optional but Recommended

| Tool | Purpose | Install |
|------|---------|---------|
| **cargo-tarpaulin** | Code coverage | `cargo install cargo-tarpaulin` |
| **cargo-audit** | Security audit deps | `cargo install cargo-audit` |
| **jq** | JSON processing (deploy scripts) | `apt-get install jq` / `brew install jq` |
| **Docker** | Isolated builds | [docker.com](https://docker.com) |

---

## 3. Local Development Setup

### 3.1 Clone & Install

```bash
# Clone the repository
git clone https://github.com/Kevin737866/stellar-asset-tokenization-suite.git
cd stellar-asset-tokenization-suite

# Install Rust dependencies (automatically fetches crates)
cargo build

# Install Node.js dependencies (SDK + UI)
npm install

# Add wasm32 target for contract compilation
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install soroban-cli
```

### 3.2 Verify Your Setup

Run these commands to confirm everything is working:

```bash
# Build contracts
cargo build --target wasm32-unknown-unknown

# Run contract tests
cargo test

# Build SDK
npm run build

# Run SDK tests
npm test
```

If all pass, you're ready to develop! 🎉

### 3.3 Configure Your IDE

**VS Code (recommended):**
- Install extensions: `rust-analyzer`, `Even Better TOML`, `ESLint`, `Prettier`
- Add to `.vscode/settings.json`:
  ```json
  {
    "rust-analyzer.cargo.target": "wasm32-unknown-unknown",
    "rust-analyzer.checkOnSave.command": "clippy",
    "editor.formatOnSave": true
  }
  ```

---

## 4. Architecture Overview

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     User Interfaces                       │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  React UI    │  │   CLI Tool   │  │  Third-party  │  │
│  │  (ui/)       │  │  (sdk/cli.ts)│  │  Integrations │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
└─────────┼──────────────────┼───────────────────┼─────────┘
          │                  │                   │
┌─────────┴──────────────────┴───────────────────┴─────────┐
│               TypeScript SDK (sdk/)                        │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌────────────┐  │
│  │Asset     │ │Token     │ │Dividend   │ │Market      │  │
│  │Factory   │ │Client    │ │Client     │ │Client      │  │
│  └──────────┘ └──────────┘ └───────────┘ └────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐                 │
│  │Compliance│ │Custody   │ │Validation │                 │
│  │Client    │ │Client    │ │/Types     │                 │
│  └──────────┘ └──────────┘ └───────────┘                 │
└──────────────────────────┬───────────────────────────────┘
                           │ (Stellar SDK / Horizon API)
┌──────────────────────────┴───────────────────────────────┐
│            Soroban Smart Contracts (src/)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────────┐  │
│  │Asset     │ │RWA Token │ │Compliance Registry       │  │
│  │Factory   │ │          │ │(KYC/AML/Blacklist)       │  │
│  └──────────┘ └──────────┘ └──────────────────────────┘  │
│  ┌───────────────┐ ┌──────────────────┐ ┌─────────────┐  │
│  │Dividend       │ │Secondary Market  │ │Custody      │  │
│  │Distributor    │ │(Order Book)      │ │Validator    │  │
│  └───────────────┘ └──────────────────┘ └─────────────┘  │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Shared: auth.rs | admin.rs | governance.rs          │ │
│  │  Asset Classes: real_estate | commodity | invoice |  │ │
│  │                 security | art | carbon_credit       │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Module Map

| Module | Path | Purpose |
|--------|------|---------|
| **Asset Factory** | `src/asset_factory.rs` | Deploy new RWA tokens with metadata |
| **RWA Token** | `src/rwa_token.rs` | Core ERC-like token with compliance hooks |
| **Compliance Registry** | `src/compliance_registry.rs` | KYC, AML, whitelist, transfer restrictions |
| **Dividend Distributor** | `src/dividend_distributor.rs` | Multi-currency yield distribution |
| **Secondary Market** | `src/secondary_market.rs` | Order book with price discovery |
| **Custody Validator** | `src/custody_validator.rs` | Off-chain asset verification |
| **Auth** | `src/auth.rs` | Authorization primitives |
| **Shared Admin** | `src/shared_admin.rs` | Centralized admin utilities |
| **Shared Governance** | `src/shared_governance.rs` | Multi-sig governance module |
| **Asset Class Handlers** | `src/asset_class_handlers.rs` | Asset type dispatch |
| **Real Estate** | `src/real_estate.rs` | Property-specific logic |
| **Commodity** | `src/commodity.rs` | Commodity-backed tokens |
| **Invoice** | `src/invoice.rs` | Invoice factoring |
| **Security** | `src/security.rs` | Security token regulations |
| **Art** | `src/art.rs` | Art/collectible tokenization |
| **Carbon Credit** | `src/carbon_credit.rs` | Carbon credit tokens |

### 4.3 Data Flow

```
1. Asset Issuer → AssetFactory.deploy() → RwaToken (deployed)
2. RwaToken.transfer() → ComplianceRegistry.check() → approve/block
3. DividendDistributor.create() → RwaToken.balanceOf() → proportional claims
4. Investor → SecondaryMarket.placeOrder() → order book matching
5. Custodian → CustodyValidator.submitProof() → verify → attestation stored
```

---

## 5. Development Workflow

### 5.1 Branching Strategy

```
main                    ← Production-ready code
  ├── feat/xxx          ← New features
  ├── fix/xxx           ← Bug fixes
  ├── chore/xxx         ← Maintenance tasks
  ├── docs/xxx          ← Documentation
  └── test/xxx          ← Test additions
```

### 5.2 Making Changes

```bash
# 1. Sync with upstream
git checkout main
git pull origin main

# 2. Create feature branch
git checkout -b feat/my-feature-name

# 3. Make your changes
# (edit files, add tests, etc.)

# 4. Format & lint
cargo fmt
cargo clippy
npm run lint

# 5. Run tests
cargo test
npm test

# 6. Commit with conventional commits
git add .
git commit -m "feat(contracts): add new feature description"

# 7. Push
git push origin feat/my-feature-name
```

### 5.3 Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

| Type | When to Use |
|------|------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `chore` | Maintenance, deps, build |
| `test` | Adding/updating tests |
| `refactor` | Code restructuring |
| `style` | Formatting, semicolons |

Examples:
```
feat(contracts): add multi-sig governance with timelock
fix(sdk): resolve BigInt serialization for JSON responses
docs(api): add CustodyValidator function reference
test(fuzz): add property tests for commodity config
```

---

## 6. Testing Guidelines

### 6.1 Running Tests

```bash
# Run all Rust tests
cargo test

# Run a specific test module
cargo test test_rwa_token

# Run with output
cargo test -- --nocapture

# Run integration tests only
cargo test --test integration_tests

# Run fuzz tests (proptest)
cargo test fuzz

# Run SDK tests
npm test

# Run SDK tests with coverage
npm test -- --coverage
```

### 6.2 Writing Tests

**Rust contracts:** See `src/tests/` for examples. Use the Soroban test framework:
```rust
#[test]
fn test_transfer() {
    let env = Env::default();
    let contract_id = env.register_contract(None, RwaToken {});
    let client = RwaTokenClient::new(&env, &contract_id);
    // ... test logic
}
```

**TypeScript SDK:** Use Jest with mocks:
```typescript
describe('TokenClient', () => {
  it('should transfer tokens between accounts', async () => {
    // ... test logic
  });
});
```

---

## 7. Your First Contribution

Follow this step-by-step guide to make your first contribution:

### Step 1: Pick an Issue
1. Browse [open issues](https://github.com/Kevin737866/stellar-asset-tokenization-suite/issues)
2. Look for `good first issue` or `help wanted` labels
3. Comment on the issue to say you're working on it:"I'd like to work on this!"

### Step 2: Set Up Locally
```bash
git clone https://github.com/Kevin737866/stellar-asset-tokenization-suite.git
cd stellar-asset-tokenization-suite
cargo build && npm install
```

### Step 3: Create a Branch
```bash
git checkout -b fix/issue-XXX-description
```

### Step 4: Implement
- Read the relevant source files
- Make your changes
- Add tests for your changes
- Run `cargo fmt && cargo clippy`

### Step 5: Test
```bash
cargo test && npm test
```

### Step 6: Commit & Push
```bash
git add .
git commit -m "fix(scope): describe your change (closes #XXX)"
git push origin fix/issue-XXX-description
```

### Step 7: Open a Pull Request
1. Go to the [Pull Requests](https://github.com/Kevin737866/stellar-asset-tokenization-suite/pulls) page
2. Click "New Pull Request"
3. Select your branch
4. Fill out the PR template
5. Submit!

### Step 8: Code Review
- A maintainer will review your PR
- Address any feedback
- Once approved, your PR will be merged! 🎉

---

## 8. Common Troubleshooting

### 8.1 Build Issues

**Problem:** `cargo build` fails with `error: linker 'cc' not found`
```bash
# Ubuntu/Debian
sudo apt-get install build-essential
# macOS
xcode-select --install
```

**Problem:** `wasm32-unknown-unknown` target not found
```bash
rustup target add wasm32-unknown-unknown
```

**Problem:** Soroban SDK version mismatch
```bash
# Check your version
cargo search soroban-sdk | grep "^soroban-sdk"
# Update Cargo.toml to match installed version
```

### 8.2 Test Failures

**Problem:** Tests pass locally but fail in CI
- Ensure you're on the correct Rust version: `rustup show`
- Run `cargo clean && cargo test` fresh
- Check for environment variables that CI sets

**Problem:** Fuzz tests are flaky
- Fuzz tests use random inputs — occasional failures are expected
- Re-run: `cargo test fuzz -- --nocapture`

### 8.3 SDK Issues

**Problem:** `npm install` fails with node-gyp errors
```bash
# Ubuntu/Debian
sudo apt-get install python3 make g++
# macOS
xcode-select --install
```

**Problem:** TypeScript compilation errors in SDK
```bash
npm run clean && npm run build
```

### 8.4 Soroban CLI Issues

**Problem:** `soroban` command not found
```bash
# Ensure ~/.cargo/bin is in PATH
export PATH="$HOME/.cargo/bin:$PATH"
# Add to ~/.bashrc or ~/.zshrc for persistence
```

**Problem:** "network not found" errors
```bash
# Configure Soroban networks
soroban network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

### 8.5 General Tips

- **Clear caches:** `cargo clean && rm -rf node_modules && npm install`
- **Update tools:** `rustup update && cargo install soroban-cli`
- **Check logs:** Use `-- --nocapture` with `cargo test` for debug output
- **Ask for help:** [Open a discussion](https://github.com/Kevin737866/stellar-asset-tokenization-suite/discussions) or ask on Discord

---

## 9. Project Conventions

| Area | Convention |
|------|-----------|
| **Rust formatting** | `cargo fmt` (rustfmt defaults) |
| **Rust linting** | `cargo clippy` (default lints) |
| **TypeScript formatting** | Prettier (2-space indent) |
| **TypeScript linting** | ESLint (recommended config) |
| **Imports ordering** | std → external → crate → super → self |
| **Error handling** | Typed contract errors (no panics) |
| **Naming** | snake_case for Rust, camelCase for TS/JS |
| **Comments** | `///` for public Rust docs, `/** */` for TS |
| **PR title** | Conventional Commits format |

---

## 10. Additional Resources

| Resource | Link |
|----------|------|
| **API Reference** | [docs/api/](./api/README.md) |
| **Security Docs** | [docs/security/](./security/) |
| **Stellar Docs** | [developers.stellar.org](https://developers.stellar.org) |
| **Soroban Docs** | [soroban.stellar.org](https://soroban.stellar.org) |
| **Rust Book** | [doc.rust-lang.org/book](https://doc.rust-lang.org/book/) |
| **Contributing Guide** | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| **Security Policy** | [Incident Response Plan](./security/incident-response.md) |

---

## 11. Getting Help

- **Discord:** [Stellar RWA Community](https://discord.gg/stellar-rwa)
- **GitHub Discussions:** [Q&A](https://github.com/Kevin737866/stellar-asset-tokenization-suite/discussions)
- **Issues:** [Bug reports & feature requests](https://github.com/Kevin737866/stellar-asset-tokenization-suite/issues)

We're excited to have you on board! Happy coding! 🚀
