#!/usr/bin/env python3
"""Decide whether a merged pull request implements the item its branch names.

Issue #125. ``update-tracker-on-merge.yml`` used to close an item and set it
to Merged for every ``feature/<N>-*``, ``fix/<N>-*``, ``refactor/<N>-*`` and
``hotfix/<N>-*`` pull request merged to ``develop``. Evidence-only and
follow-up pull requests that reused the item's branch prefix therefore closed
the item although its implementation had not merged.

The rule is opt-in, using the line Protocol 03 already requires in an
implementing pull request: the description must carry a GitHub closing
keyword (close/closes/closed, fix/fixes/fixed, resolve/resolves/resolved)
followed by a reference to the SAME issue number the branch names. Anything
else -- no keyword, a keyword for another issue, a reference to another
repository, or a keyword only inside code or an HTML comment -- is treated as
ambiguous, and the caller leaves the item alone.

Code spans, fenced code blocks and HTML comments are stripped before
matching, so a description that quotes the convention (or a pull request
template's commented-out example) does not count as a declaration. That only
narrows what THIS workflow acts on; GitHub's own closing-keyword handling is
independent and may still close the issue -- see
docs/workflow/development-workflow/tracker-status-mapping.md.

Usage:
  tracker-merge-implements-issue.py --issue <N> --repo <owner/repo> \
      [--body-file <path>|-]

The description is read from --body-file (``-`` or omitted = stdin). Output is
key=value lines:

  IMPLEMENTS=true|false
  REASON=closing_keyword|no_closing_keyword|empty_body
  MATCH=<the matched text>            (only when IMPLEMENTS=true)

Exit codes: 0 decided (either way), 2 usage error. Performs no network I/O.
"""

from __future__ import annotations

import argparse
import re
import sys

KEYWORDS = r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)"
REPO = r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"

# keyword, then a colon and/or whitespace, then one reference form:
#   #N | owner/repo#N | https://github.com/owner/repo/issues/N
CLOSING_RE = re.compile(
    r"(?<![A-Za-z0-9_])"
    + KEYWORDS
    + r"(?::[ \t]*|[ \t]+)"
    + r"(?:"
    + r"(?P<qualified>" + REPO + r")?#(?P<num>[0-9]+)"
    + r"|https?://github\.com/(?P<url_repo>" + REPO + r")/issues/(?P<url_num>[0-9]+)"
    + r")(?![0-9A-Za-z_])",
    re.IGNORECASE,
)

FENCE_RE = re.compile(r"^[ \t]*(```|~~~).*?^[ \t]*\1[^\n]*$", re.MULTILINE | re.DOTALL)
UNTERMINATED_FENCE_RE = re.compile(r"^[ \t]*(```|~~~).*\Z", re.MULTILINE | re.DOTALL)
HTML_COMMENT_RE = re.compile(r"<!--.*?(?:-->|\Z)", re.DOTALL)
INLINE_CODE_RE = re.compile(r"(`+)(?:(?!\1).)+?\1", re.DOTALL)


def strip_non_prose(body: str) -> str:
    """Remove HTML comments, fenced code and inline code spans."""
    text = HTML_COMMENT_RE.sub(" ", body)
    text = FENCE_RE.sub(" ", text)
    text = UNTERMINATED_FENCE_RE.sub(" ", text)
    text = INLINE_CODE_RE.sub(" ", text)
    return text


def decide(body: str, issue: int, repo: str) -> dict[str, str]:
    if not body.strip():
        return {"IMPLEMENTS": "false", "REASON": "empty_body"}
    prose = strip_non_prose(body)
    repo_lower = repo.lower()
    for match in CLOSING_RE.finditer(prose):
        if match.group("num") is not None:
            number = int(match.group("num"))
            target_repo = match.group("qualified")
        else:
            number = int(match.group("url_num"))
            target_repo = match.group("url_repo")
        if number != issue:
            continue
        if target_repo is not None and target_repo.lower() != repo_lower:
            continue
        return {
            "IMPLEMENTS": "true",
            "REASON": "closing_keyword",
            "MATCH": " ".join(match.group(0).split()),
        }
    return {"IMPLEMENTS": "false", "REASON": "no_closing_keyword"}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--issue", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--body-file", default="-")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return 0 if exc.code == 0 else 2

    if not re.fullmatch(r"[0-9]+", args.issue):
        print(f"ERROR: --issue must be a positive integer, got {args.issue!r}", file=sys.stderr)
        return 2
    if not re.fullmatch(REPO, args.repo):
        print(f"ERROR: --repo must be owner/repo, got {args.repo!r}", file=sys.stderr)
        return 2

    if args.body_file == "-":
        body = sys.stdin.read()
    else:
        try:
            with open(args.body_file, encoding="utf-8", errors="replace") as handle:
                body = handle.read()
        except OSError as exc:
            print(f"ERROR: cannot read --body-file: {exc}", file=sys.stderr)
            return 2

    for key, value in decide(body, int(args.issue), args.repo).items():
        print(f"{key}={value}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
