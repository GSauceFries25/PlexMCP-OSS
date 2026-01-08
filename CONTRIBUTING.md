# Contributing to PlexMCP

Thank you for your interest in contributing to PlexMCP! We welcome contributions from the community and are excited to work with you.

This document provides guidelines for contributing to the project. Following these guidelines helps maintain code quality and makes the review process smoother for everyone.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Documentation](#documentation)
- [Community](#community)

---

## Development Setup

Get up and running quickly with these commands:

```bash
# Clone and enter the repository
git clone https://github.com/PlexMCP/plexmcp.git
cd plexmcp

# Copy environment template and generate secrets
cp .env.example .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
echo "API_KEY_HMAC_SECRET=$(openssl rand -hex 32)" >> .env

# Option 1: Docker (recommended for quick start)
docker compose --profile prebuilt up -d

# Option 2: Local development (requires Rust, PostgreSQL, Redis)
cargo install sqlx-cli --no-default-features --features postgres
sqlx database create
sqlx migrate run
cargo run

# Run tests
cargo test --workspace

# Run linter
cargo clippy --all-targets --all-features

# Format code
cargo fmt
```

The server will be available at `http://localhost:3000` (Docker) or `http://127.0.0.1:8080` (cargo run).

---

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to conduct@plexmcp.com.

---

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Rust** 1.75 or later ([Install](https://rustup.rs/))
- **PostgreSQL** 14+ ([Install](https://www.postgresql.org/download/))
- **Redis** 7+ ([Install](https://redis.io/download/)) *(optional, for caching)*
- **Git** for version control
- **A code editor** (we recommend VS Code with rust-analyzer)

### Fork and Clone

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/plexmcp.git
   cd plexmcp
   ```
3. **Add upstream remote:**
   ```bash
   git remote add upstream https://github.com/plexmcp/plexmcp.git
   ```

### Local Setup

1. **Copy environment variables:**
   ```bash
   cp .env.example .env
   ```

2. **Generate secrets:**
   ```bash
   echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
   echo "TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
   echo "API_KEY_HMAC_SECRET=$(openssl rand -hex 32)" >> .env
   ```

3. **Configure database:**
   ```bash
   # Update DATABASE_URL in .env
   echo "DATABASE_URL=postgresql://postgres:password@localhost:5432/plexmcp_dev" >> .env
   ```

4. **Run migrations:**
   ```bash
   cargo install sqlx-cli --no-default-features --features postgres
   sqlx database create
   sqlx migrate run
   ```

5. **Build and run:**
   ```bash
   cargo run
   ```

The server will start at `http://127.0.0.1:8080`.

---

## Development Workflow

### Creating a Feature Branch

1. **Sync with upstream:**
   ```bash
   git fetch upstream
   git checkout main
   git merge upstream/main
   ```

2. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

   Branch naming conventions:
   - `feature/` - New features
   - `fix/` - Bug fixes
   - `docs/` - Documentation changes
   - `refactor/` - Code refactoring
   - `test/` - Test improvements
   - `chore/` - Build/tooling changes

### Making Changes

1. **Make your changes** in your feature branch
2. **Write tests** for your changes
3. **Run tests** to ensure nothing breaks:
   ```bash
   cargo test --workspace
   ```
4. **Run linter:**
   ```bash
   cargo clippy --all-targets --all-features
   ```
5. **Format code:**
   ```bash
   cargo fmt
   ```

### Keeping Your Branch Updated

```bash
git fetch upstream
git rebase upstream/main
```

---

## Coding Standards

We maintain high code quality standards to ensure PlexMCP remains production-ready.

### Rust Style Guide

- **Follow Rust conventions** from the [Rust Style Guide](https://rust-lang.github.io/api-guidelines/)
- **Use `rustfmt`** for consistent formatting (runs automatically in CI)
- **Pass `clippy`** with zero warnings
- **Never use `unwrap()` or `expect()` in production code**
  - Use `?` operator for error propagation
  - Use `unwrap_or()`, `unwrap_or_else()`, or `unwrap_or_default()` when appropriate
  - Write proper error handling with descriptive error messages

### Error Handling

✅ **Good:**
```rust
pub async fn get_user(user_id: Uuid) -> Result<User, ApiError> {
    let user = sqlx::query_as!(
        User,
        "SELECT * FROM users WHERE id = $1",
        user_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or(ApiError::NotFound("User not found"))?;

    Ok(user)
}
```

❌ **Bad:**
```rust
pub async fn get_user(user_id: Uuid) -> User {
    sqlx::query_as!(
        User,
        "SELECT * FROM users WHERE id = $1",
        user_id
    )
    .fetch_one(&pool)
    .await
    .unwrap() // ❌ NEVER DO THIS
}
```

### Database Queries

- **Use prepared statements** (SQLx `query!` and `query_as!` macros)
- **Never use string interpolation** for SQL queries (prevents SQL injection)
- **Always specify column names** (avoid `SELECT *`)
- **Use transactions** for multi-step database operations
- **Add database migrations** for schema changes

✅ **Good:**
```rust
let user = sqlx::query_as!(
    User,
    "SELECT id, email, created_at FROM users WHERE email = $1",
    email
)
.fetch_optional(&pool)
.await?;
```

❌ **Bad:**
```rust
let query = format!("SELECT * FROM users WHERE email = '{}'", email); // ❌ SQL INJECTION
```

### Code Organization

- **Keep functions small** (< 50 lines when possible)
- **One responsibility per function**
- **Group related functionality** into modules
- **Use meaningful names** for variables, functions, and types
- **Add doc comments** for public APIs:
  ```rust
  /// Retrieves a user by their unique identifier.
  ///
  /// # Arguments
  /// * `user_id` - The UUID of the user to retrieve
  ///
  /// # Returns
  /// * `Ok(User)` - The user if found
  /// * `Err(ApiError::NotFound)` - If the user doesn't exist
  /// * `Err(ApiError::Database)` - If a database error occurs
  pub async fn get_user(user_id: Uuid) -> Result<User, ApiError> {
      // ...
  }
  ```

---

## Testing Requirements

All contributions must include appropriate tests.

### Test Coverage

- **Unit tests** for business logic
- **Integration tests** for API endpoints
- **Database tests** for data access layer
- **Maintain 80%+ coverage** on critical paths

### Running Tests

```bash
# Run all tests
cargo test --workspace

# Run specific test
cargo test test_user_registration

# Run with output
cargo test --workspace -- --nocapture

# Run integration tests (requires database)
cargo test --test integration
```

### Writing Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_validate_email() {
        let valid_email = "user@example.com";
        assert!(validate_email(valid_email).is_ok());

        let invalid_email = "not-an-email";
        assert!(validate_email(invalid_email).is_err());
    }

    #[sqlx::test]
    async fn test_create_user(pool: PgPool) {
        let user = create_user(&pool, "test@example.com", "password123").await.unwrap();
        assert_eq!(user.email, "test@example.com");
    }
}
```

### Database Tests

Use the `#[sqlx::test]` attribute for tests that require a database:

```rust
#[sqlx::test]
async fn test_user_creation(pool: PgPool) -> sqlx::Result<()> {
    let user = create_user(&pool, "test@example.com").await?;
    assert!(user.id.is_some());
    Ok(())
}
```

---

## Pull Request Process

### Before Submitting

1. **Ensure all tests pass:**
   ```bash
   cargo test --workspace
   ```

2. **Run clippy:**
   ```bash
   cargo clippy --all-targets --all-features -- -D warnings
   ```

3. **Format code:**
   ```bash
   cargo fmt --check
   ```

4. **Update documentation** if you changed public APIs

5. **Add migration scripts** if you changed the database schema

### Submitting Your PR

1. **Push to your fork:**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a Pull Request** on GitHub

3. **Fill out the PR template** with:
   - Description of changes
   - Issue number (if applicable)
   - Testing performed
   - Breaking changes (if any)
   - Screenshots (for UI changes)

### PR Title Format

Use conventional commit format:

- `feat: Add user profile API endpoint`
- `fix: Resolve SQL injection in admin queries`
- `docs: Update API documentation`
- `refactor: Extract billing logic into separate module`
- `test: Add integration tests for authentication`
- `chore: Update dependencies`

### Review Process

1. **Automated CI checks** must pass:
   - Tests
   - Clippy lints
   - Code formatting
   - Security scans

2. **Code review** by maintainers:
   - At least one approving review required
   - Address all review comments
   - Update PR based on feedback

3. **Merge:**
   - Maintainers will merge approved PRs
   - Squash and merge for clean history

---

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic changes)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Build process, tooling, dependencies

### Examples

```
feat(auth): Add TOTP 2FA support

Implement two-factor authentication using TOTP (RFC 6238).
Users can now enable 2FA in their account settings.

Closes #123
```

```
fix(billing): Prevent duplicate Stripe charges

Add idempotency key to Stripe charge requests to prevent
duplicate charges when requests are retried.

Fixes #456
```

```
docs(api): Update authentication examples

Add curl examples for all authentication endpoints
including API key creation and JWT refresh.
```

### Breaking Changes

If your commit introduces breaking changes, add `BREAKING CHANGE:` in the footer:

```
feat(api): Change user registration endpoint

Renamed /api/auth/signup to /api/auth/register for consistency.

BREAKING CHANGE: The /api/auth/signup endpoint has been removed.
Clients must now use /api/auth/register instead.
```

---

## Documentation

Good documentation is crucial for PlexMCP's success.

### What to Document

- **Public APIs** - Doc comments for all public functions and types
- **Configuration** - Environment variables and settings
- **Architecture** - High-level design decisions
- **Deployment** - Installation and deployment guides
- **Examples** - Code examples and tutorials

### Documentation Location

- **Inline docs:** Use `///` for public APIs
- **Architecture:** `docs/architecture/`
- **API docs:** `docs/api/`
- **Guides:** `docs/guides/`
- **README:** High-level overview

### Writing Style

- **Be concise** but complete
- **Use examples** to illustrate complex concepts
- **Keep it up-to-date** when code changes
- **Test code examples** to ensure they work

---

## Community

### Getting Help

- **Discord:** [Join our community](https://discord.gg/HAYYTGnht8)
- **GitHub Discussions:** [Ask questions](https://github.com/plexmcp/plexmcp/discussions)
- **GitHub Issues:** [Report bugs](https://github.com/plexmcp/plexmcp/issues)

### Communication Channels

- **General questions:** GitHub Discussions
- **Bug reports:** GitHub Issues
- **Feature requests:** GitHub Issues
- **Real-time chat:** Discord
- **Security issues:** security@plexmcp.com (private)

### Suggesting Features

1. **Check existing issues** to avoid duplicates
2. **Open a GitHub issue** with:
   - Clear description of the feature
   - Use cases and benefits
   - Proposed implementation (if you have ideas)
3. **Discuss with maintainers** before investing significant time

### Reporting Bugs

1. **Search existing issues** first
2. **Create a new issue** with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Environment details (OS, Rust version, etc.)
   - Relevant logs or screenshots

---

## Recognition

We value all contributions! Contributors are recognized in:

- **GitHub contributors page**
- **CHANGELOG** for significant contributions
- **Annual contributor highlights** in our blog

Thank you for making PlexMCP better!

---

## License

By contributing to PlexMCP, you agree that your contributions will be licensed under the [FSL-1.1-Apache-2.0](./LICENSE) license.

---

## Questions?

If you have questions about contributing, please:
- Join our [Discord](https://discord.gg/HAYYTGnht8)
- Open a [GitHub Discussion](https://github.com/plexmcp/plexmcp/discussions)
- Email us at hello@plexmcp.com

Thank you for contributing to PlexMCP!
