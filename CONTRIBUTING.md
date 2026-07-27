# Contributing to Stellar RWA Tokenization Suite

We welcome contributions to the Stellar Real-World Asset Tokenization Suite! This document provides guidelines and information for contributors.

## 🚀 Getting Started

> **New contributor?** See the [Developer Onboarding Guide](docs/developer-guide.md) for a comprehensive step-by-step walkthrough including: prerequisites, local setup, architecture overview, first contribution workflow, and troubleshooting.

### Prerequisites

- Rust 1.70+ (for Soroban contracts)
- Node.js 18+ (for SDK and UI)
- Git
- Basic knowledge of Stellar blockchain
- Familiarity with React/TypeScript (for UI contributions)

### Development Setup

1. **Fork the Repository**
   ```bash
   git clone https://github.com/your-username/stellar-asset-tokenization-suite.git
   cd stellar-asset-tokenization-suite
   ```

2. **Install Dependencies**
   ```bash
   # Install Rust dependencies
   cargo build

   # Install Node.js dependencies
   npm install

   # Install Soroban CLI
   cargo install soroban-cli
   ```

3. **Run Tests**
   ```bash
   # Run contract tests
   cargo test

   # Run SDK tests
   npm test

   # Run UI tests
   npm run test:ui
   ```

> For detailed troubleshooting, deployment scripts, and architecture diagrams, see [docs/developer-guide.md](docs/developer-guide.md).

## 📁 Project Structure

```
stellar-asset-tokenization-suite/
├── src/                          # Soroban contracts (Rust)
│   ├── lib.rs                    # Main contract exports
│   ├── asset_factory.rs          # Asset deployment factory
│   ├── rwa_token.rs              # Core RWA token implementation
│   ├── compliance_registry.rs    # KYC/AML compliance
│   ├── dividend_distributor.rs   # Dividend distribution
│   ├── secondary_market.rs       # P2P trading
│   └── custody_validator.rs      # Off-chain verification
├── sdk/                          # TypeScript SDK
│   ├── src/
│   │   ├── index.ts              # Main SDK exports
│   │   ├── assetFactory.ts       # Asset factory client
│   │   ├── tokenClient.ts        # Token management
│   │   ├── dividendClient.ts     # Dividend operations
│   │   ├── marketClient.ts       # Secondary market
│   │   ├── complianceClient.ts   # Compliance management
│   │   ├── types.ts              # Type definitions
│   │   └── errors.ts             # Error handling
│   ├── package.json
│   └── tsconfig.json
├── ui/                           # React UI components
│   ├── src/
│   │   ├── components/
│   │   │   ├── AssetDeployer.tsx
│   │   │   ├── OwnershipDashboard.tsx
│   │   │   ├── SecondaryMarket.tsx
│   │   │   ├── DividendPanel.tsx
│   │   │   ├── ComplianceStatus.tsx
│   │   │   └── CustodyProof.tsx
│   │   ├── hooks/
│   │   │   └── useRWAToken.ts
│   │   └── lib/
│   │       └── types.ts
│   ├── package.json
│   └── next.config.js
├── examples/                     # Example implementations
│   ├── real-estate-tokenization.ts
│   ├── commodity-vault.ts
│   ├── invoice-factoring.ts
│   ├── security-token.ts
│   └── cross-border-property.ts
├── docs/                         # Documentation
├── tests/                        # Integration tests
├── Cargo.toml
├── package.json
└── README.md
```

## 🛠️ Development Guidelines

### Code Style

#### Rust (Smart Contracts)
- Use `cargo fmt` for formatting
- Use `cargo clippy` for linting
- Follow Rust naming conventions
- Add comprehensive documentation comments
- Include unit tests for all public functions

```rust
/// Bundled args for factory deployment (Soroban limits exported functions to 10 parameters).
#[contracttype]
pub struct RwaDeploySpec {
    pub token_contract: Address,
    pub asset_name: Symbol,
    // ... remaining fields: asset_symbol, total_supply, decimals, asset_type,
    // metadata, compliance_registry, dividend_distributor
}

/// Link and initialize an already-deployed RWA token WASM via the factory.
pub fn deploy_rwa_token(env: Env, auth: Address, spec: RwaDeploySpec) -> Address {
    // Implementation
}
```

#### TypeScript (SDK)
- Use ESLint and Prettier
- Follow TypeScript best practices
- Use JSDoc comments for all public APIs
- Include type definitions for all interfaces

```typescript
/**
 * Deploys a new RWA token contract
 * 
 * @param deployer - The address deploying the token
 * @param options - Token deployment options
 * @returns Promise resolving to deployment result
 */
async deployRWAToken(
  deployer: Address,
  options: DeploymentOptions
): Promise<DeploymentResult> {
  // Implementation
}
```

#### React (UI)
- Use functional components with hooks
- Follow React naming conventions
- Include TypeScript prop types
- Use Tailwind CSS for styling

```tsx
interface AssetDeployerProps {
  onDeploy: (options: DeploymentOptions) => Promise<void>;
  isLoading?: boolean;
}

export default function AssetDeployer({ 
  onDeploy, 
  isLoading = false 
}: AssetDeployerProps) {
  // Component implementation
}
```

### Testing

