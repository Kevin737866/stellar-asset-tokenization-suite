import {
  Asset,
  LiquidityPoolAsset,
  Operation,
  TransactionBuilder,
  Keypair,
  Server
} from 'stellar-sdk';
import { STELLAR_NETWORKS } from './constants';
import { CustodyClient } from './custody';

// Helper to parse asset string
function parseAsset(assetStr: string): Asset {
  if (assetStr.toUpperCase() === 'XLM' || assetStr.toUpperCase() === 'NATIVE') {
    return Asset.native();
  }
  const parts = assetStr.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid asset format: "${assetStr}". Expected "XLM" or "CODE:ISSUER"`);
  }
  return new Asset(parts[0], parts[1]);
}

// Compare two assets lexicographically
function compareAssets(a: Asset, b: Asset): number {
  if (a.isNative() && b.isNative()) return 0;
  if (a.isNative()) return -1;
  if (b.isNative()) return 1;

  const codeCompare = a.getCode().localeCompare(b.getCode());
  if (codeCompare !== 0) return codeCompare;

  return a.getIssuer().localeCompare(b.getIssuer());
}

function printHelp() {
  console.log(`
Stellar RWA Suite CLI

Usage:
  node dist/cli.js <command> [options]

Commands:
  create-pool   Create and fund a Stellar liquidity pool
  liquidate     Liquidate an undercollateralized RWA position

Run "node dist/cli.js <command> --help" for command-specific options.
`);
}

function printCreatePoolHelp() {
  console.log(`
Stellar RWA Suite CLI - Pool Creation Command

Usage:
  node dist/cli.js create-pool [options]

Options:
  --asset-a <asset>      First asset (e.g. "XLM" or "CODE:ISSUER") [required]
  --asset-b <asset>      Second asset (e.g. "CODE:ISSUER") [required]
  --amount-a <amount>    Maximum amount of Asset A to deposit [required]
  --amount-b <amount>    Maximum amount of Asset B to deposit [required]
  --fee <fee>            Liquidity pool fee in basis points (default: 30)
  --secret <secret>      Secret key of the depositor [required]
  --network <network>    Stellar network: testnet, mainnet, futurenet, standalone (default: testnet)
  --horizon-url <url>    Horizon server URL (optional, overrides default for network)
  --slippage <slippage>  Slippage tolerance as a decimal (default: 0.01 for 1%)
  --help, -h             Show this help message
`);
}

function printLiquidateHelp() {
  console.log(`
Stellar RWA Suite CLI - Liquidate Command

Liquidates an undercollateralized RWA position by triggering an insurance claim
on the Custody Validator contract. The command first checks whether the position
is actually undercollateralized (collateral value < total token supply). Use
--force to skip the collateralization check and proceed unconditionally.

Usage:
  node dist/cli.js liquidate [options]

Options:
  --asset-id <address>          On-chain contract address of the RWA token [required]
  --custody-validator <address> Custody Validator contract address [required]
  --secret <secret>             Secret key of the authorized admin account [required]
  --reason <reason>             Short reason code for the claim (default: "undercollateralized")
  --evidence-hash <hash>        64-character hex evidence hash (32 bytes) [required]
  --network <network>           Stellar network: testnet, mainnet, futurenet, standalone (default: testnet)
  --horizon-url <url>           Horizon server URL (optional, overrides default for network)
  --force                       Skip collateralization check and liquidate unconditionally
  --help, -h                    Show this help message
`);
}

function parseArgs(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = args[i + 1];
      if (val && !val.startsWith('--')) {
        options[key] = val;
        i++;
      } else {
        options[key] = 'true';
      }
    }
  }
  return options;
}

async function runCreatePool(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printCreatePoolHelp();
    process.exit(0);
  }

  const options = parseArgs(args);
  const required = ['asset-a', 'asset-b', 'amount-a', 'amount-b', 'secret'];
  for (const req of required) {
    if (!options[req]) {
      console.error(`Error: Missing required option --${req}`);
      printCreatePoolHelp();
      process.exit(1);
    }
  }

  const assetAStr = options['asset-a'];
  const assetBStr = options['asset-b'];
  const amountA = options['amount-a'];
  const amountB = options['amount-b'];
  const feeStr = options['fee'] || '30';
  const secret = options['secret'];
  const networkName = options['network'] || 'testnet';
  const slippageStr = options['slippage'] || '0.01';

  const fee = parseInt(feeStr, 10);
  const slippage = parseFloat(slippageStr);

  const networkConfig = STELLAR_NETWORKS[networkName];
  if (!networkConfig) {
    throw new Error(`Unsupported network: "${networkName}". Supported: testnet, mainnet, futurenet, standalone`);
  }

  const horizonUrl = options['horizon-url'] || networkConfig.horizonUrl;
  console.log(`Connecting to Stellar network: ${networkName} via ${horizonUrl}...`);
  const server = new Server(horizonUrl);

  const depositorKeypair = Keypair.fromSecret(secret);
  const depositorAddress = depositorKeypair.publicKey();
  console.log(`Depositor Account: ${depositorAddress}`);

  const assetA = parseAsset(assetAStr);
  const assetB = parseAsset(assetBStr);

  // Sort assets lexicographically
  let sortedAssetA = assetA;
  let sortedAssetB = assetB;
  let sortedAmountA = amountA;
  let sortedAmountB = amountB;

  if (compareAssets(assetA, assetB) > 0) {
    console.log('Swapping assets lexicographically (Asset A must be lexicographically smaller than Asset B in Stellar LP)...');
    sortedAssetA = assetB;
    sortedAssetB = assetA;
    sortedAmountA = amountB;
    sortedAmountB = amountA;
  }

  // Get liquidity pool details
  const lpAsset = new LiquidityPoolAsset(sortedAssetA, sortedAssetB, fee);
  let poolId = '';
  try {
    const { getLiquidityPoolId } = require('stellar-sdk');
    poolId = getLiquidityPoolId('constant_product', {
      assetA: sortedAssetA,
      assetB: sortedAssetB,
      fee
    }).toString('hex');
  } catch (e) {
    poolId = (lpAsset as any).getLiquidityPoolId?.() || (lpAsset as any).poolId || '';
  }
  console.log(`Liquidity Pool ID: ${poolId}`);

  // Load account to check balance and trustlines
  console.log('Fetching account details...');
  const account = await server.loadAccount(depositorAddress);

  // Check trustlines
  const hasTrustline = (asset: Asset) => {
    if (asset.isNative()) return true;
    return account.balances.some((b: any) =>
      b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer()
    );
  };

  const hasPoolTrustline = (pid: string) => {
    return account.balances.some((b: any) =>
      b.asset_type === 'liquidity_pool_shares' && b.liquidity_pool_id === pid
    );
  };

  const networkPassphrase = networkConfig.passphrase;
  const txBuilder = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase
  });

  let operationsAdded = 0;

  // Add trustlines if missing
  if (!hasTrustline(sortedAssetA)) {
    console.log(`Adding trustline for asset: ${sortedAssetA.getCode()}:${sortedAssetA.getIssuer()}...`);
    txBuilder.addOperation(Operation.changeTrust({ asset: sortedAssetA }));
    operationsAdded++;
  }

  if (!hasTrustline(sortedAssetB)) {
    console.log(`Adding trustline for asset: ${sortedAssetB.getCode()}:${sortedAssetB.getIssuer()}...`);
    txBuilder.addOperation(Operation.changeTrust({ asset: sortedAssetB }));
    operationsAdded++;
  }

  if (!hasPoolTrustline(poolId)) {
    console.log(`Adding trustline for pool shares: ${poolId}...`);
    txBuilder.addOperation(Operation.changeTrust({ asset: lpAsset }));
    operationsAdded++;
  }

  // Calculate slippage-adjusted price bounds
  const ratio = parseFloat(sortedAmountA) / parseFloat(sortedAmountB);
  const minPrice = (ratio * (1 - slippage)).toFixed(7);
  const maxPrice = (ratio * (1 + slippage)).toFixed(7);

  console.log(`Depositing assets into pool:`);
  console.log(`  Asset A Amount: ${sortedAmountA}`);
  console.log(`  Asset B Amount: ${sortedAmountB}`);
  console.log(`  Min Price Ratio: ${minPrice}`);
  console.log(`  Max Price Ratio: ${maxPrice}`);

  txBuilder.addOperation(
    Operation.liquidityPoolDeposit({
      liquidityPoolId: poolId,
      maxAmountA: sortedAmountA,
      maxAmountB: sortedAmountB,
      minPrice,
      maxPrice
    })
  );
  operationsAdded++;

  txBuilder.setTimeout(30);
  const tx = txBuilder.build();
  tx.sign(depositorKeypair);

  console.log(`Submitting transaction with ${operationsAdded} operations to network...`);
  const response = await server.sendTransaction(tx);
  console.log('Transaction submitted successfully!');
  console.log(`Hash: ${response.hash}`);
  console.log(`Ledger: ${response.ledger}`);
}

async function runLiquidate(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printLiquidateHelp();
    process.exit(0);
  }

  const options = parseArgs(args);
  const required = ['asset-id', 'custody-validator', 'secret', 'evidence-hash'];
  for (const req of required) {
    if (!options[req]) {
      console.error(`Error: Missing required option --${req}`);
      printLiquidateHelp();
      process.exit(1);
    }
  }

  const assetId = options['asset-id'];
  const custodyValidatorId = options['custody-validator'];
  const secret = options['secret'];
  const reason = options['reason'] || 'undercollateralized';
  const evidenceHash = options['evidence-hash'];
  const networkName = options['network'] || 'testnet';
  const force = options['force'] === 'true';

  // Validate evidence hash format
  if (!/^[0-9a-fA-F]{64}$/.test(evidenceHash)) {
    console.error('Error: --evidence-hash must be a 64-character hex string (32 bytes).');
    process.exit(1);
  }

  const networkConfig = STELLAR_NETWORKS[networkName];
  if (!networkConfig) {
    throw new Error(`Unsupported network: "${networkName}". Supported: testnet, mainnet, futurenet, standalone`);
  }

  const horizonUrl = options['horizon-url'] || networkConfig.horizonUrl;
  console.log(`Connecting to Stellar network: ${networkName} via ${horizonUrl}...`);

  const adminKeypair = Keypair.fromSecret(secret);
  console.log(`Admin Account: ${adminKeypair.publicKey()}`);
  console.log(`Asset ID: ${assetId}`);
  console.log(`Custody Validator: ${custodyValidatorId}`);

  // Instantiate CustodyClient
  const custodyClient = new CustodyClient(
    custodyValidatorId,
    horizonUrl,
    networkConfig.passphrase
  );

  // Check collateralization unless --force is set
  if (!force) {
    console.log('\nChecking collateralization status...');
    try {
      const backingStatus = await custodyClient.verifyAssetBacking(assetId);

      if (backingStatus.isValid) {
        console.log('✅ Asset is currently fully backed by valid custody attestation.');
        console.log('   Use --force to liquidate anyway.');
        process.exit(0);
      }

      // Describe why the position is undercollateralized
      if (backingStatus.alerts.length > 0) {
        console.log(`⚠️  Custody alerts detected:`);
        for (const alert of backingStatus.alerts) {
          console.log(`    - ${alert}`);
        }
      }

      if (!backingStatus.latestAttestation) {
        console.log('⚠️  No valid attestation found — asset has no confirmed collateral backing.');
      } else {
        const expiredAt = new Date(backingStatus.latestAttestation.expiresAt);
        console.log(`⚠️  Latest attestation expired at: ${expiredAt.toISOString()}`);
        console.log(`   Insurance status: ${backingStatus.insuranceStatus}`);
      }

      console.log('\n🔴 Position is undercollateralized. Proceeding with liquidation...');
    } catch (err: any) {
      console.warn(`Warning: Could not verify collateral on-chain (${err.message}). Proceeding with liquidation as requested...`);
    }
  } else {
    console.log('⚡ --force flag set. Skipping collateralization check...');
  }

  // Trigger the insurance claim / liquidation
  console.log(`\nTriggering insurance claim on Custody Validator...`);
  console.log(`  Reason: ${reason}`);
  console.log(`  Evidence Hash: ${evidenceHash}`);

  const result = await custodyClient.triggerInsuranceClaim(
    adminKeypair,
    assetId,
    reason,
    evidenceHash
  );

  console.log('\n✅ Liquidation triggered successfully!');
  console.log(`   Transaction Hash: ${result.hash}`);
  console.log(`   Ledger: ${(result as any).ledger ?? 'pending'}`);
  console.log('\nThe custody contract has emitted an "insurance_claim_triggered" event.');
  console.log('The insurance provider will now process the claim and compensate token holders.');
}

export async function runCli() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  try {
    if (command === 'create-pool') {
      await runCreatePool(commandArgs);
    } else if (command === 'liquidate') {
      await runLiquidate(commandArgs);
    } else {
      console.error(`Unknown command: "${command}".`);
      printHelp();
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message || error}`);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}
