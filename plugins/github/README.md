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

## What a block shows

The **Repository: commit activity** view has three parts, each of which can be
switched off in the block settings: the figures, the graph, and the people. So
one block can be the graph alone and another the figures and the names.

In the graph, each column is a week, oldest on the left, and each row is a day
of the week, Sunday at the top with Monday, Wednesday and Friday labelled. A
bigger, more solid dot is a busier day, scaled against the busiest day shown.

## Settings

With a token, **both settings are optional**. A token already says who it
belongs to and which repositories it can read, so leaving them blank gives you
the account behind the token and everything it can see. Fill them in only to
narrow that down.

- **Repository or organisation**, for the two repository views. Either
  `owner/name` for one repository, or a bare `owner` for everything that owner
  has. A pasted GitHub URL works for both. Blank with a token means every
  repository the token can read, labelled by the owner when they share one.
- **GitHub username**, for the two person views. Blank with a token means
  whoever the token belongs to.
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

## The short version

Paste a token, choose **Repository: commit activity**, and leave everything
else blank. That covers every repository the token can read.

## A whole organisation

Put a bare name in the repository field, such as `Aptide-ai`, and the commit
activity view covers everything that owner has rather than one repository. It
lists the owner's ten most recently pushed repositories, adds their weekly
commits together on the week each week starts, and shows the busiest
repositories by name instead of the busiest contributors.

That costs eleven requests per refresh rather than three, so a token is
required in practice: the unauthenticated allowance is sixty an hour for the
whole IP address.

### Tokens for private repositories

A fine-grained token created for "Public repositories" cannot see a private
organisation, even if you own that organisation. Getting this right has four
parts, and missing any one of them looks identical from the outside: GitHub
authenticates the token happily and returns an empty list.

1. **Resource owner** must be the organisation, not your personal account.
   This is the step people miss. It is a dropdown at the top of the token
   form, and it only offers organisations that permit fine-grained tokens.
2. **Repository access**: All repositories, or Only select repositories with
   the ones you want chosen.
3. **Permissions**: Repository permissions, Contents, Read-only.
4. **Approval**: many organisations require an owner to approve the token
   before it does anything. Until then it behaves exactly like a token with no
   access. Check Settings, Personal access tokens, Pending requests on the
   organisation.

If the organisation does not appear as a resource owner, it has fine-grained
tokens disabled. Use a **classic** token with the `repo` scope instead, from
github.com/settings/tokens, and enable single sign-on for the organisation on
the token if the organisation uses it.

The block distinguishes these cases as far as the API allows: a name that does
not exist, a token that reaches GitHub but can read nothing, and repositories
whose statistics GitHub has not finished computing.

## Statistics GitHub computes lazily

Commit activity and the contributor list are cached statistics. The first
request for a repository is answered with `202 Accepted` and an empty body
while GitHub works them out in the background, and for some repositories it
never finishes: they answer `202` for ever.

So the plugin retries a couple of times and then counts the commits itself,
from the commit list, over the last sixteen weeks. That always works, and it
is the window the graph shows for a young repository anyway. A repository with
no commits reports zero rather than looking like one that is still being
computed.

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
only what the chosen view needs: a repository view never asks who the token
belongs to, and a person view never lists repositories. Within a view the
parts are fetched independently, so a token that cannot read contributions
still gets you the activity feed, and the block explains what is missing
rather than going blank.

Stored data is compact by design: a year is 53 weeks of seven integers, and
each event keeps only the fields a sentence needs. An organisation of five
repositories costs about twenty requests per refresh, against an hourly
allowance of five thousand with a token.

The parsers are tested against captured API responses in `__tests__/`, with
personal details stripped.