#### Smart Contract Tests
- Write unit tests for all contract functions
- Test edge cases and error conditions
- Use Soroban test framework
- Achieve >90% code coverage

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_deploy_rwa_token() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RwaToken {});
        let client = RwaTokenClient::new(&env, &contract_id);
        
        // Test implementation
    }
}
```

#### SDK Tests
- Unit tests for all client methods
- Integration tests with test contracts
- Mock external dependencies
- Test error handling

```typescript
describe('AssetFactory', () => {
  let sdk: StellarRWASDK;
  let mockServer: jest.Mocked<Server>;

  beforeEach(() => {
    // Setup test environment
  });

  it('should deploy RWA token successfully', async () => {
    // Test implementation
  });
});
```

#### UI Tests
- Component testing with React Testing Library
- Integration tests with mock SDK
- Accessibility testing
- Visual regression testing

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import AssetDeployer from './AssetDeployer';

describe('AssetDeployer', () => {
  it('should render asset deployment form', () => {
    render(<AssetDeployer onDeploy={jest.fn()} />);
    expect(screen.getByText('Deploy New RWA Token')).toBeInTheDocument();
  });
});
```

## 🔄 Pull Request Process

### Before Submitting

1. **Create a Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Your Changes**
   - Follow the code style guidelines
   - Add tests for new functionality
   - Update documentation

3. **Run Tests**
   ```bash
   cargo test
   npm test
   npm run lint
   ```

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

5. **Push Branch**
   ```bash
   git push origin feature/your-feature-name
   ```

### Pull Request Requirements

- **Title**: Clear and descriptive title
- **Description**: Detailed explanation of changes
- **Tests**: All tests must pass
- **Documentation**: Updated if necessary
- **Breaking Changes**: Clearly marked if applicable

### Pull Request Template

```markdown
## Description
Brief description of the changes made.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests added/updated
```

## 🐛 Bug Reports

### Bug Report Template

```markdown
**Bug Description**
Clear and concise description of the bug.

**Steps to Reproduce**
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected Behavior**
What you expected to happen.

**Actual Behavior**
What actually happened.

**Environment**
- OS: [e.g. macOS, Windows, Linux]
- Node.js version: [e.g. 18.0.0]
- Rust version: [e.g. 1.70.0]

**Additional Context**
Add any other context about the problem here.
```

## 💡 Feature Requests

### Feature Request Template

```markdown
**Feature Description**
Clear and concise description of the feature.

**Problem Statement**
What problem does this feature solve?

**Proposed Solution**
How you envision this feature working.

**Alternatives Considered**
Other approaches you considered.

**Additional Context**
Any other context or screenshots about the feature request.
```

## 🔒 Security

### Security Vulnerability Reporting

If you discover a security vulnerability, please report it privately:

- **Email**: security@stellar-rwa.com
- **PGP Key**: Available on request

Please do not open public issues for security vulnerabilities.

### Security Guidelines

- Follow secure coding practices
- Use established cryptographic libraries
- Validate all inputs
- Implement proper access controls
- Regular security audits

## 📚 Documentation

### Documentation Guidelines

- Use clear, concise language
- Include code examples
- Add diagrams where helpful
- Keep documentation up-to-date
- Use consistent formatting

### Documentation Types

- **API Documentation**: Auto-generated from code comments
- **User Guides**: Step-by-step tutorials
- **Developer Docs**: Architecture and implementation details
- **Examples**: Real-world use cases

## 🏆 Recognition

### Contributor Recognition

- **Contributors**: Listed in README.md
- **Top Contributors**: Special recognition in releases
- **Security Researchers**: Hall of fame for bug reports
- **Community Leaders**: Moderator roles and special access

### Contribution Metrics

- **Code Contributions**: Lines of code, commits, PRs
- **Documentation**: Pages written, examples created
- **Community**: Issues answered, discussions participated
- **Security**: Vulnerabilities reported, security improvements

## 🤝 Community

### Ways to Contribute

- **Code**: Smart contracts, SDK, UI components
- **Documentation**: Guides, tutorials, API docs
- **Testing**: Bug reports, test cases, security audits
- **Community**: Support, discussions, feedback
- **Translation**: Localization and internationalization

### Communication Channels

- **Discord**: [Stellar RWA Community](https://discord.gg/stellar-rwa)
- **GitHub Discussions**: [Q&A and discussions](https://github.com/stellar-rwa-suite/discussions)
- **Twitter**: [@StellarRWA](https://twitter.com/stellarrwa)
- **Email**: contributors@stellar-rwa.com

## 📋 Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors, regardless of:

- Experience level
- Gender identity and expression
- Sexual orientation
- Disability
- Personal appearance
- Body size
- Race
- Ethnicity
- Age
- Religion
- Nationality

### Expected Behavior

- Use welcoming and inclusive language
- Respect different viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

### Unacceptable Behavior

- Harassment, trolling, or discriminatory language
- Personal attacks or political discussions
- Publishing private information
- Any other unprofessional conduct

### Reporting Issues

If you experience or witness unacceptable behavior, please contact:

- **Email**: conduct@stellar-rwa.com
- **Discord**: Private message to moderators

## 📄 License

By contributing to this project, you agree that your contributions will be licensed under the same license as the project (MIT License).

---

Thank you for contributing to the Stellar RWA Tokenization Suite! 🚀
