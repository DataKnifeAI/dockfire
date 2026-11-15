# Dockfire wiki

Human-oriented notes for the surfaces shown on the internal dashboard.

The live site also renders this content from [`site/wiki.json`](../site/wiki.json).

## Safety

- No passwords, tokens, or API keys belong in this repo or in Dockfire config.
- RFC1918 admin URLs stay in a **gitignored** deploy overlay (`deploy/private/services.local.json`), not on GitHub.
- Health checks are **DNS resolve + TCP** from the cluster path. They do not log in to apps.

## Compute

| Surface | Used for |
|---------|----------|
| **Proxmox** | Hypervisor cluster for VMs/LXCs, snapshots, migration |
| **PegaProx** | Convenience UI around the Proxmox cluster |
| **Proxmox Datacenter Manager** | Multi-node PDM control plane |
| **iDRAC** | Out-of-band power/console/hardware when the OS is down |

## Storage & backup

| Surface | Used for |
|---------|----------|
| **TrueNAS** | Datasets, shares, block storage, snapshots/replication |
| **NAS / RustFS** | S3-compatible object buckets |
| **Proxmox Backup** | Guest/host backup jobs and restores |

## Kubernetes & platforms

| Surface | Used for |
|---------|----------|
| **Rancher** | Manage RKE2/downstream clusters and Fleet targets |
| **Harbor** | Private container images for GitOps |
| **Coder** | Human and agent workspaces |
| **Authentik** | SSO for internal apps |

## Observe & respond

| Surface | Used for |
|---------|----------|
| **Pulseblade** | Findings, change journal, gated remediation, MCP |
| **Grafana** | Metrics dashboards |
| **Dockfire** | Coarse reachability + deep links (this app) |

## Network & power

| Surface | Used for |
|---------|----------|
| **UniFi** | LAN/WLAN controller (often LAN-only) |
| **PDU** | Rack power outlets and load (LAN-only) |
