# production-setup example

Shows all production-readiness features in one place:

| Feature | What it does |
|---|---|
| `healthCheck()` | k8s liveness/readiness probe at `/health` |
| `gracefulShutdown()` | Zero-downtime deploys — drains in-flight requests on SIGTERM |
| `timeout: 5000` on route | Handler aborts with 408 after 5s — prevents connection pool exhaustion |
| `inMemoryDeduplicator()` | GitHub webhook replay prevention |

```bash
npm install && npm start
# → http://localhost:3000/health
# → POST http://localhost:3000/api/v1/slow  { "delay": 2000 }
# → POST http://localhost:3000/api/v1/slow  { "delay": 10000 }  # → 408 after 5s
```
