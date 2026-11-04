import {
  api, initPage, html, render, avatar, emptyState, queryParam, krw, parseLocal, $,
} from '../app.js';
import {
  postCard, personRow, followButton, attachSocial, profileUrl,
} from '../social.js';

const user = await initPage({ role: ['member', 'trainer'] });
const me = { userId: user.userId };
const username = (queryParam('u') || user.username || '').toLowerCase();

async function load() {
  let data;
  try {
    data = await api(`/social/users/${encodeURIComponent(username)}`);
  } catch {
    render('#page', html`<div class="card p-5">${emptyState('person-x', html`Sorry, @${username} isn’t here. <a href="/social/">Back to the feed</a>`)}</div>`);
    return;
  }
  const p = data.user;
  const s = data.stats;
  document.title = `${p.name} (@${p.username}) · BinaryFit`;
  const joined = parseLocal(p.joined).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  let actions;
  if (data.isMe) {
    actions = html`<a class="btn btn-light btn-sm fw-semibold px-3" href="/profile.html"><i class="bi bi-pencil me-1"></i>Edit profile</a>`;
  } else {
    actions = html`${followButton({ ...p, following: data.following, followsYou: data.followsYou })}
      ${p.role === 'trainer' && user.role === 'member'
    ? html`<a class="btn btn-sm btn-outline-primary rounded-pill fw-semibold" href="/member/book.html?trainer=${p.userId}"><i class="bi bi-calendar-plus me-1"></i>Book a session</a>` : ''}`;
  }

  // Instagram-style header: ringed avatar, handle + actions, counts, name + bio
  render('#page', html`
    <div class="row justify-content-center"><div class="col-lg-8">
      <div class="profile-head">
        <span class="story-ring">${avatar(p.name, p.userId, 'avatar-xl')}</span>
        <div class="flex-grow-1 min-w-0">
          <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
            <span class="handle me-2">${p.username}</span>
            ${p.role === 'trainer' ? html`<i class="bi bi-patch-check-fill verified fs-5" title="BinaryFit trainer"></i>` : ''}
            ${actions}
          </div>
          <div class="profile-stats mb-3">
            <span><b>${s.posts}</b> posts</span>
            <button data-show="followers"><b>${s.followers}</b> followers</button>
            <button data-show="following"><b>${s.following}</b> following</button>
          </div>
          <div class="fw-bold">${p.name}</div>
          ${p.role === 'trainer' ? html`<div class="small text-brand">${p.specialization} trainer · ${krw(p.hourlyRateKrw)}/hour</div>` : ''}
          ${p.socialBio ? html`<div>${p.socialBio}</div>` : ''}
          <div class="small text-secondary mt-1"><i class="bi bi-calendar3 me-1"></i>Joined ${joined}
            ${data.followsYou && !data.isMe ? html` · <span class="badge badge-follows-you">Follows you</span>` : ''}</div>
        </div>
      </div>

      <ul class="nav nav-underline border-bottom mb-0 justify-content-center">
        <li class="nav-item"><span class="nav-link active"><i class="bi bi-grid-3x3 me-1"></i>Posts</span></li>
      </ul>
      <div class="card feed-card mt-3">
        ${data.posts.length ? data.posts.map((post) => postCard(post, { me })) : emptyState('camera', data.isMe ? 'Share your first workout from the Social feed.' : 'No posts yet.')}
      </div>
    </div></div>

    <div class="modal fade" id="peopleModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">
        <div class="modal-header"><h5 class="modal-title" id="peopleTitle"></h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body p-0" id="peopleList"></div>
      </div></div>
    </div>`);

  const show = queryParam('show');
  if (show === 'followers' || show === 'following') openPeople(show);
}

async function openPeople(kind) {
  /* global bootstrap */
  $('#peopleTitle').textContent = kind === 'followers' ? 'Followers' : 'Following';
  render('#peopleList', html`<div class="p-4 text-center"><div class="spinner-border spinner-border-sm text-primary"></div></div>`);
  bootstrap.Modal.getOrCreateInstance($('#peopleModal')).show();
  const people = await api(`/social/users/${encodeURIComponent(username)}/${kind}`);
  render('#peopleList', people.length
    ? html`${people.map((person) => personRow({ ...person, isMe: person.userId === user.userId }))}`
    : emptyState('people', kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'));
}

$('#page').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-show]');
  if (btn) openPeople(btn.dataset.show);
});

attachSocial($('#page'), {
  me,
  onFollowChange: (handle, res) => {
    if (handle === username) {
      const counter = $('[data-show="followers"] b');
      if (counter) counter.textContent = res.followers;
    }
  },
});

await load();
