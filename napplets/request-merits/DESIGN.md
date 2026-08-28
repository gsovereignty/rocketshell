# Request Merits design

- Deployment/d-tag: `request-merits`
- One job: validate, preview, and publish kind `1409` merit requests
- Required shell domain: `outbox`; optional enhancement: `theme`
- Shell owns requester identity, signing, relay routing, and publication
- Large layout pairs work-claim form with event guide; tiny layout stacks guide and fields
- Pointer and Enter activation both reach review; publish needs separate explicit confirmation
- No direct network, persistence, relay escape hatch, backend, or external asset
