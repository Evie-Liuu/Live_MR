# LiveKit 多人即時連線 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a LiveKit-based multi-user real-time system where a teacher (Host) creates rooms, approves students via QR Code, and views their webcam + VRM Avatar driven by MediaPipe pose data.

**Architecture:** Monorepo with `frontend/` (Vite+React+Nginx) and `backend/` (Node+Express), orchestrated by Docker Compose with a self-hosted LiveKit server. Frontend Nginx serves static files and proxies `/api/*` to backend. Waiting room implemented via backend SSE + student polling.

**Tech Stack:** React 19, TypeScript, Vite, Express, LiveKit (self-hosted + JS SDK), MediaPipe Pose, Kalidokit, Three.js, @pixiv/three-vrm, Docker Compose, Nginx

**Spec:** `docs/superpowers/specs/2026-03-22-livekit-multiplayer-design.md`

---

## Chunk 1: Monorepo Migration & Infrastructure

### Task 1: Migrate existing files to frontend/

**Files:**
- Move: `src/`, `public/`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js`, `README.md` → `frontend/`

- [ ] **Step 1: Create frontend directory and move files**

```bash
mkdir -p frontend
git mv src/ frontend/src/
git mv public/ frontend/public/
git mv index.html frontend/index.html
git mv package.json frontend/package.json
git mv package-lock.json frontend/package-lock.json
git mv vite.config.ts frontend/vite.config.ts
git mv tsconfig.json frontend/tsconfig.json
git mv tsconfig.app.json frontend/tsconfig.app.json
git mv tsconfig.node.json frontend/tsconfig.node.json
git mv eslint.config.js frontend/eslint.config.js
git mv README.md frontend/README.md
```

- [ ] **Step 2: Verify frontend still builds**

```bash
cd frontend && npm install && npm run build
```

Expected: Build succeeds, `frontend/dist/` created.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: migrate existing project into frontend/ subdirectory"
```

---

### Task 2: Create backend scaffold

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/src/index.ts`

- [ ] **Step 1: Create backend/package.json**

```json
{
  "name": "live-mr-backend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^5.1.0",
    "livekit-server-sdk": "^2.13.1",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.18",
    "@types/express": "^5.0.2",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.4",
    "typescript": "~5.9.3",
    "vitest": "^3.2.1",
    "supertest": "^7.1.0",
    "@types/supertest": "^6.0.3"
  }
}
```

- [ ] **Step 2: Create backend/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create backend/src/index.ts**

```typescript
import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

const PORT = parseInt(process.env.PORT || '3001', 10)
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`)
})

export { app }
```

- [ ] **Step 4: Install dependencies and verify**

```bash
cd backend && npm install && npx tsx src/index.ts &
sleep 2 && curl http://localhost:3001/api/health
kill %1
```

Expected: `{"status":"ok"}`

- [ ] **Step 5: Write health check test**

Create `backend/src/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from './index.js'

describe('GET /api/health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})
```

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: scaffold backend with Express + health check"
```

---

### Task 3: Docker Compose + Nginx + LiveKit config

**Files:**
- Create: `docker-compose.yml`
- Create: `frontend/nginx.conf`
- Create: `frontend/Dockerfile`
- Create: `backend/Dockerfile`
- Create: `livekit.yaml`
- Create: `.env`

- [ ] **Step 1: Create .env**

```env
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret1234567890devsecret1234567890
LIVEKIT_URL=ws://livekit:7880
VITE_LIVEKIT_URL=ws://localhost:7880
VITE_APP_DOMAIN=localhost
```

- [ ] **Step 2: Create livekit.yaml**

```yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: false
keys:
  devkey: devsecret1234567890devsecret1234567890
logging:
  level: info
```

- [ ] **Step 3: Create frontend/nginx.conf**

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header X-Accel-Buffering no;
        proxy_read_timeout 86400s;
    }
}
```

- [ ] **Step 4: Create frontend/Dockerfile**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 5: Create backend/Dockerfile**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

- [ ] **Step 6: Create docker-compose.yml**

```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    command: --config /etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    ports:
      - "7880:7880"
      - "50000-50020:50000-50020/udp"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:7880"]
      interval: 10s
      timeout: 5s
      retries: 3

  backend:
    build: ./backend
    ports:
      - "3001:3001"
    env_file: .env
    depends_on:
      livekit:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3001/api/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  frontend:
    build: ./frontend
    ports:
      - "80:80"
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
```

- [ ] **Step 7: Verify Docker Compose builds**

```bash
docker compose build
```

Expected: All 3 services build without error.

- [ ] **Step 8: Verify Docker Compose starts**

```bash
docker compose up -d
sleep 10
curl http://localhost/api/health
docker compose down
```

Expected: `{"status":"ok"}`

- [ ] **Step 9: Update .gitignore**

Add to root `.gitignore`:

```
node_modules/
dist/
.env
```

- [ ] **Step 10: Commit**

```bash
git add docker-compose.yml livekit.yaml frontend/nginx.conf frontend/Dockerfile backend/Dockerfile .gitignore
git commit -m "infra: add Docker Compose with LiveKit, Nginx, and backend services"
```

---

## Chunk 2: Backend API — Room Management & Waiting Room

### Task 4: Room store module

**Files:**
- Create: `backend/src/rooms.ts`
- Create: `backend/src/rooms.test.ts`

- [ ] **Step 1: Write failing tests for room store**

