// Shared building blocks for the social area: post cards (X-style), people
// rows with Follow buttons (Instagram-style), comments, the composer, and
// the live people search. Pages wire them up with attachSocial().
import {
  api, html, render, avatar, toast, showError, confirmDialog, parseLocal, $, $$,
} from './app.js';

export const MAX_POST = 280;
export const profileUrl = (username) => `/social/profile.html?u=${encodeURIComponent(username)}`;
export const tagUrl = (tag) => `/social/?tag=${encodeURIComponent(tag)}`;

// "now", "5m", "3h", "2d", then "3 Nov" (and the year when it differs)
export function relTime(value) {
  const d = parseLocal(value);
  const secs = Math.max(0, (Date.now() - d) / 1000);
  if (secs < 60) return 'now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 7 * 86400) return `${Math.floor(secs / 86400)}d`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

// Post text with #hashtags and @mentions turned into links (escaped safely).
// A token must not follow a letter (so emails stay plain) and a mention never
// ends with '.' (the end of a sentence).
const TOKEN_RE = /(^|[^A-Za-z0-9_])([#@])([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)/g;
export function richText(body) {
  const parts = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    const [, before, sign, token] = m;
    const word = sign === '#' ? token.split('.')[0] : token;     // hashtags have no '.'
    const start = m.index + before.length;
    parts.push(body.slice(last, start));
    parts.push(sign === '#'
      ? html`<a href="${tagUrl(word.toLowerCase())}">#${word}</a>`
      : html`<a href="${profileUrl(word.toLowerCase())}">@${word}</a>`);
    last = start + 1 + word.length;
  }
  parts.push(body.slice(last));
  return html`${parts}`;
}

const trainerTick = (p) => (p.role === 'trainer'
  ? html`<i class="bi bi-patch-check-fill verified" title="BinaryFit trainer${p.specialization ? ` · ${p.specialization}` : ''}"></i>` : '');

export function followButton(person) {
  if (person.isMe) return '';
  return person.following
    ? html`<button class="btn btn-sm btn-follow following" data-follow="${person.username}" data-following="1">Following</button>`
    : html`<button class="btn btn-sm btn-primary btn-follow" data-follow="${person.username}">${person.followsYou ? 'Follow back' : 'Follow'}</button>`;
}

export function personRow(p, { showFollow = true, why = null } = {}) {
  return html`<div class="person-row">
    <a href="${profileUrl(p.username)}">${avatar(p.name, p.userId)}</a>
    <a class="who text-decoration-none text-body" href="${profileUrl(p.username)}">
      <div class="fw-semibold text-truncate">${p.name} ${trainerTick(p)}</div>
      <div class="handle text-truncate">@${p.username}${p.followsYou ? html` <span class="badge badge-follows-you ms-1">Follows you</span>` : ''}</div>
      ${why ? html`<div class="why text-truncate">${why}</div>` : ''}
    </a>
    ${showFollow ? followButton(p) : ''}
  </div>`;
}

export function postCard(post, { me, fresh = false } = {}) {
  const a = post.author;
  const mine = me && a.userId === me.userId;
  const reasonIcon = post.reason?.startsWith('@') ? 'heart-fill' : post.reason?.startsWith('From your') ? 'person-badge' : 'stars';
  return html`<article class="post ${fresh ? 'post-new' : ''}" data-post="${post.postId}">
    ${post.reason ? html`<div class="post-reason"><i class="bi bi-${reasonIcon} me-1"></i>${post.reason}</div>` : ''}
    <div class="d-flex gap-3">
      <a href="${profileUrl(a.username)}" class="flex-shrink-0">${avatar(a.name, a.userId)}</a>
      <div class="flex-grow-1 min-w-0">
        <div class="post-head">
          <a class="name fw-bold" href="${profileUrl(a.username)}">${a.name}</a>${trainerTick(a)}
          <a class="text-secondary" href="${profileUrl(a.username)}">@${a.username}</a>
          <span class="text-secondary">· <time title="${post.createdAt}">${relTime(post.createdAt)}</time></span>
          ${mine ? html`<div class="dropdown ms-auto">
            <button class="btn btn-sm btn-link text-secondary p-0" data-bs-toggle="dropdown" aria-label="More"><i class="bi bi-three-dots"></i></button>
            <ul class="dropdown-menu dropdown-menu-end"><li><button class="dropdown-item text-danger" data-delete-post="${post.postId}"><i class="bi bi-trash me-2"></i>Delete</button></li></ul>
          </div>` : ''}
        </div>
        <div class="post-body">${richText(post.body)}</div>
        <div class="post-actions">
          <button class="pa pa-reply" data-comments="${post.postId}" aria-label="Replies"><i class="bi bi-chat"></i><span>${post.comments || ''}</span></button>
          <button class="pa pa-like ${post.likedByMe ? 'liked' : ''}" data-like="${post.postId}" aria-pressed="${post.likedByMe}" aria-label="Like">
            <i class="bi ${post.likedByMe ? 'bi-heart-fill' : 'bi-heart'}"></i><span>${post.likes || ''}</span></button>
        </div>
        <div class="post-comments d-none" id="comments-${post.postId}"></div>
      </div>
    </div>
  </article>`;
}

function commentList(postId, comments, me) {
  return html`
    ${comments.map((c) => html`<div class="comment">
      <a href="${profileUrl(c.username)}">${avatar(c.name, c.authorId, 'avatar-sm')}</a>
      <div class="flex-grow-1 min-w-0">
        <div class="post-head small"><a class="name fw-semibold" href="${profileUrl(c.username)}">${c.name}</a>${trainerTick(c)}
          <span class="text-secondary">@${c.username} · ${relTime(c.createdAt)}</span>
          ${me && c.authorId === me.userId ? html`<button class="btn btn-sm btn-link text-secondary p-0 ms-auto" data-delete-comment="${c.commentId}" data-post-id="${postId}" aria-label="Delete reply"><i class="bi bi-x-lg"></i></button>` : ''}</div>
        <div class="body">${richText(c.body)}</div>
      </div></div>`)}
    <form class="d-flex gap-2 mt-2" data-reply="${postId}">
      <input class="form-control form-control-sm rounded-pill" name="body" maxlength="${MAX_POST}" placeholder="Post your reply" autocomplete="off">
      <button class="btn btn-sm btn-primary rounded-pill px-3" type="submit">Reply</button>
    </form>`;
}

// Composer with an X-style character ring.
export function composer(me) {
  const r = 10;
  const c = 2 * Math.PI * r;
  return html`<form class="composer p-3 border-bottom" id="composer">
    <div class="d-flex gap-3">
      ${avatar(me.name, me.userId)}
      <div class="flex-grow-1">
        <textarea class="form-control" name="body" rows="2" placeholder="What did you train today?" aria-label="New post"></textarea>
        <div class="d-flex align-items-center gap-2 border-top pt-2 mt-1">
          <span class="small text-secondary flex-grow-1"><span class="d-none d-sm-inline"><i class="bi bi-hash"></i> Add #hashtags so people who like them find your post</span></span>
          <span class="char-left text-secondary" id="charLeft"></span>
          <svg class="char-ring" viewBox="0 0 26 26" aria-hidden="true"><circle class="track" cx="13" cy="13" r="${r}"></circle>
            <circle class="meter" id="charMeter" cx="13" cy="13" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c}"></circle></svg>
          <button class="btn btn-primary rounded-pill px-4 fw-semibold" type="submit" disabled>Post</button>
        </div>
      </div>
    </div>
  </form>`;
}

export function wireComposer(form, { onPosted }) {
  const textarea = form.elements.body;
  const button = $('[type=submit]', form);
  const meter = $('#charMeter', form);
  const left = $('#charLeft', form);
  const circumference = Number(meter.getAttribute('stroke-dasharray'));
  const update = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
    const n = [...textarea.value].length;
    const remaining = MAX_POST - n;
    meter.setAttribute('stroke-dashoffset', String(circumference * (1 - Math.min(n, MAX_POST) / MAX_POST)));
    const ring = meter.closest('svg');
    ring.classList.toggle('warn', remaining <= 20 && remaining >= 0);
    ring.classList.toggle('over', remaining < 0);
    left.textContent = remaining <= 20 ? remaining : '';
    left.classList.toggle('text-danger', remaining < 0);
    button.disabled = !textarea.value.trim() || remaining < 0;
  };
  textarea.addEventListener('input', update);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      const post = await api('/social/posts', { method: 'POST', body: { body: textarea.value } });
      textarea.value = '';
      update();
      onPosted(post);
    } catch (err) {
      showError(err);
      update();
    }
  });
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !button.disabled) form.requestSubmit();
  });
  update();
}

