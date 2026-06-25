import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockDbModule, seedAdminUser, getCurrentPool } from './testDb.js';

let app: import('express').Express;

async function authenticatedAgent(): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username: 'admin', password: 'admin' });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status}`);
  }
  return agent;
}

beforeAll(async () => {
  await mockDbModule();
  await seedAdminUser('admin', 'admin');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ({ app } = await import('../index.js'));
});

beforeEach(async () => {
  // Wipe configs between tests so name-uniqueness assertions are predictable
  const pool = getCurrentPool();
  if (pool) {
    try {
      await pool.query(`DELETE FROM map_admin.config_versions`);
    } catch {
      /* ignore */
    }
    try {
      await pool.query(`DELETE FROM map_admin.map_configs`);
    } catch {
      /* ignore */
    }
  }
});

describe('GET /api/configs', () => {
  it('returns an array (empty by default)', async () => {
    const res = await request(app).get('/api/configs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns previously-created configs', async () => {
    const agent = await authenticatedAgent();
    await agent.post('/api/configs').send({ name: 'my-map', description: 'demo' });
    const res = await agent.get('/api/configs');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const names = res.body.map((r: { name: string }) => r.name);
    expect(names).toContain('my-map');
  });
});

describe('POST /api/configs', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/configs').send({ name: 'unauthed' });
    expect(res.status).toBe(401);
  });

  it('creates a config when authenticated', async () => {
    const agent = await authenticatedAgent();
    const res = await agent.post('/api/configs').send({ name: 'fresh', description: 'd' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('fresh');
    expect(res.body.description).toBe('d');
    expect(res.body.is_published).toBe(false);
  });

  it('lowercases the name before persisting', async () => {
    const agent = await authenticatedAgent();
    const res = await agent.post('/api/configs').send({ name: 'MixedCase' });
    // Validation rejects after lowercase only if there are bad chars; pure
    // letters lowercase cleanly to "mixedcase".
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('mixedcase');
  });

  it('rejects an invalid slug name', async () => {
    const agent = await authenticatedAgent();
    const res = await agent.post('/api/configs').send({ name: 'has spaces' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('rejects reserved names', async () => {
    const agent = await authenticatedAgent();
    const res = await agent.post('/api/configs').send({ name: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reserved/);
  });

  it('rejects missing name', async () => {
    const agent = await authenticatedAgent();
    const res = await agent.post('/api/configs').send({ description: 'no name' });
    expect(res.status).toBe(400);
  });

  it('rejects a structurally invalid map config', async () => {
    const agent = await authenticatedAgent();
    const res = await agent
      .post('/api/configs')
      .send({ name: 'bad-config', config: { not: 'a real config' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid config');
    expect(Array.isArray(res.body.details)).toBe(true);
  });
});

describe('GET /api/configs/:id', () => {
  it('returns 404 for an unknown UUID', async () => {
    const res = await request(app).get('/api/configs/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  it('sets Cache-Control: no-store on the UUID-lookup branch', async () => {
    const agent = await authenticatedAgent();
    const created = await agent.post('/api/configs').send({ name: 'cache-uuid' });
    const id = created.body.id;
    const res = await agent.get(`/api/configs/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sets Cache-Control: no-store on the published-name branch', async () => {
    const agent = await authenticatedAgent();
    const created = await agent.post('/api/configs').send({ name: 'cache-name' });
    await agent.post(`/api/configs/${created.body.id}/publish`);
    const res = await request(app).get('/api/configs/cache-name');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('DELETE /api/configs/:id', () => {
  it('requires authentication', async () => {
    const res = await request(app).delete('/api/configs/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(401);
  });

  it('returns 404 when the config does not exist', async () => {
    const agent = await authenticatedAgent();
    const res = await agent.delete('/api/configs/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  it('deletes a config and returns its id', async () => {
    const agent = await authenticatedAgent();
    const created = await agent.post('/api/configs').send({ name: 'to-delete' });
    const id = created.body.id;
    const res = await agent.delete(`/api/configs/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(id);
  });
});

describe('POST /api/configs/:id/publish', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/configs/00000000-0000-4000-8000-000000000000/publish');
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown id', async () => {
    const agent = await authenticatedAgent();
    const res = await agent.post('/api/configs/00000000-0000-4000-8000-000000000000/publish');
    expect(res.status).toBe(404);
  });

  it('publishes an existing config', async () => {
    const agent = await authenticatedAgent();
    const created = await agent.post('/api/configs').send({ name: 'pubme' });
    const id = created.body.id;
    const res = await agent.post(`/api/configs/${id}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.is_published).toBe(true);
  });

  it('returns 409 when another config with the same name is already published', async () => {
    const agent = await authenticatedAgent();
    const a = await agent.post('/api/configs').send({ name: 'duplicate' });
    const b = await agent.post('/api/configs').send({ name: 'duplicate' });
    const pubA = await agent.post(`/api/configs/${a.body.id}/publish`);
    expect(pubA.status).toBe(200);
    const pubB = await agent.post(`/api/configs/${b.body.id}/publish`);
    expect(pubB.status).toBe(409);
    expect(pubB.body.error).toMatch(/already exists/);
  });
});

describe('POST /api/configs/:id/unpublish', () => {
  it('returns 404 for an unknown id', async () => {
    const agent = await authenticatedAgent();
    const res = await agent.post('/api/configs/00000000-0000-4000-8000-000000000000/unpublish');
    expect(res.status).toBe(404);
  });

  it('unpublishes a published config', async () => {
    const agent = await authenticatedAgent();
    const created = await agent.post('/api/configs').send({ name: 'unpub-me' });
    await agent.post(`/api/configs/${created.body.id}/publish`);
    const res = await agent.post(`/api/configs/${created.body.id}/unpublish`);
    expect(res.status).toBe(200);
    expect(res.body.is_published).toBe(false);
  });
});

describe('PUT /api/configs/:id', () => {
  it('requires authentication', async () => {
    const res = await request(app)
      .put('/api/configs/00000000-0000-4000-8000-000000000000')
      .send({ description: 'x' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown id', async () => {
    const agent = await authenticatedAgent();
    const res = await agent
      .put('/api/configs/00000000-0000-4000-8000-000000000000')
      .send({ description: 'x' });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid name', async () => {
    const agent = await authenticatedAgent();
    const created = await agent.post('/api/configs').send({ name: 'updatable' });
    const res = await agent.put(`/api/configs/${created.body.id}`).send({ name: 'has spaces' });
    expect(res.status).toBe(400);
  });
});
