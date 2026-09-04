# Ronda

GitHub PR review bot: comment-only, one pass per SHA, cheap API models first,
local model later. ADF and Helm consume it; they do not implement it.

**Contract:** [`docs/constitution.md`](docs/constitution.md)

GitHub calls **one webhook URL**. Point that URL at the MacBook while
testing, later at the Mini or MiniPC. Same App.

## Status

Bootstrap: constitution and domain docs. First slice is the spec on
[Project #11](https://github.com/users/lhpaul/projects/11).

## Development

ADF `single_repo`. Default branch `develop`. Tracker: GitHub Project #11,
classification field **Work type**.

```text
/run-item <ISSUE>
```
