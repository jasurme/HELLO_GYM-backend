const { app, request, SEED, PASSWORD, loginAs, uniqueEmail } = require('./helpers');

describe('authentication', () => {
  test('a visitor can register as a member and is logged in', async () => {
    const agent = request.agent(app);
    const email = uniqueEmail('signup');
    const res = await agent.post('/api/auth/register').send({
      email, password: 'Strong123', firstName: 'New', lastName: 'Member', phone: '010-1111-2222',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email, role: 'member', firstName: 'New' });
    expect(res.body.member.joinedOn).toBeTruthy();
    expect(res.body).not.toHaveProperty('passwordHash');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  test('registration validates fields and rejects duplicate emails', async () => {
    const weak = await request(app).post('/api/auth/register').send({
      email: uniqueEmail(), password: 'short', firstName: 'A', lastName: 'B',
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error.fields).toHaveProperty('password');

    const badEmail = await request(app).post('/api/auth/register').send({
      email: 'not-an-email', password: 'Strong123', firstName: 'A', lastName: 'B',
    });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error.fields).toHaveProperty('email');

    const dup = await request(app).post('/api/auth/register').send({
      email: SEED.minji, password: 'Strong123', firstName: 'A', lastName: 'B',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/already exists/);
  });

  test('login checks the password and returns the role', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: SEED.admin, password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@binaryfit.test', password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message); // no account enumeration

    const ok = await request(app).post('/api/auth/login').send({ email: SEED.trainer, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe('trainer');
    expect(ok.headers['set-cookie'][0]).toMatch(/gym\.sid=.*HttpOnly.*SameSite=Lax/i);
  });

  test('logout ends the session', async () => {
    const agent = await loginAs(SEED.minji);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  test('a deactivated account cannot log in, and is logged out at once', async () => {
    const admin = await loginAs(SEED.admin);
    const email = uniqueEmail('leaver');
    const created = await admin.post('/api/admin/members').send({ email, password: PASSWORD, firstName: 'Leaving', lastName: 'Soon' });
    const member = await loginAs(email);

    await admin.patch(`/api/admin/members/${created.body.userId}`).send({ isActive: false });
    expect((await member.get('/api/member/overview')).status).toBe(401);
    const again = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(again.status).toBe(403);
  });

  test('members can update their profile and change their password', async () => {
    const email = uniqueEmail('profile');
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email, password: 'First1234', firstName: 'Pro', lastName: 'File' });

    const patched = await agent.patch('/api/auth/me').send({ phone: '010-3333-4444', emergencyContactName: 'Mom' });
    expect(patched.status).toBe(200);
    expect(patched.body.phone).toBe('010-3333-4444');
    expect(patched.body.member.emergencyContactName).toBe('Mom');

    expect((await agent.post('/api/auth/password').send({ currentPassword: 'nope', newPassword: 'Second1234' })).status).toBe(400);
    expect((await agent.post('/api/auth/password').send({ currentPassword: 'First1234', newPassword: 'Second1234' })).status).toBe(204);
    expect((await request(app).post('/api/auth/login').send({ email, password: 'Second1234' })).status).toBe(200);
  });

  test('state-changing requests must be JSON (CSRF defence)', async () => {
    const agent = await loginAs(SEED.minji);
    const res = await agent.post('/api/member/bookings').type('form').send('trainerId=3&startsAt=2030-01-01 10:00');
    expect(res.status).toBe(415);
  });
});