// Live people search with a dropdown of results.
export function wireSearch(input, resultsEl) {
  let timer;
  let seq = 0;
  const close = () => { resultsEl.classList.add('d-none'); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { close(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      const people = await api('/social/search', { query: { q } }).catch(() => []);
      if (mine !== seq) return;
      render(resultsEl, people.length
        ? html`${people.map((p) => personRow(p, { showFollow: false }))}`
        : html`<div class="p-3 text-secondary small">No one found for “${q}”.</div>`);
      resultsEl.classList.remove('d-none');
    }, 200);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; close(); } });
  document.addEventListener('click', (e) => { if (!input.closest('.search-wrap').contains(e.target)) close(); });
}

// Likes, replies, follows and deletes for everything inside `root`.
export function attachSocial(root, { me, onFollowChange, onPostDeleted } = {}) {
  root.addEventListener('click', async (event) => {
    const like = event.target.closest('[data-like]');
    const reply = event.target.closest('[data-comments]');
    const follow = event.target.closest('[data-follow]');
    const delPost = event.target.closest('[data-delete-post]');
    const delComment = event.target.closest('[data-delete-comment]');

    if (like) {
      // Optimistic: flip at once, then settle with the server's count.
      const liked = !like.classList.contains('liked');
      const count = $('span', like);
      like.classList.toggle('liked', liked);
      like.classList.toggle('pop', liked);
      $('i', like).className = `bi ${liked ? 'bi-heart-fill' : 'bi-heart'}`;
      count.textContent = Math.max(0, (Number(count.textContent) || 0) + (liked ? 1 : -1)) || '';
      try {
        const res = await api(`/social/posts/${like.dataset.like}/like`, { method: liked ? 'POST' : 'DELETE' });
        count.textContent = res.likes || '';
      } catch (err) { showError(err); }
      setTimeout(() => like.classList.remove('pop'), 400);
    } else if (reply) {
      const box = $(`#comments-${reply.dataset.comments}`, root);
      if (!box.classList.contains('d-none')) { box.classList.add('d-none'); return; }
      render(box, html`<div class="small text-secondary py-2"><span class="spinner-border spinner-border-sm me-2"></span>Loading replies…</div>`);
      box.classList.remove('d-none');
      const comments = await api(`/social/posts/${reply.dataset.comments}/comments`);
      render(box, commentList(reply.dataset.comments, comments, me));
      $('input', box).focus();
    } else if (follow) {
      const following = follow.dataset.following === '1';
      if (following) {
        const ok = await confirmDialog({ title: `Unfollow @${follow.dataset.follow}?`, body: 'Their posts will no longer be at the top of your feed.', confirmText: 'Unfollow', variant: 'danger' });
        if (!ok) return;
      }
      follow.disabled = true;
      try {
        const res = await api(`/social/users/${encodeURIComponent(follow.dataset.follow)}/follow`, { method: following ? 'DELETE' : 'POST' });
        // Update every button for this person on the page.
        $$(`[data-follow="${CSS.escape(follow.dataset.follow)}"]`).forEach((b) => {
          b.dataset.following = res.following ? '1' : '';
          b.className = `btn btn-sm btn-follow ${res.following ? 'following' : 'btn-primary'}`;
          b.textContent = res.following ? 'Following' : 'Follow';
          b.disabled = false;
        });
        onFollowChange?.(follow.dataset.follow, res);
      } catch (err) {
        follow.disabled = false;
        showError(err);
      }
    } else if (delPost) {
      const ok = await confirmDialog({ title: 'Delete post?', body: 'This can’t be undone. Its likes and replies go too.', confirmText: 'Delete', variant: 'danger' });
      if (!ok) return;
      try {
        await api(`/social/posts/${delPost.dataset.deletePost}`, { method: 'DELETE' });
        $$(`[data-post="${delPost.dataset.deletePost}"]`).forEach((el) => el.remove());
        toast('Your post was deleted');
        onPostDeleted?.();
      } catch (err) { showError(err); }
    } else if (delComment) {
      try {
        const comments = await api(`/social/comments/${delComment.dataset.deleteComment}`, { method: 'DELETE' });
        const postId = delComment.dataset.postId;
        render($(`#comments-${postId}`, root), commentList(postId, comments, me));
        $(`[data-comments="${postId}"] span`, root).textContent = comments.length || '';
      } catch (err) { showError(err); }
    }
  });

  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-reply]');
    if (!form) return;
    event.preventDefault();
    const body = form.elements.body.value.trim();
    if (!body) return;
    try {
      const postId = form.dataset.reply;
      const comments = await api(`/social/posts/${postId}/comments`, { method: 'POST', body: { body } });
      render($(`#comments-${postId}`, root), commentList(postId, comments, me));
      $(`[data-comments="${postId}"] span`, root).textContent = comments.length || '';
      $(`#comments-${postId} input`, root).focus();
    } catch (err) { showError(err); }
  });
}