Create `backend/src/rooms.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { RoomStore } from './rooms.js'

describe('RoomStore', () => {
  let store: RoomStore

  beforeEach(() => {
    store = new RoomStore()
  })

  it('creates a room and returns roomId + hostToken', () => {
    const room = store.createRoom()
    expect(room.roomId).toBeTruthy()
    expect(room.hostToken).toBeTruthy()
  })

  it('gets a room by id', () => {
    const { roomId } = store.createRoom()
    const room = store.getRoom(roomId)
    expect(room).toBeTruthy()
    expect(room!.roomId).toBe(roomId)
  })

  it('returns undefined for unknown room', () => {
    expect(store.getRoom('fake')).toBeUndefined()
  })

  it('validates host token', () => {
    const { roomId, hostToken } = store.createRoom()
    expect(store.validateHost(roomId, hostToken)).toBe(true)
    expect(store.validateHost(roomId, 'wrong')).toBe(false)
    expect(store.validateHost('fake', hostToken)).toBe(false)
  })

  it('adds a join request', () => {
    const { roomId } = store.createRoom()
    const req = store.addJoinRequest(roomId, 'Alice')
    expect(req.requestId).toBeTruthy()
    expect(req.name).toBe('Alice')
    expect(req.status).toBe('pending')
  })

  it('approves a join request', () => {
    const { roomId } = store.createRoom()
    const req = store.addJoinRequest(roomId, 'Bob')
    const updated = store.approveRequest(roomId, req.requestId, 'fake-token')
    expect(updated!.status).toBe('approved')
    expect(updated!.token).toBe('fake-token')
  })

  it('rejects a join request', () => {
    const { roomId } = store.createRoom()
    const req = store.addJoinRequest(roomId, 'Charlie')
    const updated = store.rejectRequest(roomId, req.requestId)
    expect(updated!.status).toBe('rejected')
  })

  it('gets request status', () => {
    const { roomId } = store.createRoom()
    const req = store.addJoinRequest(roomId, 'Dave')
    const status = store.getRequestStatus(roomId, req.requestId)
    expect(status!.status).toBe('pending')
  })

  it('gets pending requests for a room', () => {
    const { roomId } = store.createRoom()
    store.addJoinRequest(roomId, 'A')
    store.addJoinRequest(roomId, 'B')
    const pending = store.getPendingRequests(roomId)
    expect(pending).toHaveLength(2)
  })

  it('cleans up stale rooms', () => {
    const { roomId } = store.createRoom()
    // Force the room's createdAt to be old
    const room = store.getRoom(roomId)!
    room.createdAt = Date.now() - 7 * 60 * 60 * 1000 // 7 hours ago
    store.cleanup(6 * 60 * 60 * 1000) // 6 hour TTL
    expect(store.getRoom(roomId)).toBeUndefined()
  })
})
```

Run: `cd backend && npm test`
Expected: FAIL — `RoomStore` not found

- [ ] **Step 2: Implement RoomStore**

Create `backend/src/rooms.ts`:

```typescript
import { v4 as uuidv4 } from 'uuid'

export interface JoinRequest {
  requestId: string
  roomId: string
  name: string
  status: 'pending' | 'approved' | 'rejected'
  token?: string
  createdAt: number
}

export interface Room {
  roomId: string
  hostToken: string
  requests: JoinRequest[]
  createdAt: number
}

export class RoomStore {
  private rooms = new Map<string, Room>()

  createRoom(): { roomId: string; hostToken: string } {
    const roomId = uuidv4()
    const hostToken = uuidv4()
    this.rooms.set(roomId, {
      roomId,
      hostToken,
      requests: [],
      createdAt: Date.now(),
    })
    return { roomId, hostToken }
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  validateHost(roomId: string, hostToken: string): boolean {
    const room = this.rooms.get(roomId)
    return room !== undefined && room.hostToken === hostToken
  }

  addJoinRequest(roomId: string, name: string): JoinRequest {
    const room = this.rooms.get(roomId)
    if (!room) throw new Error('Room not found')
    const request: JoinRequest = {
      requestId: uuidv4(),
      roomId,
      name,
      status: 'pending',
      createdAt: Date.now(),
    }
    room.requests.push(request)
    return request
  }

  approveRequest(roomId: string, requestId: string, token: string): JoinRequest | undefined {
    const room = this.rooms.get(roomId)
    if (!room) return undefined
    const req = room.requests.find(r => r.requestId === requestId)
    if (!req) return undefined
    req.status = 'approved'
    req.token = token
    return req
  }

  rejectRequest(roomId: string, requestId: string): JoinRequest | undefined {
    const room = this.rooms.get(roomId)
    if (!room) return undefined
    const req = room.requests.find(r => r.requestId === requestId)
    if (!req) return undefined
    req.status = 'rejected'
    return req
  }

  getRequestStatus(roomId: string, requestId: string): JoinRequest | undefined {
    const room = this.rooms.get(roomId)
    if (!room) return undefined
    return room.requests.find(r => r.requestId === requestId)
  }

  getPendingRequests(roomId: string): JoinRequest[] {
    const room = this.rooms.get(roomId)
    if (!room) return []
    return room.requests.filter(r => r.status === 'pending')
  }

  cleanup(ttlMs: number): void {
    const now = Date.now()
    for (const [id, room] of this.rooms) {
      if (now - room.createdAt > ttlMs) {
        this.rooms.delete(id)
      }
    }
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd backend && npm test
```

Expected: All 9 tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/rooms.ts backend/src/rooms.test.ts
git commit -m "feat(backend): add RoomStore with join request management"
```

---

### Task 5: LiveKit token helper

**Files:**
- Create: `backend/src/livekit.ts`
- Create: `backend/src/livekit.test.ts`

- [ ] **Step 1: Write failing test**

Create `backend/src/livekit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createToken } from './livekit.js'

describe('createToken', () => {
  it('returns a JWT string', async () => {
    const token = await createToken('room-1', 'user-1', false)
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3) // JWT format
  })

  it('returns different tokens for host vs student', async () => {
    const hostToken = await createToken('room-1', 'host', true)
    const studentToken = await createToken('room-1', 'student-1', false)
    expect(hostToken).not.toBe(studentToken)
  })
})
```

Run: `cd backend && npm test`
Expected: FAIL

- [ ] **Step 2: Implement createToken**

Create `backend/src/livekit.ts`:

```typescript
import { AccessToken } from 'livekit-server-sdk'

const API_KEY = process.env.LIVEKIT_API_KEY || 'devkey'
const API_SECRET = process.env.LIVEKIT_API_SECRET || 'devsecret1234567890devsecret1234567890'

export async function createToken(
  roomName: string,
  participantName: string,
  isHost: boolean,
): Promise<string> {
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: participantName,
    ttl: '6h',
  })
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: isHost,
    canPublishData: true,
  })
  return await at.toJwt()
}
```

- [ ] **Step 3: Run tests**

```bash
cd backend && npm test
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/livekit.ts backend/src/livekit.test.ts
git commit -m "feat(backend): add LiveKit token generation helper"
```

---

### Task 6: API routes — room create, join-request, status polling

**Files:**
- Create: `backend/src/routes.ts`
- Create: `backend/src/routes.test.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/src/routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createRouter } from './routes.js'
import { RoomStore } from './rooms.js'

