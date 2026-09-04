# GitHub

Contribution heatmap, recent activity, or the pulse of one repository.

| View          | Shows                                                                 | Needs a token     |
| ------------- | --------------------------------------------------------------------- | ----------------- |
| Contributions | The last year as a grid of dots, and the total                        | Yes               |
| Activity      | Recent events in plain language: pushes, pull requests, issues, stars | No, but see below |
| Repository    | Stars, forks, open issues, open pull requests, last push              | No                |

## Settings

- **GitHub username** for the Contributions and Activity views.
- **Repository** as `owner/name` for the Repository view. A pasted GitHub URL works too.
- **Personal access token**, stored as a per-block secret and never sent to a
  Player. Alternatively set `MORROW_GITHUB_TOKEN` on Morrow Server for every
  block at once.
- **Label**, which defaults to the username or repository.

## Why a token

GitHub's contribution calendar is only available through GraphQL, which
refuses unauthenticated requests, so the Contributions view needs one.

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
