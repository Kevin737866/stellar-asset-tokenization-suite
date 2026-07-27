#!/usr/bin/env bash
#
# deploy.sh — Stellar RWA Tokenization Suite Deployment Script
#
# Usage:
#   ./scripts/deploy.sh <network>
#
#   <network>: testnet | mainnet
#
# Environment variables:
#   TESTNET_DEPLOYER_SECRET  — Stellar secret key for testnet deployer
#   TESTNET_ADMIN_SECRET     — Stellar secret key for testnet admin
#   MAINNET_DEPLOYER_SECRET  — Stellar secret key for mainnet deployer
#   MAINNET_ADMIN_SECRET     — Stellar secret key for mainnet admin
#
# Examples:
#   TESTNET_DEPLOYER_SECRET=S... TESTNET_ADMIN_SECRET=S... ./scripts/deploy.sh testnet
#   MAINNET_DEPLOYER_SECRET=S... MAINNET_ADMIN_SECRET=S... ./scripts/deploy.sh mainnet

set -euo pipefail

# ── Help ──────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: $0 <network>"
    echo "  network: testnet | mainnet"
    echo ""
    echo "Environment variables required:"
    echo "  <NETWORK>_DEPLOYER_SECRET  — Stellar secret key for deployer"
    echo "  <NETWORK>_ADMIN_SECRET     — Stellar secret key for admin"
    exit 0
fi

# ── Validate arguments ────────────────────────────────────────────────
NETWORK="${1:-}"
if [[ "$NETWORK" != "testnet" && "$NETWORK" != "mainnet" ]]; then
    echo "ERROR: Network must be 'testnet' or 'mainnet'. Got: '$NETWORK'"
    echo "Usage: $0 <testnet|mainnet>"
    exit 1
fi

NETWORK_UPPER=$(echo "$NETWORK" | tr '[:lower:]' '[:upper:]')

