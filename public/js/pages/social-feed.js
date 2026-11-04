import {
  api, initPage, html, render, avatar, emptyState, queryParam, $,
} from '../app.js';
import {
  postCard, personRow, composer, wireComposer, wireSearch, attachSocial, profileUrl, tagUrl,
} from '../social.js';

await initPage({ role: ['member', 'trainer'] });

const tag = (queryParam('tag') || '').toLowerCase().replace(/^#/, '');
const state = { suggestedOffset: 0 };
let me = await api('/social/me');

// X-style three columns: you · feed · search and discovery
render('#page', html`
  <div class="row g-4">
    <aside class="col-lg-3 d-none d-lg-block"><div class="social-col-sticky" id="meCard"></div></aside>

    <section class="col-lg-6 col-xl-5">
      <div class="search-wrap mb-3 d-lg-none">
        <div class="input-group search-pill"><span class="input-group-text"><i class="bi bi-search"></i></span>
          <input class="form-control" id="searchMobile" type="search" placeholder="Search people by @username" autocomplete="off"></div>
        <div class="search-results d-none" id="resultsMobile"></div>
      </div>
      <div class="card feed-card" id="feedCard"></div>
    </section>

    <aside class="col-lg-3 col-xl-4">
      <div class="social-col-sticky d-flex flex-column gap-3">
        <div class="search-wrap d-none d-lg-block">
          <div class="input-group search-pill"><span class="input-group-text"><i class="bi bi-search"></i></span>
            <input class="form-control" id="search" type="search" placeholder="Search @username" autocomplete="off"></div>
          <div class="search-results d-none" id="results"></div>
        </div>
        <div class="card feed-card" id="whoToFollow"></div>
        <div class="card feed-card d-none d-lg-block" id="trending"></div>
      </div>
    </aside>
  </div>`);

wireSearch($('#search'), $('#results'));
wireSearch($('#searchMobile'), $('#resultsMobile'));

function drawMe() {
  render('#meCard', html`<div class="card feed-card">
    <div class="card-body text-center">
      <a href="${profileUrl(me.username)}" class="story-ring mb-2">${avatar(me.name, me.userId, 'avatar-lg')}</a>
      <div class="fw-bold fs-5">${me.name}</div>
      <a class="text-secondary text-decoration-none" href="${profileUrl(me.username)}">@${me.username}</a>
      ${me.socialBio ? html`<p class="small mt-2 mb-0">${me.socialBio}</p>` : ''}
      <div class="d-flex justify-content-around mt-3 small">
        <a class="text-body text-decoration-none" href="${profileUrl(me.username)}"><b>${me.stats.posts}</b><div class="text-secondary">posts</div></a>
        <a class="text-body text-decoration-none" href="${profileUrl(me.username)}&show=followers"><b>${me.stats.followers}</b><div class="text-secondary">followers</div></a>
        <a class="text-body text-decoration-none" href="${profileUrl(me.username)}&show=following"><b>${me.stats.following}</b><div class="text-secondary">following</div></a>
      </div>
    </div>
    ${me.interests.length ? html`<div class="card-body border-top">
      <div class="small fw-semibold mb-2"><i class="bi bi-stars text-brand me-1"></i>What you’re into</div>
      <div class="d-flex flex-wrap gap-1">${me.interests.map((i) => html`<a class="tag-chip" href="${tagUrl(i.tag)}">#${i.tag}</a>`)}</div>
      <div class="small text-secondary mt-2">From the posts you like, reply to and write. It shapes “Suggested for you”.</div>
    </div>` : ''}
  </div>`);
}

async function drawSidebar() {
  const [people, trends] = await Promise.all([api('/social/suggestions'), api('/social/trending')]);
  render('#whoToFollow', html`
    <div class="card-header fw-bold">Who to follow</div>
    ${people.length ? people.map((p) => personRow(p, { why: p.reason })) : html`<div class="p-3 small text-secondary">You follow everyone already!</div>`}`);
  render('#trending', html`
    <div class="card-header fw-bold">Trending at BinaryFit</div>
    ${trends.map((t, i) => html`<a class="trend-row" href="${tagUrl(t.tag)}">
      <div class="small text-secondary">${i + 1} · Trending this fortnight</div>
      <div class="fw-bold">#${t.tag}</div>
      <div class="small text-secondary">${t.posts} post${t.posts === 1 ? '' : 's'}</div></a>`)}`);
}

// ---- Feed: following first, then suggested -------------------------------
async function drawFeed() {
  if (tag) {
    const posts = await api(`/social/tags/${encodeURIComponent(tag)}`);
    document.title = `#${tag} · BinaryFit`;
    render('#feedCard', html`
      <div class="p-3 border-bottom d-flex align-items-center gap-3">
        <a href="/social/" class="btn btn-light rounded-circle" aria-label="Back to feed"><i class="bi bi-arrow-left"></i></a>
        <div><div class="fw-bold fs-5">#${tag}</div><div class="small text-secondary">${posts.length} post${posts.length === 1 ? '' : 's'}</div></div>
      </div>
      <div id="feedList">${posts.length ? posts.map((p) => postCard(p, { me })) : emptyState('hash', 'No posts with this hashtag yet.')}</div>`);
    return;
  }

  const data = await api('/social/feed');
  state.suggestedOffset = data.suggested.length;
  render('#feedCard', html`
    ${composer(me)}
    <div id="followingList">
      ${data.following.length ? data.following.map((p) => postCard(p, { me })) : html`
        <div class="p-4 text-center">
          <i class="bi bi-people fs-1 text-brand"></i>
          <h2 class="h5 fw-bold mt-2">Your feed is quiet</h2>
          <p class="text-secondary mb-0">Follow members and trainers to see their posts here first. Until then, here’s what’s popular.</p>
        </div>`}
    </div>
    ${data.suggested.length ? html`<div class="feed-divider"><i class="bi bi-stars"></i>
      <div>Suggested for you<div class="sub">${data.following.length ? 'You’re all caught up. Picked from what you like.' : 'Picked from what members like.'}</div></div></div>` : ''}
    <div id="suggestedList">${data.suggested.map((p) => postCard(p, { me }))}</div>
    <div class="p-3 text-center ${data.hasMoreSuggested ? '' : 'd-none'}" id="moreWrap">
      <button class="btn btn-light rounded-pill px-4" id="moreBtn">Show more</button>
    </div>`);

  wireComposer($('#composer'), {
    onPosted: (post) => {
      const list = $('#followingList');
      if (!list.querySelector('.post')) list.innerHTML = '';
      list.insertAdjacentHTML('afterbegin', String(postCard(post, { me, fresh: true })));
      me = { ...me, stats: { ...me.stats, posts: me.stats.posts + 1 } };
      drawMe();
    },
  });
  $('#moreBtn')?.addEventListener('click', loadMore);
}

async function loadMore() {
  const button = $('#moreBtn');
  button.disabled = true;
  const data = await api('/social/feed', { query: { offset: state.suggestedOffset } });
  state.suggestedOffset += data.suggested.length;
  $('#suggestedList').insertAdjacentHTML('beforeend', data.suggested.map((p) => String(postCard(p, { me }))).join(''));
  $('#moreWrap').classList.toggle('d-none', !data.hasMoreSuggested);
  button.disabled = false;
}

attachSocial($('#page'), {
  me,
  onFollowChange: async () => {
    me = await api('/social/me');
    drawMe();
  },
  onPostDeleted: async () => {
    me = await api('/social/me');
    drawMe();
  },
});

drawMe();
await Promise.all([drawFeed(), drawSidebar()]);
