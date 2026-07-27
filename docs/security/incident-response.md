# Incident Response Plan — Stellar RWA Tokenization Suite

> **Version:** 1.0  
> **Last Updated:** 2026-07-27  
> **Owner:** Security Team / Admin Multisig  
> **Classification:** Confidential

---

## 1. Overview

This document defines procedures for detecting, responding to, and recovering from security incidents affecting the Stellar RWA Tokenization Suite smart contracts, SDK, or associated infrastructure.

---

## 2. Incident Severity Levels

| Level | Name | Description | Example | Response Time |
|-------|------|-------------|---------|---------------|
| **P0** | Critical | Direct loss of user funds, unauthorized mint, contract compromise | Attacker mints unlimited tokens | Immediate (< 1 hour) |
| **P1** | High | Potential fund loss, exploit possible but not yet executed | Publicly disclosed vulnerability | < 4 hours |
| **P2** | Medium | Service degradation, non-critical vulnerability | Oracle downtime, order book stall | < 24 hours |
| **P3** | Low | Minor issue, informational | Documentation error, gas inefficiency | < 1 week |

---

## 3. Incident Response Team

| Role | Responsibility | Contact |
|------|---------------|---------|
| **Incident Commander (IC)** | Coordinates response, makes go/no-go decisions | Admin Multisig |
| **Technical Lead** | Investigates root cause, develops fix | Lead Smart Contract Dev |
| **Communications Lead** | Manages external communications, user notifications | Community Manager |
| **Legal/Compliance** | Regulatory reporting, legal risk assessment | Legal Counsel |

---

## 4. Response Phases

### Phase 1: Detection & Declaration (0-30 min)

1. **Detection Sources:**
   - On-chain monitoring alerts (abnormal transfers, large mints, admin actions)
   - GitHub security advisories / Dependabot alerts
   - Community reports (Discord, security@ email)
   - Oracle anomaly detection (price deviation > threshold)
   - Audit findings / bug bounty submissions

2. **Initial Triage:**
   - Verify the alert (false positive check)
   - Assess severity level (P0-P3)
   - Notify Incident Commander

3. **Declaration:**
   - IC declares incident and assigns severity
   - Activate response team via dedicated communication channel
   - Create incident log (document all actions with timestamps)

### Phase 2: Containment (30 min - 2 hours)

**For P0/P1 incidents, execute immediately:**

1. **Pause Contracts:**
   ```bash
   # Pause all contracts via admin multisig
   soroban contract invoke \
     --id <contract-id> \
     --network mainnet \
     --source admin \
     -- pause
   ```
   - Pause order: SecondaryMarket → DividendDistributor → RwaToken → AssetFactory
   - Preserve: ComplianceRegistry (may need for investigation)

2. **Freeze Affected Assets:**
   - Blacklist attacker address(es) in ComplianceRegistry
   - Lock affected token contracts
   - Halt oracle updates to prevent price manipulation propagation

3. **Preserve Evidence:**
   - Snapshot all contract storage state
   - Export transaction logs for affected period
   - Save all relevant on-chain data before any state changes

4. **Communicate:**
   - Issue initial statement: "We are investigating a potential security incident. Contracts are paused. Funds secured. Updates to follow."
   - Do NOT disclose technical details until root cause is confirmed

### Phase 3: Investigation (2-24 hours)

1. **Root Cause Analysis:**
   - Reconstruct attack transaction sequence
   - Identify exploited vulnerability (code bug, access control, oracle manipulation)
   - Determine scope: which contracts, users, assets affected
   - Calculate financial impact (if any)

2. **Develop Fix:**
   - Technical team develops and tests patch
   - Code review by at least 2 developers
   - Deploy to testnet and simulate attack scenario
   - Prepare migration/upgrade script if storage changes needed

3. **Legal Assessment:**
   - Determine regulatory reporting obligations
   - Assess liability and insurance coverage
   - Prepare user compensation plan if funds were lost

### Phase 4: Recovery (24-72 hours)

1. **Deploy Fix:**
   - Deploy patched contracts to mainnet
   - Execute migration if needed
   - Verify contract state integrity
   - Run full test suite against deployed contracts

2. **Resume Operations:**
   - Unpause contracts in reverse order: AssetFactory → RwaToken → DividendDistributor → SecondaryMarket
   - Re-enable oracle updates
   - Process queued operations (dividend claims, order settlements)

3. **User Compensation (if applicable):**
   - Snapshot affected balances pre-incident
   - Execute compensation distribution via DividendDistributor
   - Publish transparency report with full accounting

### Phase 5: Post-Incident (1-4 weeks)

1. **Postmortem:**
   - Document full incident timeline
   - Root cause and contributing factors
   - What worked well / what didn't in the response
   - Action items with owners and deadlines

2. **Preventive Measures:**
   - Update audit checklist with new findings
   - Add regression tests for the vulnerability class
   - Enhance monitoring to detect similar patterns
   - Update threat model

3. **External Communication:**
   - Publish postmortem (sanitized if necessary)
   - Notify affected users individually
   - Update security documentation

---

## 5. Communication Templates

### Initial Incident Notification
```
🚨 Security Incident Notice

We are investigating a potential security incident affecting the Stellar RWA 
Tokenization Suite. As a precautionary measure, all contracts have been paused.

Key details:
- Incident detected: [TIMESTAMP UTC]
- Status: Investigation in progress
- User funds: [ASSESSMENT]
- Next update: [TIME]

For questions: [COMMS EMAIL/DISCORD]
```

### Incident Resolution
```
✅ Security Incident Resolved

The security incident has been fully resolved.

Summary:
- Root cause: [BRIEF DESCRIPTION]
- Impact: [ASSESSMENT]
- Fix deployed: [TX HASH]
- Contracts resumed: [TIMESTAMP UTC]

Full postmortem: [LINK]
```

---

## 6. Contact Information

| Channel | Address |
|---------|---------|
| Security Email | security@stellar-rwa.com |
| Discord (Private) | Admin-only channel |
| GitHub Security Advisory | [Report a vulnerability](https://github.com/Kevin737866/stellar-asset-tokenization-suite/security/advisories/new) |

---

## 7. Drill Schedule

| Exercise | Frequency | Participants |
|----------|-----------|-------------|
| Tabletop (P0 scenario) | Quarterly | Full response team |
| Pause/unpause drill | Monthly | Technical team |
| Communication drill | Quarterly | Communications lead |
| Full simulation (testnet) | Bi-annual | All stakeholders |

---

## 8. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-27 | simonfrvr | Initial version |
