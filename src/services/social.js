const { QueryTypes } = require('sequelize');
const { sequelize, User } = require('../models');
const { select, selectOne } = require('../lib/sql');
const { badRequest, notFound, forbidden } = require('../lib/http-error');

const MAX_POST = 280;
const TAG_RE = /#([a-z0-9_]{1,30})/gi; // hashtags: stored lowercase, without '#'

const tagsIn = (body) => [...new Set([...body.matchAll(TAG_RE)].map((m) => m[1].toLowerCase()))];

// One post, shaped for the feed. `:me` decides likedByMe.
const POST_FIELDS = `
  p.post_id, p.body, p.created_at,
  u.user_id AS author_id, u.username, CONCAT(u.first_name, ' ', u.last_name) AS name, r.role_name AS role,
  t.specialization,
  (SELECT COUNT(*) FROM post_likes l    WHERE l.post_id = p.post_id) AS likes,
  (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.post_id) AS comments,
  EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.post_id AND l.user_id = :me) AS liked_by_me`;
const POST_JOINS = `
  JOIN users u    ON u.user_id = p.author_id AND u.is_active
  JOIN roles r    ON r.role_id = u.role_id
  LEFT JOIN trainers t ON t.trainer_id = u.user_id`;

function shapePost(row) {
  return {
    postId: row.postId,
    body: row.body,
    createdAt: row.createdAt,
    author: {
      userId: row.authorId, username: row.username, name: row.name, role: row.role, specialization: row.specialization,
    },
    likes: row.likes,
    comments: row.comments,
    likedByMe: Boolean(row.likedByMe),
    reason: row.reason || null,
  };
}

async function findUser(username) {
  const user = await selectOne(
    `SELECT u.user_id, u.username, u.first_name, u.last_name, u.social_bio, u.created_at, r.role_name AS role,
            t.specialization, t.hourly_rate_krw
     FROM users u JOIN roles r ON r.role_id = u.role_id LEFT JOIN trainers t ON t.trainer_id = u.user_id
     WHERE u.username = :username AND u.is_active AND r.role_name IN ('member', 'trainer')`,
    { username: String(username || '').toLowerCase().replace(/^@/, '') },
  );
  if (!user) throw notFound('User');
  return user;
}

// ---------------------------------------------------------------------
// Feed: posts from people you follow (and your own) first, newest first;
// then "Suggested for you", ranked by what you engage with.
// ---------------------------------------------------------------------
async function followingFeed(me, { limit = 40 } = {}) {
  const rows = await select(
    `SELECT ${POST_FIELDS}
     FROM posts p ${POST_JOINS}
     WHERE (p.author_id = :me OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = :me))
       AND p.created_at >= NOW() - INTERVAL 30 DAY
     ORDER BY p.created_at DESC
     LIMIT ${Number(limit)}`,
    { me },
  );
  return rows.map(shapePost);
}

// The ranking ("algorithm"). Signals, from what the database already knows:
//   tag_score     how much you like the post's hashtags (view v_user_tag_interest)
//   author_score  how often you liked this author before
//   friend_likes  people you follow who liked it
//   trained_with  the author is a trainer you have trained with
//   likes, comments  overall popularity
// divided by an age penalty so fresh posts win ties.
async function suggestedFeed(me, { limit = 15, offset = 0 } = {}) {
  const rows = await select(
    `WITH my_tags AS (
       SELECT tag_id, tag, score FROM v_user_tag_interest WHERE user_id = :me
     ),
     my_authors AS (
       SELECT p.author_id, COUNT(*) AS n FROM post_likes l JOIN posts p ON p.post_id = l.post_id
       WHERE l.user_id = :me GROUP BY p.author_id
     ),
     candidates AS (
       SELECT ${POST_FIELDS},
         COALESCE((SELECT SUM(mt.score) FROM post_hashtags ph JOIN my_tags mt ON mt.tag_id = ph.tag_id
                   WHERE ph.post_id = p.post_id), 0)                                         AS tag_score,
         COALESCE((SELECT ma.n FROM my_authors ma WHERE ma.author_id = p.author_id), 0)     AS author_score,
         (SELECT COUNT(*) FROM post_likes l JOIN follows f ON f.followee_id = l.user_id AND f.follower_id = :me
           WHERE l.post_id = p.post_id)                                                     AS friend_likes,
         EXISTS (SELECT 1 FROM bookings b WHERE b.member_id = :me AND b.trainer_id = p.author_id
                   AND b.status <> 'cancelled')                                              AS trained_with,
         (SELECT mt.tag FROM post_hashtags ph JOIN my_tags mt ON mt.tag_id = ph.tag_id
           WHERE ph.post_id = p.post_id ORDER BY mt.score DESC LIMIT 1)                     AS matched_tag,
         (SELECT fu.username FROM post_likes l
            JOIN follows f ON f.followee_id = l.user_id AND f.follower_id = :me
            JOIN users fu ON fu.user_id = l.user_id
           WHERE l.post_id = p.post_id ORDER BY l.created_at DESC LIMIT 1)                  AS liked_by
       FROM posts p ${POST_JOINS}
       WHERE p.author_id <> :me
         AND p.author_id NOT IN (SELECT followee_id FROM follows WHERE follower_id = :me)
         AND NOT EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.post_id AND l.user_id = :me)
         AND p.created_at >= NOW() - INTERVAL 60 DAY
     )
     SELECT *,
       ( 2.0 * LN(1 + tag_score) + 1.5 * LN(1 + author_score) + 1.2 * friend_likes
       + 1.5 * trained_with + 0.8 * LN(1 + likes) + 0.5 * LN(1 + comments) + 0.1 )
       / POW(1 + TIMESTAMPDIFF(HOUR, created_at, NOW()) / 24, 0.6) AS score
     FROM candidates
     ORDER BY score DESC, created_at DESC
     LIMIT ${Number(limit) + 1} OFFSET ${Number(offset)}`,
    { me },
  );
  const hasMore = rows.length > limit;
  const posts = rows.slice(0, limit).map((r) => shapePost({
    ...r,
    reason: r.trainedWith ? 'From your trainer'
      : r.likedBy ? `@${r.likedBy} liked this`
        : r.matchedTag ? `Because you like #${r.matchedTag}`
          : 'Popular at BinaryFit',
  }));
  return { posts, hasMore };
}

