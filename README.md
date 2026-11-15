# Dockfire

![Dockfire — homelab health overview and admin deep links](docs/assets/dockfire-hero.jpg)

**Dockfire** — high-level health for the homelab, with deep links into the admin pages that fix what is wrong.

Sits above deep telemetry ([pulseblade](https://github.com/DataKnifeAI/pulseblade)) and the agent pipeline ([fleetshade](https://github.com/DataKnifeAI/fleetshade), [helmrail](https://github.com/DataKnifeAI/helmrail), [slashbay](https://github.com/DataKnifeAI/slashbay)): a human-facing overview, not another metrics firehose.

## Goals

- **Health at a glance** — Proxmox, UniFi, Kubernetes, storage, and other surfaces as coarse green / amber / red
- **Jump to fix** — each unhealthy signal links straight to the right admin UI
- **Homelab-shaped** — self-hosted, local-first, no SaaS dashboard tax

## Status

Internal site: <https://dockfire.dataknife.net/>  
GitLab mirror: <https://gitlab.com/dk-raas/dkai/dockfire>

Health + wiki UI. Public catalog is hostname-based (`site/services.json`). LAN-only
RFC1918 admin URLs live in a **gitignored** overlay — see `deploy/private/services.local.example.json`.

Wiki: [docs/WIKI.md](docs/WIKI.md) (also rendered in the site **Wiki** tab).

## Related

| Project | Role |
|---------|------|
| [pulseblade](https://github.com/DataKnifeAI/pulseblade) | Agent-first infra monitor / remediation |
| [fleetshade](https://github.com/DataKnifeAI/fleetshade) | Observe-only agent fleet status board |
| [helmrail](https://github.com/DataKnifeAI/helmrail) | Rust K8s control plane for agent fleets |
| [coldberth](https://github.com/DataKnifeAI/coldberth) | Local Hermes Agent + vLLM host bootstrap |

## Deploy (prd-apps)

```bash
TAG=$(git rev-parse --short HEAD)
docker build -t harbor.dataknife.net/library/dockfire:$TAG -t harbor.dataknife.net/library/dockfire:latest .
docker push harbor.dataknife.net/library/dockfire:$TAG
docker push harbor.dataknife.net/library/dockfire:latest
kubectl apply -f deploy/k8s/prod/dockfire.yaml
```

## License

Apache License 2.0 · DataKnifeAI
