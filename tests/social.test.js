const {
  app, request, SEED, loginAs, uniqueUsername, memberWithPlan,
} = require('./helpers');
const { sequelize } = require('../src/models');

const usernameOf = async (userId) => (await sequelize.query(
  'SELECT username FROM users WHERE user_id = ?', { replacements: [userId], type: 'SELECT' },
))[0].username;

describe('usernames', () => {
  test('the live check says taken / free / invalid and suggests alternatives', async () => {
    const taken = await request(app).get('/api/auth/username').query({ username: 'minji.kim' });
    expect(taken.body).toMatchObject({ valid: true, available: false, reason: 'That username is taken' });
    expect(taken.body.suggestions.length).toBeGreaterThan(0);
    for (const s of taken.body.suggestions) {
      const again = await request(app).get('/api/auth/username').query({ username: s });
      expect(again.body.available).toBe(true);
    }

    const free = await request(app).get('/api/auth/username').query({ username: '@Fresh.Name42' });
    expect(free.body).toMatchObject({ username: 'fresh.name42', available: true });

    for (const [bad, why] of [['ab', /at least 3/], ['bad name', /Only letters/], ['.dot', /Start and end/], ['a..b', /two periods/], ['admin', /reserved/]]) {
      const res = await request(app).get('/api/auth/username').query({ username: bad });
      expect(res.body.available).toBe(false);
      expect(res.body.reason).toMatch(why);
    }
  });

  test('sign-up refuses a taken username; you can log in with @username', async () => {
    const admin = await loginAs(SEED.admin);
    const m = await memberWithPlan(admin);
    const handle = await usernameOf(m.memberId);
    expect(handle).toMatch(/^test\.member\d*$/);   // generated first.last for desk sign-ups

    const res = await request(app).post('/api/auth/register/check').send({
      email: `x.${Date.now()}@binaryfit.test`, username: handle, password: 'Strong123', firstName: 'X', lastName: 'Y',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.fields).toHaveProperty('username');

    const byHandle = await request(app).post('/api/auth/login').send({ email: `@${handle}`, password: 'Gym12345!' });
    expect(byHandle.status).toBe(200);
    expect(byHandle.body.username).toBe(handle);
  });

  test('members change their username and bio; names stay unique', async () => {
    const admin = await loginAs(SEED.admin);
    const m = await memberWithPlan(admin);
    const taken = await m.agent.patch('/api/auth/me').send({ username: 'daniel.park' });
    expect(taken.status).toBe(409);
    const handle = uniqueUsername('renamed');
    const ok = await m.agent.patch('/api/auth/me').send({ username: handle.toUpperCase(), socialBio: 'Squats daily' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ username: handle, socialBio: 'Squats daily' });
  });
});

describe('social area', () => {
  let admin;
  beforeAll(async () => { admin = await loginAs(SEED.admin); });

  test('only members and trainers get in (R7 + R13)', async () => {
    expect((await request(app).get('/api/social/feed')).status).toBe(401);
    expect((await admin.get('/api/social/feed')).status).toBe(403);
    expect((await (await loginAs(SEED.trainer)).get('/api/social/feed')).status).toBe(200);
    const page = await admin.get('/social/');
    expect(page.status).toBe(302);
  });

  test('posts: hashtags are stored, limits checked, only the author deletes', async () => {
    const a = await memberWithPlan(admin);
    const b = await memberWithPlan(admin);
    const tag = `t${Date.now().toString(36)}`;
    const post = await a.agent.post('/api/social/posts').send({ body: `Leg day done #${tag} #LegDay` });
    expect(post.status).toBe(201);
    expect(post.body).toMatchObject({ likes: 0, comments: 0, likedByMe: false });
    const [rows] = await sequelize.query(
      'SELECT h.name FROM post_hashtags ph JOIN hashtags h ON h.tag_id = ph.tag_id WHERE ph.post_id = ? ORDER BY h.name',
      { replacements: [post.body.postId] },
    );
    expect(rows.map((r) => r.name)).toEqual(['legday', tag].sort());
    const byTag = await b.agent.get(`/api/social/tags/${tag}`);
    expect(byTag.body.map((p) => p.postId)).toEqual([post.body.postId]);

    expect((await a.agent.post('/api/social/posts').send({ body: '   ' })).status).toBe(400);
    expect((await a.agent.post('/api/social/posts').send({ body: 'x'.repeat(281) })).status).toBe(400);
    expect((await b.agent.delete(`/api/social/posts/${post.body.postId}`)).status).toBe(403);
    expect((await a.agent.delete(`/api/social/posts/${post.body.postId}`)).status).toBe(204);
  });

  test('likes are one per person; replies can be added and removed', async () => {
    const a = await memberWithPlan(admin);
    const b = await memberWithPlan(admin);
    const post = await a.agent.post('/api/social/posts').send({ body: 'First session done!' });
    const id = post.body.postId;
    expect((await b.agent.post(`/api/social/posts/${id}/like`)).body).toEqual({ likes: 1, likedByMe: true });
    expect((await b.agent.post(`/api/social/posts/${id}/like`)).body).toEqual({ likes: 1, likedByMe: true });
    expect((await b.agent.delete(`/api/social/posts/${id}/like`)).body).toEqual({ likes: 0, likedByMe: false });

    const replied = await b.agent.post(`/api/social/posts/${id}/comments`).send({ body: 'Congrats!' });
    expect(replied.status).toBe(201);
    expect(replied.body).toHaveLength(1);
    expect((await a.agent.delete(`/api/social/comments/${replied.body[0].commentId}`)).status).toBe(403);
    expect((await b.agent.delete(`/api/social/comments/${replied.body[0].commentId}`)).body).toEqual([]);
  });

  test('follow and unfollow; you cannot follow yourself', async () => {
    const a = await memberWithPlan(admin);
    const b = await memberWithPlan(admin);
    const aName = await usernameOf(a.memberId);
    const bName = await usernameOf(b.memberId);

    const self = await a.agent.post(`/api/social/users/${aName}/follow`);
    expect(self.status).toBe(400);
    expect(self.body.error.message).toMatch(/cannot follow yourself/);

    expect((await a.agent.post(`/api/social/users/${bName}/follow`)).body).toEqual({ following: true, followers: 1 });
    const profile = await b.agent.get(`/api/social/users/${bName}`);
    expect(profile.body.stats.followers).toBe(1);
    const fromB = await b.agent.get(`/api/social/users/${aName}`);
    expect(fromB.body).toMatchObject({ followsYou: true, following: false });
    const suggestions = await b.agent.get('/api/social/suggestions');
    expect(suggestions.body.find((p) => p.username === aName)).toMatchObject({ reason: 'Follows you' });

    expect((await a.agent.delete(`/api/social/users/${bName}/follow`)).body).toEqual({ following: false, followers: 0 });
  });

  test('search finds people by @username prefix and by name', async () => {
    const a = await memberWithPlan(admin);
    const res = await a.agent.get('/api/social/search').query({ q: '@daniel' });
    expect(res.body[0]).toMatchObject({ username: 'daniel.park', role: 'trainer' });
    const byName = await a.agent.get('/api/social/search').query({ q: 'Park' });
    expect(byName.body.some((p) => p.username === 'daniel.park')).toBe(true);
  });

  test('feed: people you follow first, then suggestions without them, you, or what you liked', async () => {
    const reader = await memberWithPlan(admin);
    const friend = await memberWithPlan(admin);
    const friendName = await usernameOf(friend.memberId);
    const post = await friend.agent.post('/api/social/posts').send({ body: 'Friends-only test post' });
    await reader.agent.post(`/api/social/users/${friendName}/follow`);
    const own = await reader.agent.post('/api/social/posts').send({ body: 'My own post' });

    const feed = await reader.agent.get('/api/social/feed');
    expect(feed.status).toBe(200);
    const followingIds = feed.body.following.map((p) => p.postId);
    expect(followingIds.slice(0, 2).sort()).toEqual([post.body.postId, own.body.postId].sort());
    const suggestedAuthors = feed.body.suggested.map((p) => p.author.userId);
    expect(suggestedAuthors).not.toContain(friend.memberId);
    expect(suggestedAuthors).not.toContain(reader.memberId);
    expect(feed.body.suggested.length).toBeGreaterThan(0);
    for (const p of feed.body.suggested) expect(p.reason).toBeTruthy();

    // Paging through suggestions never repeats a post
    const more = await reader.agent.get('/api/social/feed').query({ offset: feed.body.suggested.length });
    const ids = new Set(feed.body.suggested.map((p) => p.postId));
    for (const p of more.body.suggested) expect(ids.has(p.postId)).toBe(false);
  });

  test('the algorithm learns: liking a #tag post ranks other #tag posts first', async () => {
    const reader = await memberWithPlan(admin);
    const author = await memberWithPlan(admin);
    const tag = `zz${Date.now().toString(36)}`;
    const first = await author.agent.post('/api/social/posts').send({ body: `Trying something new #${tag}` });
    const second = await author.agent.post('/api/social/posts').send({ body: `Day two of #${tag}, loving it` });

    const before = await reader.agent.get('/api/social/me');
    expect(before.body.interests).toEqual([]);

    await reader.agent.post(`/api/social/posts/${first.body.postId}/like`);
    const after = await reader.agent.get('/api/social/me');
    expect(after.body.interests).toEqual([{ tag, score: 2 }]);   // a like counts 2 (view v_user_tag_interest)

    const feed = await reader.agent.get('/api/social/feed');
    const top = feed.body.suggested[0];
    expect(top.postId).toBe(second.body.postId);
    expect(top.reason).toBe(`Because you like #${tag}`);
    expect(feed.body.suggested.map((p) => p.postId)).not.toContain(first.body.postId); // already liked
  });
});
