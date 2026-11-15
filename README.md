# DockFire

![DockFire — homelab central for local and external services](docs/assets/dockfire-hero.jpg)

**DockFire** — homelab central for all local and external services. Find what is available, see if it is healthy, and jump in to support.

Built for family members and operators alike: a searchable launcher (Heimdall/Dashy-style) plus live reachability for admin surfaces. Sits above deep telemetry ([pulseblade](https://github.com/DataKnifeAI/pulseblade)) and the agent pipeline ([fleetshade](https://github.com/DataKnifeAI/fleetshade), [helmrail](https://github.com/DataKnifeAI/helmrail), [slashbay](https://github.com/DataKnifeAI/slashbay)).

## Goals

- **Know what exists** — Local services and org links with plain-language blurbs
- **Jump in fast** — One click to the right UI; audience tags (Everyone / Support / Admin)
- **Health at a glance** — Coarse green / amber / red from cluster-side DNS + TCP
- **Homelab-shaped** — Self-hosted, local-first, no SaaS dashboard tax

## Status

Internal site: <https://dockfire.dataknife.net/>  
GitHub: <https://github.com/DataKnifeAI/dockfire>  
GitLab mirror: <https://gitlab.com/dk-raas/dkai/dockfire>

- **Catalog** — `site/catalog.json` (family-facing local + external launcher)
- **Health probes** — `site/services.json` (hostname-based; LAN overlay gitignored)
- **Guide** — [docs/WIKI.md](docs/WIKI.md) / site Guide section

LAN-only RFC1918 admin URLs: see `deploy/private/services.local.example.json`.

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