describe('API routes', () => {
  let app: express.Express
  let store: RoomStore

  beforeEach(() => {
    store = new RoomStore()
    app = express()
    app.use(express.json())
    app.use('/api', createRouter(store))
  })

  describe('POST /api/rooms/create', () => {
    it('returns roomId and hostToken', async () => {
      const res = await request(app).post('/api/rooms/create')
      expect(res.status).toBe(200)
      expect(res.body.roomId).toBeTruthy()
      expect(res.body.hostToken).toBeTruthy()
    })
  })

  describe('POST /api/rooms/join-request', () => {
    it('returns requestId for valid room', async () => {
      const createRes = await request(app).post('/api/rooms/create')
      const { roomId } = createRes.body

      const res = await request(app)
        .post('/api/rooms/join-request')
        .send({ roomId, name: 'Alice' })
      expect(res.status).toBe(200)
      expect(res.body.requestId).toBeTruthy()
    })

    it('returns 404 for invalid room', async () => {
      const res = await request(app)
        .post('/api/rooms/join-request')
        .send({ roomId: 'fake', name: 'Alice' })
      expect(res.status).toBe(404)
    })

    it('returns 400 if name missing', async () => {
      const createRes = await request(app).post('/api/rooms/create')
      const res = await request(app)
        .post('/api/rooms/join-request')
        .send({ roomId: createRes.body.roomId })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/rooms/:roomId/request-status/:requestId', () => {
    it('returns pending status', async () => {
      const createRes = await request(app).post('/api/rooms/create')
      const { roomId } = createRes.body
      const joinRes = await request(app)
        .post('/api/rooms/join-request')
        .send({ roomId, name: 'Bob' })
      const { requestId } = joinRes.body

      const res = await request(app)
        .get(`/api/rooms/${roomId}/request-status/${requestId}`)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('pending')
    })
  })

  describe('POST /api/rooms/approve', () => {
    it('approves a request with valid hostToken', async () => {
      const createRes = await request(app).post('/api/rooms/create')
      const { roomId, hostToken } = createRes.body
      const joinRes = await request(app)
        .post('/api/rooms/join-request')
        .send({ roomId, name: 'Charlie' })
      const { requestId } = joinRes.body

      const res = await request(app)
        .post('/api/rooms/approve')
        .send({ roomId, requestId, hostToken })
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('approved')
    })

    it('returns 403 for wrong hostToken', async () => {
      const createRes = await request(app).post('/api/rooms/create')
      const { roomId } = createRes.body
      const joinRes = await request(app)
        .post('/api/rooms/join-request')
        .send({ roomId, name: 'Eve' })

      const res = await request(app)
        .post('/api/rooms/approve')
        .send({ roomId, requestId: joinRes.body.requestId, hostToken: 'wrong' })
      expect(res.status).toBe(403)
    })
  })

  describe('POST /api/rooms/reject', () => {
    it('rejects a request', async () => {
      const createRes = await request(app).post('/api/rooms/create')
      const { roomId, hostToken } = createRes.body
      const joinRes = await request(app)
        .post('/api/rooms/join-request')
        .send({ roomId, name: 'Frank' })

      const res = await request(app)
        .post('/api/rooms/reject')
        .send({ roomId, requestId: joinRes.body.requestId, hostToken })
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('rejected')
    })
  })

  describe('approved status includes token', () => {
    it('returns token after approval', async () => {
      const createRes = await request(app).post('/api/rooms/create')
      const { roomId, hostToken } = createRes.body
      const joinRes = await request(app)
        .post('/api/rooms/join-request')
        .send({ roomId, name: 'Grace' })
      const { requestId } = joinRes.body

      await request(app)
        .post('/api/rooms/approve')
        .send({ roomId, requestId, hostToken })

      const statusRes = await request(app)
        .get(`/api/rooms/${roomId}/request-status/${requestId}`)
      expect(statusRes.body.status).toBe('approved')
      expect(statusRes.body.token).toBeTruthy()
    })
  })
})
```

Run: `cd backend && npm test`
Expected: FAIL

- [ ] **Step 2: Implement routes**

Create `backend/src/routes.ts`:

```typescript
import { Router } from 'express'
import { RoomStore } from './rooms.js'
import { createToken } from './livekit.js'

export function createRouter(store: RoomStore): Router {
  const router = Router()

  // SSE clients per room
  const sseClients = new Map<string, Set<import('express').Response>>()

  function notifySSE(roomId: string, data: object) {
    const clients = sseClients.get(roomId)
    if (!clients) return
    const msg = `data: ${JSON.stringify(data)}\n\n`
    for (const res of clients) {
      res.write(msg)
    }
  }

  // Create room
  router.post('/rooms/create', async (req, res) => {
    const { roomId, hostToken: secret } = store.createRoom()
    const livekitToken = await createToken(roomId, 'host', true)
    // Return the secret for backend auth AND the LiveKit JWT for connecting
    res.json({ roomId, hostToken: secret, livekitToken })
  })

  // Join request
  router.post('/rooms/join-request', (req, res) => {
    const { roomId, name } = req.body
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    const room = store.getRoom(roomId)
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }
    const request = store.addJoinRequest(roomId, name)
    notifySSE(roomId, { type: 'join-request', requestId: request.requestId, name })
    res.json({ requestId: request.requestId })
  })

  // Request status (student polling)
  router.get('/rooms/:roomId/request-status/:requestId', (req, res) => {
    const { roomId, requestId } = req.params
    const request = store.getRequestStatus(roomId, requestId)
    if (!request) {
      res.status(404).json({ error: 'Request not found' })
      return
    }
    const result: Record<string, string | undefined> = { status: request.status }
    if (request.status === 'approved' && request.token) {
      result.token = request.token
    }
    res.json(result)
  })

  // Approve
  router.post('/rooms/approve', async (req, res) => {
    const { roomId, requestId, hostToken } = req.body
    if (!store.validateHost(roomId, hostToken)) {
      res.status(403).json({ error: 'Unauthorized' })
      return
    }
    const request = store.getRequestStatus(roomId, requestId)
    if (!request) {
      res.status(404).json({ error: 'Request not found' })
      return
    }
    const token = await createToken(roomId, request.name, false)
    const updated = store.approveRequest(roomId, requestId, token)
    res.json({ status: updated!.status })
  })

  // Reject
  router.post('/rooms/reject', (req, res) => {
    const { roomId, requestId, hostToken } = req.body
    if (!store.validateHost(roomId, hostToken)) {
      res.status(403).json({ error: 'Unauthorized' })
      return
    }
    const updated = store.rejectRequest(roomId, requestId)
    if (!updated) {
      res.status(404).json({ error: 'Request not found' })
      return
    }
    res.json({ status: updated.status })
  })

  // SSE events stream
  router.get('/rooms/:roomId/events', (req, res) => {
    const { roomId } = req.params
    const room = store.getRoom(roomId)
    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('\n')

    // Send all pending requests on connect (handles reconnect)
    const pending = store.getPendingRequests(roomId)
    for (const req of pending) {
      res.write(`data: ${JSON.stringify({ type: 'join-request', requestId: req.requestId, name: req.name })}\n\n`)
    }

    if (!sseClients.has(roomId)) {
      sseClients.set(roomId, new Set())
    }
    sseClients.get(roomId)!.add(res)

    req.on('close', () => {
      sseClients.get(roomId)?.delete(res)
    })
  })

  return router
}
```

- [ ] **Step 3: Wire routes into index.ts**

Modify `backend/src/index.ts`:

```typescript
import express from 'express'
import cors from 'cors'
import { createRouter } from './routes.js'
import { RoomStore } from './rooms.js'

const app = express()
app.use(cors())
app.use(express.json())

const store = new RoomStore()

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api', createRouter(store))

// TTL cleanup every 10 minutes
const TTL_MS = 6 * 60 * 60 * 1000
setInterval(() => store.cleanup(TTL_MS), 10 * 60 * 1000)

const PORT = parseInt(process.env.PORT || '3001', 10)
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`)
})

export { app }
```

- [ ] **Step 4: Run all tests**

```bash
cd backend && npm test
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes.ts backend/src/routes.test.ts backend/src/index.ts
git commit -m "feat(backend): add room API routes with SSE and waiting room"
```

---

## Chunk 3: Frontend — State Machine & UI

### Task 7: Install frontend dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install LiveKit + QR + Three.js dependencies**

```bash
cd frontend && npm install livekit-client @livekit/components-react qrcode.react three @pixiv/three-vrm @mediapipe/pose kalidokit @types/three
```

- [ ] **Step 2: Verify build still works**

```bash
cd frontend && npm run build
```

Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): add LiveKit, Three.js, MediaPipe dependencies"
```

---

### Task 8: App state machine + role selection

**Files:**
- Create: `frontend/src/state.ts`
- Rewrite: `frontend/src/App.tsx`
- Rewrite: `frontend/src/App.css`
- Create: `frontend/src/api.ts`
- Create: `frontend/src/components/RoleSelect.tsx`

- [ ] **Step 1: Create state types**

Create `frontend/src/state.ts`:

```typescript
export type AppState =
  | { screen: 'select-role' }
  | { screen: 'host-lobby'; roomId: string; hostToken: string; livekitToken: string }
  | { screen: 'host-session'; roomId: string; livekitToken: string }
  | { screen: 'student-join'; roomId: string }
  | { screen: 'student-waiting'; roomId: string; requestId: string; name: string }
  | { screen: 'student-session'; roomId: string; token: string; name: string }
  | { screen: 'student-rejected'; roomId: string }
  | { screen: 'error'; message: string }