async function feed(me, { offset = 0 } = {}) {
  const [following, suggested] = await Promise.all([
    offset ? [] : followingFeed(me),
    suggestedFeed(me, { offset }),
  ]);
  return { following, suggested: suggested.posts, hasMoreSuggested: suggested.hasMore };
}

async function postsByTag(me, tag) {
  const rows = await select(
    `SELECT ${POST_FIELDS}
     FROM posts p ${POST_JOINS}
     JOIN post_hashtags ph ON ph.post_id = p.post_id
     JOIN hashtags h ON h.tag_id = ph.tag_id AND h.name = :tag
     ORDER BY p.created_at DESC LIMIT 50`,
    { me, tag: String(tag).toLowerCase().replace(/^#/, '') },
  );
  return rows.map(shapePost);
}

async function getPost(me, postId) {
  const row = await selectOne(`SELECT ${POST_FIELDS} FROM posts p ${POST_JOINS} WHERE p.post_id = :postId`, { me, postId });
  if (!row) throw notFound('Post');
  return shapePost(row);
}

// ---------------------------------------------------------------------
// Writing: posts (hashtags parsed into hashtags/post_hashtags), likes,
// comments. R13 (active members and trainers only) is a trigger.
// ---------------------------------------------------------------------
async function createPost(me, body) {
  const text = String(body || '').trim();
  if (!text) throw badRequest('Write something first');
  if ([...text].length > MAX_POST) throw badRequest(`Posts are at most ${MAX_POST} characters`);
  const postId = await sequelize.transaction(async (transaction) => {
    const [id] = await sequelize.query('INSERT INTO posts (author_id, body) VALUES (:me, :text)',
      { replacements: { me, text }, type: QueryTypes.INSERT, transaction });
    const tags = tagsIn(text);
    if (tags.length) {
      await sequelize.query(`INSERT IGNORE INTO hashtags (name) VALUES ${tags.map(() => '(?)').join(', ')}`,
        { replacements: tags, transaction });
      await sequelize.query(
        'INSERT INTO post_hashtags (post_id, tag_id) SELECT :id, tag_id FROM hashtags WHERE name IN (:tags)',
        { replacements: { id, tags }, transaction },
      );
    }
    return id;
  });
  return getPost(me, postId);
}

async function deletePost(me, postId) {
  const post = await selectOne('SELECT author_id FROM posts WHERE post_id = :postId', { postId });
  if (!post) throw notFound('Post');
  if (post.authorId !== me) throw forbidden('You can only delete your own posts');
  await sequelize.query('DELETE FROM posts WHERE post_id = :postId', { replacements: { postId } }); // likes, comments, tags cascade
}

async function setLike(me, postId, liked) {
  await getPost(me, postId);
  if (liked) {
    // Not INSERT IGNORE: IGNORE would also silence CHECK and R13 errors.
    await sequelize.query('INSERT INTO post_likes (user_id, post_id) VALUES (:me, :postId) ON DUPLICATE KEY UPDATE post_id = post_id',
      { replacements: { me, postId } });
  } else {
    await sequelize.query('DELETE FROM post_likes WHERE user_id = :me AND post_id = :postId', { replacements: { me, postId } });
  }
  const post = await getPost(me, postId);
  return { likes: post.likes, likedByMe: post.likedByMe };
}

async function listComments(postId) {
  return select(
    `SELECT c.comment_id, c.body, c.created_at, u.user_id AS author_id, u.username,
            CONCAT(u.first_name, ' ', u.last_name) AS name, r.role_name AS role
     FROM post_comments c JOIN users u ON u.user_id = c.author_id JOIN roles r ON r.role_id = u.role_id
     WHERE c.post_id = :postId AND u.is_active
     ORDER BY c.created_at ASC`,
    { postId },
  );
}

async function addComment(me, postId, body) {
  const text = String(body || '').trim();
  if (!text) throw badRequest('Write a reply first');
  if ([...text].length > MAX_POST) throw badRequest(`Replies are at most ${MAX_POST} characters`);
  await getPost(me, postId);
  await sequelize.query('INSERT INTO post_comments (post_id, author_id, body) VALUES (:postId, :me, :text)',
    { replacements: { postId, me, text } });
  return listComments(postId);
}

async function deleteComment(me, commentId) {
  const comment = await selectOne('SELECT author_id, post_id FROM post_comments WHERE comment_id = :commentId', { commentId });
  if (!comment) throw notFound('Comment');
  if (comment.authorId !== me) throw forbidden('You can only delete your own replies');
  await sequelize.query('DELETE FROM post_comments WHERE comment_id = :commentId', { replacements: { commentId } });
  return listComments(comment.postId);
}

// ---------------------------------------------------------------------
// People: search, profiles, follows, who to follow
// ---------------------------------------------------------------------
const PERSON_FIELDS = `
  u.user_id, u.username, CONCAT(u.first_name, ' ', u.last_name) AS name, r.role_name AS role, t.specialization,
  (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.user_id)                          AS followers,
  EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :me AND f.followee_id = u.user_id)  AS following,
  EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.user_id AND f.followee_id = :me)  AS follows_you`;
const PERSON_JOINS = `
  JOIN roles r ON r.role_id = u.role_id AND r.role_name IN ('member', 'trainer')
  LEFT JOIN trainers t ON t.trainer_id = u.user_id`;
const shapePerson = (p) => ({ ...p, following: Boolean(p.following), followsYou: Boolean(p.followsYou) });

// Instagram-style search: @username prefix first, then names.
async function searchUsers(me, query) {
  const q = String(query || '').trim().toLowerCase().replace(/^@/, '');
  if (!q) return [];
  const rows = await select(
    `SELECT ${PERSON_FIELDS},
            (u.username = :q) AS exact, (u.username LIKE :prefix) AS prefix
     FROM users u ${PERSON_JOINS}
     WHERE u.is_active AND u.user_id <> :me
       AND (u.username LIKE :prefix OR CONCAT(u.first_name, ' ', u.last_name) LIKE :contains)
     ORDER BY exact DESC, prefix DESC, following DESC, followers DESC, u.username
     LIMIT 15`,
    { me, q, prefix: `${q.replace(/[%_\\]/g, '\\$&')}%`, contains: `%${q.replace(/[%_\\]/g, '\\$&')}%` },
  );
  return rows.map(({ exact, prefix, ...p }) => shapePerson(p));
}

async function profile(me, username) {
  const user = await findUser(username);
  const [stats, relation, posts] = await Promise.all([
    selectOne('SELECT posts, followers, following FROM v_user_social_stats WHERE user_id = :id', { id: user.userId }),
    selectOne(
      `SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id = :me AND followee_id = :id) AS following,
              EXISTS (SELECT 1 FROM follows WHERE follower_id = :id AND followee_id = :me) AS follows_you`,
      { me, id: user.userId },
    ),
    select(`SELECT ${POST_FIELDS} FROM posts p ${POST_JOINS} WHERE p.author_id = :id ORDER BY p.created_at DESC LIMIT 50`,
      { me, id: user.userId }),
  ]);
  return {
    user: {
      userId: user.userId,
      username: user.username,
      name: `${user.firstName} ${user.lastName}`,
      role: user.role,
      socialBio: user.socialBio,
      joined: user.createdAt,
      specialization: user.specialization,
      hourlyRateKrw: user.hourlyRateKrw,
    },
    stats,
    isMe: user.userId === me,
    following: Boolean(relation.following),
    followsYou: Boolean(relation.followsYou),
    posts: posts.map(shapePost),
  };
}

async function setFollow(me, username, follow) {
  const user = await findUser(username);
  if (follow) {
    // ck_follows_not_self rejects following yourself; R13 checks both accounts.
    // Not INSERT IGNORE: IGNORE turns those errors into silent warnings.
    await sequelize.query('INSERT INTO follows (follower_id, followee_id) VALUES (:me, :id) ON DUPLICATE KEY UPDATE created_at = created_at',
      { replacements: { me, id: user.userId } });
  } else {
    await sequelize.query('DELETE FROM follows WHERE follower_id = :me AND followee_id = :id',
      { replacements: { me, id: user.userId } });
  }
  const stats = await selectOne('SELECT followers FROM v_user_social_stats WHERE user_id = :id', { id: user.userId });
  return { following: follow, followers: stats.followers };
}

async function connections(me, username, kind) {
  const user = await findUser(username);
  const [joinCol, whereCol] = kind === 'followers' ? ['follower_id', 'followee_id'] : ['followee_id', 'follower_id'];
  const rows = await select(
    `SELECT ${PERSON_FIELDS}
     FROM follows x JOIN users u ON u.user_id = x.${joinCol} AND u.is_active ${PERSON_JOINS}
     WHERE x.${whereCol} = :id
     ORDER BY x.created_at DESC`,
    { me, id: user.userId },
  );
  return rows.map(shapePerson);
}

// Who to follow: people who follow you, your trainers, friends of friends
// and people who like the same hashtags, then overall popularity.
async function suggestions(me, { limit = 5 } = {}) {
  const rows = await select(
    `WITH my_tags AS (SELECT tag_id FROM v_user_tag_interest WHERE user_id = :me ORDER BY score DESC LIMIT 5)
     SELECT ${PERSON_FIELDS},
       (SELECT COUNT(*) FROM follows f1 JOIN follows f2 ON f2.follower_id = f1.followee_id
         WHERE f1.follower_id = :me AND f2.followee_id = u.user_id)                         AS mutuals,
       (SELECT fu.username FROM follows f1 JOIN follows f2 ON f2.follower_id = f1.followee_id
          JOIN users fu ON fu.user_id = f1.followee_id
         WHERE f1.follower_id = :me AND f2.followee_id = u.user_id LIMIT 1)                 AS mutual_name,
       EXISTS (SELECT 1 FROM bookings b WHERE b.member_id = :me AND b.trainer_id = u.user_id
                 AND b.status <> 'cancelled')                                                AS trained_with,
       (SELECT COUNT(*) FROM v_user_tag_interest i JOIN my_tags mt ON mt.tag_id = i.tag_id
         WHERE i.user_id = u.user_id)                                                       AS shared_tags
     FROM users u ${PERSON_JOINS}
     WHERE u.is_active AND u.user_id <> :me
       AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :me AND f.followee_id = u.user_id)
     ORDER BY (3 * follows_you + 3 * trained_with + 2 * LN(1 + mutuals) + 0.8 * shared_tags + LN(1 + followers)) DESC,
              u.username
     LIMIT ${Number(limit)}`,
    { me },
  );
  return rows.map(({ mutuals, mutualName, trainedWith, sharedTags, ...p }) => ({
    ...shapePerson(p),
    reason: p.followsYou ? 'Follows you'
      : trainedWith ? 'Your trainer'
        : mutuals ? `Followed by @${mutualName}${mutuals > 1 ? ` + ${mutuals - 1} more` : ''}`
          : sharedTags ? 'Likes the same things as you'
            : p.role === 'trainer' ? `${p.specialization} coach` : 'Popular at BinaryFit',
  }));
}

async function trending() {
  return select(
    `SELECT h.name AS tag, COUNT(*) AS posts
     FROM post_hashtags ph JOIN hashtags h ON h.tag_id = ph.tag_id JOIN posts p ON p.post_id = ph.post_id
     WHERE p.created_at >= NOW() - INTERVAL 14 DAY
     GROUP BY h.tag_id, h.name ORDER BY posts DESC, h.name LIMIT 6`,
  );
}

async function interests(me) {
  return select('SELECT tag, score FROM v_user_tag_interest WHERE user_id = :me ORDER BY score DESC, tag LIMIT 8', { me });
}

// The logged-in person's card on the left of the feed.
async function summary(userId) {
  const user = await User.findByPk(userId, { attributes: ['userId', 'username', 'firstName', 'lastName', 'socialBio'] });
  const stats = await selectOne('SELECT posts, followers, following FROM v_user_social_stats WHERE user_id = :userId', { userId });
  return { userId, username: user.username, name: `${user.firstName} ${user.lastName}`, socialBio: user.socialBio, stats };
}

module.exports = {
  MAX_POST, tagsIn, feed, suggestedFeed, postsByTag, getPost, createPost, deletePost, setLike,
  listComments, addComment, deleteComment, searchUsers, profile, setFollow, connections, suggestions,
  trending, interests, summary,
};
