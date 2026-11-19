# Deployment

The production-oriented Compose deployment uses a non-root application image, persistent PocketBase volume, health check, restart policy, and CPU/memory limits. Copy `.env.example` to `.env`, set the public URL, then run `docker compose up --build -d`. Behind HTTPS, set `SLOPSTACK_SECURE_COOKIES=true`; terminate TLS at the reverse proxy and forward the public host/protocol. Configure `STARBURST_LLM_BASE_URL`, `STARBURST_LLM_API_KEY`, and `STARBURST_LLM_MODEL` together to enable provider-backed course and podcast scripts; leave all three blank to use deterministic fixtures. Set the Wyoming Piper/Whisper host and port when those services are available. Services must be reachable from the application container; do not assume container-local `localhost` addresses another service. For host services on Docker Desktop, use `host.docker.internal`; on Linux, attach the app to a shared user-defined network or configure a host gateway explicitly.

## Backups and restore

Stop Starburst before copying the SQLite database so the database and uploaded files form a consistent backup. Store the environment file separately because it contains credentials.

```sh
mkdir -p backups
chmod 700 backups
docker compose stop starburst
docker run --rm -v starburst-data:/data:ro -v "$PWD/backups":/backup alpine:3.22 sh -c 'tar -czf /backup/starburst-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /data .'
cp .env backups/starburst.env
chmod 600 backups/starburst.env
docker compose start starburst
```

Restore with the matching application release and environment file. Replace the example archive name with the backup to restore:

```sh
docker compose stop starburst
docker run --rm -v starburst-data:/data -v "$PWD/backups":/backup alpine:3.22 sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -xzf /backup/starburst-data-YYYYMMDDTHHMMSSZ.tar.gz -C /data'
cp backups/starburst.env .env
chmod 600 .env
docker compose up -d
```

PocketBase migrations run during startup; restore the database and configuration from a compatible application release before upgrading.

Downloaded lesson content and queued progress are stored in each learner’s browser IndexedDB and are not included in server backups. The production web build registers a service worker that caches the app shell and versioned frontend assets; it does not cache API responses, private server data, or external AI/speech services. Podcast scripts and generated episode WAV files (up to 25 MiB each) are stored in PocketBase and included in the PocketBase volume backup. Lesson narration and turn-by-turn podcast audio are synthesized on demand and are not stored. Imported sources and database files are included in the PocketBase volume. S3-compatible storage and automated restore verification are not implemented. Live provider, Wyoming, audio quality, and offline browser behavior need deployment-specific verification. Browser offline storage is per device and may be removed by browser storage cleanup.
