# GitHub

A repository's commit activity and contributors, or one person's contributions
and recent events.

Two views describe a repository and two describe a person.

| View                            | Shows                                                                                     | Whose                | Needs a token     |
| ------------------------------- | ----------------------------------------------------------------------------------------- | -------------------- | ----------------- |
| Repository: commit activity     | The repository's last year as a grid of dots, total commits, and the busiest contributors | Everyone who commits | No                |
| Repository: stars and open work | Stars, forks, open issues, open pull requests, last push                                  | The repository       | No                |
| Person: contributions           | One person's last year as a grid of dots, and their total                                 | One account          | Yes               |
| Person: activity                | Recent events in plain language: pushes, pull requests, issues, stars                     | One account          | No, but see below |

To see how a project is doing, use **Repository: commit activity**. It counts
everybody's commits, not just yours, and needs no token.

## Settings

- **Repository or organisation** for the two repository views. Either
  `owner/name` for one repository, or a bare `owner` for everything that owner
  has, which is what you want for a team or a company. A pasted GitHub URL
  works for both.
- **GitHub username** for the two person views.
- **Personal access token**, stored as a per-block secret and never sent to a
  Player. Alternatively set `MORROW_GITHUB_TOKEN` on Morrow Server for every
  block at once.
- **Label**, which defaults to the username or repository.

## Why a token

GitHub's per-person contribution calendar is only available through GraphQL,
which refuses unauthenticated requests, so **Person: contributions** needs
one. A repository's commit activity comes from a REST endpoint and does not.

The other views work without a token, with two caveats. First, the public
events feed excludes anything that happened in a private repository and can
lag by a few hours, so an activity feed for a person looks emptier and staler
than their profile does. Second, the unauthenticated limit is 60 requests an
hour **per IP address**. Self-hosted on your own address that is fine for a few
blocks. On Cloudflare Workers the address is shared with other tenants, and
the budget with it, so a token is effectively required there.

Create a fine-grained token at github.com/settings/tokens with no repository
access if you only want public data. Grant read access to the repositories
you want private activity for. Nothing in this plugin writes.

## A whole organisation

Put a bare name in the repository field, such as `Aptide-ai`, and the commit
activity view covers everything that owner has rather than one repository. It
lists the owner's ten most recently pushed repositories, adds their weekly
commits together on the week each week starts, and shows the busiest
repositories by name instead of the busiest contributors.

That costs eleven requests per refresh rather than three, so a token is
required in practice: the unauthenticated allowance is sixty an hour for the
whole IP address.

Private repositories need a token that can actually see them. A fine-grained
token created for "Public repositories" cannot, even if you are an owner of
the organisation. Create the token with the **organisation** as its resource
owner, select the repositories, and grant **Contents: read-only**. Some
organisations require an owner to approve the token before it works. If the
token cannot see anything, the block says so rather than looking empty.

## Statistics GitHub computes lazily

Commit activity and the contributor list are cached statistics. The first
request for a repository is answered with `202 Accepted` and an empty body
while GitHub works them out in the background. The plugin retries once, then
reports that they are on the way and picks them up on the next poll rather
than blocking a fetch.

The two arrive independently, so a block may show the contributors before the
graph, or the other way round; it shows whichever has arrived. A brand-new
repository can return an empty contributor list for a while even with commits
present, and the block then shows the graph alone.

## If a block shows nothing

Two things catch people out.

**The token has its own Save.** It is stored through the secrets API, keyed to
the block, and is deliberately never part of the configuration. So the Save
button at the top of Admin does not include it: press the Save beside the
token field, or hit Enter in it. The note under the field says so while a
value is waiting.

**The repository field wants `owner/name`.** `morrow-glance` alone is not
enough; `Espen-PublAI/morrow-glance` is. A bad entry here is reported as a
warning and no longer stops the other views from loading.

## Data

Morrow Server fetches every five minutes while a screen shows the block, and
each view's data is fetched independently: a token that cannot read
contributions still gets you the activity feed, and the block explains what
is missing rather than going blank. Stored data is compact by design: the
year of contributions is 53 weeks of seven integers, and each event keeps
only the fields a sentence needs.

The parsers are tested against captured API responses in `__tests__/`, with
personal details stripped.
