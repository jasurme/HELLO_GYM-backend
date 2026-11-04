const express = require('express');
const { requireRole } = require('../middleware/auth');
const social = require('../services/social');
const v = require('../lib/validate');

// The social area is for members and trainers (R13 is enforced by triggers too).
const router = express.Router();
router.use(requireRole('member', 'trainer'));

const me = (req) => req.user.userId;
const postId = (req) => v.validate(v.id, req.params.id);
const bodySchema = v.z.object({ body: v.z.string().max(2000) });

router.get('/me', async (req, res) => {
  const [card, interests] = await Promise.all([social.summary(me(req)), social.interests(me(req))]);
  res.json({ ...card, interests });
});

// ---- Feed and posts --------------------------------------------------
router.get('/feed', async (req, res) => {
  const { offset } = v.validate(v.z.object({ offset: v.z.coerce.number().int().min(0).default(0) }), req.query);
  res.json(await social.feed(me(req), { offset }));
});

router.get('/tags/:tag', async (req, res) => {
  res.json(await social.postsByTag(me(req), req.params.tag));
});

router.get('/trending', async (req, res) => {
  res.json(await social.trending());
});

router.post('/posts', async (req, res) => {
  const { body } = v.validate(bodySchema, req.body);
  res.status(201).json(await social.createPost(me(req), body));
});

router.get('/posts/:id', async (req, res) => {
  res.json(await social.getPost(me(req), postId(req)));
});

router.delete('/posts/:id', async (req, res) => {
  await social.deletePost(me(req), postId(req));
  res.status(204).end();
});

router.post('/posts/:id/like', async (req, res) => {
  res.json(await social.setLike(me(req), postId(req), true));
});

router.delete('/posts/:id/like', async (req, res) => {
  res.json(await social.setLike(me(req), postId(req), false));
});

router.get('/posts/:id/comments', async (req, res) => {
  res.json(await social.listComments(postId(req)));
});

router.post('/posts/:id/comments', async (req, res) => {
  const { body } = v.validate(bodySchema, req.body);
  res.status(201).json(await social.addComment(me(req), postId(req), body));
});

router.delete('/comments/:id', async (req, res) => {
  res.json(await social.deleteComment(me(req), postId(req)));
});

// ---- People ------------------------------------------------------------
router.get('/search', async (req, res) => {
  const { q } = v.validate(v.z.object({ q: v.z.string().max(60).default('') }), req.query);
  res.json(await social.searchUsers(me(req), q));
});

router.get('/suggestions', async (req, res) => {
  res.json(await social.suggestions(me(req)));
});

router.get('/users/:username', async (req, res) => {
  res.json(await social.profile(me(req), req.params.username));
});

router.get('/users/:username/followers', async (req, res) => {
  res.json(await social.connections(me(req), req.params.username, 'followers'));
});

router.get('/users/:username/following', async (req, res) => {
  res.json(await social.connections(me(req), req.params.username, 'following'));
});

router.post('/users/:username/follow', async (req, res) => {
  res.json(await social.setFollow(me(req), req.params.username, true));
});

router.delete('/users/:username/follow', async (req, res) => {
  res.json(await social.setFollow(me(req), req.params.username, false));
});

module.exports = router;
