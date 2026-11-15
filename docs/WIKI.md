# DockFire wiki

**DockFire** is the homelab central for local and external services — find what is available, check coarse health, and jump into the right admin UI. Aimed at family support as much as operators.

Rendered live in the site **Guide** section (same content as `site/wiki.json`).

## First steps when helping

1. **Find the service** — Search or browse Local services.
2. **Check the status dot** — Green = reachable; red/amber = open Infrastructure health, then Pulseblade if needed.
3. **Sign in** — Most apps use Authentik (`auth.dataknife.net`).

## Compute

| Surface | Used for |
|---------|----------|
| **Proxmox** | Hypervisor for VMs / LXCs |
| **PegaProx / PDM** | Cluster helpers around Proxmox |
| **iDRAC** | Dell out-of-band power / console |

## Storage & backup

| Surface | Used for |
|---------|----------|
| **TrueNAS** | Shares, datasets, NAS admin |
| **NAS / RustFS** | S3-compatible object storage |
| **Proxmox Backup** | Guest / host backup appliance |

## Platforms

| Surface | Used for |
|---------|----------|
| **Rancher** | Kubernetes cluster manager |
| **Harbor** | Private container registry |
| **Coder** | Dev / agent workspaces |
| **Authentik** | SSO for internal apps |

## Observe & respond

| Surface | Used for |
|---------|----------|
| **Pulseblade** | Findings, remediation, MCP |
| **DockFire** | Catalog + coarse reachability + deep links |

## Network & power

| Surface | Used for |
|---------|----------|
| **UniFi** | LAN/WLAN (often LAN-only) |
| **PDU** | Rack power (LAN-only) |

## Org links

- [DataKnifeAI on GitHub](https://github.com/DataKnifeAI)
- [DockFire on GitHub](https://github.com/DataKnifeAI/dockfire)
- [DockFire on GitLab](https://gitlab.com/dk-raas/dkai/dockfire)
