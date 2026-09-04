# Stack-Specific Best Practices

## Stack Summary

v0 stack is chosen in the spec. Until then:

- Keep the GitHub review payload and webhook verification independent of the
  model vendor.
- The public URL is operator config (tunnel), not a constant in this repo.
- No LH hostnames in git (`mac-mini`, `lhpaul.cl` in examples only).

## Quick Reference

- **Constitution wins** over “just push a fix from the bot”.
- **One SHA, one review.**
- **Webhook URL is movable.** Tests on the MacBook are valid.
- **Do not implement this inside ADF.** Adapter only.
