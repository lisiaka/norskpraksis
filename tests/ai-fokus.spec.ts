import { test, expect } from '@playwright/test';

// Prompt-construction test for feature 012 (Teacher AI Steering), Acceptance
// Criterion #1: verify a teacher's saved AI-fokus instructions end up in the
// system prompt sent to Claude for that student. Per spec.md's Clarifications,
// this asserts on the *request* built by the client — never on Claude's actual
// output content, which is inherently non-deterministic.
//
// The app's API_BASE always points at a Railway backend (staging for any
// non-production hostname), which enforces CORS restricted to the deployed
// frontend origins — a local dev server can never call it directly. This test
// redirects those calls to a local FastAPI instance (`ENVIRONMENT=development`
// allows CORS from anywhere) so it can exercise the real backend, including
// the real GET /api/me/ai-context endpoint, end to end. Only the Claude call
// itself (/api/proxy/claude) is mocked, since we don't want a live LLM call
// gating a deterministic test.

const LOCAL_BACKEND = 'http://localhost:8000';
const RUN_ID = Date.now();
const TEACHER_EMAIL = `aifokus_teacher_${RUN_ID}@example.com`;
const STUDENT_EMAIL = `aifokus_student_${RUN_ID}@example.com`;
const PASSWORD = 'passord123';
const FIXED_INSTRUCTIONS = `TEST-INSTRUKSJON-${RUN_ID}: fokuser på substantivbøying`;

let studentToken = '';
let studentId = '';

test.beforeAll(async ({ request }) => {
  const teacherReg = await request.post(`${LOCAL_BACKEND}/auth/register`, {
    data: { name: 'AI-fokus Lærer', email: TEACHER_EMAIL, password: PASSWORD, role: 'teacher' },
  });
  const teacher = await teacherReg.json();

  const studentReg = await request.post(`${LOCAL_BACKEND}/auth/register`, {
    data: { name: 'AI-fokus Elev', email: STUDENT_EMAIL, password: PASSWORD },
  });
  const student = await studentReg.json();
  studentToken = student.token;
  studentId = student.user.id;

  // Teacher adds the student to their roster.
  await request.post(`${LOCAL_BACKEND}/api/teacher/students`, {
    headers: { Authorization: `Bearer ${teacher.token}` },
    data: { student_email: STUDENT_EMAIL },
  });

  // Teacher saves AI-fokus instructions for that student — this is the write
  // path the test verifies gets read back into the student's Claude prompt.
  await request.put(`${LOCAL_BACKEND}/api/teacher/students/${student.user.id}/ai-instructions`, {
    headers: { Authorization: `Bearer ${teacher.token}` },
    data: { instructions: FIXED_INSTRUCTIONS },
  });
});

test('teacher AI-fokus instructions appear in the Claude system prompt', async ({ page }) => {
  // Redirect all Railway backend calls to the local backend (real CORS, real DB).
  // route.continue({url}) can't cross http/https, so fetch locally and fulfill instead.
  await page.route('**://norskb2-backend-staging.up.railway.app/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const res = await fetch(`${LOCAL_BACKEND}${url.pathname}${url.search}`, {
      method: req.method(),
      headers: req.headers(),
      body: ['GET', 'HEAD'].includes(req.method()) ? undefined : (req.postData() ?? undefined),
    });
    const body = await res.arrayBuffer();
    await route.fulfill({
      status: res.status,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': res.headers.get('content-type') || 'application/json' },
      body: Buffer.from(body),
    });
  });

  // Mock the Claude call itself — capture what the frontend actually sent.
  let capturedBody: any = null;
  await page.route('**/api/proxy/claude', (route) => {
    capturedBody = route.request().postDataJSON();
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: '{}' }] }),
    });
  });

  // Pre-authenticate as the student (skips the CORS-blocked login form flow —
  // the token was already obtained server-side in beforeAll).
  await page.addInitScript(
    ({ token, id }) => {
      localStorage.setItem('b2_session_token', token);
      localStorage.setItem('b2_user_id', id);
    },
    { token: studentToken, id: studentId }
  );

  await page.goto('/norsk_b2_pro.html');
  await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });

  // Add a word so Setninger has something to write a sentence about.
  await page.locator('button.tab-btn', { hasText: 'Ordbank' }).click();
  const word = `testord_${RUN_ID}`;
  await page.fill('#fi-word', word);
  await page.fill('#fi-meaning', 'testbetydning');
  await page.locator('button.btn-add').click();
  await expect(page.locator('#word-list')).toContainText(word, { timeout: 5000 });

  await page.locator('button.tab-btn', { hasText: 'Setninger' }).click();
  await page.fill('#sent-ta', `Dette er en test med ${word}.`);
  await page.locator('button.btn-sec', { hasText: 'Sjekk med Claude' }).click();

  await expect.poll(() => capturedBody?.system, { timeout: 10000 }).toContain(FIXED_INSTRUCTIONS);
});