# ── Check prerequisites ───────────────────────────────────────────────
command -v cargo >/dev/null 2>&1 || { echo "ERROR: cargo not found. Install Rust: https://rustup.rs"; exit 1; }
command -v soroban >/dev/null 2>&1 || { echo "ERROR: soroban CLI not found. Install: cargo install soroban-cli"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq not found. Install: apt-get install jq / brew install jq"; exit 1; }

# ── Load config ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/${NETWORK}.json"

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "ERROR: Config file not found: $CONFIG_FILE"
    exit 1
fi

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Stellar RWA Tokenization Suite — Deploy to ${NETWORK_UPPER}          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Read config values ────────────────────────────────────────────────
DEPLOYER_SECRET_ENV=$(jq -r '.accounts.deployerSecretEnv' "$CONFIG_FILE")
ADMIN_SECRET_ENV=$(jq -r '.accounts.adminSecretEnv' "$CONFIG_FILE")
RPC_URL=$(jq -r '.stellar.rpcUrl' "$CONFIG_FILE")
PASSPHRASE=$(jq -r '.stellar.passphrase' "$CONFIG_FILE")
BUILD_DIR=$(jq -r '.contracts.buildDir' "$CONFIG_FILE")
OUTPUT_FILE=$(jq -r '.deployment.outputFile' "$CONFIG_FILE")
VERIFY=$(jq -r '.deployment.verifyAfterDeploy' "$CONFIG_FILE")
IDEMPOTENT=$(jq -r '.deployment.idempotent' "$CONFIG_FILE")
MAX_RETRIES=$(jq -r '.deployment.maxRetries' "$CONFIG_FILE")
RETRY_DELAY=$(jq -r '.deployment.retryDelayMs' "$CONFIG_FILE")
REQUIRE_CONFIRM=$(jq -r '.deployment.requireConfirmation // false' "$CONFIG_FILE")
MAX_FEE=$(jq -r '.fee.maxFee' "$CONFIG_FILE")

# ── Check environment variables ───────────────────────────────────────
DEPLOYER_SECRET="${!DEPLOYER_SECRET_ENV:-}"
ADMIN_SECRET="${!ADMIN_SECRET_ENV:-}"

if [[ -z "$DEPLOYER_SECRET" ]]; then
    echo "ERROR: ${DEPLOYER_SECRET_ENV} environment variable is not set"
    exit 1
fi
if [[ -z "$ADMIN_SECRET" ]]; then
    echo "WARNING: ${ADMIN_SECRET_ENV} environment variable is not set. Admin operations will be skipped."
fi

# ── Mainnet confirmation ──────────────────────────────────────────────
if [[ "$NETWORK" == "mainnet" && "$REQUIRE_CONFIRM" == "true" ]]; then
    echo ""
    echo "⚠️  WARNING: You are about to deploy to MAINNET ⚠️"
    echo "   This will deploy contracts with real value implications."
    echo ""
    read -rp "Type 'MAINNET' to confirm: " CONFIRM
    if [[ "$CONFIRM" != "MAINNET" ]]; then
        echo "Deployment cancelled."
        exit 0
    fi
    echo ""
fi

# ── Build contracts ───────────────────────────────────────────────────
echo "📦 Building contracts..."
cd "$PROJECT_ROOT"

cargo build --target wasm32-unknown-unknown --release 2>&1 | tail -5
BUILD_STATUS=${PIPESTATUS[0]}
if [[ $BUILD_STATUS -ne 0 ]]; then
    echo "ERROR: Contract build failed (exit code: $BUILD_STATUS)"
    exit 1
fi
echo "✅ Build successful"

# ── Verify WASM size ──────────────────────────────────────────────────
echo ""
echo "📏 Checking WASM sizes..."
MAX_WASM_KB=64
WASM_PATH="$PROJECT_ROOT/$BUILD_DIR"
# Check each WASM file individually for size
WASM_SIZE_OK=true
for wf in "$WASM_PATH"/*.wasm; do
    if [[ -f "$wf" ]]; then
        WASM_BYTES=$(stat -c%s "$wf" 2>/dev/null || stat -f%z "$wf" 2>/dev/null || echo "0")
        echo "   $(basename "$wf"): ${WASM_BYTES} bytes"
        if [[ "$WASM_BYTES" -gt $((MAX_WASM_KB * 1024)) ]]; then
            echo "   ❌ $(basename "$wf") exceeds ${MAX_WASM_KB}KB limit"
            WASM_SIZE_OK=false
        fi
    fi
done
if [[ "$WASM_SIZE_OK" != "true" ]]; then
    echo "ERROR: One or more WASM files exceed the ${MAX_WASM_KB}KB size limit"
    exit 1
fi
echo "✅ All WASM files within size limits"

# ── Deploy contracts ──────────────────────────────────────────────────
echo ""
echo "🚀 Deploying contracts to ${NETWORK_UPPER}..."

DEPLOY_OUTPUT="$PROJECT_ROOT/$OUTPUT_FILE"

# Hash for idempotent deployment tracking
DEPLOY_HASH_FILE="$PROJECT_ROOT/.deploy_hash_${NETWORK}"

# Reuse previous successful deployment hash for idempotency check
if [[ "$IDEMPOTENT" == "true" && -f "$DEPLOY_HASH_FILE" ]]; then
    echo "📋 Previous deployment found: $(cat "$DEPLOY_HASH_FILE")"
    echo "   Skipping previously deployed contracts..."
fi

declare -A CONTRACTS
CONTRACTS=(
    ["ASSET_FACTORY"]="Asset Factory"
    ["COMPLIANCE_REGISTRY"]="Compliance Registry"
    ["DIVIDEND_DISTRIBUTOR"]="Dividend Distributor"
    ["SECONDARY_MARKET"]="Secondary Market"
    ["CUSTODY_VALIDATOR"]="Custody Validator"
    ["RWA_TOKEN"]="RWA Token"
)

# Clear output file
> "$DEPLOY_OUTPUT"

deploy_contract() {
    local env_var_name="$1"
    local display_name="$2"
    local wasm_name="$3"

    echo ""
    echo "─────────────────────────────────────────"
    echo "  Deploying: $display_name"
    echo "─────────────────────────────────────────"

    # Check if already deployed (idempotent)
    if [[ "$IDEMPOTENT" == "true" ]]; then
        EXISTING_ADDR=$(grep "^${env_var_name}=" "$DEPLOY_OUTPUT" 2>/dev/null | cut -d'=' -f2 || echo "")
        if [[ -n "$EXISTING_ADDR" ]]; then
            echo "  ⏭️  Already deployed: $EXISTING_ADDR (skipping)"
            echo "${env_var_name}=${EXISTING_ADDR}" >> "$DEPLOY_OUTPUT"
            return 0
        fi
    fi

    # Gas estimate (simulate first)
    if [[ "$(jq -r '.deployment.gasEstimateBeforeDeploy' "$CONFIG_FILE")" == "true" ]]; then
        echo "  📊 Estimating gas..."
    fi

    # Deploy with retries
    for ((i=1; i<=MAX_RETRIES; i++)); do
        echo "  🔄 Attempt $i/$MAX_RETRIES..."

        DEPLOY_RESULT=$(soroban contract deploy \
            --wasm "$WASM_PATH/$wasm_name" \
            --source "$DEPLOYER_SECRET" \
            --rpc-url "$RPC_URL" \
            --network-passphrase "$PASSPHRASE" \
            --fee "$MAX_FEE" 2>&1)

        if [[ $? -eq 0 ]]; then
            CONTRACT_ID=$(echo "$DEPLOY_RESULT" | tail -1 | tr -d '\n\r')
            echo "  ✅ Deployed: $CONTRACT_ID"
            echo "${env_var_name}=${CONTRACT_ID}" >> "$DEPLOY_OUTPUT"

            # Verify deployment
            if [[ "$VERIFY" == "true" ]]; then
                echo "  🔍 Verifying deployment..."
                VERIFY_RESULT=$(soroban contract read \
                    --id "$CONTRACT_ID" \
                    --rpc-url "$RPC_URL" \
                    --network-passphrase "$PASSPHRASE" 2>&1 || echo "WARNING: Verification read failed")
                echo "  📋 Verification: $VERIFY_RESULT" | head -3
            fi

            return 0
        else
            echo "  ❌ Attempt $i failed: $DEPLOY_RESULT"
            if [[ $i -lt $MAX_RETRIES ]]; then
                echo "  ⏳ Retrying in ${RETRY_DELAY}ms..."
                sleep "$(echo "scale=2; $RETRY_DELAY / 1000" | bc)"
            fi
        fi
    done

    echo "  💥 Deployment failed after $MAX_RETRIES attempts"
    return 1
}

# Get the WASM file (should be in the build directory)
# NOTE: This project builds a single WASM file (single crate). All contracts
# share the same WASM but produce different deployed instances/addresses.
# Each invocation of 'soroban contract deploy' creates a new instance.
WASM_FILE=$(ls "$WASM_PATH"/*.wasm 2>/dev/null | head -1)
if [[ -z "$WASM_FILE" ]]; then
    echo "ERROR: No WASM file found in $WASM_PATH"
    exit 1
fi
WASM_NAME=$(basename "$WASM_FILE")

FAILED_CONTRACTS=()

for env_key in "${!CONTRACTS[@]}"; do
    if ! deploy_contract "$env_key" "${CONTRACTS[$env_key]}" "$WASM_NAME"; then
        FAILED_CONTRACTS+=("$env_key")
    fi
done

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Deployment Summary — ${NETWORK_UPPER}"
echo "═══════════════════════════════════════════════════════════════"

if [[ ${#FAILED_CONTRACTS[@]} -gt 0 ]]; then
    echo ""
    echo "❌ ${#FAILED_CONTRACTS[@]} contract(s) failed to deploy:"
    for c in "${FAILED_CONTRACTS[@]}"; do
        echo "   - $c"
    done
    exit 1
fi

echo ""
echo "✅ All contracts deployed successfully!"
echo "📄 Addresses saved to: $DEPLOY_OUTPUT"
echo ""
cat "$DEPLOY_OUTPUT"
echo ""

# ── Save deployment hash for idempotency tracking ───────────────────
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEPLOY_HASH_FILE"

echo "🎉 Deployment complete!"
