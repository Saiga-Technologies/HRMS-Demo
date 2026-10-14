import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import request from 'supertest';

// Each test file gets a fresh database directory.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-test-'));
process.env.HRMS_DATA_DIR = dir;
process.env.HRMS_DB_FILE = path.join(dir, 'test.sqlite');

const { createApp } = await import('../src/app.js');
const { seedIfEmpty, DEMO_PASSWORD, sampleFile } = await import('../src/seed.js');
const { closeDb } = await import('../src/db.js');

seedIfEmpty();
export const app = createApp();
export const PASSWORD = DEMO_PASSWORD;
export { sampleFile };

export async function login(email: string, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${res.text}`);
  return res.body.token as string;
}
export const hr = () => login('hr@acme.example');
export const manager = () => login('manager@acme.example');
export const employee = () => login('employee@acme.example');

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}
export function cleanup() {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
}
export { request };