```

- [ ] **Step 2: Create API client**

Create `frontend/src/api.ts`:

```typescript
const BASE = '/api'

export async function createRoom(): Promise<{ roomId: string; hostToken: string; livekitToken: string }> {
  const res = await fetch(`${BASE}/rooms/create`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to create room')
  return res.json()
}

export async function joinRequest(roomId: string, name: string): Promise<{ requestId: string }> {
  const res = await fetch(`${BASE}/rooms/join-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, name }),
  })
  if (!res.ok) throw new Error('Room not found')
  return res.json()
}

export async function getRequestStatus(roomId: string, requestId: string): Promise<{ status: string; token?: string }> {
  const res = await fetch(`${BASE}/rooms/${roomId}/request-status/${requestId}`)
  if (!res.ok) throw new Error('Request not found')
  return res.json()
}

export async function approveRequest(roomId: string, requestId: string, hostToken: string): Promise<void> {
  const res = await fetch(`${BASE}/rooms/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, requestId, hostToken }),
  })
  if (!res.ok) throw new Error('Failed to approve')
}

export async function rejectRequest(roomId: string, requestId: string, hostToken: string): Promise<void> {
  const res = await fetch(`${BASE}/rooms/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, requestId, hostToken }),
  })
  if (!res.ok) throw new Error('Failed to reject')
}

export function subscribeToRoomEvents(roomId: string, onEvent: (data: { type: string; requestId: string; name: string }) => void): () => void {
  const es = new EventSource(`${BASE}/rooms/${roomId}/events`)
  es.onmessage = (e) => {
    const data = JSON.parse(e.data)
    onEvent(data)
  }
  return () => es.close()
}
```

- [ ] **Step 3: Create RoleSelect component**

Create `frontend/src/components/RoleSelect.tsx`:

```tsx
interface Props {
  onHost: () => void
  onStudent: () => void
}

export function RoleSelect({ onHost, onStudent }: Props) {
  return (
    <div className="role-select">
      <h1>Live MR</h1>
      <p>選擇你的角色</p>
      <div className="role-buttons">
        <button className="role-btn host" onClick={onHost}>我是老師</button>
        <button className="role-btn student" onClick={onStudent}>我是學生</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rewrite App.tsx with state machine**

```tsx
import { useState, useEffect } from 'react'
import type { AppState } from './state'
import { createRoom } from './api'
import { RoleSelect } from './components/RoleSelect'
import './App.css'

function App() {
  const [state, setState] = useState<AppState>(() => {
    const params = new URLSearchParams(window.location.search)
    const roomId = params.get('roomId')
    if (roomId) return { screen: 'student-join', roomId }
    return { screen: 'select-role' }
  })

  async function handleHost() {
    try {
      const { roomId, hostToken, livekitToken } = await createRoom()
      setState({ screen: 'host-lobby', roomId, hostToken, livekitToken })
    } catch {
      setState({ screen: 'error', message: '無法建立房間' })
    }
  }

  function handleStudent() {
    const roomId = prompt('輸入房間 ID：')
    if (roomId) setState({ screen: 'student-join', roomId })
  }

  return (
    <div className="app">
      {state.screen === 'select-role' && (
        <RoleSelect onHost={handleHost} onStudent={handleStudent} />
      )}
      {state.screen === 'host-lobby' && (
        <div>Host Lobby: {state.roomId} (placeholder)</div>
      )}
      {state.screen === 'host-session' && (
        <div>Host Session (placeholder)</div>
      )}
      {state.screen === 'student-join' && (
        <div>Student Join for room {state.roomId} (placeholder)</div>
      )}
      {state.screen === 'student-waiting' && (
        <div>Waiting for approval... (placeholder)</div>
      )}
      {state.screen === 'student-session' && (
        <div>Student Session (placeholder)</div>
      )}
      {state.screen === 'student-rejected' && (
        <div>
          <p>申請被拒絕</p>
          <button onClick={() => setState({ screen: 'student-join', roomId: state.roomId })}>
            重新申請
          </button>
        </div>
      )}
      {state.screen === 'error' && (
        <div>
          <p>錯誤: {state.message}</p>
          <button onClick={() => setState({ screen: 'select-role' })}>返回</button>
        </div>
      )}
    </div>
  )
}

export default App
```

- [ ] **Step 5: Rewrite App.css (minimal)**

```css
.app {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: system-ui, sans-serif;
  background: #0a0a0a;
  color: #fff;
}

.role-select {
  text-align: center;
}

.role-buttons {
  display: flex;
  gap: 1rem;
  margin-top: 2rem;
}

.role-btn {
  padding: 1rem 2rem;
  font-size: 1.2rem;
  border: 2px solid #333;
  border-radius: 8px;
  background: #1a1a1a;
  color: #fff;
  cursor: pointer;
  transition: border-color 0.2s;
}

.role-btn:hover {
  border-color: #646cff;
}

.role-btn.host {
  border-color: #4caf50;
}

.role-btn.student {
  border-color: #2196f3;
}
```

- [ ] **Step 6: Verify build**

```bash
cd frontend && npm run build
```

Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): add state machine, API client, role selection"
```

---

### Task 9: Host lobby — QR Code + pending list + SSE

**Files:**
- Create: `frontend/src/components/HostLobby.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create HostLobby component**

Create `frontend/src/components/HostLobby.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { subscribeToRoomEvents, approveRequest, rejectRequest } from '../api'

interface PendingRequest {
  requestId: string
  name: string
}

interface Props {
  roomId: string
  hostToken: string
  livekitToken: string
  onStartSession: () => void
}

export function HostLobby({ roomId, hostToken, livekitToken, onStartSession }: Props) {
  const [pending, setPending] = useState<PendingRequest[]>([])
  const [approved, setApproved] = useState<string[]>([])

  const domain = import.meta.env.VITE_APP_DOMAIN || window.location.host
  const joinUrl = `${window.location.protocol}//${domain}/?roomId=${roomId}`

  useEffect(() => {
    const unsub = subscribeToRoomEvents(roomId, (data) => {
      if (data.type === 'join-request') {
        setPending(prev => {
          if (prev.some(p => p.requestId === data.requestId)) return prev
          return [...prev, { requestId: data.requestId, name: data.name }]
        })
      }
    })
    return unsub
  }, [roomId])

  async function handleApprove(requestId: string, name: string) {
    await approveRequest(roomId, requestId, hostToken)
    setPending(prev => prev.filter(p => p.requestId !== requestId))
    setApproved(prev => [...prev, name])
  }

  async function handleReject(requestId: string) {
    await rejectRequest(roomId, requestId, hostToken)
    setPending(prev => prev.filter(p => p.requestId !== requestId))
  }

  return (
    <div className="host-lobby">
      <h2>老師大廳</h2>
      <div className="qr-section">
        <QRCodeSVG value={joinUrl} size={200} bgColor="#1a1a1a" fgColor="#ffffff" />
        <p className="room-url">{joinUrl}</p>
        <p className="room-id">Room: {roomId.slice(0, 8)}...</p>
      </div>

      {pending.length > 0 && (
        <div className="pending-section">
          <h3>等待審核 ({pending.length})</h3>
          <ul className="pending-list">
            {pending.map(p => (
              <li key={p.requestId} className="pending-item">
                <span>{p.name}</span>
                <div className="pending-actions">
                  <button className="approve-btn" onClick={() => handleApprove(p.requestId, p.name)}>允許</button>
                  <button className="reject-btn" onClick={() => handleReject(p.requestId)}>拒絕</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {approved.length > 0 && (
        <div className="approved-section">
          <h3>已加入 ({approved.length})</h3>
          <ul>{approved.map((name, i) => <li key={i}>{name}</li>)}</ul>
        </div>
      )}

      <button className="start-btn" onClick={onStartSession} disabled={approved.length === 0}>
        開始課堂 ({approved.length} 位學生)
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Wire HostLobby into App.tsx**

In `App.tsx`, replace the host-lobby placeholder:

```tsx
// Add import at top
import { HostLobby } from './components/HostLobby'

// Replace the host-lobby block:
{state.screen === 'host-lobby' && (
  <HostLobby
    roomId={state.roomId}
    hostToken={state.hostToken}
    livekitToken={state.livekitToken}
    onStartSession={() =>
      setState({ screen: 'host-session', roomId: state.roomId, livekitToken: state.livekitToken })
    }
  />
)}
```

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): add HostLobby with QR Code, SSE, approve/reject"
```

---

### Task 10: Student join + waiting + rejected screens

**Files:**
- Create: `frontend/src/components/StudentJoin.tsx`
- Create: `frontend/src/components/StudentWaiting.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create StudentJoin component**

Create `frontend/src/components/StudentJoin.tsx`:

```tsx
import { useState } from 'react'
import { joinRequest } from '../api'

interface Props {
  roomId: string
  onSubmit: (requestId: string, name: string) => void
  onError: (message: string) => void
}

export function StudentJoin({ roomId, onSubmit, onError }: Props) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      const { requestId } = await joinRequest(roomId, name.trim())
      onSubmit(requestId, name.trim())
    } catch {
      onError('房間不存在或已關閉')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="student-join">
      <h2>加入課堂</h2>
      <p>房間: {roomId.slice(0, 8)}...</p>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="輸入你的名字"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          disabled={loading}
        />
        <button type="submit" disabled={!name.trim() || loading}>
          {loading ? '送出中...' : '送出申請'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Create StudentWaiting component**

Create `frontend/src/components/StudentWaiting.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { getRequestStatus } from '../api'

interface Props {
  roomId: string
  requestId: string
  name: string
  onApproved: (token: string) => void
  onRejected: () => void
  onError: (message: string) => void
}

export function StudentWaiting({ roomId, requestId, name, onApproved, onRejected, onError }: Props) {
  const elapsed = useRef(0)

  useEffect(() => {
    const interval = setInterval(async () => {
      elapsed.current += 2
      if (elapsed.current > 300) {
        clearInterval(interval)
        onError('等待超時，請重新申請')
        return
      }
      try {
        const res = await getRequestStatus(roomId, requestId)
        if (res.status === 'approved' && res.token) {
          clearInterval(interval)
          onApproved(res.token)
        } else if (res.status === 'rejected') {
          clearInterval(interval)
          onRejected()
        }
      } catch {
        // Network error, keep polling
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [roomId, requestId, onApproved, onRejected, onError])

  return (
    <div className="student-waiting">
      <h2>等待老師審核</h2>
      <p>{name}，請稍候...</p>
      <div className="spinner" />
    </div>
  )
}
```

- [ ] **Step 3: Wire into App.tsx**

Add imports and replace placeholders:

```tsx
import { StudentJoin } from './components/StudentJoin'
import { StudentWaiting } from './components/StudentWaiting'

// student-join
{state.screen === 'student-join' && (
  <StudentJoin
    roomId={state.roomId}
    onSubmit={(requestId, name) =>
      setState({ screen: 'student-waiting', roomId: state.roomId, requestId, name })
    }
    onError={(message) => setState({ screen: 'error', message })}
  />
)}

// student-waiting
{state.screen === 'student-waiting' && (
  <StudentWaiting
    roomId={state.roomId}
    requestId={state.requestId}
    name={state.name}
    onApproved={(token) =>
      setState({ screen: 'student-session', roomId: state.roomId, token, name: state.name })
    }
    onRejected={() => setState({ screen: 'student-rejected', roomId: state.roomId })}
    onError={(message) => setState({ screen: 'error', message })}
  />
)}
```

- [ ] **Step 4: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): add student join, waiting, and rejected screens"
```

---

## Chunk 4: LiveKit Integration

### Task 11: Host session — connect to LiveKit and display student tracks

**Files:**
- Create: `frontend/src/components/HostSession.tsx`
- Create: `frontend/src/components/StudentTile.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create StudentTile component**

Create `frontend/src/components/StudentTile.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import type { RemoteTrackPublication, RemoteParticipant } from 'livekit-client'
import { Track } from 'livekit-client'

interface Props {
  participant: RemoteParticipant
  onPoseData?: (data: unknown) => void
}

export function StudentTile({ participant, onPoseData }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const handleTrackSubscribed = (pub: RemoteTrackPublication) => {
      if (pub.track && pub.track.kind === Track.Kind.Video && videoRef.current) {
        pub.track.attach(videoRef.current)
      }
    }

    // Attach existing tracks
    for (const pub of participant.trackPublications.values()) {
      if (pub.track && pub.track.kind === Track.Kind.Video && videoRef.current) {
        pub.track.attach(videoRef.current)
      }
    }

    participant.on('trackSubscribed', handleTrackSubscribed as any)
    return () => {
      participant.off('trackSubscribed', handleTrackSubscribed as any)
    }
  }, [participant])

  return (
    <div className="student-tile">
      <video ref={videoRef} autoPlay muted playsInline />
      <div className="avatar-canvas-container">
        {/* Three.js canvas will be added in Task 14 */}
      </div>
      <span className="student-name">{participant.identity}</span>
    </div>
  )
}
```

- [ ] **Step 2: Create HostSession component**

Create `frontend/src/components/HostSession.tsx`:

```tsx
import { useEffect, useState, useRef } from 'react'
import { Room, RoomEvent } from 'livekit-client'
import type { RemoteParticipant } from 'livekit-client'
import { StudentTile } from './StudentTile'

interface Props {
  roomId: string
  livekitToken: string
  onError: (message: string) => void
}

export function HostSession({ roomId, livekitToken, onError }: Props) {
  const [participants, setParticipants] = useState<RemoteParticipant[]>([])
  const roomRef = useRef<Room | null>(null)

  useEffect(() => {
    const livekitUrl = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880'
    const room = new Room()
    roomRef.current = room

    function updateParticipants() {
      setParticipants(Array.from(room.remoteParticipants.values()))
    }

    room.on(RoomEvent.ParticipantConnected, updateParticipants)
    room.on(RoomEvent.ParticipantDisconnected, updateParticipants)
    room.on(RoomEvent.TrackSubscribed, updateParticipants)
    room.on(RoomEvent.Disconnected, () => onError('LiveKit 連線中斷'))

    room.connect(livekitUrl, livekitToken)
      .then(() => updateParticipants())
      .catch(() => onError('無法連上 LiveKit'))

    return () => {
      room.disconnect()
    }
  }, [livekitToken, onError])

  return (
    <div className="host-session">
      <h2>課堂進行中</h2>
      <p>{participants.length} 位學生連線中</p>
      <div className="student-grid">
        {participants.map(p => (
          <StudentTile key={p.identity} participant={p} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire into App.tsx**

```tsx
import { HostSession } from './components/HostSession'

// Replace host-session placeholder:
{state.screen === 'host-session' && (
  <HostSession
    roomId={state.roomId}
    livekitToken={state.livekitToken}
    onError={(message) => setState({ screen: 'error', message })}
  />
)}
```

- [ ] **Step 4: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): add HostSession with LiveKit connection and StudentTile"
```

---

### Task 12: Student session — publish webcam + data track

**Files:**
- Create: `frontend/src/components/StudentSession.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create StudentSession component**

Create `frontend/src/components/StudentSession.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, createLocalVideoTrack } from 'livekit-client'

interface Props {
  roomId: string
  token: string
  name: string
  onError: (message: string) => void
}

export function StudentSession({ roomId, token, name, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const roomRef = useRef<Room | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const livekitUrl = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880'
    const room = new Room()
    roomRef.current = room

    room.on(RoomEvent.Disconnected, () => onError('LiveKit 連線中斷'))

    async function connect() {
      try {
        await room.connect(livekitUrl, token)
        setConnected(true)

        // Publish webcam
        const videoTrack = await createLocalVideoTrack({ resolution: { width: 640, height: 480 } })
        await room.localParticipant.publishTrack(videoTrack)

        if (videoRef.current) {
          videoTrack.attach(videoRef.current)
        }
      } catch {
        onError('無法連上 LiveKit')
      }
    }

    connect()

    return () => {
      room.disconnect()
    }
  }, [token, onError])

  return (
    <div className="student-session">
      <h2>課堂中 — {name}</h2>
      <p>{connected ? '已連線' : '連線中...'}</p>
      <div className="self-view">
        <video ref={videoRef} autoPlay muted playsInline />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into App.tsx**

```tsx
import { StudentSession } from './components/StudentSession'

// Replace student-session placeholder:
{state.screen === 'student-session' && (
  <StudentSession
    roomId={state.roomId}
    token={state.token}
    name={state.name}
    onError={(message) => setState({ screen: 'error', message })}
  />
)}
```

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): add StudentSession with webcam publishing"
```

---

## Chunk 5: MediaPipe + Kalidokit + VRM Avatar

### Task 13: MediaPipe pose detection on student side

**Files:**
- Create: `frontend/src/hooks/usePoseDetection.ts`
- Modify: `frontend/src/components/StudentSession.tsx`

- [ ] **Step 1: Create usePoseDetection hook**

Create `frontend/src/hooks/usePoseDetection.ts`:

```typescript
import { useEffect, useRef, useCallback } from 'react'
import { Pose } from '@mediapipe/pose'
import type { Results } from '@mediapipe/pose'

interface PoseFrame {
  participantId: string
  timestamp: number
  pose: {
    landmarks: Array<{ x: number; y: number; z: number; visibility: number }>
  }
}

export function usePoseDetection(
  videoElement: HTMLVideoElement | null,
  participantId: string,
  onFrame: (frame: PoseFrame) => void,
) {
  const poseRef = useRef<Pose | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!videoElement) return

    const pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    })

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })

    pose.onResults((results: Results) => {
      if (results.poseLandmarks) {
        onFrame({
          participantId,
          timestamp: Date.now(),
          pose: {
            landmarks: results.poseLandmarks.map(lm => ({
              x: lm.x,
              y: lm.y,
              z: lm.z,
              visibility: lm.visibility ?? 0,
            })),
          },
        })
      }
    })

    poseRef.current = pose

    async function detect() {
      if (videoElement.readyState >= 2 && poseRef.current) {
        await poseRef.current.send({ image: videoElement })
      }
      rafRef.current = requestAnimationFrame(detect)
    }

    detect()

    return () => {
      cancelAnimationFrame(rafRef.current)
      poseRef.current?.close()
    }
  }, [videoElement, participantId, onFrame])
}
```

- [ ] **Step 2: Integrate into StudentSession**

Add to `StudentSession.tsx` — after webcam is publishing, start pose detection and send data via LiveKit:

```tsx
// Add imports
import { usePoseDetection } from '../hooks/usePoseDetection'
import { DataPacket_Kind } from 'livekit-client'

// Inside StudentSession component, add after useState:
const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)

const handlePoseFrame = useCallback((frame: any) => {
  if (!roomRef.current?.localParticipant) return
  const data = new TextEncoder().encode(JSON.stringify(frame))
  roomRef.current.localParticipant.publishData(data, { reliable: false })
}, [])

usePoseDetection(videoEl, name, handlePoseFrame)

// Update the video ref callback:
// Change: <video ref={videoRef}
// To: <video ref={(el) => { videoRef.current = el; setVideoEl(el) }}
```

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): add MediaPipe pose detection with LiveKit data channel"
```

---

### Task 14: VRM Avatar renderer

**Files:**
- Create: `frontend/src/hooks/useVrmAvatar.ts`
- Modify: `frontend/src/components/StudentTile.tsx`

- [ ] **Step 1: Create useVrmAvatar hook**

Create `frontend/src/hooks/useVrmAvatar.ts`:

```typescript
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm'

export function useVrmAvatar(canvas: HTMLCanvasElement | null) {
  const vrmRef = useRef<VRM | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)

  useEffect(() => {
    if (!canvas) return

    // Setup Three.js
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true })
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 20)
    camera.position.set(0, 1.3, 2)
    camera.lookAt(0, 1, 0)
    cameraRef.current = camera

    // Lighting
    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(1, 1, 1)
    scene.add(light)
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))

    // Load VRM
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.load('/avatar.vrm', (gltf) => {
      const vrm = gltf.userData.vrm as VRM
      scene.add(vrm.scene)
      vrmRef.current = vrm
    })

    // Render loop
    let rafId: number
    function animate() {
      rafId = requestAnimationFrame(animate)
      if (vrmRef.current) {
        vrmRef.current.update(1 / 60)
      }
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      renderer.dispose()
    }
  }, [canvas])

  // Apply pose data
  function applyPose(landmarks: Array<{ x: number; y: number; z: number; visibility: number }>) {
    if (!vrmRef.current) return

    try {
      // Use Kalidokit to solve pose
      const { Pose: KPose } = await import('kalidokit')
      const poseRig = KPose.solve(landmarks)
      if (!poseRig) return

      const vrm = vrmRef.current

      // Apply hip rotation
      if (poseRig.Hips) {
        const hips = vrm.humanoid?.getNormalizedBoneNode('hips')
        if (hips && poseRig.Hips.rotation) {
          hips.rotation.set(
            poseRig.Hips.rotation.x,
            poseRig.Hips.rotation.y,
            poseRig.Hips.rotation.z,
          )
        }
      }

      // Apply spine
      if (poseRig.Spine) {
        const spine = vrm.humanoid?.getNormalizedBoneNode('spine')
        if (spine) {
          spine.rotation.set(poseRig.Spine.x, poseRig.Spine.y, poseRig.Spine.z)
        }
      }

      // Apply left/right upper arms
      const armMap: Record<string, string> = {
        RightUpperArm: 'rightUpperArm',
        RightLowerArm: 'rightLowerArm',
        LeftUpperArm: 'leftUpperArm',
        LeftLowerArm: 'leftLowerArm',
      }
      for (const [kKey, vrmBone] of Object.entries(armMap)) {
        if (poseRig[kKey]) {
          const bone = vrm.humanoid?.getNormalizedBoneNode(vrmBone as any)
          if (bone) {
            bone.rotation.set(poseRig[kKey].x, poseRig[kKey].y, poseRig[kKey].z)
          }
        }
      }
    } catch {
      // Kalidokit may fail on some frames
    }
  }

  return { applyPose }
}
```

- [ ] **Step 2: Update StudentTile to receive pose data and render avatar**

Modify `frontend/src/components/StudentTile.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { RemoteParticipant } from 'livekit-client'
import { Track } from 'livekit-client'
import { useVrmAvatar } from '../hooks/useVrmAvatar'

interface Props {
  participant: RemoteParticipant
  poseData?: { pose: { landmarks: Array<{ x: number; y: number; z: number; visibility: number }> } }
}

export function StudentTile({ participant, poseData }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
  const { applyPose } = useVrmAvatar(canvasEl)

  // Attach video tracks
  useEffect(() => {
    for (const pub of participant.trackPublications.values()) {
      if (pub.track && pub.track.kind === Track.Kind.Video && videoRef.current) {
        pub.track.attach(videoRef.current)
      }
    }

    const handleTrackSubscribed = (track: any) => {
      if (track.kind === Track.Kind.Video && videoRef.current) {
        track.attach(videoRef.current)
      }
    }

    participant.on('trackSubscribed', handleTrackSubscribed)
    return () => {
      participant.off('trackSubscribed', handleTrackSubscribed)
    }
  }, [participant])

  // Apply pose data from HostSession (received via Room DataReceived event)
  useEffect(() => {
    if (poseData?.pose?.landmarks) {
      applyPose(poseData.pose.landmarks)
    }
  }, [poseData, applyPose])

  return (
    <div className="student-tile">
      <video ref={videoRef} autoPlay muted playsInline />
      <canvas
        ref={setCanvasEl}
        className="avatar-canvas"
        width={320}
        height={240}
      />
      <span className="student-name">{participant.identity}</span>
    </div>
  )
}
```

- [ ] **Step 3: Handle data events in HostSession**

In `HostSession.tsx`, add data event handling to forward pose data to the correct tile:

```tsx
// Add a poseData state map
const [poseDataMap, setPoseDataMap] = useState<Record<string, any>>({})

// In the room setup useEffect, add:
room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
  if (!participant) return
  try {
    const frame = JSON.parse(new TextDecoder().decode(payload))
    setPoseDataMap(prev => ({ ...prev, [participant.identity]: frame }))
  } catch { /* ignore */ }
})

// Pass poseData to StudentTile:
<StudentTile
  key={p.identity}
  participant={p}
  poseData={poseDataMap[p.identity]}
/>
```

Update `StudentTile` props to accept optional `poseData` and call `applyPose` when it changes:

```tsx
interface Props {
  participant: RemoteParticipant
  poseData?: { pose: { landmarks: Array<{ x: number; y: number; z: number; visibility: number }> } }
}

// Add useEffect to apply pose:
useEffect(() => {
  if (poseData?.pose?.landmarks) {
    applyPose(poseData.pose.landmarks)
  }
}, [poseData, applyPose])
```

- [ ] **Step 4: Add avatar.vrm placeholder**

```bash
# Create placeholder — replace with actual VRM file before testing
touch frontend/public/avatar.vrm
echo "Download a VRM model file and place it at frontend/public/avatar.vrm"
```

> **Note:** Download a free VRM model (e.g., from VRoid Hub or https://hub.vroid.com/) and save it as `frontend/public/avatar.vrm` before testing the avatar feature.

- [ ] **Step 5: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/ frontend/public/
git commit -m "feat(frontend): add VRM Avatar rendering with Kalidokit pose mapping"
```

---

### Task 15: Add CSS for session layouts

**Files:**
- Modify: `frontend/src/App.css`

- [ ] **Step 1: Append session styles to App.css**

```css
/* Host Lobby */
.host-lobby { text-align: center; max-width: 600px; }
.qr-section { margin: 2rem 0; }
.room-url { font-size: 0.8rem; color: #888; word-break: break-all; margin-top: 0.5rem; }
.room-id { font-size: 0.9rem; color: #aaa; }
.pending-section { margin: 2rem 0; text-align: left; }
.pending-list { list-style: none; padding: 0; }
.pending-item { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; border: 1px solid #333; border-radius: 4px; margin-bottom: 0.5rem; }
.pending-actions { display: flex; gap: 0.5rem; }
.approve-btn { background: #4caf50; color: #fff; border: none; padding: 0.3rem 0.8rem; border-radius: 4px; cursor: pointer; }
.reject-btn { background: #f44336; color: #fff; border: none; padding: 0.3rem 0.8rem; border-radius: 4px; cursor: pointer; }
.approved-section { margin: 1rem 0; text-align: left; }
.start-btn { margin-top: 2rem; padding: 0.8rem 2rem; font-size: 1.1rem; background: #4caf50; color: #fff; border: none; border-radius: 8px; cursor: pointer; }
.start-btn:disabled { background: #333; cursor: not-allowed; }

/* Student Join */
.student-join { text-align: center; }
.student-join input { padding: 0.6rem 1rem; font-size: 1rem; border: 1px solid #333; border-radius: 4px; background: #1a1a1a; color: #fff; margin-right: 0.5rem; }
.student-join button { padding: 0.6rem 1rem; font-size: 1rem; background: #2196f3; color: #fff; border: none; border-radius: 4px; cursor: pointer; }

/* Student Waiting */
.student-waiting { text-align: center; }
.spinner { width: 40px; height: 40px; border: 4px solid #333; border-top-color: #2196f3; border-radius: 50%; animation: spin 1s linear infinite; margin: 2rem auto; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Host Session */
.host-session { width: 100%; padding: 1rem; }
.student-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; margin-top: 1rem; }

/* Student Tile */
.student-tile { position: relative; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
.student-tile video { width: 100%; display: block; }
.avatar-canvas { position: absolute; top: 0; right: 0; width: 160px; height: 120px; pointer-events: none; }
.student-name { position: absolute; bottom: 8px; left: 8px; background: rgba(0,0,0,0.7); padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; }

/* Student Session */
.student-session { text-align: center; }
.self-view { max-width: 640px; margin: 1rem auto; }
.self-view video { width: 100%; border-radius: 8px; }
```

- [ ] **Step 2: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.css
git commit -m "style: add CSS for all session screens and grid layout"
```

---

### Task 16: End-to-end Docker verification

- [ ] **Step 1: Rebuild and start all services**

```bash
docker compose build && docker compose up -d
```

- [ ] **Step 2: Verify frontend loads**

Open `http://localhost` in browser. Should see role selection screen.

- [ ] **Step 3: Verify host flow**

1. Click "我是老師"
2. Should see QR Code and room URL
3. Open the room URL in a second tab (simulating student)
4. Enter name, submit
5. Back in host tab, see the pending request
6. Click "允許"

- [ ] **Step 4: Verify student connects**

After approval, the student tab should show webcam. The host tab should show the student's webcam tile.

- [ ] **Step 5: Commit final cleanup**

```bash
git add -A
git commit -m "chore: final Docker Compose integration verification"
```
